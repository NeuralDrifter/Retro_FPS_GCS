/**
 * ============================================================================
 * PIE3D UPLOADED MODEL FILE STORE (INDEXEDDB)
 * ============================================================================
 * Keeps `.glb` files uploaded through the app (and URL-linked models, as just
 * their URL) across page reloads. Every
 * function resolves (never rejects): when IndexedDB is missing, blocked, or
 * full, writes report `false` and reads return nothing, so uploads still work
 * for the current session.
 */

import type { Model3DAsset } from '../../types/engine';
import { computeDeterministicAssetId } from '../AssetRegistry';

const DB_NAME = 'pie3d-models';
const STORE_NAME = 'uploads';

export interface UploadedModelRecord {
  id: string;
  name: string;
  /** The uploaded file, or null for a URL-linked model (its URL is in `meta.customGlbUrl`) */
  blob: Blob | null;
  meta: Partial<Model3DAsset>;
}

/** Rebuilds a library model from a stored record, or null when it has no file or URL */
export function recordToAsset(
  record: UploadedModelRecord,
  createObjectUrl: (blob: Blob) => string
): Model3DAsset | null {
  const url = record.blob ? createObjectUrl(record.blob) : record.meta.customGlbUrl;
  if (!url) return null;
  return {
    ...(record.meta as Model3DAsset),
    id: record.id,
    name: record.meta.name ?? record.name,
    customGlbUrl: url,
  };
}

/**
 * Library id for an uploaded file. It is derived from the file's name and size
 * (never from its temporary object URL), so levels keep resolving the model
 * after a reload restores it from this store.
 */
export function uploadedModelId(fileName: string, fileSize: number): string {
  return computeDeterministicAssetId('glb', `${fileName}:${fileSize}`);
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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
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

export function deleteUploadedModel(id: string): Promise<boolean> {
  return withStore('readwrite', (store) => store.delete(id), () => true, false);
}
