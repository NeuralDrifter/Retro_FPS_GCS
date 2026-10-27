/**
 * ============================================================================
 * GRIDFORGE 3D GLOBAL HISTORY MANAGEMENT SYSTEM (UNDO / REDO ENGINE)
 * ============================================================================
 * Tracks immutable deep-cloned snapshots of the level design state:
 *  - `grid[row][col]`            : Cell block types (Empty, Wall, Door, Key)
 *  - `wallTextures[row][col]`    : Per-cell Wall Texture Asset IDs
 *  - `floorTextures[row][col]`   : Per-cell Floor Texture Asset IDs
 *  - `ceilingTextures[row][col]` : Per-cell Ceiling Texture Asset IDs
 *  - `entities[]`              : Placed 3D `.glb` Entities & Enemy AI stats
 *  - `spawn`                   : Player Spawn coordinates & yaw angle
 *
 * Supports:
 *  - Discrete design actions (Inspector edits, Fill Surface, Place Entity, etc.)
 *  - Continuous 2D Grid drag-stroke coalescing (a multi-cell pointer drag is
 *    recorded as a single atomic Undo step)
 *  - Keyboard shortcuts: `Ctrl+Z` / `Cmd+Z` (Undo) and `Ctrl+Y` / `Ctrl+Shift+Z` (Redo)
 */

import { PlacedEntity } from '../types/engine';

export interface DesignStateSnapshot {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  entities: PlacedEntity[];
  spawn: { row: number; col: number; yaw: number };
  actionLabel: string;
}

export const MAX_HISTORY_DEPTH = 60;

export class HistoryManager {
  /**
   * Deep-clones a `DesignStateSnapshot` so subsequent state edits never mutate
   * historical entries in the `past` or `future` stacks.
   */
  public static cloneSnapshot(
    snapshot: DesignStateSnapshot
  ): DesignStateSnapshot {
    return {
      grid: snapshot.grid.map((row) => [...row]),
      wallTextures: snapshot.wallTextures.map((row) => [...row]),
      floorTextures: snapshot.floorTextures.map((row) => [...row]),
      ceilingTextures: snapshot.ceilingTextures.map((row) => [...row]),
      entities: snapshot.entities.map((ent) => ({ ...ent })),
      spawn: { ...snapshot.spawn },
      actionLabel: snapshot.actionLabel,
    };
  }

  /**
   * Checks whether two snapshots have identical map data (ignoring actionLabel),
   * preventing duplicate no-op states from being pushed onto the Undo stack.
   */
  public static areSnapshotsEqual(
    a: DesignStateSnapshot,
    b: DesignStateSnapshot
  ): boolean {
    if (
      a.spawn.row !== b.spawn.row ||
      a.spawn.col !== b.spawn.col ||
      a.spawn.yaw !== b.spawn.yaw
    ) {
      return false;
    }

    if (a.entities.length !== b.entities.length) {
      return false;
    }

    for (let i = 0; i < a.entities.length; i++) {
      const ea = a.entities[i];
      const eb = b.entities[i];
      if (
        ea.id !== eb.id ||
        ea.row !== eb.row ||
        ea.col !== eb.col ||
        ea.blueprintId !== eb.blueprintId ||
        ea.name !== eb.name ||
        ea.yaw !== eb.yaw ||
        ea.scale !== eb.scale ||
        ea.customGlbUrl !== eb.customGlbUrl ||
        ea.isEnemy !== eb.isEnemy ||
        ea.maxHealth !== eb.maxHealth ||
        ea.moveSpeed !== eb.moveSpeed ||
        ea.attackDamage !== eb.attackDamage
      ) {
        return false;
      }
    }

    // Maps of different sizes differ even when one is a prefix of the other
    if (a.grid.length !== b.grid.length) {
      return false;
    }

    for (let r = 0; r < a.grid.length; r++) {
      const gRowA = a.grid[r];
      const gRowB = b.grid[r];
      const wRowA = a.wallTextures[r];
      const wRowB = b.wallTextures[r];
      const fRowA = a.floorTextures[r];
      const fRowB = b.floorTextures[r];
      const cRowA = a.ceilingTextures[r];
      const cRowB = b.ceilingTextures[r];

      for (let c = 0; c < gRowA.length; c++) {
        if (
          gRowA[c] !== gRowB[c] ||
          wRowA[c] !== wRowB[c] ||
          fRowA[c] !== fRowB[c] ||
          cRowA[c] !== cRowB[c]
        ) {
          return false;
        }
      }
    }

    return true;
  }
}
