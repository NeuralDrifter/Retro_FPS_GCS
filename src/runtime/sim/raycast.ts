/**
 * ============================================================================
 * DETERMINISTIC INTEGER 2D DDA GRID RAYCASTER (WITH HEIGHT-CHECK HOOK)
 * ============================================================================
 * Casts a ray across the integer millicell grid (`CELL_UNITS = 1000`)
 * using only integer arithmetic and the committed BAM trig lookup table.
 *
 * Includes a per-cell height-check hook (`floorHeights`, `ceilingHeights`,
 * `eyeHeightUnits`) so variable floor/ceiling heights after Phase 1 work
 * without changing the raycaster signature.
 */

import { MoverSimState, SIM_CONFIG, SimCellType } from './types';
import { TRIG_SCALE, bamCos, bamSin } from './trigTable';

export interface GridRayHit {
  hit: boolean;
  hitKind: 'wall' | 'door' | 'height_step' | 'boundary' | 'none';
  row: number;
  col: number;
  distanceUnits: number; // Integer millicells traveled from origin
  hitXUnits: number;
  hitZUnits: number;
  side: 'x' | 'z' | 'none';
}

/**
 * Converts grid coordinates `(row, col)` to cell-center world millicells `(xUnits, zUnits)`.
 */
export function gridToWorldUnits(
  row: number,
  col: number,
  gridSize: number
): {
  xUnits: number;
  zUnits: number;
} {
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  return {
    xUnits:
      -halfWorld +
      Math.trunc(col) * SIM_CONFIG.CELL_UNITS +
      Math.trunc(SIM_CONFIG.CELL_UNITS / 2),
    zUnits:
      -halfWorld +
      Math.trunc(row) * SIM_CONFIG.CELL_UNITS +
      Math.trunc(SIM_CONFIG.CELL_UNITS / 2),
  };
}

/**
 * Converts world millicells `(xUnits, zUnits)` to clamped grid coordinates `(row, col)`.
 */
export function worldUnitsToGrid(
  xUnits: number,
  zUnits: number,
  gridSize: number
): { row: number; col: number } {
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  const rawCol = Math.floor(
    (Math.trunc(xUnits) + halfWorld) / SIM_CONFIG.CELL_UNITS
  );
  const rawRow = Math.floor(
    (Math.trunc(zUnits) + halfWorld) / SIM_CONFIG.CELL_UNITS
  );
  return {
    row: Math.max(0, Math.min(gridSize - 1, rawRow)),
    col: Math.max(0, Math.min(gridSize - 1, rawCol)),
  };
}

/**
 * Key of a door or keycard cell: `"row,col"` on the ground layer, `"L<layer>:row,col"`
 * on a stacked layer. Door movers are named `door:` plus this key.
 */
export function layerCellKey(row: number, col: number, layer = 0): string {
  return layer > 0 ? `L${layer}:${row},${col}` : `${row},${col}`;
}

/**
 * Returns true if the door at `(row, col)` of `layer` is passable (progress >= 8000 basis points).
 */
export function isDoorPassable(
  row: number,
  col: number,
  movers: Record<string, MoverSimState>,
  layer = 0
): boolean {
  const mover = movers[`door:${layerCellKey(row, col, layer)}`];
  if (!mover) return false;
  return mover.state === 'open' || mover.progress >= 8000;
}

/**
 * Pure integer 2D DDA raycast across the grid.
 *
 * Direction convention matches Three.js camera orientation:
 *  - `dirX = -bamSin(yawBam)` (scaled by `TRIG_SCALE = 16384`)
 *  - `dirZ = -bamCos(yawBam)` (scaled by `TRIG_SCALE = 16384`)
 */
export function castGridRayDDA(params: {
  originXUnits: number;
  originZUnits: number;
  yawBam: number;
  maxDistanceUnits: number;
  grid: number[][];
  movers?: Record<string, MoverSimState>;
  /** Cells covered by static solid models stop the ray like walls */
  solidFootprint?: number[][];
  eyeHeightUnits?: number;
  floorHeights?: number[][];
  ceilingHeights?: number[][];
}): GridRayHit {
  const gridSize = params.grid.length || SIM_CONFIG.GRID_SIZE;
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  const maxDist = Math.max(0, Math.trunc(params.maxDistanceUnits));
  const movers = params.movers || {};
  const eyeHeight =
    params.eyeHeightUnits ?? SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS;

  // Convert origin from centered world millicells [-halfWorld..halfWorld] to positive grid-space [0..gridSize*1000]
  const posX = Math.trunc(params.originXUnits) + halfWorld;
  const posZ = Math.trunc(params.originZUnits) + halfWorld;

  const dirX = -bamSin(params.yawBam); // in [-16384, 16384]
  const dirZ = -bamCos(params.yawBam); // in [-16384, 16384]

  let mapCol = Math.max(
    0,
    Math.min(gridSize - 1, Math.trunc(posX / SIM_CONFIG.CELL_UNITS))
  );
  let mapRow = Math.max(
    0,
    Math.min(gridSize - 1, Math.trunc(posZ / SIM_CONFIG.CELL_UNITS))
  );

  if (dirX === 0 && dirZ === 0) {
    return {
      hit: false,
      hitKind: 'none',
      row: mapRow,
      col: mapCol,
      distanceUnits: 0,
      hitXUnits: Math.trunc(params.originXUnits),
      hitZUnits: Math.trunc(params.originZUnits),
      side: 'none',
    };
  }

  // Fixed-point distance along ray:
  // Distance (in millicells) to cross 1000 millicells along X is:
  // deltaDistX = floor(1000 * TRIG_SCALE *SCALE_FACTOR / |dirX|)
  // Using scale 1024 on top of millicells prevents truncation error across 10 cells.
  const DIST_FP = 1024;
  const INF_DIST_FP = 1_000_000_000;

  const absDirX = Math.abs(dirX);
  const absDirZ = Math.abs(dirZ);

  const deltaDistXFp =
    absDirX === 0
      ? INF_DIST_FP
      : Math.trunc(
          (SIM_CONFIG.CELL_UNITS * TRIG_SCALE * DIST_FP) / absDirX
        );
  const deltaDistZFp =
    absDirZ === 0
      ? INF_DIST_FP
      : Math.trunc(
          (SIM_CONFIG.CELL_UNITS * TRIG_SCALE * DIST_FP) / absDirZ
        );

  const cellLocalX = posX - mapCol * SIM_CONFIG.CELL_UNITS;
  const cellLocalZ = posZ - mapRow * SIM_CONFIG.CELL_UNITS;

  let stepCol = 0;
  let sideDistXFp = INF_DIST_FP;
  if (dirX < 0) {
    stepCol = -1;
    sideDistXFp = Math.trunc((cellLocalX * TRIG_SCALE * DIST_FP) / absDirX);
  } else if (dirX > 0) {
    stepCol = 1;
    sideDistXFp = Math.trunc(
      ((SIM_CONFIG.CELL_UNITS - cellLocalX) * TRIG_SCALE * DIST_FP) / absDirX
    );
  }

  let stepRow = 0;
  let sideDistZFp = INF_DIST_FP;
  if (dirZ < 0) {
    stepRow = -1;
    sideDistZFp = Math.trunc((cellLocalZ * TRIG_SCALE * DIST_FP) / absDirZ);
  } else if (dirZ > 0) {
    stepRow = 1;
    sideDistZFp = Math.trunc(
      ((SIM_CONFIG.CELL_UNITS - cellLocalZ) * TRIG_SCALE * DIST_FP) / absDirZ
    );
  }

  const maxDistFp = maxDist * DIST_FP;
  let side: 'x' | 'z' = 'x';
  let traveledFp = 0;

  for (let iter = 0; iter < gridSize * 4; iter++) {
    if (sideDistXFp < sideDistZFp) {
      traveledFp = sideDistXFp;
      sideDistXFp += deltaDistXFp;
      mapCol += stepCol;
      side = 'x';
    } else {
      traveledFp = sideDistZFp;
      sideDistZFp += deltaDistZFp;
      mapRow += stepRow;
      side = 'z';
    }

    const distanceUnits = Math.trunc(traveledFp / DIST_FP);
    if (distanceUnits > maxDist) {
      break;
    }

    const hitXUnits =
      Math.trunc(params.originXUnits) +
      Math.trunc((distanceUnits * dirX) / TRIG_SCALE);
    const hitZUnits =
      Math.trunc(params.originZUnits) +
      Math.trunc((distanceUnits * dirZ) / TRIG_SCALE);

    // Out of bounds check
    if (mapRow < 0 || mapRow >= gridSize || mapCol < 0 || mapCol >= gridSize) {
      return {
        hit: true,
        hitKind: 'boundary',
        row: Math.max(0, Math.min(gridSize - 1, mapRow)),
        col: Math.max(0, Math.min(gridSize - 1, mapCol)),
        distanceUnits,
        hitXUnits,
        hitZUnits,
        side,
      };
    }

    const cellType = params.grid[mapRow]?.[mapCol] ?? SimCellType.EMPTY;

    if (
      cellType === SimCellType.WALL ||
      (params.solidFootprint?.[mapRow]?.[mapCol] ?? 0) > 0
    ) {
      return {
        hit: true,
        hitKind: 'wall',
        row: mapRow,
        col: mapCol,
        distanceUnits,
        hitXUnits,
        hitZUnits,
        side,
      };
    }

    if (
      cellType === SimCellType.DOOR &&
      !isDoorPassable(mapRow, mapCol, movers)
    ) {
      return {
        hit: true,
        hitKind: 'door',
        row: mapRow,
        col: mapCol,
        distanceUnits,
        hitXUnits,
        hitZUnits,
        side,
      };
    }

    // Per-cell height check hook (for variable floor/ceiling heights after Phase 1)
    const floorH =
      params.floorHeights?.[mapRow]?.[mapCol] ??
      SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS;
    const ceilH =
      params.ceilingHeights?.[mapRow]?.[mapCol] ??
      SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
    if (eyeHeight < floorH || eyeHeight > ceilH || ceilH <= floorH) {
      return {
        hit: true,
        hitKind: 'height_step',
        row: mapRow,
        col: mapCol,
        distanceUnits,
        hitXUnits,
        hitZUnits,
        side,
      };
    }
  }

  const endXUnits =
    Math.trunc(params.originXUnits) + Math.trunc((maxDist * dirX) / TRIG_SCALE);
  const endZUnits =
    Math.trunc(params.originZUnits) + Math.trunc((maxDist * dirZ) / TRIG_SCALE);
  const endCell = worldUnitsToGrid(endXUnits, endZUnits, gridSize);

  return {
    hit: false,
    hitKind: 'none',
    row: endCell.row,
    col: endCell.col,
    distanceUnits: maxDist,
    hitXUnits: endXUnits,
    hitZUnits: endZUnits,
    side: 'none',
  };
}
