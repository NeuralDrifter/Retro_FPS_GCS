/**
 * ============================================================================
 * PIE3D EXTERNAL ASSET FOLDER LOADER (`/src/assets/` + `/public/assets/`)
 * ============================================================================
 * Allows designers and developers to store textures (`.png`, `.jpg`, `.webp`,
 * `.svg`) and 3D models (`.glb`, `.gltf`) in dedicated project folders instead
 * of baking them into TypeScript code:
 *
 *  1. Zero-Config Folder Scan (`/src/assets/textures/**` & `/src/assets/models/**`):
 *     Uses Vite's `import.meta.glob` to automatically discover any files dropped
 *     into `/src/assets/textures/` or `/src/assets/models/` (texture subfolders
 *     become texture folders, see `textureLibrary.ts`; model subfolders pick the
 *     library category and folder, see `modelLibrary/diskPaths.ts`).
 *
 *  2. Static Public Folder Manifest (`/public/assets/manifest.json`):
 *     Fetches `/assets/manifest.json` at startup to register static files placed
 *     in `/public/assets/textures/` and `/public/assets/models/`.
 */

import { Model3DAsset, TextureAsset } from '../types/engine';
import type { ModelCategoryId } from '../types/modelLibrary';
import { isModelCategoryId } from './modelLibrary/categories';
import { diskModelId, parseModelDiskPath } from './modelLibrary/diskPaths';
import { parseTextureDiskPath } from './textureLibrary';

export interface PublicAssetManifest {
  textures?: {
    id?: string;
    name?: string;
    file: string;
  }[];
  models?: {
    id?: string;
    name?: string;
    file: string;
    isEnemy?: boolean;
    defaultHealth?: number;
    moveSpeed?: number;
    attackDamage?: number;
    /** characters | decorations | items | buildings | vehicles */
    category?: string;
    /** Slash path of a custom library folder, e.g. "town/shops" */
    folder?: string;
    tags?: string[];
  }[];
}

// 1. Vite build-time/dev-server glob discovery for /src/assets/
const globTextureUrls = import.meta.glob(
  '/src/assets/textures/**/*.{png,jpg,jpeg,webp,gif,svg}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  }
) as Record<string, string>;

const globModelUrls = import.meta.glob('/src/assets/models/**/*.{glb,gltf}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// Real sizes of the shipped models, written when they were converted (path under models/ -> meters)
const shippedModelSizes = (Object.values(
  import.meta.glob('/src/assets/models/model-sizes.json', { eager: true, import: 'default' })
)[0] ?? {}) as Record<string, { width: number; depth: number }>;

function formatFilenameToLabel(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  const withoutExt = base.replace(/\.[^/.]+$/, '');
  return withoutExt
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function slugifyPath(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  return base
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-');
}

/**
 * Builds a library model for a discovered file. Only characters fight and
 * move; every other category gets zero combat stats.
 */
function createDiscoveredModelAsset(params: {
  id: string;
  name: string;
  url: string;
  category: ModelCategoryId;
  folderPath: string | null;
  folderAtRoot?: boolean;
  tags?: string[];
  isEnemy?: boolean;
  defaultHealth?: number;
  moveSpeed?: number;
  attackDamage?: number;
  measuredSizeMeters?: { width: number; depth: number };
}): Model3DAsset {
  const isCharacter = params.category === 'characters';
  const isEnemy = isCharacter && params.isEnemy !== false;
  return {
    id: params.id,
    blueprintId: 'custom-glb',
    name: params.name,
    sourceType: 'file',
    isEnemy,
    defaultHealth: params.defaultHealth ?? (isEnemy ? 85 : 0),
    moveSpeed: isCharacter ? params.moveSpeed ?? (isEnemy ? 4.5 : 0) : 0,
    attackDamage: isCharacter ? params.attackDamage ?? (isEnemy ? 14 : 0) : 0,
    accentHex: isEnemy ? '#f43f5e' : '#38bdf8',
    badgeText: isEnemy ? 'FOE' : 'PROP',
    customGlbUrl: params.url,
    category: params.category,
    ...(params.folderPath ? { folderPath: params.folderPath } : {}),
    ...(params.folderPath && params.folderAtRoot ? { folderAtRoot: true } : {}),
    ...(params.tags && params.tags.length > 0 ? { tags: params.tags } : {}),
    ...(params.measuredSizeMeters ? { measuredSizeMeters: params.measuredSizeMeters } : {}),
  };
}

export class AssetFolderLoader {
  /**
   * Synchronously returns all textures and 3D `.glb` models discovered inside
   * `/src/assets/textures/` and `/src/assets/models/`.
   */
  public static getAutoDiscoveredSrcAssets(): {
    textures: TextureAsset[];
    models: Model3DAsset[];
  } {
    const textures: TextureAsset[] = Object.entries(globTextureUrls).map(
      ([filePath, resolvedUrl]) => {
        const { id, name, folderPath } = parseTextureDiskPath(filePath);
        return {
          id,
          name,
          sourceType: 'file',
          previewUrl: resolvedUrl,
          recommendedSurface: 'any',
          fromProject: true,
          ...(folderPath ? { folderPath } : {}),
        };
      }
    );

    const models: Model3DAsset[] = Object.entries(globModelUrls).map(
      ([filePath, resolvedUrl]) => {
        const { category, folderPath, atRoot } = parseModelDiskPath(filePath);
        return createDiscoveredModelAsset({
          id: diskModelId(filePath),
          measuredSizeMeters: shippedModelSizes[filePath.replace('/src/assets/models/', '')],
          name: `${formatFilenameToLabel(filePath)} (.glb)`,
          url: resolvedUrl,
          category,
          folderPath,
          folderAtRoot: atRoot,
        });
      }
    );

    return { textures, models };
  }

  /**
   * Fetches `/assets/manifest.json` (served from `/public/assets/manifest.json`)
   * so large `.glb` models and textures placed in `/public/assets/` are
   * registered dynamically without bundling them into JS code.
   */
  public static async fetchPublicManifestAssets(): Promise<{
    textures: TextureAsset[];
    models: Model3DAsset[];
  }> {
    try {
      const response = await fetch('/assets/manifest.json', {
        cache: 'no-store',
      });
      if (!response.ok) {
        return { textures: [], models: [] };
      }

      const manifest = (await response.json()) as PublicAssetManifest;
      const textures: TextureAsset[] = (manifest.textures || [])
        .filter((item) => item && typeof item.file === 'string' && item.file.trim())
        .map((item) => ({
          id: item.id || `pub-tex-${slugifyPath(item.file)}`,
          name: item.name || formatFilenameToLabel(item.file),
          sourceType: 'file',
          previewUrl: item.file,
          recommendedSurface: 'wall',
          fromProject: true,
        }));

      const models: Model3DAsset[] = (manifest.models || [])
        .filter((item) => item && typeof item.file === 'string' && item.file.trim())
        .map((item) =>
          createDiscoveredModelAsset({
            id: item.id || `pub-glb-${slugifyPath(item.file)}`,
            name: item.name || `${formatFilenameToLabel(item.file)} (.glb)`,
            url: item.file,
            category: isModelCategoryId(item.category)
              ? item.category
              : item.isEnemy === false
              ? 'decorations'
              : 'characters',
            folderPath:
              typeof item.folder === 'string' && item.folder.trim()
                ? item.folder.trim()
                : null,
            tags: Array.isArray(item.tags)
              ? item.tags.filter((t): t is string => typeof t === 'string')
              : undefined,
            isEnemy: item.isEnemy,
            defaultHealth: item.defaultHealth,
            moveSpeed: item.moveSpeed,
            attackDamage: item.attackDamage,
          })
        );

      return { textures, models };
    } catch {
      return { textures: [], models: [] };
    }
  }
}
