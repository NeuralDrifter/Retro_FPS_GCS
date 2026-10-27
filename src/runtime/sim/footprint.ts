/**
 * FORGECORE MULTI-TILE FOOTPRINT & ROTATION LOGIC (/src/runtime/sim/footprint.ts)
 */

import { SIM_CONFIG, SimPlacedEntityV3 } from './types';
import { gridToWorldUnits } from './physics';

export function yawBamToQuadrant(yawBam: number): number {
  const norm = ((Math.trunc(yawBam) % 65536) + 65536) % 65536;
  return Math.round(norm / 16384) % 4;
}

export const quarterTurnsFromBam = yawBamToQuadrant;

export function rotatedFootprint(
  w: number,
  d: number,
  quadrant: number
): { w: number; d: number } {
  return quadrant % 2 === 1 ? { w: d, d: w } : { w, d };
}

export function getFootprintRect(entity: {
  row: number;
  col: number;
  footprintW?: number;
  footprintD?: number;
  yawBam?: number;
  [key: string]: any;
}): {
  row0: number;
  col0: number;
  row1: number;
  col1: number;
} {
  const quad = yawBamToQuadrant(entity.yawBam ?? 0);
  const { w, d } = rotatedFootprint(
    Math.max(1, Math.trunc(entity.footprintW ?? 1)),
    Math.max(1, Math.trunc(entity.footprintD ?? 1)),
    quad
  );
  const row0 = Math.trunc(entity.row);
  const col0 = Math.trunc(entity.col);
  return {
    row0,
    col0,
    row1: row0 + d - 1,
    col1: col0 + w - 1,
  };
}

export function getFootprintCenterUnits(
  entity: {
    row: number;
    col: number;
    footprintW?: number;
    footprintD?: number;
    yawBam?: number;
    [key: string]: any;
  },
  gridSize: number
): {
  row: number;
  col: number;
  xUnits: number;
  zUnits: number;
} {
  const rect = getFootprintRect(entity);
  const world0 = gridToWorldUnits(rect.row0, rect.col0, gridSize);
  const rowSpan = rect.row1 - rect.row0;
  const colSpan = rect.col1 - rect.col0;
  return {
    row: rect.row0 + Math.trunc(rowSpan / 2),
    col: rect.col0 + Math.trunc(colSpan / 2),
    xUnits: world0.xUnits + Math.trunc((colSpan * SIM_CONFIG.CELL_UNITS) / 2),
    zUnits: world0.zUnits + Math.trunc((rowSpan * SIM_CONFIG.CELL_UNITS) / 2),
  };
}

export function isSolidFootprint(entity: {
  category?: string;
  blueprintId?: string;
  [key: string]: any;
}): boolean {
  return (
    entity.category !== undefined &&
    entity.category !== 'characters' &&
    entity.blueprintId !== 'supply-crate'
  );
}

export function buildSolidFootprintGrid(
  entities: readonly {
    row: number;
    col: number;
    category?: string;
    blueprintId?: string;
    collision?: string;
    footprintW?: number;
    footprintD?: number;
    yawBam?: number;
    [key: string]: any;
  }[],
  gridSize: number
): number[][] | undefined {
  const solidEntities = entities.filter(
    (e) => isSolidFootprint(e) && e.collision === 'solid'
  );
  if (solidEntities.length === 0) return undefined;

  const grid: number[][] = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => 0)
  );

  for (const ent of solidEntities) {
    const rect = getFootprintRect(ent);
    const minRow = Math.max(0, rect.row0);
    const maxRow = Math.min(gridSize - 1, rect.row1);
    const minCol = Math.max(0, rect.col0);
    const maxCol = Math.min(gridSize - 1, rect.col1);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        grid[r][c] += 1;
      }
    }
  }

  return grid;
}
