/**
 * The game manifest an export writes to `data/game.<hash>.json` and the single-player runtime
 * reads at boot (release plan P3.1, section 3.4): levels, campaign, game data, the asset map and
 * versions. P3.3 builds it from a project; the runtime validates it before anything else runs.
 *
 * Asset paths are relative to the page (`assets/<sha256-16>.<ext>`), never absolute, so a game
 * plays from any folder of any host.
 */
import { validateLevelDataV3 } from '../../sim';
import type { LevelDataV3 } from '../../sim';
import { BUILTIN_MODEL_IDS, BUILTIN_SOUND_IDS, BUILTIN_TEXTURE_IDS, SAFE_ASSET_ID_REGEX } from '../assetIds';
import { RUNTIME_VERSION, majorVersion } from '../versions';
import type { GameData, ProjectCampaign } from './schema';

export const GAME_MANIFEST_FORMAT = 'retro-fps-gcs-game';
export const GAME_MANIFEST_SCHEMA_VERSION = 1;

export type GameAssetKind = 'texture' | 'model' | 'audio';

export interface GameAssetEntry {
  id: string;
  kind: GameAssetKind;
  /** Relative to the page, e.g. `assets/0123456789abcdef.png` */
  path: string;
  sha256: string;
  size: number;
  /** The model needs the Draco decoder (shipped in `draco/`) */
  draco?: boolean;
}

/** One file a credit covers: its name in the editor and its path in the game */
export interface GameCreditFile {
  name: string;
  path: string;
}

/** Who made the bundled assets (release plan P3.5); `CREDITS.txt` and the Credits screen show it */
export interface GameCredits {
  /** Asset library packs, sorted by title */
  packs: { title: string; author: string; license: string; source: string; files: GameCreditFile[] }[];
  /** The creator's uploads, sorted by name then path */
  uploads: { name: string; path: string; license: string; attribution: string }[];
}

export interface GameManifestV1 {
  format: typeof GAME_MANIFEST_FORMAT;
  schemaVersion: number;
  /** Version of the runtime the editor exported with */
  runtimeVersion: string;
  meta: { title: string; author: string; description: string; version: string };
  levels: { id: string; title: string; data: LevelDataV3 }[];
  campaign: ProjectCampaign;
  gameData: GameData;
  assets: GameAssetEntry[];
  /** Missing in games exported before P3.5 */
  credits?: GameCredits;
}

/**
 * A single-HTML game (P3.9) carries each file in a `<script type="application/octet-stream">`
 * with this attribute naming the file's path, and its base64 as the text
 */
export const EMBEDDED_FILE_ATTRIBUTE = 'data-gcs-file';

/** Paths an export may use: inside assets/, content-named, with a known extension */
export const GAME_ASSET_PATH = /^assets\/[0-9a-f]{16}\.(?:png|jpg|webp|glb|ogg|mp3)$/;

export type GameManifestCheck =
  | { ok: true; manifest: GameManifestV1 }
  | { ok: false; reason: 'newer-schema' | 'runtime-mismatch' | 'invalid'; message: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

const MAX_CREDIT_ENTRIES = 4096;
const isCreditFile = (v: unknown) => isObject(v) && isText(v.name, 200) && isText(v.path, 64) && GAME_ASSET_PATH.test(v.path as string);

function isCredits(v: unknown): v is GameCredits {
  if (!isObject(v) || !Array.isArray(v.packs) || !Array.isArray(v.uploads)) return false;
  if (v.packs.length > MAX_CREDIT_ENTRIES || v.uploads.length > MAX_CREDIT_ENTRIES) return false;
  const packsOk = v.packs.every(
    (p) =>
      isObject(p) &&
      isText(p.title, 200) &&
      isText(p.author, 200) &&
      isText(p.license, 200) &&
      isText(p.source, 2000) &&
      Array.isArray(p.files) &&
      p.files.length <= MAX_CREDIT_ENTRIES &&
      p.files.every(isCreditFile)
  );
  const uploadsOk = v.uploads.every(
    (u) => isCreditFile(u) && isText((u as Json).license, 200) && isText((u as Json).attribution, 1000)
  );
  return packsOk && uploadsOk;
}

/** Checks untrusted manifest JSON; never throws */
export function checkGameManifest(raw: unknown, runtimeVersion = RUNTIME_VERSION): GameManifestCheck {
  const invalid = (message: string): GameManifestCheck => ({ ok: false, reason: 'invalid', message });
  try {
    if (!isObject(raw) || raw.format !== GAME_MANIFEST_FORMAT) return invalid('This is not a Retro FPS GCS game file.');
    if (typeof raw.schemaVersion !== 'number' || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
      return invalid('The game file has no valid schema version.');
    }
    if (raw.schemaVersion > GAME_MANIFEST_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: 'newer-schema',
        message: `This game was made with a newer editor (game data version ${raw.schemaVersion}; this player reads up to ${GAME_MANIFEST_SCHEMA_VERSION}).`,
      };
    }
    if (typeof raw.runtimeVersion !== 'string' || Number.isNaN(majorVersion(raw.runtimeVersion))) {
      return invalid('The game file has no valid runtime version.');
    }
    if (majorVersion(raw.runtimeVersion) !== majorVersion(runtimeVersion)) {
      return {
        ok: false,
        reason: 'runtime-mismatch',
        message: `The game data is for runtime ${raw.runtimeVersion}, but this player is ${runtimeVersion}. Export the game again.`,
      };
    }

    const meta = raw.meta;
    if (!isObject(meta) || !isText(meta.title, 120) || !isText(meta.author, 200) || !isText(meta.description, 4000) || !isText(meta.version, 32)) {
      return invalid('The game file has invalid title or author information.');
    }
    if (!isObject(raw.campaign) || !isObject(raw.gameData)) return invalid('The game file has no campaign or game data.');

    if (!Array.isArray(raw.assets) || raw.assets.length > 4096) return invalid('The game file has an invalid asset list.');
    const textureIds = new Set<string>(BUILTIN_TEXTURE_IDS);
    const modelIds = new Set<string>(BUILTIN_MODEL_IDS);
    const seen = new Set<string>();
    for (const [i, a] of raw.assets.entries()) {
      if (
        !isObject(a) ||
        typeof a.id !== 'string' ||
        !SAFE_ASSET_ID_REGEX.test(a.id) ||
        seen.has(a.id) ||
        (a.kind !== 'texture' && a.kind !== 'model' && a.kind !== 'audio') ||
        typeof a.path !== 'string' ||
        !GAME_ASSET_PATH.test(a.path) ||
        typeof a.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(a.sha256) ||
        typeof a.size !== 'number' ||
        !Number.isInteger(a.size) ||
        a.size < 1 ||
        ('draco' in a && typeof a.draco !== 'boolean')
      ) {
        return invalid(`Asset ${i + 1} in the game file is invalid.`);
      }
      seen.add(a.id);
      if (a.kind === 'texture') textureIds.add(a.id);
      if (a.kind === 'model') modelIds.add(a.id);
    }

    if (raw.credits !== undefined && !isCredits(raw.credits)) return invalid('The game file has invalid credits.');

    if (!Array.isArray(raw.levels) || raw.levels.length < 1 || raw.levels.length > 64) {
      return invalid('The game file has no levels.');
    }
    for (const [i, level] of raw.levels.entries()) {
      if (!isObject(level) || typeof level.id !== 'string' || !isText(level.title, 120)) {
        return invalid(`Level ${i + 1} in the game file is invalid.`);
      }
      const result = validateLevelDataV3(level.data, {
        allowedTextureIds: textureIds,
        allowedModelIds: modelIds,
        allowedSoundIds: new Set(BUILTIN_SOUND_IDS),
      });
      if (!result.valid) {
        const first = result.errors[0];
        return invalid(`Level ${i + 1} in the game file is invalid (${first?.path ?? '$'}: ${first?.message ?? 'unknown'}).`);
      }
    }
    return { ok: true, manifest: raw as unknown as GameManifestV1 };
  } catch {
    return invalid('The game file could not be read.');
  }
}
