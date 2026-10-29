/**
 * ============================================================================
 * ASSET COLLECTOR, OFFLINE RESOLVER & DRACO BUNDLER (`/src/runtime/assetBundler.ts`)
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
 * Pure runtime-compatible module with zero React/lucide/Gemini imports.
 */

import {
  ActionSpec,
  EventDefinition,
  LevelDataV3,
} from './sim';
import {
  GameManifest,
  GameManifestAssets,
  LevelStateData,
  ManifestModelAsset,
  ManifestTextureAsset,
  TextureAsset,
} from './types';
import { AssetRegistry } from './AssetRegistry';
import { createGameManifest, migrateGameManifest } from './manifest';

export const BUILTIN_PROCEDURAL_TEXTURE_IDS = new Set<string>([
  'default-grid',
  'techbase-panel',
  'dungeon-stone',
  'stone-dungeon',
  'labyrinth-check',
  'floor-obsidian',
  'ceiling-coffer',
  'grate-alpha',
  'brick',
  'metal',
  'stone',
  'scifi',
  'wood',
  'grid-floor',
  'door',
  'retro-nebula',
  'starry-void',
  'crimson-dusk',
  'emerald-grid',
]);

export const BUILTIN_PROCEDURAL_MODEL_IDS = new Set<string>([
  'sentinel-bot',
  'turret-guardian',
  'supply-crate',
]);

export function isBuiltInTexture(id: string): boolean {
  if (!id) return true;
  return BUILTIN_PROCEDURAL_TEXTURE_IDS.has(id.toLowerCase());
}

export function isBuiltInModel(id: string): boolean {
  if (!id) return true;
  return BUILTIN_PROCEDURAL_MODEL_IDS.has(id.toLowerCase());
}

export function slugify(text: string): string {
  const s = String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'asset';
}

/**
 * Traverses an ActionSpec array recursively, walking into nested if_then_else
 * and random_branch action trees.
 */
export function walkActions(
  actions: readonly ActionSpec[] | undefined,
  visitor: (action: ActionSpec) => void
): void {
  if (!actions || !Array.isArray(actions)) return;
  for (const act of actions) {
    if (!act || typeof act !== 'object') continue;
    visitor(act);
    if (act.type === 'if_then_else') {
      walkActions(act.then_actions, visitor);
      walkActions(act.else_actions, visitor);
    } else if (act.type === 'random_branch') {
      if (Array.isArray(act.branches)) {
        for (const branch of act.branches) {
          walkActions(branch.actions, visitor);
        }
      }
    }
  }
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

/**
 * Detects whether a GLB / glTF model requires Draco mesh compression
 * by inspecting the JSON header for `KHR_draco_mesh_compression`.
 */
export function detectDracoCompression(
  modelBytesOrText: Uint8Array | string
): boolean {
  if (typeof modelBytesOrText === 'string') {
    return modelBytesOrText.includes('KHR_draco_mesh_compression');
  }
  const bytes = modelBytesOrText;
  if (!bytes || bytes.length === 0) return false;

  // If binary GLB: magic 0x46546C67 ("glTF")
  const isGlb =
    bytes.length >= 20 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46;

  if (isGlb) {
    const chunk0Len =
      bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24);
    const jsonLen = Math.min(chunk0Len, bytes.length - 20);
    const jsonBytes = bytes.subarray(20, 20 + jsonLen);
    const jsonText = new TextDecoder('utf-8', { fatal: false }).decode(jsonBytes);
    return jsonText.includes('KHR_draco_mesh_compression');
  }

  // Fallback: scan first 64KB as text
  const scanLimit = Math.min(bytes.length, 65536);
  const headerText = new TextDecoder('utf-8', { fatal: false }).decode(
    bytes.subarray(0, scanLimit)
  );
  return headerText.includes('KHR_draco_mesh_compression');
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
      const fetched = await fetchUrlToBytes(src.url);
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
      const warnLicense =
        src.license === 'Unknown' ||
        Boolean(!isGithub && !isUserUpload && src.source && src.source.startsWith('http'));

      return {
        bytes,
        mimeType,
        source: src.source || 'Custom Source',
        license:
          src.license ||
          (isGithub
            ? 'MIT (NeuralDrifter/Retro_FPS_GCS-assets)'
            : 'Unspecified, owned by creator'),
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
    const fetched = await fetchUrlToBytes(directUrl, options.baseUrl);
    const isDraco = type === 'model' && detectDracoCompression(fetched.bytes);
    const isGithub =
      directUrl.includes('github.com') ||
      directUrl.includes('raw.githubusercontent.com') ||
      directUrl.includes('Retro_FPS_GCS-assets');
    const license = isGithub
      ? 'MIT (NeuralDrifter/Retro_FPS_GCS-assets)'
      : 'Unknown';

    return {
      bytes: fetched.bytes,
      mimeType: fetched.mimeType,
      source: directUrl,
      license,
      name: assetName,
      draco: isDraco,
      warnLicense: !isGithub,
    };
  }

  throw new Error(
    `Failed to resolve asset '${id}' (${type}): no registered data URL, Blob, or URL found.`
  );
}

/**
 * Universal fetcher supporting browser fetch and Node local file fallbacks.
 */
async function fetchUrlToBytes(
  url: string,
  baseUrl?: string
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
      // Fall through to Node local fs read if applicable
    }
  }

  // Node local filesystem fallback for /assets/... or public/...
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const cleanPath = url.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^\/+/, '');
      const candidates = [
        path.resolve(cleanPath),
        path.resolve('public', cleanPath),
        path.resolve('public', cleanPath.replace(/^assets\//, '')),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          const buf = fs.readFileSync(cand);
          const ext = path.extname(cand).toLowerCase();
          let mimeType = 'application/octet-stream';
          if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
          else if (ext === '.svg') mimeType = 'image/svg+xml';
          else if (ext === '.glb') mimeType = 'model/gltf-binary';
          return {
            bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            mimeType,
          };
        }
      }
    } catch {
      // Ignore
    }
  }

  throw new Error(`Failed to fetch asset from URL: ${url}`);
}

/**
 * Reads the bundled Draco decoder files from local filesystem or static path.
 */
export async function loadBundledDracoFiles(): Promise<BundledDracoFiles> {
  const fileNames = [
    'draco_decoder.js',
    'draco_wasm_wrapper.js',
    'draco_decoder.wasm',
  ] as const;

  const result: Partial<BundledDracoFiles> = {};

  if (typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const searchDirs = [
      path.resolve('public/draco'),
      path.resolve('node_modules/three/examples/jsm/libs/draco/gltf'),
      path.resolve('node_modules/three/examples/jsm/libs/draco'),
    ];

    for (const name of fileNames) {
      for (const dir of searchDirs) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) {
          const buf = fs.readFileSync(full);
          result[name] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          break;
        }
      }
    }
  } else if (typeof fetch === 'function') {
    for (const name of fileNames) {
      const res = await fetch(`/draco/${name}`);
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
      const status = a.warnLicense ? '⚠️ Warning: Unverified License' : '✅ Verified';
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
}

/**
 * Phase 3 Entry Point:
 * Collects, resolves, and rewrites all referenced assets in a level or manifest.
 */
export async function bundleLevelAssets(
  levelInput: LevelDataV3 | LevelStateData | GameManifest,
  options: BundleOptions = {}
): Promise<AssetBundleResult> {
  const baseManifest = migrateGameManifest(levelInput);
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
      dracoFiles = await loadBundledDracoFiles();
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
