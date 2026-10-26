/**
 * ============================================================================
 * PIE3D MODEL LIBRARY STATE (FOLDERS, TAGS, SETTINGS & FILTERING)
 * ============================================================================
 * Pure, immutable operations on the global model library. Every function
 * returns a new state and never mutates its input.
 *  - Built-in category folders (`cat:<category>`) always exist at the root.
 *  - User folders (`f-<n>`) nest anywhere; a model's category comes from the
 *    nearest category folder above it ('decorations' when there is none).
 */

import type { Model3DAsset } from '../../types/engine';
import type {
  LibraryFolder,
  ModelCategoryId,
  ModelFilter,
  ModelLibraryState,
  ModelSettings,
  ResolvedModelSettings,
} from '../../types/modelLibrary';
import {
  MODEL_CATEGORIES,
  getCategoryInfo,
  resolveEntityCategory,
} from './categories';
import { measuredFootprintFromSize } from './footprint';

const FALLBACK_CATEGORY: ModelCategoryId = 'decorations';

export const categoryFolderId = (category: ModelCategoryId): string =>
  `cat:${category}`;

function isBuiltInFolder(s: ModelLibraryState, folderId: string): boolean {
  return s.folders.some((f) => f.id === folderId && f.categoryId !== undefined);
}

function requireCustomFolder(s: ModelLibraryState, folderId: string): LibraryFolder {
  const folder = s.folders.find((f) => f.id === folderId);
  if (!folder) throw new Error(`Folder '${folderId}' does not exist.`);
  if (folder.categoryId !== undefined) {
    throw new Error(`Built-in folder '${folder.name}' cannot be changed.`);
  }
  return folder;
}

function cleanFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  return trimmed;
}

export function createEmptyLibraryState(): ModelLibraryState {
  return {
    version: 1,
    nextFolderId: 1,
    folders: MODEL_CATEGORIES.map((c) => ({
      id: categoryFolderId(c.id),
      name: c.label,
      parentId: null,
      categoryId: c.id,
    })),
    modelFolder: {},
    modelTags: {},
    modelSettings: {},
  };
}

export function createFolder(
  s: ModelLibraryState,
  name: string,
  parentId: string | null
): { state: ModelLibraryState; folderId: string } {
  const folderId = `f-${s.nextFolderId}`;
  return {
    folderId,
    state: {
      ...s,
      nextFolderId: s.nextFolderId + 1,
      folders: [...s.folders, { id: folderId, name: cleanFolderName(name), parentId }],
    },
  };
}

export function renameFolder(
  s: ModelLibraryState,
  folderId: string,
  name: string
): ModelLibraryState {
  requireCustomFolder(s, folderId);
  const cleaned = cleanFolderName(name);
  return {
    ...s,
    folders: s.folders.map((f) => (f.id === folderId ? { ...f, name: cleaned } : f)),
  };
}

/** Removes a custom folder; its child folders and models move to its parent */
export function deleteFolder(s: ModelLibraryState, folderId: string): ModelLibraryState {
  const folder = requireCustomFolder(s, folderId);
  const modelTarget = folder.parentId ?? categoryFolderId(FALLBACK_CATEGORY);
  return {
    ...s,
    folders: s.folders
      .filter((f) => f.id !== folderId)
      .map((f) => (f.parentId === folderId ? { ...f, parentId: folder.parentId } : f)),
    modelFolder: Object.fromEntries(
      Object.entries(s.modelFolder).map(([modelId, fId]) => [
        modelId,
        fId === folderId ? modelTarget : fId,
      ])
    ),
  };
}

/** Finds or creates each '/'-separated folder of `path` below `rootFolderId` */
export function ensureFolderPath(
  s: ModelLibraryState,
  rootFolderId: string | null,
  path: string
): { state: ModelLibraryState; folderId: string } {
  const segments = path.split('/').map((p) => p.trim()).filter(Boolean);
  let state = s;
  let parentId = rootFolderId;
  for (const segment of segments) {
    const existing = state.folders.find(
      (f) =>
        f.parentId === parentId &&
        f.categoryId === undefined &&
        f.name.toLowerCase() === segment.toLowerCase()
    );
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const created = createFolder(state, segment, parentId);
    state = created.state;
    parentId = created.folderId;
  }
  return { state, folderId: parentId ?? categoryFolderId(FALLBACK_CATEGORY) };
}

/** Category of a folder: its nearest built-in ancestor, or 'decorations' */
export function getFolderCategory(s: ModelLibraryState, folderId: string): ModelCategoryId {
  const byId = new Map(s.folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    if (current.categoryId) return current.categoryId;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return FALLBACK_CATEGORY;
}

/** Puts a model in a folder and adopts that folder's category */
export function moveModelToFolder(
  s: ModelLibraryState,
  modelId: string,
  folderId: string
): ModelLibraryState {
  const moved = {
    ...s,
    modelFolder: { ...s.modelFolder, [modelId]: folderId },
  };
  return setModelSettings(moved, modelId, { category: getFolderCategory(s, folderId) });
}

/** Stores tags trimmed, without empties, deduped case-insensitively (first spelling wins) */
export function setModelTags(
  s: ModelLibraryState,
  modelId: string,
  tags: string[]
): ModelLibraryState {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(tag);
  }
  return { ...s, modelTags: { ...s.modelTags, [modelId]: cleaned } };
}

export function setModelSettings(
  s: ModelLibraryState,
  modelId: string,
  patch: ModelSettings
): ModelLibraryState {
  return {
    ...s,
    modelSettings: {
      ...s.modelSettings,
      [modelId]: { ...s.modelSettings[modelId], ...patch },
    },
  };
}

/** Folder a model shows in: stored placement, else its category, else its legacy category */
export function resolveModelFolder(s: ModelLibraryState, asset: Model3DAsset): string {
  const stored = s.modelFolder[asset.id];
  if (stored && s.folders.some((f) => f.id === stored)) return stored;
  const category =
    asset.category ?? resolveEntityCategory({ isEnemy: asset.isEnemy });
  return categoryFolderId(category);
}

/** Footprint of the measured real size at `scale`, or null when the model was never measured */
export function measuredFootprintAtScale(
  settings: Pick<ModelSettings, 'measuredSizeMeters'>,
  scale: number
): { w: number; d: number } | null {
  const size = settings.measuredSizeMeters;
  return size ? measuredFootprintFromSize(size.width * scale, size.depth * scale) : null;
}

/** Effective settings: category defaults, then asset values, then stored library overrides */
export function resolveModelSettings(
  s: ModelLibraryState,
  asset: Model3DAsset
): ResolvedModelSettings {
  const stored = s.modelSettings[asset.id] ?? {};
  const category =
    stored.category ??
    asset.category ??
    resolveEntityCategory({ isEnemy: asset.isEnemy });
  const info = getCategoryInfo(category);
  const scale = stored.scale ?? 1;
  const measured =
    measuredFootprintAtScale(stored, scale) ??
    stored.measuredFootprint ??
    asset.measuredFootprint;
  const footprint =
    stored.footprintOverride && stored.footprintW && stored.footprintD
      ? { w: stored.footprintW, d: stored.footprintD }
      : asset.footprintW && asset.footprintD
      ? { w: asset.footprintW, d: asset.footprintD }
      : measured ?? { w: 1, d: 1 };
  const isCharacter = category === 'characters';
  return {
    ...stored,
    category,
    collision: stored.collision ?? asset.collision ?? info.defaultCollision,
    footprintW: footprint.w,
    footprintD: footprint.d,
    ...(measured ? { measuredFootprint: measured } : {}),
    scale,
    isEnemy: isCharacter ? stored.isEnemy ?? asset.isEnemy : false,
    maxHealth: stored.maxHealth ?? asset.defaultHealth,
    moveSpeed: isCharacter ? stored.moveSpeed ?? asset.moveSpeed : 0,
    attackDamage: isCharacter ? stored.attackDamage ?? asset.attackDamage : 0,
  };
}

function folderSubtree(s: ModelLibraryState, folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of s.folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Models in the folder's subtree matching search, every tag, and the used-in-level set */
export function filterModels(
  assets: Model3DAsset[],
  s: ModelLibraryState,
  f: ModelFilter
): Model3DAsset[] {
  const subtree = f.folderId ? folderSubtree(s, f.folderId) : null;
  const search = f.search.trim().toLowerCase();
  const wantedTags = f.tags.map((t) => t.toLowerCase());
  return assets.filter((asset) => {
    if (subtree && !subtree.has(resolveModelFolder(s, asset))) return false;
    if (f.usedModelIds && !f.usedModelIds.has(asset.id)) return false;
    const tags = (s.modelTags[asset.id] ?? asset.tags ?? []).map((t) => t.toLowerCase());
    if (!wantedTags.every((t) => tags.includes(t))) return false;
    if (!search) return true;
    return (
      asset.name.toLowerCase().includes(search) ||
      tags.some((t) => t.includes(search))
    );
  });
}

/**
 * Files models found in disk or manifest folders into matching library folders.
 * Models the user already placed in a folder keep their placement, and running
 * it again changes nothing.
 */
export function mergeDiscoveredFolders(
  s: ModelLibraryState,
  assets: Model3DAsset[]
): ModelLibraryState {
  let state = s;
  for (const asset of assets) {
    if (!asset.folderPath || state.modelFolder[asset.id]) continue;
    const category =
      asset.category ?? resolveEntityCategory({ isEnemy: asset.isEnemy });
    const { state: withFolder, folderId } = ensureFolderPath(
      state,
      asset.folderAtRoot ? null : categoryFolderId(category),
      asset.folderPath
    );
    state = moveModelToFolder(withFolder, asset.id, folderId);
  }
  return state;
}
