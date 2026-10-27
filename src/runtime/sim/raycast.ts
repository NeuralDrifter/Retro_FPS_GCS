/**
 * FORGECORE DDA GRID RAYCASTING (/src/runtime/sim/raycast.ts)
 */

import { SIM_CONFIG } from './types';
import { bamSin, bamCos } from './trigTable';
import { worldUnitsToGrid, isDoorPassable } from './physics';

export interface GridRaycastRequest {
  originXUnits: number;
  originZUnits: number;
  yawBam: number;
  maxDistanceUnits: number;
  grid: number[][];
  movers?: Record<string, any>;
  solidFootprint?: number[][];
  eyeHeightUnits?: number;
  floorHeights?: number[][];
  ceilingHeights?: number[][];
}

export interface GridRaycastResult {
  hit: boolean;
  hitKind: 'none' | 'boundary' | 'wall' | 'door' | 'height_step';
  row: number;
  col: number;
  distanceUnits: number;
  hitXUnits: number;
  hitZUnits: number;
  side: 'none' | 'x' | 'z';
}

export function castGridRayDDA(req: GridRaycastRequest): GridRaycastResult {
  const gridSize = req.grid.length || SIM_CONFIG.GRID_SIZE;
  const halfExtent = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  const maxDist = Math.max(0, Math.trunc(req.maxDistanceUnits));
  const movers = req.movers || {};
  const eyeHeight = req.eyeHeightUnits ?? SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS;

  const posX = Math.trunc(req.originXUnits) + halfExtent;
  const posZ = Math.trunc(req.originZUnits) + halfExtent;

  const dirX = -bamSin(req.yawBam);
  const dirZ = -bamCos(req.yawBam);

  let mapCol = Math.max(0, Math.min(gridSize - 1, Math.trunc(posX / SIM_CONFIG.CELL_UNITS)));
  let mapRow = Math.max(0, Math.min(gridSize - 1, Math.trunc(posZ / SIM_CONFIG.CELL_UNITS)));

  if (dirX === 0 && dirZ === 0) {
    return {
      hit: false,
      hitKind: 'none',
      row: mapRow,
      col: mapCol,
      distanceUnits: 0,
      hitXUnits: Math.trunc(req.originXUnits),
      hitZUnits: Math.trunc(req.originZUnits),
      side: 'none',
    };
  }

  const DDA_SCALE = 1024;
  const INF = 1000000000;
  const absDirX = Math.abs(dirX);
  const absDirZ = Math.abs(dirZ);

  const deltaDistX = absDirX === 0 ? INF : Math.trunc((SIM_CONFIG.CELL_UNITS * 16384 * DDA_SCALE) / absDirX);
  const deltaDistZ = absDirZ === 0 ? INF : Math.trunc((SIM_CONFIG.CELL_UNITS * 16384 * DDA_SCALE) / absDirZ);

  const cellOffsetX = posX - mapCol * SIM_CONFIG.CELL_UNITS;
  const cellOffsetZ = posZ - mapRow * SIM_CONFIG.CELL_UNITS;

  let stepX = 0;
  let sideDistX = INF;
  if (dirX < 0) {
    stepX = -1;
    sideDistX = Math.trunc((cellOffsetX * 16384 * DDA_SCALE) / absDirX);
  } else if (dirX > 0) {
    stepX = 1;
    sideDistX = Math.trunc(((SIM_CONFIG.CELL_UNITS - cellOffsetX) * 16384 * DDA_SCALE) / absDirX);
  }

  let stepZ = 0;
  let sideDistZ = INF;
  if (dirZ < 0) {
    stepZ = -1;
    sideDistZ = Math.trunc((cellOffsetZ * 16384 * DDA_SCALE) / absDirZ);
  } else if (dirZ > 0) {
    stepZ = 1;
    sideDistZ = Math.trunc(((SIM_CONFIG.CELL_UNITS - cellOffsetZ) * 16384 * DDA_SCALE) / absDirZ);
  }

  let side: 'none' | 'x' | 'z' = 'x';
  let curDistScaled = 0;

  for (let stepCount = 0; stepCount < gridSize * 4; stepCount++) {
    if (sideDistX < sideDistZ) {
      curDistScaled = sideDistX;
      sideDistX += deltaDistX;
      mapCol += stepX;
      side = 'x';
    } else {
      curDistScaled = sideDistZ;
      sideDistZ += deltaDistZ;
      mapRow += stepZ;
      side = 'z';
    }

    const distUnits = Math.trunc(curDistScaled / DDA_SCALE);
    if (distUnits > maxDist) break;

    const hitX = Math.trunc(req.originXUnits) + Math.trunc((distUnits * dirX) / 16384);
    const hitZ = Math.trunc(req.originZUnits) + Math.trunc((distUnits * dirZ) / 16384);

    if (mapRow < 0 || mapRow >= gridSize || mapCol < 0 || mapCol >= gridSize) {
      return {
        hit: true,
        hitKind: 'boundary',
        row: Math.max(0, Math.min(gridSize - 1, mapRow)),
        col: Math.max(0, Math.min(gridSize - 1, mapCol)),
        distanceUnits: distUnits,
        hitXUnits: hitX,
        hitZUnits: hitZ,
        side,
      };
    }

    const cellVal = req.grid[mapRow]?.[mapCol] ?? 0;
    if (cellVal === 1 || (req.solidFootprint?.[mapRow]?.[mapCol] ?? 0) > 0) {
      return {
        hit: true,
        hitKind: 'wall',
        row: mapRow,
        col: mapCol,
        distanceUnits: distUnits,
        hitXUnits: hitX,
        hitZUnits: hitZ,
        side,
      };
    }

    if (cellVal === 2 && !isDoorPassable(mapRow, mapCol, movers)) {
      return {
        hit: true,
        hitKind: 'door',
        row: mapRow,
        col: mapCol,
        distanceUnits: distUnits,
        hitXUnits: hitX,
        hitZUnits: hitZ,
        side,
      };
    }

    const fH = req.floorHeights?.[mapRow]?.[mapCol] ?? SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS;
    const cH = req.ceilingHeights?.[mapRow]?.[mapCol] ?? SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
    if (eyeHeight < fH || eyeHeight > cH || cH <= fH) {
      return {
        hit: true,
        hitKind: 'height_step',
        row: mapRow,
        col: mapCol,
        distanceUnits: distUnits,
        hitXUnits: hitX,
        hitZUnits: hitZ,
        side,
      };
    }
  }

  const endX = Math.trunc(req.originXUnits) + Math.trunc((maxDist * dirX) / 16384);
  const endZ = Math.trunc(req.originZUnits) + Math.trunc((maxDist * dirZ) / 16384);
  const endCell = worldUnitsToGrid(endX, endZ, gridSize);
  return {
    hit: false,
    hitKind: 'none',
    row: endCell.row,
    col: endCell.col,
    distanceUnits: maxDist,
    hitXUnits: endX,
    hitZUnits: endZ,
    side: 'none',
  };
}
