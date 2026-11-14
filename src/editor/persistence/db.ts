/**
 * The editor's browser storage (release plan P2.5): saved projects, autosaves and user asset
 * blobs in IndexedDB. Nothing here leaves the browser.
 *
 *   projects    one record per project the creator saved (Ctrl+S), keyed by project id
 *   autosaves   timed copies of the open project, at most AUTOSAVES_KEPT per project
 *   assets      user asset blobs keyed by SHA-256 (filled from P2.6)
 *
 * Every function rejects when IndexedDB is unavailable (some private windows); callers treat
 * that as "no browser storage" and keep working.
 */
import type { ProjectDocV4 } from '../../shared/project';

export const DB_NAME = 'retro-fps-gcs-editor';
const DB_VERSION = 1;
export const AUTOSAVES_KEPT = 5;

export interface SavedProjectRecord {
  id: string;
  title: string;
  /** When the creator last saved it (ms since epoch) */
  savedAt: number;
  doc: ProjectDocV4;
}

export interface AutosaveRecord {
  key?: number;
  projectId: string;
  title: string;
  savedAt: number;
  doc: ProjectDocV4;
}

export type ProjectSummary = Omit<SavedProjectRecord, 'doc'>;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('autosaves')) {
        const autosaves = db.createObjectStore('autosaves', { keyPath: 'key', autoIncrement: true });
        autosaves.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets');
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema closes this connection; the next call reopens
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another tab'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Browser storage transaction failed'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed'));
  });
}

// ------------------------------------------------------------------ projects

export async function saveProject(doc: ProjectDocV4, savedAt = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  const record: SavedProjectRecord = { id: doc.id, title: doc.meta.title, savedAt, doc };
  tx.objectStore('projects').put(record);
  await done(tx);
}

export async function loadProject(id: string): Promise<SavedProjectRecord | undefined> {
  const db = await openDb();
  return result(db.transaction('projects').objectStore('projects').get(id) as IDBRequest<SavedProjectRecord | undefined>);
}

/** Saved projects, most recently saved first, without their documents */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb();
  const all = await result(db.transaction('projects').objectStore('projects').getAll() as IDBRequest<SavedProjectRecord[]>);
  return all.map(({ id, title, savedAt }) => ({ id, title, savedAt })).sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'autosaves'], 'readwrite');
  tx.objectStore('projects').delete(id);
  const index = tx.objectStore('autosaves').index('projectId');
  const keys = await result(index.getAllKeys(id));
  for (const key of keys) tx.objectStore('autosaves').delete(key);
  await done(tx);
}

// ----------------------------------------------------------------- autosaves

/** Stores an autosave and drops the oldest beyond AUTOSAVES_KEPT for that project */
export async function addAutosave(doc: ProjectDocV4, savedAt = Date.now()): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('autosaves', 'readwrite');
  const store = tx.objectStore('autosaves');
  const record: AutosaveRecord = { projectId: doc.id, title: doc.meta.title, savedAt, doc };
  store.add(record);
  const existing = await result(store.index('projectId').getAll(doc.id) as IDBRequest<AutosaveRecord[]>);
  const sorted = existing.sort((a, b) => b.savedAt - a.savedAt || (b.key ?? 0) - (a.key ?? 0));
  for (const old of sorted.slice(AUTOSAVES_KEPT)) store.delete(old.key!);
  await done(tx);
}

export async function listAutosaves(): Promise<AutosaveRecord[]> {
  const db = await openDb();
  return result(db.transaction('autosaves').objectStore('autosaves').getAll() as IDBRequest<AutosaveRecord[]>);
}

export async function deleteAutosaves(projectId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('autosaves', 'readwrite');
  const keys = await result(tx.objectStore('autosaves').index('projectId').getAllKeys(projectId));
  for (const key of keys) tx.objectStore('autosaves').delete(key);
  await done(tx);
}

// -------------------------------------------------------------------- assets

export async function putAssetBlob(sha256: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('assets', 'readwrite');
  tx.objectStore('assets').put(blob, sha256);
  await done(tx);
}

export async function getAssetBlob(sha256: string): Promise<Blob | undefined> {
  const db = await openDb();
  return result(db.transaction('assets').objectStore('assets').get(sha256) as IDBRequest<Blob | undefined>);
}
