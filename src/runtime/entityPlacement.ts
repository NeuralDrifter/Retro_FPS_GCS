/**
 * ============================================================================
 * FREE 3D PLACEMENT OF MODELS (LAYER, OFFSET, ELEVATION, TILT)
 * ============================================================================
 * Shared by the game's world builder and the 3D editor so a placed model sits
 * in exactly the same spot in both.
 */

import * as THREE from 'three';
import { ENGINE_CONFIG, PlacedEntity, VerticalLevelData } from './types';
import { SIM_CONFIG } from './sim';
import { getFootprintRect } from './sim/footprint';
import { radiansToBam } from './sim/trigTable';
import { CollisionSystem } from './CollisionSystem';

const LAYER_METERS = (SIM_CONFIG.LAYER_HEIGHT_UNITS * ENGINE_CONFIG.CELL_SIZE) / SIM_CONFIG.CELL_UNITS;
const METERS_PER_UNIT = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS;

/** Grid anchor (meters) a placed model stands on: the center of its whole footprint */
export function entityAnchorWorld(entity: PlacedEntity, gridSize: number): { x: number; z: number } {
  const cellSize = ENGINE_CONFIG.CELL_SIZE;
  const rect = getFootprintRect({ ...entity, yawBam: radiansToBam(entity.yaw || 0) });
  const anchor = CollisionSystem.gridToWorld(rect.row0, rect.col0, gridSize);
  return {
    x: anchor.x + ((rect.col1 - rect.col0) * cellSize) / 2,
    z: anchor.z + ((rect.row1 - rect.row0) * cellSize) / 2,
  };
}

/** Height in meters of the floor under a tile of a layer (its stored floor height, slopes ignored) */
export function tileFloorMeters(
  vertical: VerticalLevelData | undefined,
  layer: number,
  row: number,
  col: number
): number {
  if (!vertical) return 0;
  const heights = layer === 0 ? vertical.floorHeights : vertical.layers[layer - 1]?.floorHeights;
  return layer * LAYER_METERS + (heights?.[row]?.[col] ?? 0) * METERS_PER_UNIT;
}

/** Absolute height in meters of a placed model's origin */
export function entityBaseMeters(entity: PlacedEntity, vertical: VerticalLevelData | undefined): number {
  const layer = Math.max(0, entity.layer ?? 0);
  if (entity.elevation !== undefined) return layer * LAYER_METERS + entity.elevation;
  return tileFloorMeters(vertical, layer, entity.row, entity.col);
}

/**
 * Moves a model's root group from its grid anchor to its free 3D placement: offset,
 * height, and tilt. Yaw is applied first, then pitch, then roll.
 */
export function applyVerticalPlacement(
  root: THREE.Object3D,
  entity: PlacedEntity,
  anchor: { x: number; z: number },
  vertical: VerticalLevelData | undefined
): void {
  root.position.set(
    anchor.x + (entity.offsetX ?? 0),
    entityBaseMeters(entity, vertical),
    anchor.z + (entity.offsetZ ?? 0)
  );
  root.rotation.set(entity.pitch ?? 0, entity.yaw || 0, entity.roll ?? 0, 'YXZ');
}

export { LAYER_METERS, METERS_PER_UNIT };
