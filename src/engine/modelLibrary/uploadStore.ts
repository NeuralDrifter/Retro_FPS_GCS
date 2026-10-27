/**
 * ============================================================================
 * GRIDFORGE 3D UPLOADED MODEL FILE STORE (INDEXEDDB)
 * ============================================================================
 * Keeps `.glb` files uploaded through the app (and URL-linked models, as just
 * their URL) across page reloads. Every
 * function resolves (never rejects): when IndexedDB is missing, blocked, or
 * full, writes report `false` and reads return nothing, so uploads still work
 * for the current session.
 */

import type { Model3DAsset } from '../../types/engine';
import { computeDeterministicAssetId } from '../AssetRegistry';

const DB_NAME = 'gridforge-models';
const STORE_NAME = 'uploads';

export interface UploadedModelRecord {
  id: string;
  name: string;
  /** The uploaded file, or null for a URL-linked model (its URL is in `meta.customGlbUrl`) */
  blob: Blob | null;
  meta: Partial<Model3DAsset>;
}

/**
 * Rebuilds a library model from a stored record, or null when it has no file
 * or URL. An uploaded file goes to `keepFile` rather than into a link, so it
 * only takes memory while the 3D view loads it.
 */
export function recordToAsset(
  record: UploadedModelRecord,
  keepFile: (modelId: string, file: Blob) => void
): Model3DAsset | null {
  const url = record.blob ? undefined : record.meta.customGlbUrl;
  if (!record.blob && !url) return null;
  if (record.blob) keepFile(record.id, record.blob);
  const { customGlbUrl: _savedLink, ...meta } = record.meta;
  return {
    ...(meta as Model3DAsset),
    id: record.id,
    name: record.meta.name ?? record.name,
    ...(url ? { customGlbUrl: url } : {}),
  };
}

/**
 * Library id for an uploaded file: `glb-` plus the first 16 hex digits of the
 * SHA-256 of its contents. It never depends on the temporary object URL, so
 * levels keep resolving the model after a reload restores it from this store,
 * and two different files can not share an id.
 */
export async function uploadedModelId(bytes: ArrayBuffer): Promise<string> {
  // Pages served over plain http on a LAN address have no crypto.subtle; hash the bytes as text instead
  if (!globalThis.crypto?.subtle) {
    const view = new Uint8Array(bytes);
    let text = '';
    for (let i = 0; i < view.length; i += 0x8000) {
      text += String.fromCharCode(...view.subarray(i, i + 0x8000));
    }
    return computeDeterministicAssetId('glb', text);
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0'));
  return `glb-${hex.join('')}`;
}

/**
 * Id for a second (third, ...) copy of a file already in the library, which
 * the user chose to keep anyway: the content id plus the next free `-<n>`.
 */
export function duplicateModelId(contentId: string, existingIds: Set<string>): string {
  let n = 2;
  while (existingIds.has(`${contentId}-${n}`)) n++;
  return `${contentId}-${n}`;
}

/** True when `id` is `contentId` or a numbered duplicate of it */
function isIdForContent(id: string, contentId: string): boolean {
  if (id === contentId) return true;
  const suffix = id.startsWith(`${contentId}-`) ? id.slice(contentId.length + 1) : '';
  return /^\d+$/.test(suffix);
}

/** The id a record should have under the current scheme (content hash, or URL hash) */
async function currentRecordId(record: UploadedModelRecord): Promise<string> {
  if (record.blob) return uploadedModelId(await record.blob.arrayBuffer());
  const url = record.meta.customGlbUrl;
  return url ? computeDeterministicAssetId('glb', url) : record.id;
}

/**
 * Gives every stored record its current-scheme id. `renamed` maps each old id
 * to its new one; records that end up with the same id (the same file stored
 * twice under old ids) are kept once.
 */
export async function rekeyUploadedRecords(records: UploadedModelRecord[]): Promise<{
  records: UploadedModelRecord[];
  renamed: Record<string, string>;
}> {
  const byId = new Map<string, UploadedModelRecord>();
  const renamed: Record<string, string> = {};
  for (const record of records) {
    const contentId = await currentRecordId(record);
    // Duplicates the user chose to keep stay under their own numbered id
    const id = isIdForContent(record.id, contentId) ? record.id : contentId;
    if (id !== record.id) renamed[record.id] = id;
    if (!byId.has(id)) byId.set(id, { ...record, id, meta: { ...record.meta, id } });
  }
  return { records: [...byId.values()], renamed };
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      // A blocked open can still succeed later; that late connection is closed, not leaked
      let settled = false;
      const settle = (db: IDBDatabase | null) => {
        if (settled) {
          db?.close();
          return;
        }
        settled = true;
        resolve(db);
      };
      request.onsuccess = () => settle(request.result);
      request.onerror = () => settle(null);
      request.onblocked = () => settle(null);
    } catch {
      resolve(null);
    }
  });
}

/** Runs one request in its own transaction, resolving `fallback` on any failure */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  onSuccess: (result: unknown) => T,
  fallback: T
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      let result: T = fallback;
      request.onsuccess = () => {
        result = onSuccess(request.result);
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(fallback);
      tx.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  }).finally(() => db.close());
}

export function putUploadedModel(record: UploadedModelRecord): Promise<boolean> {
  return withStore('readwrite', (store) => store.put(record), () => true, false);
}

export function getAllUploadedModels(): Promise<UploadedModelRecord[]> {
  return withStore<UploadedModelRecord[]>(
    'readonly',
    (store) => store.getAll(),
    (result) => (Array.isArray(result) ? (result as UploadedModelRecord[]) : []),
    []
  );
}

export function getUploadedModel(id: string): Promise<UploadedModelRecord | null> {
  return withStore<UploadedModelRecord | null>(
    'readonly',
    (store) => store.get(id),
    (result) => (result ? (result as UploadedModelRecord) : null),
    null
  );
}

export function deleteUploadedModel(id: string): Promise<boolean> {
  return withStore('readwrite', (store) => store.delete(id), () => true, false);
}
