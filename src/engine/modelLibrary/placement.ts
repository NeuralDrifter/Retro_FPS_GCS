/**
 * ============================================================================
 * PIE3D MULTI-CELL PLACEMENT CHECKS (EDITOR SIDE)
 * ============================================================================
 * Footprint lookups and conflict checks for placing, moving, rotating, or
 * resizing models in the 2D editor. Rectangles follow the same quarter-turn
 * rule as the simulation (`sim/footprint.ts`).
 */

import { CellType, PlacedEntity } from '../../types/engine';
import { getFootprintRect } from '../sim/footprint';
import { radiansToBam } from '../sim/trigTable';

export interface CellRect {
  row0: number;
  col0: number;
  row1: number;
  col1: number;
}

export function getEntityRect(e: PlacedEntity): CellRect {
  return getFootprintRect({ ...e, yawBam: radiansToBam(e.yaw || 0) });
}

const rectsOverlap = (a: CellRect, b: CellRect): boolean =>
  a.row0 <= b.row1 && b.row0 <= a.row1 && a.col0 <= b.col1 && b.col0 <= a.col1;

const rectFits = (r: CellRect, gridSize: number): boolean =>
  r.row0 >= 0 && r.col0 >= 0 && r.row1 < gridSize && r.col1 < gridSize;

/** Every placed model whose footprint covers the cell, in placement order */
export function getEntitiesCoveringCell(
  entities: PlacedEntity[],
  row: number,
  col: number
): PlacedEntity[] {
  return entities.filter((e) => {
    const r = getEntityRect(e);
    return row >= r.row0 && row <= r.row1 && col >= r.col0 && col <= r.col1;
  });
}

/**
 * Reasons `candidate` cannot go where it is: 'off the map edge', walls, doors,
 * and other models it overlaps (`ignoreEntityId` skips the copy being edited).
 * 'off the map edge' always refuses; the others only while overlap is off.
 */
export function findPlacementConflicts(
  grid: number[][],
  entities: PlacedEntity[],
  candidate: PlacedEntity,
  ignoreEntityId?: string
): string[] {
  const rect = getEntityRect(candidate);
  if (!rectFits(rect, grid.length)) return ['off the map edge'];

  const reasons: string[] = [];
  for (let r = rect.row0; r <= rect.row1; r++) {
    for (let c = rect.col0; c <= rect.col1; c++) {
      if (grid[r][c] === CellType.WALL) reasons.push(`wall at [X:${c}, Z:${r}]`);
      else if (grid[r][c] === CellType.DOOR) reasons.push(`door at [X:${c}, Z:${r}]`);
    }
  }
  for (const other of entities) {
    if (other.id === ignoreEntityId || other.id === candidate.id) continue;
    if (rectsOverlap(rect, getEntityRect(other))) reasons.push(`overlaps ${other.name}`);
  }
  return [...new Set(reasons)];
}

/** Placed models whose whole footprint fits a grid of `gridSize` */
export function entitiesFittingGrid(
  entities: PlacedEntity[],
  gridSize: number
): PlacedEntity[] {
  return entities.filter((e) => rectFits(getEntityRect(e), gridSize));
}

/**
 * Points placed copies at their model's new id (`renamed` maps old id to new).
 * Returns `entities` itself when no copy uses a renamed model.
 */
export function remapEntityModelIds(
  entities: PlacedEntity[],
  renamed: Record<string, string>
): PlacedEntity[] {
  let changed = false;
  const next = entities.map((e) => {
    const newId = e.modelAssetId ? renamed[e.modelAssetId] : undefined;
    if (!newId) return e;
    changed = true;
    return { ...e, modelAssetId: newId };
  });
  return changed ? next : entities;
}
