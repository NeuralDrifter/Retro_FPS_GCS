/**
 * ============================================================================
 * GRIDFORGE 3D EXTERNAL ASSET FOLDER LOADER (`/src/assets/` + `/public/assets/`)
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
import { AssetRegistry } from './AssetRegistry';
import bundledGitHubIndex from './bundledGitHubAssetsIndex.json';
import { isModelCategoryId } from './modelLibrary/categories';
import { diskModelId, parseModelDiskPath } from './modelLibrary/diskPaths';
import { parseTextureDiskPath } from './textureLibrary';
import {
  DEFAULT_GITHUB_ASSETS_BRANCH,
  DEFAULT_GITHUB_ASSETS_REPO,
  GitHubRepoSpec,
  buildAssetsFromRepoPaths,
  buildGitHubRawUrl,
  createDiscoveredModelAsset,
  formatFilenameToLabel,
  parseGitHubRepoSpec,
} from './gitHubAssets';

export {
  DEFAULT_GITHUB_ASSETS_BRANCH,
  DEFAULT_GITHUB_ASSETS_REPO,
  buildAssetsFromRepoPaths,
  buildGitHubRawUrl,
  parseGitHubRepoSpec,
};
export type { GitHubRepoSpec };

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

// 2. Baked-in GitHub asset index for NeuralDrifter/Retro_FPS_GCS-assets@main
const BUNDLED_GITHUB_SPEC: GitHubRepoSpec = {
  owner: 'NeuralDrifter',
  repo: 'Retro_FPS_GCS-assets',
  branch: bundledGitHubIndex.branch || DEFAULT_GITHUB_ASSETS_BRANCH,
};

const BUNDLED_GITHUB_ASSETS = buildAssetsFromRepoPaths({
  spec: BUNDLED_GITHUB_SPEC,
  paths: bundledGitHubIndex.paths || [],
  modelSizes:
    (bundledGitHubIndex.modelSizes as Record<
      string,
      { width: number; depth: number }
    >) || {},
});

function slugifyPath(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  return base
    .toLowerCase()
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-');
}

const GITHUB_REPO_PREF_KEY = 'gridforge-github-assets-repo-v1';
const GITHUB_CACHE_PREFIX = 'gridforge-github-assets-cache-v1:';

interface CachedGitHubRepoData {
  paths: string[];
  modelSizes: Record<string, { width: number; depth: number }>;
  fetchedAt: number;
}

export class AssetFolderLoader {
  /**
   * Returns the saved GitHub assets repository string (or the default
   * `NeuralDrifter/Retro_FPS_GCS-assets` repository).
   */
  public static getSavedGitHubRepoInput(): string {
    try {
      const saved = window.localStorage.getItem(GITHUB_REPO_PREF_KEY);
      return saved && saved.trim() ? saved.trim() : DEFAULT_GITHUB_ASSETS_REPO;
    } catch {
      return DEFAULT_GITHUB_ASSETS_REPO;
    }
  }

  public static setSavedGitHubRepoInput(repoInput: string): void {
    try {
      window.localStorage.setItem(GITHUB_REPO_PREF_KEY, repoInput.trim());
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  /**
   * Returns the baked-in GitHub repository asset counts (`NeuralDrifter/Retro_FPS_GCS-assets@main`).
   */
  public static getBundledGitHubAssetsStats(): {
    repoLabel: string;
    textures: number;
    models: number;
  } {
    return {
      repoLabel: `${BUNDLED_GITHUB_SPEC.owner}/${BUNDLED_GITHUB_SPEC.repo}@${BUNDLED_GITHUB_SPEC.branch}`,
      textures: BUNDLED_GITHUB_ASSETS.textures.length,
      models: BUNDLED_GITHUB_ASSETS.models.length,
    };
  }

  /**
   * Synchronously returns all baked-in GitHub pack textures & 3D `.glb` models
   * (`NeuralDrifter/Retro_FPS_GCS-assets`) merged with any local files inside
   * `/src/assets/textures/` and `/src/assets/models/`, and registers them in `AssetRegistry`.
   */
  public static getAutoDiscoveredSrcAssets(): {
    textures: TextureAsset[];
    models: Model3DAsset[];
  } {
    const texturesById = new Map<string, TextureAsset>();
    for (const tex of BUNDLED_GITHUB_ASSETS.textures) {
      texturesById.set(tex.id, tex);
    }

    for (const [filePath, resolvedUrl] of Object.entries(globTextureUrls)) {
      const { id, name, folderPath } = parseTextureDiskPath(filePath);
      texturesById.set(id, {
        id,
        name,
        sourceType: 'file',
        previewUrl: resolvedUrl,
        recommendedSurface: 'any',
        fromProject: true,
        ...(folderPath ? { folderPath } : {}),
      });
    }

    const modelsById = new Map<string, Model3DAsset>();
    for (const model of BUNDLED_GITHUB_ASSETS.models) {
      modelsById.set(model.id, model);
    }

    for (const [filePath, resolvedUrl] of Object.entries(globModelUrls)) {
      const { category, folderPath, atRoot } = parseModelDiskPath(filePath);
      const id = diskModelId(filePath);
      modelsById.set(
        id,
        createDiscoveredModelAsset({
          id,
          measuredSizeMeters:
            shippedModelSizes[filePath.replace('/src/assets/models/', '')],
          name: `${formatFilenameToLabel(filePath)} (.glb)`,
          url: resolvedUrl,
          category,
          folderPath,
          folderAtRoot: atRoot,
        })
      );
    }

    const textures = [...texturesById.values()];
    const models = [...modelsById.values()];

    for (const t of textures) AssetRegistry.registerTexture(t);
    for (const m of models) AssetRegistry.registerModel(m);

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
        .filter(
          (item) => item && typeof item.file === 'string' && item.file.trim()
        )
        .map((item) => ({
          id: item.id || `pub-tex-${slugifyPath(item.file)}`,
          name: item.name || formatFilenameToLabel(item.file),
          sourceType: 'file',
          previewUrl: item.file,
          recommendedSurface: 'wall',
          fromProject: true,
        }));

      const models: Model3DAsset[] = (manifest.models || [])
        .filter(
          (item) => item && typeof item.file === 'string' && item.file.trim()
        )
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

  /**
   * Discovers and registers all textures (`textures/**`) and 3D models (`models/**`
   * + `models/model-sizes.json`) from a public GitHub repository such as
   * `NeuralDrifter/Retro_FPS_GCS-assets`.
   */
  public static async fetchGitHubRepoAssets(
    repoInput = DEFAULT_GITHUB_ASSETS_REPO,
    options?: { forceRefresh?: boolean }
  ): Promise<{
    spec: GitHubRepoSpec | null;
    textures: TextureAsset[];
    models: Model3DAsset[];
    fromCache: boolean;
    error?: string;
  }> {
    const spec = parseGitHubRepoSpec(repoInput);
    if (!spec) {
      return {
        spec: null,
        textures: [],
        models: [],
        fromCache: false,
        error: 'Enter a valid GitHub repo (e.g. owner/repo or https://github.com/owner/repo).',
      };
    }

    const cacheKey = `${GITHUB_CACHE_PREFIX}${spec.owner}/${spec.repo}@${spec.branch}`;

    if (!options?.forceRefresh) {
      try {
        const cachedRaw = window.localStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as CachedGitHubRepoData;
          if (Array.isArray(cached.paths) && cached.paths.length > 0) {
            const built = buildAssetsFromRepoPaths({
              spec,
              paths: cached.paths,
              modelSizes: cached.modelSizes || {},
            });
            return { ...built, spec, fromCache: true };
          }
        }
      } catch {
        // Proceed to bundled or network fetch if cache read fails
      }

      if (
        spec.owner.toLowerCase() === BUNDLED_GITHUB_SPEC.owner.toLowerCase() &&
        spec.repo.toLowerCase() === BUNDLED_GITHUB_SPEC.repo.toLowerCase() &&
        spec.branch === BUNDLED_GITHUB_SPEC.branch
      ) {
        return {
          ...BUNDLED_GITHUB_ASSETS,
          spec,
          fromCache: true,
        };
      }
    }

    try {
      const paths = await this.fetchRepoFilePaths(spec);
      const hasModelSizes = paths.includes('models/model-sizes.json');
      let modelSizes: Record<string, { width: number; depth: number }> = {};

      if (hasModelSizes) {
        try {
          const sizesRes = await fetch(
            buildGitHubRawUrl(spec, 'models/model-sizes.json')
          );
          if (sizesRes.ok) {
            modelSizes = (await sizesRes.json()) as Record<
              string,
              { width: number; depth: number }
            >;
          }
        } catch {
          // Non-fatal: models will still load and measure on demand
        }
      }

      try {
        const toCache: CachedGitHubRepoData = {
          paths,
          modelSizes,
          fetchedAt: Date.now(),
        };
        window.localStorage.setItem(cacheKey, JSON.stringify(toCache));
      } catch {
        // Ignore quota or storage restriction errors
      }

      const built = buildAssetsFromRepoPaths({ spec, paths, modelSizes });
      return { ...built, spec, fromCache: false };
    } catch (err) {
      return {
        spec,
        textures: [],
        models: [],
        fromCache: false,
        error:
          err instanceof Error
            ? err.message
            : 'Could not load assets from GitHub repository.',
      };
    }
  }

  private static async fetchRepoFilePaths(
    spec: GitHubRepoSpec
  ): Promise<string[]> {
    // 1. Primary: GitHub Git Trees API
    const ghTreeUrl = `https://api.github.com/repos/${encodeURIComponent(
      spec.owner
    )}/${encodeURIComponent(spec.repo)}/git/trees/${encodeURIComponent(
      spec.branch
    )}?recursive=1`;

    try {
      const res = await fetch(ghTreeUrl, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          tree?: { path?: string; type?: string }[];
        };
        if (Array.isArray(data.tree)) {
          return data.tree
            .filter((node) => node.type === 'blob' && typeof node.path === 'string')
            .map((node) => node.path!);
        }
      }
    } catch {
      // Fall through to jsDelivr flat index fallback
    }

    // 2. Fallback: jsDelivr package file listing (unaffected by GitHub API rate limits)
    const jsDelivrUrl = `https://data.jsdelivr.com/v1/package/gh/${encodeURIComponent(
      spec.owner
    )}/${encodeURIComponent(spec.repo)}@${encodeURIComponent(spec.branch)}/flat`;
    const fallbackRes = await fetch(jsDelivrUrl);
    if (!fallbackRes.ok) {
      throw new Error(
        `GitHub repository '${spec.owner}/${spec.repo}' (branch '${spec.branch}') could not be reached (HTTP ${fallbackRes.status}).`
      );
    }
    const fallbackData = (await fallbackRes.json()) as {
      files?: { name?: string }[];
    };
    return (fallbackData.files || [])
      .map((f) => (typeof f.name === 'string' ? f.name.replace(/^\/+/, '') : ''))
      .filter(Boolean);
  }
}
