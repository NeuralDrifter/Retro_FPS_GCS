/**
 * Migrations from every earlier save format to the v4 project document (release plan P2.2).
 *
 *   v1  a bare grid array (the first editor)
 *   v2  editor save files, `version: "2.0"` (LevelStateData, with campaign levels and custom textures)
 *   v3  a `formatVersion: 3` level, or a GameManifest wrapping v3 levels (exported games)
 *   v4  the project document itself, returned as is after validation
 *
 * Converting v1 and v2 levels needs the editor's legacy converter (it registers assets with the
 * runtime), so callers pass it in as `legacyToV3`; this module stays free of the runtime.
 */
import type { LevelDataV3 } from '../../sim';
import { base64ToBytes, sha256Hex } from '../bytes';
import { SAFE_ASSET_ID_REGEX } from '../assetIds';
import { createDefaultGameData, slugify } from './defaults';
import { IMPORTED_LICENSE_NOT_RECORDED, PROJECT_ID_PATTERN, PROJECT_SCHEMA_VERSION } from './schema';
import type { ProjectCampaign, ProjectDocV4, ProjectLevel, UserAsset, UserAssetMimeType } from './schema';
import { validateProjectV4 } from './validate';

export type ProjectFormat =
  | { kind: 'v1' }
  | { kind: 'v2' }
  | { kind: 'v3-level' }
  | { kind: 'v3-manifest' }
  | { kind: 'v4' }
  | { kind: 'newer'; schemaVersion: number }
  | { kind: 'unknown' };

/** A legacy custom texture as the editor's converter reports it */
export interface LegacyTexture {
  id: string;
  name?: string;
  previewUrl?: string;
}

export interface MigrationOptions {
  /** The editor's v1/v2 level converter (LegacyLevelSerializer.migrateToV3) */
  legacyToV3?: (level: unknown) => { levelV3: LevelDataV3; customTextures: LegacyTexture[] };
  /** ID for the new project document */
  projectId: string;
  /** ISO 8601 time used for created and updated times the source does not carry */
  now: string;
  editorVersion: string;
}

export type MigrationResult =
  | { ok: true; doc: ProjectDocV4; from: ProjectFormat['kind']; notes: string[] }
  | { ok: false; error: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

export function detectProjectFormat(raw: unknown): ProjectFormat {
  if (Array.isArray(raw)) return Array.isArray(raw[0]) ? { kind: 'v1' } : { kind: 'unknown' };
  if (!isObject(raw)) return { kind: 'unknown' };
  if (typeof raw.schemaVersion === 'number') {
    if (raw.schemaVersion > PROJECT_SCHEMA_VERSION) return { kind: 'newer', schemaVersion: raw.schemaVersion };
    if (raw.schemaVersion === PROJECT_SCHEMA_VERSION) return { kind: 'v4' };
    if (raw.schemaVersion === 1 && isObject(raw.level)) return { kind: 'v3-manifest' };
  }
  if (raw.version === '2.0' || typeof raw.engine === 'string') return { kind: 'v2' };
  if (raw.formatVersion === 3) return { kind: 'v3-level' };
  if (Array.isArray(raw.grid)) return { kind: 'v2' };
  return { kind: 'unknown' };
}

const MIME_BY_DATA_URL: Record<string, UserAssetMimeType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/webp': 'image/webp',
};

/** Turns a legacy texture's base64 data URL into an embedded user asset */
function textureToUserAsset(texture: LegacyTexture, notes: string[]): UserAsset | null {
  const match = /^data:(image\/[a-z]+);base64,(.*)$/s.exec(texture.previewUrl ?? '');
  const mimeType = match ? MIME_BY_DATA_URL[match[1]] : undefined;
  const bytes = match && mimeType ? base64ToBytes(match[2]) : null;
  if (!match || !mimeType || !bytes || bytes.length === 0) {
    notes.push(`Custom texture '${texture.id}' is not an embedded PNG, JPEG or WebP image and was left out; levels using it show the default texture.`);
    return null;
  }
  const id = SAFE_ASSET_ID_REGEX.test(texture.id) && PROJECT_ID_PATTERN.test(texture.id) ? texture.id : `tex-${sha256Hex(bytes).slice(0, 16)}`;
  return {
    id,
    name: (texture.name ?? id).slice(0, 200) || id,
    mimeType,
    sha256: sha256Hex(bytes),
    size: bytes.length,
    // Older projects did not record a license; the export refuses it until it is uploaded again (P3.5)
    license: 'other',
    attribution: IMPORTED_LICENSE_NOT_RECORDED,
    data: match[2].replace(/\s+/g, ''),
  };
}

function campaignFrom(value: unknown): ProjectCampaign {
  const c = isObject(value) ? value : {};
  return {
    carryOverHealth: c.carryOverHealth !== false,
    carryOverAmmo: c.carryOverAmmo !== false,
    ...(isObject(c.menus) ? { menus: c.menus } : {}),
  };
}

function levelId(index: number): string {
  return `level-${index + 1}`;
}

function levelTitle(level: LevelDataV3, fallback: string, index: number): string {
  return (level.metadata?.title || fallback || `Level ${index + 1}`).trim().slice(0, 120) || `Level ${index + 1}`;
}

function assemble(
  options: MigrationOptions,
  meta: { title: string; author?: string; description?: string; createdAt?: string },
  levels: ProjectLevel[],
  campaign: ProjectCampaign,
  userAssets: UserAsset[]
): ProjectDocV4 {
  const title = meta.title.trim().slice(0, 120) || 'Untitled Game';
  const createdAt = meta.createdAt && /^\d{4}-\d{2}-\d{2}T/.test(meta.createdAt) ? meta.createdAt : options.now;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: options.projectId,
    meta: {
      title,
      author: (meta.author ?? 'Unknown').slice(0, 200),
      description: (meta.description ?? '').slice(0, 4000),
      version: '0.1.0',
      createdAt,
      updatedAt: options.now,
      editorVersion: options.editorVersion,
      contentLicense: 'all-rights-reserved',
    },
    assetLibrary: { id: 'retro-fps-gcs-assets', version: 'unpinned' },
    levels,
    campaign,
    gameData: createDefaultGameData(),
    userAssets,
    export: { slug: slugify(title) },
  };
}

function fromLegacy(raw: unknown, kind: 'v1' | 'v2', options: MigrationOptions, notes: string[]): ProjectDocV4 {
  if (!options.legacyToV3) throw new Error('Converting v1 and v2 files needs the editor (legacyToV3 was not provided).');
  const source: Json = isObject(raw) ? raw : {};
  // Editor saves hold the active level at the root and every level in `levels`
  const rawLevels: unknown[] = Array.isArray(source.levels) && source.levels.length > 0 ? source.levels : [raw];
  const assets = new Map<string, UserAsset>();
  const levels = rawLevels.map((rawLevel, i) => {
    const { levelV3, customTextures } = options.legacyToV3!(rawLevel);
    for (const texture of customTextures) {
      if (assets.has(texture.id)) continue;
      const asset = textureToUserAsset(texture, notes);
      if (asset) assets.set(texture.id, asset);
    }
    const legacyTitle = isObject(rawLevel) && typeof rawLevel.title === 'string' ? rawLevel.title : '';
    return { id: levelId(i), title: levelTitle(levelV3, legacyTitle, i), data: levelV3 };
  });
  if (kind === 'v1') notes.push('Converted from a v1 grid-only file: textures and entities use the defaults.');
  const title = typeof source.title === 'string' && source.title.trim() ? source.title : levels[0].title;
  return assemble(
    options,
    { title, createdAt: typeof source.timestamp === 'string' ? source.timestamp : undefined },
    levels,
    campaignFrom(source.campaign),
    [...assets.values()]
  );
}

/** Migrates any supported save format to a validated v4 project document. Never throws. */
export function migrateToV4(raw: unknown, options: MigrationOptions): MigrationResult {
  const format = detectProjectFormat(raw);
  const notes: string[] = [];
  try {
    let doc: ProjectDocV4;
    switch (format.kind) {
      case 'newer':
        return {
          ok: false,
          error: `This project uses schema version ${format.schemaVersion}, which is newer than this editor supports (${PROJECT_SCHEMA_VERSION}). Update the editor to open it.`,
        };
      case 'unknown':
        return { ok: false, error: 'This file is not a Retro FPS GCS project, level or exported game manifest.' };
      case 'v4':
        doc = raw as ProjectDocV4;
        break;
      case 'v3-level': {
        const level = raw as LevelDataV3;
        const title = levelTitle(level, '', 0);
        doc = assemble(options, { title, author: level.metadata?.author, createdAt: level.metadata?.exportedAt }, [{ id: levelId(0), title, data: level }], campaignFrom(undefined), []);
        break;
      }
      case 'v3-manifest': {
        const m = raw as Json;
        const meta = isObject(m.meta) ? m.meta : {};
        const levelsRaw = Array.isArray(m.levels) && m.levels.length > 0 ? m.levels : [m.level];
        const levels = levelsRaw.map((lvl, i) => {
          const level = lvl as LevelDataV3;
          return { id: levelId(i), title: levelTitle(level, '', i), data: level };
        });
        if (isObject(m.assets) && ((Array.isArray(m.assets.textures) && m.assets.textures.length > 0) || (Array.isArray(m.assets.models) && m.assets.models.length > 0))) {
          notes.push('The manifest listed exported asset files; they are not part of the project and were left out. Re-add uploaded assets in the Asset Library.');
        }
        doc = assemble(
          options,
          {
            title: typeof meta.title === 'string' ? meta.title : levels[0].title,
            author: typeof meta.author === 'string' ? meta.author : undefined,
            description: typeof meta.description === 'string' ? meta.description : undefined,
            createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : undefined,
          },
          levels,
          campaignFrom(m.campaign),
          []
        );
        break;
      }
      case 'v1':
      case 'v2':
        doc = fromLegacy(raw, format.kind, options, notes);
        break;
    }
    const result = validateProjectV4(doc);
    if (!result.valid) {
      const first = result.errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join('; ');
      return { ok: false, error: `The converted project is not valid: ${first}` };
    }
    return { ok: true, doc, from: format.kind, notes };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
