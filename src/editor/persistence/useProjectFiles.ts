/**
 * Project management for the File menu (release plan P2.5): new, open (file or recent), save
 * to browser storage, download, close; autosave and recovery; one editing tab per project.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Model3DAsset, TextureAsset } from '../../runtime';
import { LevelSerializer } from '../engine/LevelSerializer';
import { canonicalStringify, createDefaultProject, detectProjectFormat, migrateToV4 } from '../../shared/project';
import type { ProjectDocV4 } from '../../shared/project';
import type { DocumentStore } from '../store/documentStore';
import { EDITOR_VERSION, createInitialProject, randomProjectId } from '../store/useEditorDocument';
import { createAutosaver, pickRecoverable } from './autosave';
import type { Autosaver } from './autosave';
import {
  QUOTA_WARNING_RATIO,
  acquireProjectLock,
  requestPersistentStorage,
  storageUseRatio,
} from './browserStorage';
import type { ProjectLock } from './browserStorage';
import { addAutosave, deleteAutosaves, listAutosaves, listProjects, loadProject, saveProject } from './db';
import type { AutosaveRecord, ProjectSummary } from './db';
import { downloadText } from './download';
import { embedUploadedTextures, importUserAssets, prepareForDownload, prepareForStorage } from './projectAssets';
import { MAX_PROJECT_FILE_BYTES, formatMB } from '../library/uploadIntake';

export interface UseProjectFilesOptions {
  store: DocumentStore;
  doc: ProjectDocV4;
  customTextures: TextureAsset[];
  addCustomTextures: (textures: TextureAsset[]) => void;
  addCustomModels: (models: Model3DAsset[]) => void;
  setActiveLevelId: (id: string) => void;
  /** Resets editor UI state after another project was opened */
  onProjectOpened: () => void;
  /** Opens an older editor save file (LevelStateData) as a new project */
  restoreLegacy: (state: ReturnType<typeof LevelSerializer.parseLevelJson>) => void;
  setReadOnly: (readOnly: boolean) => void;
  log: (message: string) => void;
}

/** Projects whose edit lock another tab holds right now */
async function projectsOpenElsewhere(): Promise<Set<string>> {
  try {
    const snapshot = await navigator.locks?.query?.();
    return new Set((snapshot?.held ?? []).map((l) => l.name?.replace(/^retro-fps-gcs-project:/, '') ?? ''));
  } catch {
    return new Set();
  }
}

export function createBlankProject(): ProjectDocV4 {
  return createDefaultProject({ id: randomProjectId(), title: 'Untitled Game', now: new Date().toISOString(), editorVersion: EDITOR_VERSION });
}

export function useProjectFiles({
  store,
  doc,
  customTextures,
  addCustomTextures,
  addCustomModels,
  setActiveLevelId,
  onProjectOpened,
  restoreLegacy,
  setReadOnly,
  log,
}: UseProjectFilesOptions) {
  const [readOnly, setReadOnlyState] = useState(false);
  const [recovery, setRecovery] = useState<AutosaveRecord | null>(null);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const [quotaWarning, setQuotaWarning] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);

  const logRef = useRef(log);
  logRef.current = log;
  const texturesRef = useRef(customTextures);
  texturesRef.current = customTextures;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /** The document as stored and downloaded: uploaded textures embedded, times updated */
  const snapshot = useCallback((): ProjectDocV4 => {
    const current = store.getState().doc;
    const stamped = { ...current, meta: { ...current.meta, updatedAt: new Date().toISOString(), editorVersion: EDITOR_VERSION } };
    return embedUploadedTextures(stamped, texturesRef.current);
  }, [store]);

  const checkQuota = useCallback(async () => {
    const ratio = await storageUseRatio();
    if (ratio !== null && ratio >= QUOTA_WARNING_RATIO) {
      const message = `Browser storage is ${Math.round(ratio * 100)}% full. Download your projects to keep copies.`;
      setQuotaWarning(message);
      logRef.current(`Warning: ${message}`);
    } else {
      setQuotaWarning(null);
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listProjects());
    } catch {
      setStorageOk(false);
    }
  }, []);

  // ------------------------------------------------------------------ autosave
  const autosaverRef = useRef<Autosaver | null>(null);
  useEffect(() => {
    const autosaver = createAutosaver({
      save: async () => {
        await addAutosave(await prepareForStorage(snapshot()));
      },
      onError: (error) => {
        setStorageOk(false);
        logRef.current(`Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    autosaverRef.current = autosaver;
    let last = store.getState();
    const unsubscribe = store.subscribe(() => {
      const next = store.getState();
      const opened = next.doc.id !== last.doc.id || (next.past.length === 0 && next.future.length === 0 && next.doc !== last.doc);
      last = next;
      if (opened) autosaver.markClean();
      else if (!readOnlyRef.current) autosaver.changed();
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void autosaver.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
      autosaver.dispose();
    };
  }, [store, snapshot]);

  // ------------------------------------------------------------- edit lock
  useEffect(() => {
    let lock: ProjectLock | null = null;
    let cancelled = false;
    void acquireProjectLock(doc.id).then((acquired) => {
      if (cancelled) {
        acquired.release();
        return;
      }
      lock = acquired;
      setReadOnlyState(acquired.readOnly);
      setReadOnly(acquired.readOnly);
      if (acquired.readOnly) {
        logRef.current('Read-only: this project is open for editing in another tab. Close it there to edit here.');
      }
    });
    return () => {
      cancelled = true;
      lock?.release();
    };
  }, [doc.id, setReadOnly]);

  // ------------------------------------------------- recovery on first load
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [autosaves, saved, elsewhere] = await Promise.all([listAutosaves(), listProjects(), projectsOpenElsewhere()]);
        if (!active) return;
        setRecent(saved);
        const candidate = pickRecoverable(
          autosaves.filter((a) => !elsewhere.has(a.projectId) && a.projectId !== store.getState().doc.id),
          saved
        );
        setRecovery(candidate);
      } catch {
        if (active) setStorageOk(false);
      }
      await checkQuota();
    })();
    return () => {
      active = false;
    };
  }, [store, checkQuota]);

  // ------------------------------------------------------------- opening
  /**
   * Replaces the open project; writes pending autosaves of the old one first. Embedded files are
   * checked against their SHA-256; a mismatch leaves the open project as it was.
   */
  const openDoc = useCallback(
    async (next: ProjectDocV4, message: string): Promise<boolean> => {
      const imported = await importUserAssets(next);
      if (!imported.ok) {
        logRef.current(`Error: ${imported.error}`);
        return false;
      }
      await autosaverRef.current?.flush();
      const { doc: opened, textures, models, missing } = imported.result;
      if (textures.length > 0) addCustomTextures(textures);
      if (models.length > 0) addCustomModels(models);
      store.replace(opened);
      setActiveLevelId(opened.levels[0].id);
      onProjectOpened();
      logRef.current(
        missing.length > 0
          ? `${message} Warning: ${missing.length} uploaded file(s) are missing (${missing.join(', ')}); the levels show stand-ins for them.`
          : message
      );
      return true;
    },
    [store, addCustomTextures, addCustomModels, setActiveLevelId, onProjectOpened]
  );

  const newProject = useCallback(
    (kind: 'blank' | 'sample') => {
      const next = kind === 'blank' ? createBlankProject() : createInitialProject();
      void openDoc(next, kind === 'blank' ? 'File: Started a new blank project.' : `File: Started a new project from the sample '${next.meta.title}'.`);
    },
    [openDoc]
  );

  const openFile = useCallback(
    (file: File) => {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        logRef.current(`Error: '${file.name}' is ${formatMB(file.size)}; project files can be at most ${formatMB(MAX_PROJECT_FILE_BYTES)}.`);
        return;
      }
      void file.text().then(async (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          logRef.current(`Error: '${file.name}' is not a JSON file.`);
          return;
        }
        const format = detectProjectFormat(raw);
        if (format.kind === 'v1' || format.kind === 'v2' || format.kind === 'v3-level' || format.kind === 'v3-manifest') {
          // Older files go through the editor's own converter, which also registers their textures
          await autosaverRef.current?.flush();
          try {
            restoreLegacy(LevelSerializer.parseLevelJson(text));
          } catch (err) {
            logRef.current(err instanceof Error ? `Error: ${err.message}` : 'Error: Failed to read that file.');
          }
          return;
        }
        const migrated = migrateToV4(raw, { projectId: randomProjectId(), now: new Date().toISOString(), editorVersion: EDITOR_VERSION });
        if (!migrated.ok) {
          logRef.current(`Error: ${migrated.error}`);
          return;
        }
        await openDoc(migrated.doc, `File: Opened '${migrated.doc.meta.title}' (${migrated.doc.levels.length} levels).`);
      });
    },
    [openDoc, restoreLegacy]
  );

  const openRecent = useCallback(
    async (id: string) => {
      try {
        const record = await loadProject(id);
        if (!record) {
          logRef.current('Error: That project is no longer in browser storage.');
          await refreshRecent();
          return;
        }
        await openDoc(record.doc, `File: Opened '${record.title}' from browser storage.`);
      } catch (err) {
        logRef.current(`Error: Could not open the project (${err instanceof Error ? err.message : String(err)}).`);
      }
    },
    [openDoc, refreshRecent]
  );

  const save = useCallback(async () => {
    if (readOnlyRef.current) {
      logRef.current('Read-only: this project is open for editing in another tab, so it was not saved here.');
      return;
    }
    try {
      const copy = await prepareForStorage(snapshot());
      await saveProject(copy);
      autosaverRef.current?.markClean();
      await refreshRecent();
      setStorageOk(true);
      logRef.current(`File: Saved '${copy.meta.title}' to browser storage (Ctrl+S).`);
      void requestPersistentStorage();
      await checkQuota();
    } catch (err) {
      setStorageOk(false);
      logRef.current(`Error: Could not save to browser storage (${err instanceof Error ? err.message : String(err)}). Download the project file instead.`);
    }
  }, [snapshot, refreshRecent, checkQuota]);

  const download = useCallback(async () => {
    const { doc: copy, missing } = await prepareForDownload(snapshot());
    const text = canonicalStringify(copy);
    downloadText(text, `${copy.export.slug || 'game'}.gcs.json`);
    const notes: string[] = [];
    if (missing.length > 0) notes.push(`${missing.length} uploaded file(s) could not be found and were left out (${missing.join(', ')}).`);
    if (text.length > MAX_PROJECT_FILE_BYTES) notes.push(`It is ${formatMB(text.length)}, over the ${formatMB(MAX_PROJECT_FILE_BYTES)} the editor opens; remove unused uploads.`);
    logRef.current(`File: Downloaded '${copy.meta.title}' as a project file.${notes.length ? ` Warning: ${notes.join(' ')}` : ''}`);
  }, [snapshot]);

  const close = useCallback(() => {
    const title = store.getState().doc.meta.title;
    void openDoc(createBlankProject(), `File: Closed '${title}' and started a new blank project.`);
  }, [store, openDoc]);

  const recover = useCallback(async () => {
    if (!recovery) return;
    setRecovery(null);
    await openDoc(recovery.doc, `File: Recovered '${recovery.title}' from the autosave of ${new Date(recovery.savedAt).toLocaleString()}.`);
  }, [recovery, openDoc]);

  const discardRecovery = useCallback(async () => {
    if (!recovery) return;
    setRecovery(null);
    try {
      await deleteAutosaves(recovery.projectId);
    } catch {
      // Nothing to clean up when storage is unavailable
    }
    logRef.current(`File: Discarded the autosaves of '${recovery.title}'.`);
  }, [recovery]);

  // Ctrl+S (Cmd+S) saves to browser storage
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  return {
    readOnly,
    storageOk,
    quotaWarning,
    recent,
    recovery,
    recover,
    discardRecovery,
    newProject,
    openFile,
    openRecent,
    save,
    download,
    close,
  };
}
