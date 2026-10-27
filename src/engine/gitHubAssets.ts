/**
 * ============================================================================
 * GRIDFORGE 3D GITHUB ASSETS REPOSITORY PARSER & ASSET BUILDER
 * ============================================================================
 * Pure functions (zero Vite `import.meta.glob` or browser DOM dependencies)
 * that map file trees and `models/model-sizes.json` from a public GitHub
 * repository (default: `NeuralDrifter/Retro_FPS_GCS-assets`) into `TextureAsset`
 * and `Model3DAsset` entries with the exact same deterministic IDs, categories,
 * and folder structure as `/src/assets/`.
 */

import { Model3DAsset, TextureAsset } from '../types/engine';
import type { ModelCategoryId } from '../types/modelLibrary';
import { diskModelId, parseModelDiskPath } from './modelLibrary/diskPaths';
import { parseTextureDiskPath } from './textureLibrary';

export const DEFAULT_GITHUB_ASSETS_REPO = 'NeuralDrifter/Retro_FPS_GCS-assets';
export const DEFAULT_GITHUB_ASSETS_BRANCH = 'main';

const TEXTURE_EXT_RE = /\.(png|jpg|jpeg|webp|gif|svg)$/i;
const MODEL_EXT_RE = /\.(glb|gltf)$/i;

export interface GitHubRepoSpec {
  owner: string;
  repo: string;
  branch: string;
}

export function formatFilenameToLabel(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  const withoutExt = base.replace(/\.[^/.]+$/, '');
  return withoutExt
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function createDiscoveredModelAsset(params: {
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
    ...(params.measuredSizeMeters
      ? { measuredSizeMeters: params.measuredSizeMeters }
      : {}),
  };
}

/**
 * Parses a GitHub repository URL or shorthand (`owner/repo`, `owner/repo@branch`,
 * or `https://github.com/owner/repo/tree/branch`) into `{ owner, repo, branch }`.
 */
export function parseGitHubRepoSpec(
  input: string,
  defaultBranch = DEFAULT_GITHUB_ASSETS_BRANCH
): GitHubRepoSpec | null {
  const trimmed = input.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!trimmed) return null;

  // Full GitHub URL: https://github.com/<owner>/<repo>[/tree/<branch>]
  const urlMatch =
    /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^\s/]+))?/i.exec(
      trimmed
    );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      branch: urlMatch[3] || defaultBranch,
    };
  }

  // Shorthand: owner/repo or owner/repo@branch or owner/repo#branch
  const shortMatch =
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[@#]([^\s/]+))?$/.exec(trimmed);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      branch: shortMatch[3] || defaultBranch,
    };
  }

  return null;
}

/**
 * Encodes each segment of a repository file path for `raw.githubusercontent.com`
 * while preserving `/` separators (handles spaces and punctuation in filenames).
 */
export function buildGitHubRawUrl(
  spec: GitHubRepoSpec,
  repoRelativePath: string
): string {
  const cleanPath = repoRelativePath.replace(/^\/+/, '');
  const encodedPath = cleanPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(
    spec.owner
  )}/${encodeURIComponent(spec.repo)}/${encodeURIComponent(
    spec.branch
  )}/${encodedPath}`;
}

/**
 * Pure converter that transforms a list of repository-relative file paths
 * (`textures/...` and `models/...`) and an optional `model-sizes.json` map into
 * `TextureAsset[]` and `Model3DAsset[]` with the exact same deterministic IDs
 * and folder structure as `/src/assets/`.
 */
export function buildAssetsFromRepoPaths(params: {
  spec: GitHubRepoSpec;
  paths: readonly string[];
  modelSizes?: Record<string, { width: number; depth: number }>;
}): {
  textures: TextureAsset[];
  models: Model3DAsset[];
} {
  const { spec, paths, modelSizes = {} } = params;
  const textures: TextureAsset[] = [];
  const models: Model3DAsset[] = [];

  for (const rawPath of paths) {
    const clean = rawPath.replace(/^\/+/, '');
    if (clean.startsWith('textures/') && TEXTURE_EXT_RE.test(clean)) {
      const relTexPath = clean.slice('textures/'.length);
      if (!relTexPath) continue;
      const { id, name, folderPath } = parseTextureDiskPath(relTexPath);
      textures.push({
        id,
        name,
        sourceType: 'file',
        previewUrl: buildGitHubRawUrl(spec, clean),
        recommendedSurface: 'any',
        fromProject: true,
        ...(folderPath ? { folderPath } : {}),
      });
    } else if (clean.startsWith('models/') && MODEL_EXT_RE.test(clean)) {
      const relModelPath = clean.slice('models/'.length);
      if (!relModelPath) continue;
      const { category, folderPath, atRoot } = parseModelDiskPath(relModelPath);
      models.push(
        createDiscoveredModelAsset({
          id: diskModelId(relModelPath),
          measuredSizeMeters: modelSizes[relModelPath],
          name: `${formatFilenameToLabel(relModelPath)} (.glb)`,
          url: buildGitHubRawUrl(spec, clean),
          category,
          folderPath,
          folderAtRoot: atRoot,
        })
      );
    }
  }

  return { textures, models };
}
