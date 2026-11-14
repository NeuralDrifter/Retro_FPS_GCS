/**
 * Live playtest state, kept outside React so that play never re-renders the editor.
 *
 * The runtime reports the player's position up to 20 times a second and its simulation state on
 * every notable change (doors, keys, messages). Those values describe the running game, not the
 * level being edited, so they live here instead of in App state: the document stays the snapshot
 * playtest started from, and the world is rebuilt only when the document is edited (P1.7).
 *
 * Small components read it with useSyncExternalStore (usePlaytestPlayer, usePlaytestLiveSim).
 */
import { useSyncExternalStore } from 'react';
import type { PlayerTransform, SimulationState } from '../../runtime';

interface PlaytestSnapshot {
  player: PlayerTransform | null;
  liveSim: SimulationState | null;
  /** The runtime's latest status line (door opened, key taken, ...) */
  log: string | null;
}

const EMPTY: PlaytestSnapshot = { player: null, liveSim: null, log: null };
let snapshot: PlaytestSnapshot = EMPTY;
const listeners = new Set<() => void>();

function publish(next: PlaytestSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export const playtestStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getPlayer: (): PlayerTransform | null => snapshot.player,
  getLiveSim: (): SimulationState | null => snapshot.liveSim,
  setPlayer(player: PlayerTransform): void {
    publish({ ...snapshot, player });
  },
  getLog: (): string | null => snapshot.log,
  setLiveSim(liveSim: SimulationState): void {
    publish({ ...snapshot, liveSim });
  },
  setLog(log: string): void {
    publish({ ...snapshot, log });
  },
  /** Called when playtest stops: the editor shows the document again. */
  reset(): void {
    if (snapshot !== EMPTY) publish(EMPTY);
  },
};

/** The player's live transform while playtesting, or null in edit mode. */
export function usePlaytestPlayer(): PlayerTransform | null {
  return useSyncExternalStore(playtestStore.subscribe, playtestStore.getPlayer);
}

/** The running game's simulation state while playtesting, or null in edit mode. */
export function usePlaytestLiveSim(): SimulationState | null {
  return useSyncExternalStore(playtestStore.subscribe, playtestStore.getLiveSim);
}

/** The runtime's latest status line while playtesting, or null in edit mode. */
export function usePlaytestLog(): string | null {
  return useSyncExternalStore(playtestStore.subscribe, playtestStore.getLog);
}
