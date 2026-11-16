/**
 * ============================================================================
 * ASSET COLLECTOR, OFFLINE RESOLVER & DRACO BUNDLER (`src/export/collect.ts`)
 * ============================================================================
 * Phase 3 asset collector and offline packager:
 *  1. Scans LevelDataV3 grid cells, entities, and event actions (including
 *     nested if_then_else and random_branch).
 *  2. Skips built-in procedural textures, skyboxes, and archetypes.
 *  3. Resolves non-procedural assets to raw bytes from data URLs, AssetRegistry,
 *     Blob stores, or remote URLs.
 *  4. Generates canonical export paths (`assets/textures/...` and `assets/models/...`).
 *  5. Inspects GLTF binaries for KHR_draco_mesh_compression to bundle Draco decoders.
 *  6. Tracks licenses (GitHub repo license, user uploads, remote warnings) and
 *     formats ASSET_LICENSES.md.
 *
 * Runs in the browser (the editor, later a Web Worker). No React and no Node APIs:
 * tests inject file bytes through `readFile` and `dracoFiles`.
 */

import { LibraryIntegrityError, libraryFileRecord } from '../shared/libraryIntegrity';
import { sha256Hex } from '../shared/bytes';
import { LevelDataV3 } from '../sim';
import {
  GameManifest,
  LevelStateData,
  ManifestModelAsset,
  ManifestTextureAsset,
} from '../runtime/types';
import { AssetRegistry } from '../runtime/AssetRegistry';
import { createGameManifest, loadGameManifest } from '../runtime/manifest';
import { collectMenuTextureIds } from '../runtime/menu/types';
import { detectDracoCompression } from './glb';
import {
  BUILTIN_PROCEDURAL_MODEL_IDS,
  BUILTIN_PROCEDURAL_TEXTURE_IDS,
  isBuiltInModel,
  isBuiltInTexture,
  walkActions,
} from './references';

export {
  BUILTIN_PROCEDURAL_MODEL_IDS,
  BUILTIN_PROCEDURAL_TEXTURE_IDS,
  detectDracoCompression,
  isBuiltInModel,
  isBuiltInTexture,
  walkActions,
};

export function slugify(text: string): string {
  const s = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'asset';
}

export interface ReferencedAssets {
  textureIds: string[];
  modelIds: string[];
}

export interface AllReferencedAssets extends ReferencedAssets {
  allTextureIds: string[];
  allModelIds: string[];
  builtInTextureIds: string[];
  builtInModelIds: string[];
}

/**
 * Collects all texture and model IDs referenced by a level or manifest.
 * By default skips procedural built-ins that the runtime generates.
 */
export function collectReferencedAssets(
  levelInput: LevelDataV3 | LevelStateData | GameManifest
): ReferencedAssets {
  const all = collectAllReferencedAssets(levelInput);
  return {
    textureIds: all.textureIds,
    modelIds: all.modelIds,
  };
}

/**
 * Comprehensive asset collector returning both filtered (non-builtin) and
 * all referenced asset IDs across the primary level and any campaign levels.
 */
export function collectAllReferencedAssets(
  levelInput: LevelDataV3 | LevelStateData | GameManifest
): AllReferencedAssets {
  const primaryLevel: LevelDataV3 =
    'level' in levelInput && typeof (levelInput as any).level === 'object'
      ? (levelInput as GameManifest).level
      : (levelInput as LevelDataV3);

  const extraLevels: (LevelDataV3 | LevelStateData)[] =
    'levels' in levelInput && Array.isArray((levelInput as any).levels)
      ? ((levelInput as any).levels as (LevelDataV3 | LevelStateData)[])
      : [];

  const levelsToScan: (LevelDataV3 | LevelStateData)[] = [
    primaryLevel,
    ...extraLevels,
  ];

  const textureIdSet = new Set<string>();
  const modelIdSet = new Set<string>();

  for (const level of levelsToScan) {
    if (!level || typeof level !== 'object') continue;

    // 1. Scan cell textures
    if (Array.isArray(level.wallTextures)) {
      for (const row of level.wallTextures) {
        if (Array.isArray(row)) {
          for (const id of row) {
            if (id) textureIdSet.add(id);
          }
        }
      }
    }
    if (Array.isArray(level.floorTextures)) {
      for (const row of level.floorTextures) {
        if (Array.isArray(row)) {
          for (const id of row) {
            if (id) textureIdSet.add(id);
          }
        }
      }
    }
    if (Array.isArray(level.ceilingTextures)) {
      for (const row of level.ceilingTextures) {
        if (Array.isArray(row)) {
          for (const id of row) {
            if (id) textureIdSet.add(id);
          }
        }
      }
    }

    // 1b. Scan the textures of stacked layers (v3 `layers` or editor `vertical.layers`)
    const stackedLayers = Array.isArray((level as LevelDataV3).layers)
      ? (level as LevelDataV3).layers
      : Array.isArray((level as LevelStateData).vertical?.layers)
      ? (level as LevelStateData).vertical?.layers
      : undefined;
    if (Array.isArray(stackedLayers)) {
      for (const layer of stackedLayers) {
        for (const mat of [
          layer?.wallTextures,
          layer?.floorTextures,
          layer?.ceilingTextures,
        ]) {
          if (!Array.isArray(mat)) continue;
          for (const row of mat) {
            if (Array.isArray(row)) {
              for (const id of row) {
                if (id) textureIdSet.add(id);
              }
            }
          }
        }
      }
    }

    // 2. Scan event actions (including nested actions)
    if (Array.isArray(level.events)) {
      for (const evt of level.events) {
        walkActions(evt.actions, (action) => {
          if (action.type === 'set_wall_texture') {
            if (action.texture_id) textureIdSet.add(action.texture_id);
          } else if (action.type === 'set_floor_texture') {
            if (action.texture_id) textureIdSet.add(action.texture_id);
          } else if (action.type === 'set_ceiling_texture') {
            if (action.texture_id) textureIdSet.add(action.texture_id);
          } else if (action.type === 'spawn_entity') {
            const modelId =
              (action as any).modelAssetId || action.blueprintId;
            if (modelId) modelIdSet.add(modelId);
          }
        });
      }
    }

    // 3. Scan placed entities
    if (Array.isArray(level.entities)) {
      for (const ent of level.entities) {
        const modelId = ent.modelAssetId || ent.blueprintId;
        if (modelId) modelIdSet.add(modelId);
      }
    }
  }

  // 4. Scan UI Menu Pack textures (backgrounds, button skins, image widgets)
  const campaignObj =
    'campaign' in levelInput && levelInput.campaign
      ? levelInput.campaign
      : undefined;
  if (campaignObj?.menus) {
    for (const texId of collectMenuTextureIds(campaignObj.menus)) {
      if (texId) textureIdSet.add(texId);
    }
  }

  const allTextureIds = Array.from(textureIdSet);
  const allModelIds = Array.from(modelIdSet);

  const textureIds = allTextureIds.filter((id) => !isBuiltInTexture(id));
  const modelIds = allModelIds.filter((id) => !isBuiltInModel(id));
  const builtInTextureIds = allTextureIds.filter(isBuiltInTexture);
  const builtInModelIds = allModelIds.filter(isBuiltInModel);

  return {
    textureIds,
    modelIds,
    allTextureIds,
    allModelIds,
    builtInTextureIds,
    builtInModelIds,
  };
}

/**
 * Decodes a data URL (e.g. data:image/png;base64,...) to raw bytes and MIME type.
 */
export function decodeDataUrl(dataUrl: string): {
  bytes: Uint8Array;
  mimeType: string;
} {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    throw new Error('Invalid data URL: missing comma delimiter');
  }
  const header = dataUrl.slice(0, commaIdx);
  const base64Data = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;,]+)/i.exec(header);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(base64Data, 'base64');
    return {
      bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      mimeType,
    };
  } else if (typeof atob === 'function') {
    const binary = atob(base64Data);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, mimeType };
  }
  throw new Error('No base64 decoder available in runtime environment');
}

export function extensionFromMimeType(mimeType: string, defaultExt = 'bin'): string {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('svg')) return 'svg';
  if (lower.includes('gltf-binary') || lower.includes('glb')) return 'glb';
  if (lower.includes('gltf')) return 'gltf';
  return defaultExt;
}

export interface BundledAssetItem {
  id: string;
  name: string;
  type: 'texture' | 'model';
  exportPath: string; // e.g. "assets/textures/wall-tex-123.png"
  bytes: Uint8Array;
  mimeType: string;
  draco: boolean;
  source: string;
  license: string;
  warnLicense?: boolean;
}

export interface BundledDracoFiles {
  'draco_decoder.js': Uint8Array;
  'draco_wasm_wrapper.js': Uint8Array;
  'draco_decoder.wasm': Uint8Array;
}

export interface ResolveAssetOptions {
  customSources?: Record<
    string,
    {
      bytes?: Uint8Array;
      dataUrl?: string;
      url?: string;
      mimeType?: string;
      license?: string;
      source?: string;
      name?: string;
    }
  >;
  baseUrl?: string;
  /**
   * Reads a non-HTTP asset path when `fetch` cannot (tests in Node). Returns null when the
   * file is not found. The browser never needs it.
   */
  readFile?: (path: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

/**
 * Resolves an asset ID to raw bytes, MIME type, source, and license metadata.
 */
export async function resolveAssetBytes(
  id: string,
  type: 'texture' | 'model',
  options: ResolveAssetOptions = {}
): Promise<{
  bytes: Uint8Array;
  mimeType: string;
  source: string;
  license: string;
  name: string;
  draco: boolean;
  warnLicense: boolean;
}> {
  // 1. Explicit override option (used in testing and explicit injectors)
  if (options.customSources && options.customSources[id]) {
    const src = options.customSources[id];
    let bytes = src.bytes;
    let mimeType = src.mimeType || (type === 'texture' ? 'image/png' : 'model/gltf-binary');
    if (!bytes && src.dataUrl) {
      const decoded = decodeDataUrl(src.dataUrl);
      bytes = decoded.bytes;
      mimeType = decoded.mimeType;
    }
    if (!bytes && src.url) {
      const fetched = await fetchUrlToBytes(src.url, undefined, options.readFile);
      bytes = fetched.bytes;
      mimeType = fetched.mimeType || mimeType;
    }
    if (bytes) {
      const isDraco = type === 'model' && detectDracoCompression(bytes);
      const isGithub =
        src.source &&
        (src.source.includes('github.com') ||
          src.source.includes('raw.githubusercontent.com') ||
          src.source.includes('Retro_FPS_GCS-assets'));
      const isUserUpload = src.source === 'User Upload';
      // Being on GitHub says nothing about a file's license (ED-8): without one, warn
      const warnLicense =
        !src.license ||
        src.license.startsWith('Unknown') ||
        Boolean(!isGithub && !isUserUpload && src.source && src.source.startsWith('http'));

      return {
        bytes,
        mimeType,
        source: src.source || 'Custom Source',
        license: src.license || (isGithub || !isUserUpload ? 'Unknown (no license recorded)' : 'Unspecified, owned by creator'),
        name: src.name || id,
        draco: isDraco,
        warnLicense: Boolean(warnLicense),
      };
    }
  }

  // 2. Check AssetRegistry model file (Blob)
  if (type === 'model') {
    const blob = AssetRegistry.getModelFile(id);
    if (blob) {
      const ab = await blob.arrayBuffer();
      const bytes = new Uint8Array(ab);
      const isDraco = detectDracoCompression(bytes);
      const modelMeta = AssetRegistry.getModel(id);
      return {
        bytes,
        mimeType: 'model/gltf-binary',
        source: 'User Upload',
        license: 'Unspecified, owned by creator',
        name: modelMeta?.name || id,
        draco: isDraco,
        warnLicense: false,
      };
    }
  }

  // 3. Check AssetRegistry metadata for data URLs or URLs
  let directUrl: string | undefined;
  let assetName = id;
  if (type === 'texture') {
    const tex = AssetRegistry.getTexture(id);
    if (tex) {
      directUrl = tex.previewUrl;
      assetName = tex.name || id;
    }
  } else {
    const mdl = AssetRegistry.getModel(id);
    if (mdl) {
      directUrl = mdl.customGlbUrl;
      assetName = mdl.name || id;
    }
  }

  if (directUrl) {
    if (directUrl.startsWith('data:')) {
      const decoded = decodeDataUrl(directUrl);
      const isDraco = type === 'model' && detectDracoCompression(decoded.bytes);
      return {
        bytes: decoded.bytes,
        mimeType: decoded.mimeType,
        source: 'User Upload',
        license: 'Unspecified, owned by creator',
        name: assetName,
        draco: isDraco,
        warnLicense: false,
      };
    }

    // Remote or local URL
    const fetched = await fetchUrlToBytes(directUrl, options.baseUrl, options.readFile);
    const isDraco = type === 'model' && detectDracoCompression(fetched.bytes);

    // A file from the pinned asset library must match its published SHA-256 (P2.7)
    const library = libraryFileRecord(directUrl);
    if (library) {
      if (fetched.bytes.length !== library.size || (await sha256Of(fetched.bytes)) !== library.sha256) {
        throw new LibraryIntegrityError(library);
      }
      return {
        bytes: fetched.bytes,
        mimeType: fetched.mimeType,
        source: library.pack.source,
        license: `${library.pack.license} (${library.pack.title}, by ${library.pack.author})`,
        name: assetName,
        draco: isDraco,
        warnLicense: false,
      };
    }

    // Other repositories record no license (Q9: a custom repository needs a packs.json first)
    const isGithub =
      directUrl.includes('github.com') ||
      directUrl.includes('raw.githubusercontent.com') ||
      directUrl.includes('Retro_FPS_GCS-assets');
    const license = isGithub ? 'Unknown (the repository has no published packs.json)' : 'Unknown';

    return {
      bytes: fetched.bytes,
      mimeType: fetched.mimeType,
      source: directUrl,
      license,
      name: assetName,
      draco: isDraco,
      warnLicense: true,
    };
  }

  throw new Error(
    `Failed to resolve asset '${id}' (${type}): no registered data URL, Blob, or URL found.`
  );
}

/** SHA-256 in hex, with the browser's implementation when there is one */
async function sha256Of(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(bytes);
}

/**
 * Fetches an asset's bytes, falling back to the injected `readFile` for local paths.
 */
async function fetchUrlToBytes(
  url: string,
  baseUrl?: string,
  readFile?: ResolveAssetOptions['readFile']
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const fullUrl =
    baseUrl && !url.startsWith('http://') && !url.startsWith('https://')
      ? `${baseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
      : url;

  if (typeof fetch === 'function') {
    try {
      const res = await fetch(fullUrl);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const mimeType = res.headers.get('content-type') || 'application/octet-stream';
        return { bytes: new Uint8Array(ab), mimeType };
      }
    } catch {
      // Fall through to the injected readFile, if any
    }
  }

  if (readFile && !/^https?:\/\//i.test(url)) {
    const local = await readFile(url);
    if (local) return local;
  }

  throw new Error(`Failed to fetch asset from URL: ${url}`);
}

/**
 * Fetches the Draco decoder files the editor serves from its runtime/draco/ folder.
 */
export async function loadBundledDracoFiles(): Promise<BundledDracoFiles> {
  const fileNames = [
    'draco_decoder.js',
    'draco_wasm_wrapper.js',
    'draco_decoder.wasm',
  ] as const;

  const result: Partial<BundledDracoFiles> = {};

  if (typeof fetch === 'function') {
    for (const name of fileNames) {
      // Relative to the page, so it resolves under the editor's base path (e.g. /Retro_FPS_GCS/runtime/draco/)
      const res = await fetch(`runtime/draco/${name}`);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        result[name] = new Uint8Array(ab);
      }
    }
  }

  if (
    !result['draco_decoder.js'] ||
    !result['draco_wasm_wrapper.js'] ||
    !result['draco_decoder.wasm']
  ) {
    throw new Error('Unable to locate Draco 1.5.6 decoder files for bundling.');
  }

  return result as BundledDracoFiles;
}

export function generateAssetLicensesMarkdown(
  assets: readonly BundledAssetItem[],
  gameTitle = 'Exported Game'
): string {
  const lines: string[] = [
    `# Asset Licenses & Attribution: ${gameTitle}`,
    '',
    `This game export contains offline assets. Below is the full attribution and license inventory:`,
    '',
    '| Asset Name | Type | Target Path | Source | License | Status |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
  ];

  if (assets.length === 0) {
    lines.push('| (None) | - | - | Built-in Procedural Only | MIT Runtime | Clean |');
  } else {
    for (const a of assets) {
      const status = a.warnLicense ? 'Warning: no verified license' : 'License recorded';
      lines.push(
        `| **${a.name}** | \`${a.type}\` | \`${a.exportPath}\` | ${a.source} | ${a.license} | ${status} |`
      );
    }
  }

  lines.push('');
  lines.push('## Built-in Procedural Assets');
  lines.push(
    'Procedural wall, floor, ceiling, door, and skybox textures as well as default procedural archetypes (sentinel-bot, turret-guardian, supply-crate) are generated on-the-fly in code and are licensed under the runtime MIT license.'
  );
  lines.push('');

  return lines.join('\n');
}

export interface AssetBundleResult {
  manifest: GameManifest;
  level: LevelDataV3;
  assets: BundledAssetItem[];
  hasDraco: boolean;
  dracoFiles?: BundledDracoFiles;
  assetLicensesMarkdown: string;
  licenseWarnings: string[];
}

export interface BundleOptions extends ResolveAssetOptions {
  includeDracoIfDetected?: boolean;
  /** Decoder files to bundle instead of fetching them (tests in Node). */
  dracoFiles?: BundledDracoFiles;
}

/**
 * Phase 3 Entry Point:
 * Collects, resolves, and rewrites all referenced assets in a level or manifest.
 */
export async function bundleLevelAssets(
  levelInput: GameManifest | LevelDataV3,
  options: BundleOptions = {}
): Promise<AssetBundleResult> {
  const baseManifest =
    'level' in levelInput ? loadGameManifest(levelInput) : createGameManifest(levelInput);
  const referenced = collectReferencedAssets(baseManifest);

  const bundledAssets: BundledAssetItem[] = [];
  const licenseWarnings: string[] = [];
  let hasDraco = false;

  const manifestTextures: ManifestTextureAsset[] = [];
  const manifestModels: ManifestModelAsset[] = [];

  // Mapping from old asset ID to rewritten relative export path
  const texturePathMap = new Map<string, string>();
  const modelPathMap = new Map<string, string>();

  // 1. Resolve and bundle textures
  for (const id of referenced.textureIds) {
    const res = await resolveAssetBytes(id, 'texture', options);
    const slug = slugify(res.name);
    const ext = extensionFromMimeType(res.mimeType, 'png');
    const exportPath = `assets/textures/${slug}-${id}.${ext}`;
    texturePathMap.set(id, exportPath);

    if (res.warnLicense) {
      licenseWarnings.push(
        `Texture '${res.name}' (${id}) from '${res.source}' has no verified open-source license.`
      );
    }

    const item: BundledAssetItem = {
      id,
      name: res.name,
      type: 'texture',
      exportPath,
      bytes: res.bytes,
      mimeType: res.mimeType,
      draco: false,
      source: res.source,
      license: res.license,
      warnLicense: res.warnLicense,
    };
    bundledAssets.push(item);
    manifestTextures.push({
      id,
      path: exportPath,
      mimeType: res.mimeType,
      license: res.license,
      source: res.source,
    });
  }

  // 2. Resolve and bundle models
  for (const id of referenced.modelIds) {
    const res = await resolveAssetBytes(id, 'model', options);
    const slug = slugify(res.name);
    const ext = extensionFromMimeType(res.mimeType, 'glb');
    const exportPath = `assets/models/${slug}-${id}.${ext}`;
    modelPathMap.set(id, exportPath);

    if (res.draco) {
      hasDraco = true;
    }

    if (res.warnLicense) {
      licenseWarnings.push(
        `Model '${res.name}' (${id}) from '${res.source}' has no verified open-source license.`
      );
    }

    const item: BundledAssetItem = {
      id,
      name: res.name,
      type: 'model',
      exportPath,
      bytes: res.bytes,
      mimeType: res.mimeType,
      draco: res.draco,
      source: res.source,
      license: res.license,
      warnLicense: res.warnLicense,
    };
    bundledAssets.push(item);
    manifestModels.push({
      id,
      path: exportPath,
      draco: res.draco,
      license: res.license,
      source: res.source,
    });
  }

  // 3. Cloned LevelDataV3 references models strictly by modelAssetId;
  // all relative export file paths are housed in manifest.assets.models and manifest.assets.textures.
  const clonedLevel: LevelDataV3 = JSON.parse(JSON.stringify(baseManifest.level));
  const clonedLevels: LevelDataV3[] | undefined = baseManifest.levels
    ? JSON.parse(JSON.stringify(baseManifest.levels))
    : undefined;

  // 4. Load Draco decoders if Draco compression was detected
  let dracoFiles: BundledDracoFiles | undefined;
  if (hasDraco && options.includeDracoIfDetected !== false) {
    try {
      dracoFiles = options.dracoFiles ?? (await loadBundledDracoFiles());
    } catch (err) {
      // In non-filesystem headless test environments without draco files, log warning
      console.warn('Draco files could not be pre-loaded:', err);
    }
  }

  const assetLicensesMarkdown = generateAssetLicensesMarkdown(
    bundledAssets,
    baseManifest.meta.title
  );

  const finalManifest: GameManifest = {
    schemaVersion: 1,
    meta: { ...baseManifest.meta },
    level: clonedLevel,
    ...(clonedLevels && clonedLevels.length > 0 ? { levels: clonedLevels } : {}),
    ...(baseManifest.campaign
      ? { campaign: { ...baseManifest.campaign } }
      : {}),
    assets: {
      textures: manifestTextures,
      models: manifestModels,
    },
  };

  return {
    manifest: finalManifest,
    level: clonedLevel,
    assets: bundledAssets,
    hasDraco,
    dracoFiles,
    assetLicensesMarkdown,
    licenseWarnings,
  };
}
