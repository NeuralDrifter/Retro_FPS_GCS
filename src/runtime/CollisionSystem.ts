/**
 * ============================================================================
 * FORGECORE COLLISION & TRIGGER SOLVER (PHASE 1 + EVENT HOOKS)
 * ============================================================================
 * Handles grid-to-world coordinate transforms and Circle-vs-AABB collision
 * resolution with independent X and Z axis sliding.
 *
 * Why Circle-vs-Grid-AABB?
 *  - In classic first-person grid engines (Wolfenstein 3D, Pie in the Sky),
 *    representing the player as a cylinder (2D circle on the XZ plane) against
 *    axis-aligned grid squares allows silky-smooth sliding along corridor walls
 *    without snagging on internal vertices.
 */

import { CellType, ENGINE_CONFIG, GridCoord } from './types';

export class CollisionSystem {
  /**
   * Converts a 2D grid coordinate (row, col) into the center 3D world (X, Z)
   * position.
   *
   * Coordinate Mapping:
   *  - Grid origin (0, 0) is top-left of the 2D editor.
   *  - World center (0, 0, 0) corresponds to the center of the map.
   */
  public static gridToWorld(
    row: number,
    col: number,
    gridSize: number
  ): { x: number; z: number } {
    const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;
    const x =
      col * ENGINE_CONFIG.CELL_SIZE - halfWorld + ENGINE_CONFIG.CELL_SIZE / 2;
    const z =
      row * ENGINE_CONFIG.CELL_SIZE - halfWorld + ENGINE_CONFIG.CELL_SIZE / 2;
    return { x, z };
  }

  /**
   * Converts a 3D world (X, Z) coordinate back into 2D grid indices (row, col).
   */
  public static worldToGrid(x: number, z: number, gridSize: number): GridCoord {
    const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;
    const col = Math.floor((x + halfWorld) / ENGINE_CONFIG.CELL_SIZE);
    const row = Math.floor((z + halfWorld) / ENGINE_CONFIG.CELL_SIZE);
    return {
      row: Math.max(0, Math.min(gridSize - 1, row)),
      col: Math.max(0, Math.min(gridSize - 1, col)),
    };
  }

  /**
   * Checks whether a given grid cell blocks player movement.
   *  - Solid Walls (CellType.WALL = 1) are always solid.
   *  - Locked Doors (CellType.DOOR = 2) are solid until opened.
   *  - Cells covered by a static solid model (`solidFootprint > 0`) are solid.
   */
  public static isCellSolid(
    grid: number[][],
    row: number,
    col: number,
    openDoors: Set<string>,
    solidFootprint?: number[][]
  ): boolean {
    if (row < 0 || row >= grid.length || col < 0 || col >= grid.length) {
      return true; // Out-of-bounds world perimeter acts as solid barrier
    }
    const cell = grid[row]?.[col] ?? CellType.WALL;
    if (cell === CellType.WALL) return true;
    if ((solidFootprint?.[row]?.[col] ?? 0) > 0) return true;
    if (cell === CellType.DOOR) {
      return !openDoors.has(`${row},${col}`);
    }
    return false;
  }

  /**
   * Tests if a player circle centered at (worldX, worldZ) with radius `r`
   * intersects any solid grid cell in the 3x3 neighborhood.
   */
  public static checkCircleCollision(
    worldX: number,
    worldZ: number,
    radius: number,
    grid: number[][],
    openDoors: Set<string>,
    solidFootprint?: number[][]
  ): boolean {
    const gridSize = grid.length;
    const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;
    const worldLimit = halfWorld - radius;

    // Keep player inside outer world boundary
    if (
      worldX < -worldLimit ||
      worldX > worldLimit ||
      worldZ < -worldLimit ||
      worldZ > worldLimit
    ) {
      return true;
    }

    const centerCell = this.worldToGrid(worldX, worldZ, gridSize);
    const halfCell = ENGINE_CONFIG.CELL_SIZE / 2;

    // Inspect 3x3 neighboring grid squares around the player
    for (let r = centerCell.row - 1; r <= centerCell.row + 1; r++) {
      for (let c = centerCell.col - 1; c <= centerCell.col + 1; c++) {
        if (!this.isCellSolid(grid, r, c, openDoors, solidFootprint)) continue;

        const cellCenter = this.gridToWorld(r, c, gridSize);
        const minX = cellCenter.x - halfCell;
        const maxX = cellCenter.x + halfCell;
        const minZ = cellCenter.z - halfCell;
        const maxZ = cellCenter.z + halfCell;

        // Closest point on the cell's AABB to the player's circle center
        const closestX = Math.max(minX, Math.min(worldX, maxX));
        const closestZ = Math.max(minZ, Math.min(worldZ, maxZ));

        const dx = worldX - closestX;
        const dz = worldZ - closestZ;

        if (dx * dx + dz * dz < radius * radius) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Pushes a circle `(worldX, worldZ)` out of any overlapping solid cells in its 3x3
   * neighborhood so an entity or player never gets permanently wedged inside a wall.
   */
  public static depenetrateCircle(
    worldX: number,
    worldZ: number,
    radius: number,
    grid: number[][],
    openDoors: Set<string>,
    solidFootprint?: number[][]
  ): { x: number; z: number } {
    const gridSize = grid.length;
    const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;
    const worldLimit = halfWorld - radius;
    let rx = Math.max(-worldLimit, Math.min(worldLimit, worldX));
    let rz = Math.max(-worldLimit, Math.min(worldLimit, worldZ));
    const halfCell = ENGINE_CONFIG.CELL_SIZE / 2;
    const rSq = radius * radius;

    for (let pass = 0; pass < 3; pass++) {
      let pushed = false;
      const centerCell = this.worldToGrid(rx, rz, gridSize);

      for (let r = centerCell.row - 1; r <= centerCell.row + 1; r++) {
        for (let c = centerCell.col - 1; c <= centerCell.col + 1; c++) {
          if (!this.isCellSolid(grid, r, c, openDoors, solidFootprint)) continue;

          const cellCenter = this.gridToWorld(r, c, gridSize);
          const minX = cellCenter.x - halfCell;
          const maxX = cellCenter.x + halfCell;
          const minZ = cellCenter.z - halfCell;
          const maxZ = cellCenter.z + halfCell;

          const closestX = Math.max(minX, Math.min(rx, maxX));
          const closestZ = Math.max(minZ, Math.min(rz, maxZ));

          const dx = rx - closestX;
          const dz = rz - closestZ;
          const distSq = dx * dx + dz * dz;

          if (distSq < rSq) {
            pushed = true;
            if (distSq > 0.000001) {
              const dist = Math.sqrt(distSq);
              const pen = radius - dist + 0.01;
              rx += (dx / dist) * pen;
              rz += (dz / dist) * pen;
            } else {
              const distLeft = rx - minX;
              const distRight = maxX - rx;
              const distTop = rz - minZ;
              const distBottom = maxZ - rz;
              const minEdge = Math.min(distLeft, distRight, distTop, distBottom);
              if (minEdge === distLeft) rx = minX - radius - 0.01;
              else if (minEdge === distRight) rx = maxX + radius + 0.01;
              else if (minEdge === distTop) rz = minZ - radius - 0.01;
              else rz = maxZ + radius + 0.01;
            }
          }
        }
      }
      if (!pushed) break;
    }

    return { x: rx, z: rz };
  }

  /**
   * Resolves player/entity movement from (currX, currZ) by delta (dx, dz),
   * separating X and Z axes so the mover slides smoothly along walls.
   */
  public static resolveMovement(
    currX: number,
    currZ: number,
    dx: number,
    dz: number,
    grid: number[][],
    openDoors: Set<string>,
    collisionEnabled = true,
    solidFootprint?: number[][],
    radius: number = ENGINE_CONFIG.PLAYER_RADIUS
  ): { x: number; z: number; hitWall: boolean } {
    if (!collisionEnabled) {
      return { x: currX + dx, z: currZ + dz, hitWall: false };
    }

    const r = radius;
    let baseX = currX;
    let baseZ = currZ;
    if (
      this.checkCircleCollision(baseX, baseZ, r, grid, openDoors, solidFootprint)
    ) {
      const unstuck = this.depenetrateCircle(
        baseX,
        baseZ,
        r,
        grid,
        openDoors,
        solidFootprint
      );
      baseX = unstuck.x;
      baseZ = unstuck.z;
    }

    let nextX = baseX;
    let nextZ = baseZ;
    let hitWall = false;

    // 1. Try advancing along World X
    if (
      !this.checkCircleCollision(baseX + dx, baseZ, r, grid, openDoors, solidFootprint)
    ) {
      nextX = baseX + dx;
    } else {
      hitWall = true;
    }

    // 2. Try advancing along World Z using resolved X
    if (
      !this.checkCircleCollision(nextX, baseZ + dz, r, grid, openDoors, solidFootprint)
    ) {
      nextZ = baseZ + dz;
    } else {
      hitWall = true;
    }

    return { x: nextX, z: nextZ, hitWall };
  }
}
