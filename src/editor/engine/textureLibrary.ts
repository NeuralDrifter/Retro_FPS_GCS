/**
 * ============================================================================
 * GRIDFORGE 3D TEXTURE LIBRARY FOLDERS
 * ============================================================================
 * Textures in `/src/assets/textures/` subfolders are grouped by their path,
 * e.g. `textures/Horror/Brick/x.webp` shows under Horror › Brick. Folders come
 * only from disk; textures cannot be moved inside the app.
 */

import type { TextureAsset } from '../types/engine';

const TEXTURE_ROOT = '/src/assets/textures/';

/** "All", "Built-in", "Uploaded", or a disk folder path */
export type TextureFolderFilter = 'all' | 'builtin' | 'uploaded' | string;

export interface TextureFolderNode {
  path: string;
  name: string;
  depth: number;
  /** Textures in this folder and its subfolders */
  count: number;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function labelFromFileName(stem: string): string {
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Id, label and folder of a texture found at `globPath`. The id includes the
 * folder path, so equal file names in different packs never collide; files
 * directly in `textures/` keep the id they always had.
 */
export function parseTextureDiskPath(globPath: string): {
  id: string;
  name: string;
  folderPath: string | null;
} {
  const rel = globPath.startsWith(TEXTURE_ROOT) ? globPath.slice(TEXTURE_ROOT.length) : globPath;
  const parts = rel.split('/');
  const stem = parts.pop()!.replace(/\.[^/.]+$/, '');
  const folderPath = parts.length > 0 ? parts.join('/') : null;
  return {
    id: `folder-tex-${slug([...parts, stem].join('-'))}`,
    name: labelFromFileName(stem),
    folderPath,
  };
}

/** Every disk folder, parents before children, sorted by name at each level */
export function buildTextureFolderTree(textures: TextureAsset[]): TextureFolderNode[] {
  const counts = new Map<string, number>();
  for (const t of textures) {
    if (!t.folderPath) continue;
    const parts = t.folderPath.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts.keys()]
    .sort((a, b) => {
      const pa = a.split('/');
      const pb = b.split('/');
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        const c = pa[i].localeCompare(pb[i], undefined, { numeric: true });
        if (c !== 0) return c;
      }
      return pa.length - pb.length;
    })
    .map((path) => {
      const parts = path.split('/');
      return { path, name: parts[parts.length - 1], depth: parts.length - 1, count: counts.get(path)! };
    });
}

/** Textures in `folder` (including its subfolders) whose name contains `search` */
export function filterTextures(
  textures: TextureAsset[],
  folder: TextureFolderFilter,
  search: string
): TextureAsset[] {
  const query = search.trim().toLowerCase();
  return textures.filter((t) => {
    const inFolder =
      folder === 'all' ||
      (folder === 'builtin' && t.sourceType === 'procedural') ||
      (folder === 'uploaded' && t.sourceType !== 'procedural' && !t.fromProject) ||
      (t.folderPath !== undefined &&
        (t.folderPath === folder || t.folderPath.startsWith(`${folder}/`)));
    return inFolder && (!query || t.name.toLowerCase().includes(query));
  });
}

export const MAX_RECENT_TEXTURES = 5;
const RECENT_TEXTURES_STORAGE_KEY = 'gridforge.recentTextures.v1';

/**
 * Records `textureId` as the most recently used texture (index 0),
 * deduplicating any prior occurrence and capping the list at `maxCount` (default 5).
 */
export function recordRecentTexture(
  recentIds: readonly string[],
  textureId: string,
  maxCount: number = MAX_RECENT_TEXTURES
): string[] {
  const trimmed = textureId.trim();
  if (!trimmed) return recentIds.slice(0, maxCount);
  const next = [trimmed, ...recentIds.filter((id) => id !== trimmed)];
  return next.slice(0, maxCount);
}

/**
 * Resolves an ordered list of recent texture IDs against the available `textures` library,
 * preserving most-recently-used order and skipping any missing IDs.
 */
export function resolveRecentTextures(
  textures: readonly TextureAsset[],
  recentIds: readonly string[],
  maxCount: number = MAX_RECENT_TEXTURES
): TextureAsset[] {
  const byId = new Map(textures.map((t) => [t.id, t]));
  const resolved: TextureAsset[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (seen.has(id)) continue;
    const found = byId.get(id);
    if (found) {
      seen.add(id);
      resolved.push(found);
      if (resolved.length >= maxCount) break;
    }
  }
  return resolved;
}

/**
 * Extracts up to `maxCount` unique texture IDs currently used across a level's surface matrices.
 */
export function collectUsedTextureIdsFromMatrices(
  matrices: readonly (readonly (readonly string[])[])[],
  maxCount: number = MAX_RECENT_TEXTURES
): string[] {
  const seen = new Set<string>();
  for (const mat of matrices) {
    for (const row of mat) {
      for (const id of row) {
        if (typeof id === 'string' && id.trim()) {
          seen.add(id.trim());
          if (seen.size >= maxCount) return [...seen];
        }
      }
    }
  }
  return [...seen];
}

export function loadRecentTextureIds(
  fallbackIds: readonly string[] = []
): string[] {
  try {
    if (typeof localStorage === 'undefined') {
      return fallbackIds.slice(0, MAX_RECENT_TEXTURES);
    }
    const raw = localStorage.getItem(RECENT_TEXTURES_STORAGE_KEY);
    if (!raw) return fallbackIds.slice(0, MAX_RECENT_TEXTURES);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallbackIds.slice(0, MAX_RECENT_TEXTURES);
    const valid = parsed.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0
    );
    return valid.length > 0
      ? valid.slice(0, MAX_RECENT_TEXTURES)
      : fallbackIds.slice(0, MAX_RECENT_TEXTURES);
  } catch {
    return fallbackIds.slice(0, MAX_RECENT_TEXTURES);
  }
}

export function saveRecentTextureIds(recentIds: readonly string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      RECENT_TEXTURES_STORAGE_KEY,
      JSON.stringify(recentIds.slice(0, MAX_RECENT_TEXTURES))
    );
  } catch {
    // Ignore storage quota or private browsing errors
  }
}
