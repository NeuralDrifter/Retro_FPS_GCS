/**
 * ============================================================================
 * GRIDFORGE 3D MODEL LIBRARY PERSISTENCE (BROWSER STORAGE + EXPORT / IMPORT FILE)
 * ============================================================================
 * Browser storage is per-site and can be blocked, full, or cleared (private
 * windows, AI Studio iframes), so every access is guarded and falls back to an
 * empty library. The exported `gridforge-library.json` file is the durable copy.
 */

import type { ModelLibraryState } from '../../types/modelLibrary';
import { createEmptyLibraryState } from './libraryState';

export const LIBRARY_STORAGE_KEY = 'gridforge.modelLibrary.v1';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates the parsed shape and re-adds any missing built-in folders */
function normalizeLibraryState(value: unknown): ModelLibraryState | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.nextFolderId !== 'number' ||
    !Array.isArray(value.folders) ||
    !isRecord(value.modelFolder) ||
    !isRecord(value.modelTags) ||
    !isRecord(value.modelSettings)
  ) {
    return null;
  }
  const state = value as unknown as ModelLibraryState;
  const builtIns = createEmptyLibraryState().folders.filter(
    (b) => !state.folders.some((f) => f.id === b.id)
  );
  return builtIns.length > 0
    ? { ...state, folders: [...builtIns, ...state.folders] }
    : state;
}

export function getBrowserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadLibraryState(
  storage: Pick<Storage, 'getItem'> | null
): ModelLibraryState {
  try {
    const raw = storage?.getItem(LIBRARY_STORAGE_KEY);
    if (raw) {
      const loaded = normalizeLibraryState(JSON.parse(raw));
      if (loaded) return loaded;
    }
  } catch {
    // Unreadable storage or corrupt JSON: start from the defaults
  }
  return createEmptyLibraryState();
}

/** Returns false when the library could not be saved (no storage, blocked, or full) */
export function saveLibraryState(
  storage: Pick<Storage, 'setItem'> | null,
  s: ModelLibraryState
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/**
 * Library file contents. Uploaded model files are not embedded; they are
 * listed so they can be re-added after importing in another browser.
 */
export function exportLibraryJson(
  s: ModelLibraryState,
  uploadedModels: { id: string; name: string }[]
): string {
  return JSON.stringify(
    { format: 'gridforge-library', version: 1, library: s, uploadedModels },
    null,
    2
  );
}

export function importLibraryJson(json: string): ModelLibraryState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Not a GridForge library file');
  }
  const library =
    isRecord(parsed) && parsed.format === 'gridforge-library'
      ? normalizeLibraryState(parsed.library)
      : null;
  if (!library) throw new Error('Not a GridForge library file');
  return library;
}
