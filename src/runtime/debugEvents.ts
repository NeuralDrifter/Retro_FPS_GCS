/**
 * Test hooks for the end-to-end suite.
 *
 * When `window.__GCS_DEBUG__` is `true`, milestones are announced as `gcs:<name>`
 * events on `window`. Playwright sets the flag before the page loads (see
 * `e2e/fixtures.ts`). Without the flag nothing is dispatched, so players and
 * creators never see these events.
 */
import type { PlayerTickInput } from '../sim';

/** Run-length encoded inputs, the format of `samples/recordings/*.json` */
export interface DebugReplay {
  segments: { ticks: number; input: PlayerTickInput }[];
}

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
    /** An input recording the e2e suite plays on the first level (see debugReplaySource) */
    __GCS_DEBUG_REPLAY__?: DebugReplay;
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

/**
 * In debug runs with `window.__GCS_DEBUG_REPLAY__` set, an input source that plays the recording
 * on the first level, tick by tick, instead of the keyboard; later levels get no input (P3.7).
 * A replay also turns off the real-time enemy AI that is not in the sim yet, as in the headless
 * test that checks the recording reaches the exit.
 */
export function debugReplaySource(levelIndex: () => number): ((tick: number) => PlayerTickInput | undefined) | undefined {
  if (typeof window === 'undefined' || window.__GCS_DEBUG__ !== true) return undefined;
  const replay = window.__GCS_DEBUG_REPLAY__;
  if (!replay || !Array.isArray(replay.segments)) return undefined;
  const inputs = replay.segments.flatMap((s) => Array.from({ length: Math.max(0, Math.floor(s.ticks)) }, () => s.input));
  return (tick) => (levelIndex() === 0 ? inputs[tick] : undefined);
}

export function emitDebugEvent(name: GcsDebugEventName): void {
  if (typeof window === 'undefined' || window.__GCS_DEBUG__ !== true) return;
  window.dispatchEvent(new CustomEvent(`gcs:${name}`));
}
