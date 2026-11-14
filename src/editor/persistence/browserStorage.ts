/**
 * Browser services around project storage (release plan P2.5): one editing tab per project
 * (Web Locks), persistent storage, and the storage quota.
 */

export interface ProjectLock {
  /** True when another tab already edits this project, so this tab must not write to it */
  readOnly: boolean;
  release(): void;
}

/**
 * Takes the edit lock for a project. A second tab that opens the same project gets
 * `readOnly: true`. Browsers without Web Locks always get the lock.
 */
export function acquireProjectLock(projectId: string): Promise<ProjectLock> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve({ readOnly: false, release: () => {} });
  return new Promise((resolve) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    locks
      .request(`retro-fps-gcs-project:${projectId}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve({ readOnly: true, release: () => {} });
          return undefined;
        }
        resolve({ readOnly: false, release });
        // Held until release() is called
        return held;
      })
      .catch(() => resolve({ readOnly: false, release: () => {} }));
  });
}

/** Asks the browser not to evict saved projects under storage pressure; false when refused */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export const QUOTA_WARNING_RATIO = 0.8;

/** Storage use as a fraction of the quota, or null when the browser does not say */
export async function storageUseRatio(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota || estimate.usage === undefined) return null;
    return estimate.usage / estimate.quota;
  } catch {
    return null;
  }
}
