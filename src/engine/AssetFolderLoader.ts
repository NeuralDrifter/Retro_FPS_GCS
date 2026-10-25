/**
 * ============================================================================
 * PIE3D EXTERNAL ASSET FOLDER LOADER (`/src/assets/` + `/public/assets/`)
 * ============================================================================
 * Allows designers and developers to store textures (`.png`, `.jpg`, `.webp`,
 * `.svg`) and 3D models (`.glb`, `.gltf`) in dedicated project folders instead
 * of baking them into TypeScript code:
 *
 *  1. Zero-Config Folder Scan (`/src/assets/textures/*` & `/src/assets/models/*`):
 *     Uses Vite's `import.meta.glob` to automatically discover any files dropped
 *     into `/src/assets/textures/` or `/src/assets/models/`.
 *
 *  2. Static Public Folder Manifest (`/public/assets/manifest.json`):
 *     Fetches `/assets/manifest.json` at startup to register static files placed
 *     in `/public/assets/textures/` and `/public/assets/models/`.
 */

import { Model3DAsset, TextureAsset } from '../types/engine';

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
  }[];
}

// 1. Vite build-time/dev-server glob discovery for /src/assets/
const globTextureUrls = import.meta.glob(
  '/src/assets/textures/*.{png,jpg,jpeg,webp,gif,svg}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  }
) as Record<string, string>;

const globModelUrls = import.meta.glob('/src/assets/models/*.{glb,gltf}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

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
      ([filePath, resolvedUrl]) => ({
        id: `folder-tex-${slugifyPath(filePath)}`,
        name: formatFilenameToLabel(filePath),
        sourceType: 'file',
        previewUrl: resolvedUrl,
        recommendedSurface: 'wall',
      })
    );

    const models: Model3DAsset[] = Object.entries(globModelUrls).map(
      ([filePath, resolvedUrl]) => {
        const fileNameLower = (filePath.split('/').pop() || '').toLowerCase();
        const isProp =
          fileNameLower.startsWith('prop_') ||
          fileNameLower.startsWith('prop-') ||
          fileNameLower.startsWith('crate_') ||
          fileNameLower.startsWith('static_');
        const isEnemy = !isProp;

        return {
          id: `folder-glb-${slugifyPath(filePath)}`,
          blueprintId: 'custom-glb',
          name: `${formatFilenameToLabel(filePath)} (.glb)`,
          sourceType: 'file',
          isEnemy,
          defaultHealth: isEnemy ? 85 : 0,
          moveSpeed: isEnemy ? 4.5 : 0,
          attackDamage: isEnemy ? 14 : 0,
          accentHex: isEnemy ? '#f43f5e' : '#38bdf8',
          badgeText: isEnemy ? 'FOE' : 'PROP',
          customGlbUrl: resolvedUrl,
        };
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
        }));

      const models: Model3DAsset[] = (manifest.models || [])
        .filter((item) => item && typeof item.file === 'string' && item.file.trim())
        .map((item) => {
          const isEnemy = item.isEnemy !== false;
          return {
            id: item.id || `pub-glb-${slugifyPath(item.file)}`,
            blueprintId: 'custom-glb',
            name: item.name || `${formatFilenameToLabel(item.file)} (.glb)`,
            sourceType: 'file',
            isEnemy,
            defaultHealth: item.defaultHealth ?? (isEnemy ? 85 : 0),
            moveSpeed: item.moveSpeed ?? (isEnemy ? 4.5 : 0),
            attackDamage: item.attackDamage ?? (isEnemy ? 14 : 0),
            accentHex: isEnemy ? '#f43f5e' : '#38bdf8',
            badgeText: isEnemy ? 'FOE' : 'PROP',
            customGlbUrl: item.file,
          };
        });

      return { textures, models };
    } catch {
      return { textures: [], models: [] };
    }
  }
}
