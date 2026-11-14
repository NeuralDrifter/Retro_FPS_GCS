/**
 * When to autosave (release plan P2.5): 5 s after the last change, at least every 30 s while
 * changes keep coming, and at once when the page is hidden. The schedule is separate from
 * storage so it can be tested with fake timers.
 */

export const AUTOSAVE_IDLE_MS = 5_000;
export const AUTOSAVE_MAX_INTERVAL_MS = 30_000;

export interface AutosaverOptions {
  /** Writes the current state; a rejection is reported and the next change tries again */
  save: () => Promise<void>;
  onError?: (error: unknown) => void;
  idleMs?: number;
  maxIntervalMs?: number;
  now?: () => number;
}

export interface Autosaver {
  /** Something changed since the last save */
  changed(): void;
  /** Saves now if anything changed; resolves when written */
  flush(): Promise<void>;
  /** True while a change has not been written yet */
  isDirty(): boolean;
  /** Forgets pending changes (a project was saved or replaced by other means) */
  markClean(): void;
  dispose(): void;
}

export function createAutosaver({
  save,
  onError,
  idleMs = AUTOSAVE_IDLE_MS,
  maxIntervalMs = AUTOSAVE_MAX_INTERVAL_MS,
  now = () => Date.now(),
}: AutosaverOptions): Autosaver {
  let dirtySince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> | null = null;
  let disposed = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = async () => {
    clear();
    if (dirtySince === null || disposed) return;
    // A save in progress finishes first; changes made meanwhile get their own save
    if (writing) await writing;
    if (dirtySince === null) return;
    dirtySince = null;
    writing = save()
      .catch((error) => {
        onError?.(error);
      })
      .finally(() => {
        writing = null;
      });
    await writing;
  };

  return {
    changed() {
      if (disposed) return;
      const t = now();
      if (dirtySince === null) dirtySince = t;
      clear();
      // Wait for a pause, but never past the longest interval since the first unsaved change
      const delay = Math.max(0, Math.min(idleMs, dirtySince + maxIntervalMs - t));
      timer = setTimeout(() => void run(), delay);
    },
    flush: run,
    isDirty: () => dirtySince !== null,
    markClean() {
      dirtySince = null;
      clear();
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}

/** What recovery needs to know about an autosave or a saved project */
export interface StoredCopy {
  projectId: string;
  title: string;
  savedAt: number;
}

/**
 * The autosave to offer on load: the newest one whose project was not saved after it.
 * Returns null when every autosave is older than its project's last save.
 */
export function pickRecoverable<T extends StoredCopy>(autosaves: T[], saved: { id: string; savedAt: number }[]): T | null {
  const savedAt = new Map(saved.map((p) => [p.id, p.savedAt]));
  let best: T | null = null;
  for (const a of autosaves) {
    if (a.savedAt <= (savedAt.get(a.projectId) ?? -Infinity)) continue;
    if (!best || a.savedAt > best.savedAt) best = a;
  }
  return best;
}
