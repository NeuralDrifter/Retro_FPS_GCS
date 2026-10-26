/**
 * ============================================================================
 * PIE3D MODEL FOOTPRINT MEASUREMENT (EDITOR SIDE)
 * ============================================================================
 * Converts a model's measured size in meters into a footprint in grid cells.
 */

import { ENGINE_CONFIG } from '../../types/engine';
import { SIM_CONFIG } from '../sim/types';

function sizeToCells(sizeMeters: number, cellSizeMeters: number): number {
  if (!Number.isFinite(sizeMeters) || sizeMeters <= 0) return 1;
  return Math.max(
    1,
    Math.min(SIM_CONFIG.MAX_FOOTPRINT_CELLS, Math.ceil(sizeMeters / cellSizeMeters))
  );
}

/** Rounds partial cells up and clamps to 1..MAX_FOOTPRINT_CELLS, treating bad sizes as 1 */
export function measuredFootprintFromSize(
  widthMeters: number,
  depthMeters: number,
  cellSizeMeters: number = ENGINE_CONFIG.CELL_SIZE
): { w: number; d: number } {
  return {
    w: sizeToCells(widthMeters, cellSizeMeters),
    d: sizeToCells(depthMeters, cellSizeMeters),
  };
}
