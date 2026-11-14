/**
 * ============================================================================
 * PURE INTEGER CIRCLE COLLISION & DEPENETRATION UNITS
 * ============================================================================
 * Integer-only collision detection and resolution against grid walls, doors,
 * solid model footprints, and moving pushwalls.
 */

import { MoverSimState, SIM_CONFIG, SimCellType } from './types';
import { isqrt } from './trigTable';
import { isDoorPassable, worldUnitsToGrid } from './raycast';

export function checkCircleCollisionUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, MoverSimState>,
  solidFootprint?: number[][]
): boolean {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);

  // World boundary check
  if (
    xUnits - radiusUnits < -halfWorld ||
    xUnits + radiusUnits > halfWorld ||
    zUnits - radiusUnits < -halfWorld ||
    zUnits + radiusUnits > halfWorld
  ) {
    return true;
  }

  const center = worldUnitsToGrid(xUnits, zUnits, gridSize);
  const rSq = radiusUnits * radiusUnits;

  for (let r = center.row - 1; r <= center.row + 1; r++) {
    for (let c = center.col - 1; c <= center.col + 1; c++) {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
      const cell = grid[r][c];
      const activePushwallAtCell = movers[`pushwall:${r},${c}`];
      const isBlockingWall =
        cell === SimCellType.WALL &&
        !(activePushwallAtCell && activePushwallAtCell.state === 'active');
      const isBlockingDoor =
        cell === SimCellType.DOOR && !isDoorPassable(r, c, movers);
      const isBlockingModel = (solidFootprint?.[r]?.[c] ?? 0) > 0;

      if (!isBlockingWall && !isBlockingDoor && !isBlockingModel) continue;

      const minX = -halfWorld + c * SIM_CONFIG.CELL_UNITS;
      const maxX = minX + SIM_CONFIG.CELL_UNITS;
      const minZ = -halfWorld + r * SIM_CONFIG.CELL_UNITS;
      const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

      const closestX = Math.max(minX, Math.min(xUnits, maxX));
      const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));

      const dx = xUnits - closestX;
      const dz = zUnits - closestZ;
      if (dx * dx + dz * dz < rSq) {
        return true;
      }
    }
  }

  // Check active sliding pushwalls along their integer trajectory
  for (const mKey of Object.keys(movers)) {
    const mover = movers[mKey];
    if (!mover || mover.kind !== 'pushwall' || mover.state !== 'active') {
      continue;
    }
    const dRow =
      mover.direction === 'N' ? -1 : mover.direction === 'S' ? 1 : 0;
    const dCol =
      mover.direction === 'E' ? 1 : mover.direction === 'W' ? -1 : 0;
    const distCells = mover.distanceCells ?? 2;
    const offsetUnits = Math.trunc(
      (distCells * SIM_CONFIG.CELL_UNITS * mover.progress) /
        SIM_CONFIG.MOVER_MAX_PROGRESS
    );

    const minX =
      -halfWorld + mover.col * SIM_CONFIG.CELL_UNITS + dCol * offsetUnits;
    const maxX = minX + SIM_CONFIG.CELL_UNITS;
    const minZ =
      -halfWorld + mover.row * SIM_CONFIG.CELL_UNITS + dRow * offsetUnits;
    const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

    const closestX = Math.max(minX, Math.min(xUnits, maxX));
    const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));
    const dx = xUnits - closestX;
    const dz = zUnits - closestZ;
    if (dx * dx + dz * dz < rSq) {
      return true;
    }
  }

  return false;
}

/**
 * Pushes a circle out of any blocking wall, door or model footprint cell it overlaps.
 * Runs up to 3 integer passes so a push out of one cell into a neighbour is resolved too.
 */
export function depenetrateCircleUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, MoverSimState> = {},
  solidFootprint?: number[][]
): { xUnits: number; zUnits: number } {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);

  // Clamp inside the world boundary first
  let x = Math.max(
    -halfWorld + radiusUnits,
    Math.min(halfWorld - radiusUnits, Math.trunc(xUnits))
  );
  let z = Math.max(
    -halfWorld + radiusUnits,
    Math.min(halfWorld - radiusUnits, Math.trunc(zUnits))
  );
  const rSq = radiusUnits * radiusUnits;

  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;
    const center = worldUnitsToGrid(x, z, gridSize);

    for (let r = center.row - 1; r <= center.row + 1; r++) {
      for (let c = center.col - 1; c <= center.col + 1; c++) {
        if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
        const cell = grid[r][c];
        const activePushwallAtCell = movers[`pushwall:${r},${c}`];
        const isBlockingWall =
          cell === SimCellType.WALL &&
          !(activePushwallAtCell && activePushwallAtCell.state === 'active');
        const isBlockingDoor =
          cell === SimCellType.DOOR && !isDoorPassable(r, c, movers);
        const isBlockingModel = (solidFootprint?.[r]?.[c] ?? 0) > 0;

        if (!isBlockingWall && !isBlockingDoor && !isBlockingModel) continue;

        const minX = -halfWorld + c * SIM_CONFIG.CELL_UNITS;
        const maxX = minX + SIM_CONFIG.CELL_UNITS;
        const minZ = -halfWorld + r * SIM_CONFIG.CELL_UNITS;
        const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

        const closestX = Math.max(minX, Math.min(x, maxX));
        const closestZ = Math.max(minZ, Math.min(z, maxZ));
        const dx = x - closestX;
        const dz = z - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= rSq) continue;

        pushed = true;
        if (distSq > 0) {
          // Push straight away from the closest point, plus a 2-unit margin
          const dist = Math.max(1, isqrt(distSq));
          const overlap = radiusUnits - dist + 2;
          x += Math.trunc((dx * overlap) / dist);
          z += Math.trunc((dz * overlap) / dist);
        } else {
          // Center is inside the cell: exit through the nearest edge
          const toLeft = x - minX;
          const toRight = maxX - x;
          const toTop = z - minZ;
          const toBottom = maxZ - z;
          const nearest = Math.min(toLeft, toRight, toTop, toBottom);
          if (nearest === toLeft) x = minX - radiusUnits - 2;
          else if (nearest === toRight) x = maxX + radiusUnits + 2;
          else if (nearest === toTop) z = minZ - radiusUnits - 2;
          else z = maxZ + radiusUnits + 2;
        }
      }
    }

    if (!pushed) break;
  }

  return { xUnits: Math.trunc(x), zUnits: Math.trunc(z) };
}
