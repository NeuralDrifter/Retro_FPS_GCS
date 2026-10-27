/**
 * FORGECORE INTEGER PHYSICS & COLLISION SYSTEM (/src/runtime/sim/physics.ts)
 */

import { SIM_CONFIG } from './types';
import { intSqrt } from './trigTable';

export function gridToWorldUnits(
  row: number,
  col: number,
  gridSize: number
): { xUnits: number; zUnits: number } {
  const halfExtent = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  return {
    xUnits: -halfExtent + Math.trunc(col) * SIM_CONFIG.CELL_UNITS + Math.trunc(SIM_CONFIG.CELL_UNITS / 2),
    zUnits: -halfExtent + Math.trunc(row) * SIM_CONFIG.CELL_UNITS + Math.trunc(SIM_CONFIG.CELL_UNITS / 2),
  };
}

export function worldUnitsToGrid(
  xUnits: number,
  zUnits: number,
  gridSize: number
): { row: number; col: number } {
  const halfExtent = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  const col = Math.floor((Math.trunc(xUnits) + halfExtent) / SIM_CONFIG.CELL_UNITS);
  const row = Math.floor((Math.trunc(zUnits) + halfExtent) / SIM_CONFIG.CELL_UNITS);
  return {
    row: Math.max(0, Math.min(gridSize - 1, row)),
    col: Math.max(0, Math.min(gridSize - 1, col)),
  };
}

export function isDoorPassable(
  row: number,
  col: number,
  movers: Record<string, any>
): boolean {
  const m = movers[`door:${row},${col}`];
  return m ? m.state === 'open' || m.progress >= 8000 : false;
}

export function checkCircleCollisionUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, any> = {},
  solidFootprint?: number[][]
): boolean {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfExtent = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  if (
    xUnits - radiusUnits < -halfExtent ||
    xUnits + radiusUnits > halfExtent ||
    zUnits - radiusUnits < -halfExtent ||
    zUnits + radiusUnits > halfExtent
  ) {
    return true;
  }

  const cell = worldUnitsToGrid(xUnits, zUnits, gridSize);
  const rSq = radiusUnits * radiusUnits;

  for (let r = cell.row - 1; r <= cell.row + 1; r++) {
    for (let c = cell.col - 1; c <= cell.col + 1; c++) {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
      const cellType = grid[r][c];
      const pushwall = movers[`pushwall:${r},${c}`];
      const isWallSolid = cellType === 1 && !(pushwall && pushwall.state === 'active');
      const isDoorSolid = cellType === 2 && !isDoorPassable(r, c, movers);
      const isFootprintSolid = (solidFootprint?.[r]?.[c] ?? 0) > 0;
      if (!isWallSolid && !isDoorSolid && !isFootprintSolid) continue;

      const minX = -halfExtent + c * SIM_CONFIG.CELL_UNITS;
      const maxX = minX + SIM_CONFIG.CELL_UNITS;
      const minZ = -halfExtent + r * SIM_CONFIG.CELL_UNITS;
      const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

      const closestX = Math.max(minX, Math.min(xUnits, maxX));
      const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));
      const dx = xUnits - closestX;
      const dz = zUnits - closestZ;
      if (dx * dx + dz * dz < rSq) return true;
    }
  }

  for (const k of Object.keys(movers)) {
    const mover = movers[k];
    if (!mover || mover.kind !== 'pushwall' || mover.state !== 'active') continue;
    const rowDelta = mover.direction === 'N' ? -1 : mover.direction === 'S' ? 1 : 0;
    const colDelta = mover.direction === 'E' ? 1 : mover.direction === 'W' ? -1 : 0;
    const distCells = mover.distanceCells ?? 2;
    const offsetUnits = Math.trunc(
      (distCells * SIM_CONFIG.CELL_UNITS * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
    );
    const minX = -halfExtent + mover.col * SIM_CONFIG.CELL_UNITS + colDelta * offsetUnits;
    const maxX = minX + SIM_CONFIG.CELL_UNITS;
    const minZ = -halfExtent + mover.row * SIM_CONFIG.CELL_UNITS + rowDelta * offsetUnits;
    const maxZ = minZ + SIM_CONFIG.CELL_UNITS;
    const closestX = Math.max(minX, Math.min(xUnits, maxX));
    const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));
    const dx = xUnits - closestX;
    const dz = zUnits - closestZ;
    if (dx * dx + dz * dz < rSq) return true;
  }

  return false;
}

export function depenetrateCircleUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, any> = {},
  solidFootprint?: number[][]
): { xUnits: number; zUnits: number } {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfExtent = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);
  let curX = Math.max(-halfExtent + radiusUnits, Math.min(halfExtent - radiusUnits, Math.trunc(xUnits)));
  let curZ = Math.max(-halfExtent + radiusUnits, Math.min(halfExtent - radiusUnits, Math.trunc(zUnits)));
  const rSq = radiusUnits * radiusUnits;

  for (let iter = 0; iter < 3; iter++) {
    let pushed = false;
    const cell = worldUnitsToGrid(curX, curZ, gridSize);
    for (let r = cell.row - 1; r <= cell.row + 1; r++) {
      for (let c = cell.col - 1; c <= cell.col + 1; c++) {
        if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
        const cellType = grid[r][c];
        const pushwall = movers[`pushwall:${r},${c}`];
        const isWallSolid = cellType === 1 && !(pushwall && pushwall.state === 'active');
        const isDoorSolid = cellType === 2 && !isDoorPassable(r, c, movers);
        const isFootprintSolid = (solidFootprint?.[r]?.[c] ?? 0) > 0;
        if (!isWallSolid && !isDoorSolid && !isFootprintSolid) continue;

        const minX = -halfExtent + c * SIM_CONFIG.CELL_UNITS;
        const maxX = minX + SIM_CONFIG.CELL_UNITS;
        const minZ = -halfExtent + r * SIM_CONFIG.CELL_UNITS;
        const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

        const closestX = Math.max(minX, Math.min(curX, maxX));
        const closestZ = Math.max(minZ, Math.min(curZ, maxZ));
        const dx = curX - closestX;
        const dz = curZ - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < rSq) {
          pushed = true;
          if (distSq > 0) {
            const dist = Math.max(1, intSqrt(distSq));
            const overlap = radiusUnits - dist + 2;
            curX += Math.trunc((dx * overlap) / dist);
            curZ += Math.trunc((dz * overlap) / dist);
          } else {
            const dLeft = curX - minX;
            const dRight = maxX - curX;
            const dTop = curZ - minZ;
            const dBottom = maxZ - curZ;
            const minD = Math.min(dLeft, dRight, dTop, dBottom);
            if (minD === dLeft) curX = minX - radiusUnits - 2;
            else if (minD === dRight) curX = maxX + radiusUnits + 2;
            else if (minD === dTop) curZ = minZ - radiusUnits - 2;
            else curZ = maxZ + radiusUnits + 2;
          }
        }
      }
    }
    if (!pushed) break;
  }

  return { xUnits: Math.trunc(curX), zUnits: Math.trunc(curZ) };
}
