/**
 * Test hooks for the end-to-end suite.
 *
 * When `window.__GCS_DEBUG__` is `true`, milestones are announced as `gcs:<name>`
 * events on `window`. Playwright sets the flag before the page loads (see
 * `e2e/fixtures.ts`). Without the flag nothing is dispatched, so players and
 * creators never see these events.
 */

export type GcsDebugEventName =
  /** The game runtime drew its first frame. */
  | 'first-frame'
  /** The editor has mounted and is interactive. */
  | 'editor-ready';

declare global {
  interface Window {
    __GCS_DEBUG__?: boolean;
    /** Read-only probes the e2e suite calls in debug runs (see registerDebugProbe). */
    __gcsProbes?: Record<string, () => unknown>;
  }
}

/** In debug runs, exposes `probe` as `window.__gcsProbes[name]`; returns a function that removes it. */
export function registerDebugProbe(name: string, probe: () => unknown): () => void {
  if (typeof window === 'undefined' || window.__GCS_DEBUG__ !== true) return () => {};
  const probes = (window.__gcsProbes ??= {});
  probes[name] = probe;
  return () => {
    if (probes[name] === probe) delete probes[name];
  };
}

export function emitDebugEvent(name: GcsDebugEventName): void {
  if (typeof window === 'undefined' || window.__GCS_DEBUG__ !== true) return;
  window.dispatchEvent(new CustomEvent(`gcs:${name}`));
}
