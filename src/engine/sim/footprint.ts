/**
 * ============================================================================
 * PURE INTEGER MODEL FOOTPRINTS & SOLID OCCUPANCY GRID
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 *
 * A placed model covers a rectangle of whole cells anchored at its (row, col)
 * and extending toward +row / +col. Its footprint follows the nearest quarter
 * turn of its yaw: 90 and 270 degrees swap width and depth.
 */

import { BAM_FULL_TURN, BAM_QUARTER_TURN } from './trigTable';

export interface FootprintSource {
  row: number;
  col: number;
  footprintW?: number;
  footprintD?: number;
  yawBam?: number;
  category?: string;
  collision?: 'solid' | 'nonSolid';
  blueprintId: string;
}

export function quarterTurnsFromBam(yawBam: number): 0 | 1 | 2 | 3 {
  const wrapped =
    ((Math.trunc(yawBam) % BAM_FULL_TURN) + BAM_FULL_TURN) % BAM_FULL_TURN;
  return (Math.round(wrapped / BAM_QUARTER_TURN) % 4) as 0 | 1 | 2 | 3;
}

export function rotatedFootprint(
  w: number,
  d: number,
  quarterTurns: number
): { w: number; d: number } {
  return quarterTurns % 2 === 1 ? { w: d, d: w } : { w, d };
}

/** Inclusive cell rectangle covered by `src` (not clamped to the grid) */
export function getFootprintRect(src: FootprintSource): {
  row0: number;
  col0: number;
  row1: number;
  col1: number;
} {
  const { w, d } = rotatedFootprint(
    Math.max(1, Math.trunc(src.footprintW ?? 1)),
    Math.max(1, Math.trunc(src.footprintD ?? 1)),
    quarterTurnsFromBam(src.yawBam ?? 0)
  );
  const row0 = Math.trunc(src.row);
  const col0 = Math.trunc(src.col);
  return { row0, col0, row1: row0 + d - 1, col1: col0 + w - 1 };
}

/**
 * Mirrors `isStaticModel` in `engine/modelLibrary/categories.ts` (the sim may
 * not import editor modules): categorized, not a character, not the supply crate.
 */
export function isStaticFootprintSource(src: FootprintSource): boolean {
  return (
    src.category !== undefined &&
    src.category !== 'characters' &&
    src.blueprintId !== 'supply-crate'
  );
}

/**
 * Per-cell count of static solid models covering each cell, or `undefined`
 * when the level has none (so simulation state and hashes stay unchanged).
 */
export function buildSolidFootprintGrid(
  sources: FootprintSource[],
  gridSize: number
): number[][] | undefined {
  const solids = sources.filter(
    (s) => isStaticFootprintSource(s) && s.collision === 'solid'
  );
  if (solids.length === 0) return undefined;

  const grid = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => 0)
  );
  for (const src of solids) {
    const rect = getFootprintRect(src);
    for (let r = Math.max(0, rect.row0); r <= Math.min(gridSize - 1, rect.row1); r++) {
      for (let c = Math.max(0, rect.col0); c <= Math.min(gridSize - 1, rect.col1); c++) {
        grid[r][c] += 1;
      }
    }
  }
  return grid;
}
