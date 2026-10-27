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
