/**
 * ============================================================================
 * VALIDATION OF VERTICAL LEVEL FIELDS (LAYERS, HEIGHTS, SLOPES, 3D PLACEMENT)
 * ============================================================================
 * Called by `validateLevelDataV3` for the optional fields vertical levels add.
 * Zero React, DOM, or Three.js imports.
 */

import { SIM_CONFIG, SimCellType } from './types';
import type { ValidationErrorItem } from './validator';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isSafeInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);

/** A placement in units with at most three decimals (finer than a millimeter) */
const isFineUnits = (v: unknown): v is number =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  !Object.is(v, -0) &&
  Math.round(v * 1000) / 1000 === v;

const DIRECTIONS = new Set(['N', 'S', 'E', 'W']);
const LAYER_KEYS = new Set([
  'grid',
  'wallTextures',
  'floorTextures',
  'ceilingTextures',
  'floorHeights',
  'ceilingHeights',
  'slopes',
]);
const MOVEMENT_KEYS = new Set(['jump', 'crouch', 'stepUnits', 'fallDamage', 'aim']);
const WALK_SURFACE_KEYS = new Set([
  'originXUnits',
  'originZUnits',
  'spacingUnits',
  'cols',
  'rows',
  'top',
  'bottom',
]);
/** Furthest a coordinate in units can be from the world center on the largest map */
const MAX_WORLD_UNITS = SIM_CONFIG.MAX_GRID_SIZE * SIM_CONFIG.CELL_UNITS;
const MAX_ABS_HEIGHT_UNITS = (SIM_CONFIG.MAX_LAYERS + 1) * SIM_CONFIG.LAYER_HEIGHT_UNITS;

function unknownKeys(
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: ValidationErrorItem[]
): void {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (!allowed.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Unknown schema field '${key}' at ${path}.`,
      });
    }
  }
}

function validateHeightMatrix(
  mat: unknown,
  path: string,
  gridSize: number,
  min: number,
  max: number,
  errors: ValidationErrorItem[]
): void {
  if (mat === undefined) return;
  if (
    !Array.isArray(mat) ||
    mat.length !== gridSize ||
    !mat.every((r) => Array.isArray(r) && r.length === gridSize)
  ) {
    errors.push({
      path,
      code: 'INVALID_HEIGHT',
      message: `${path} must be a ${gridSize}x${gridSize} integer array.`,
    });
    return;
  }
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const v = mat[r][c];
      if (!isSafeInt(v) || v < min || v > max) {
        errors.push({
          path: `${path}[${r}][${c}]`,
          code: 'INVALID_HEIGHT',
          message: `Height must be an integer from ${min} to ${max}.`,
        });
        return; // One error per matrix keeps huge broken maps readable
      }
    }
  }
}

function validateSlopes(
  slopes: unknown,
  path: string,
  gridSize: number,
  errors: ValidationErrorItem[]
): void {
  if (slopes === undefined) return;
  if (!Array.isArray(slopes) || slopes.length > gridSize * gridSize) {
    errors.push({ path, code: 'INVALID_SLOPE', message: `${path} must be an array of slopes.` });
    return;
  }
  slopes.forEach((s, i) => {
    const sPath = `${path}[${i}]`;
    if (
      !isPlainObject(s) ||
      !isSafeInt(s.row) ||
      s.row < 0 ||
      s.row >= gridSize ||
      !isSafeInt(s.col) ||
      s.col < 0 ||
      s.col >= gridSize ||
      !DIRECTIONS.has(s.dir as string) ||
      !isSafeInt(s.riseUnits) ||
      Math.abs(s.riseUnits) > SIM_CONFIG.MAX_SLOPE_RISE_UNITS ||
      (s.surface !== undefined && s.surface !== 'floor' && s.surface !== 'ceiling')
    ) {
      errors.push({
        path: sPath,
        code: 'INVALID_SLOPE',
        message: `Slope needs row, col, dir (N/S/E/W), riseUnits within ±${SIM_CONFIG.MAX_SLOPE_RISE_UNITS} and an optional surface ('floor' or 'ceiling').`,
      });
      return;
    }
    unknownKeys(s, new Set(['row', 'col', 'dir', 'riseUnits', 'surface']), sPath, errors);
  });
}

/**
 * Validates `slopes`, `layers` and `movement` on a level (the ground layer's grid,
 * textures and heights are checked by `validateLevelDataV3` itself).
 */
export function validateVerticalLevelFields(
  input: Record<string, unknown>,
  gridSize: number,
  validateTexMatrix: (mat: unknown, path: string) => void,
  errors: ValidationErrorItem[]
): void {
  const LAYER = SIM_CONFIG.LAYER_HEIGHT_UNITS;
  validateHeightMatrix(
    input.floorHeights,
    '$.floorHeights',
    gridSize,
    SIM_CONFIG.MIN_FLOOR_HEIGHT_UNITS,
    LAYER,
    errors
  );
  validateHeightMatrix(
    input.ceilingHeights,
    '$.ceilingHeights',
    gridSize,
    SIM_CONFIG.MIN_FLOOR_HEIGHT_UNITS,
    LAYER,
    errors
  );
  validateSlopes(input.slopes, '$.slopes', gridSize, errors);

  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers) || input.layers.length > SIM_CONFIG.MAX_LAYERS - 1) {
      errors.push({
        path: '$.layers',
        code: 'INVALID_LAYER',
        message: `layers must be an array of at most ${SIM_CONFIG.MAX_LAYERS - 1} layers.`,
      });
    } else {
      input.layers.forEach((layer, i) => {
        const lPath = `$.layers[${i}]`;
        if (!isPlainObject(layer)) {
          errors.push({ path: lPath, code: 'INVALID_LAYER', message: 'Layer must be an object.' });
          return;
        }
        unknownKeys(layer, LAYER_KEYS, lPath, errors);
        const grid = layer.grid;
        if (
          !Array.isArray(grid) ||
          grid.length !== gridSize ||
          !grid.every((r) => Array.isArray(r) && r.length === gridSize)
        ) {
          errors.push({
            path: `${lPath}.grid`,
            code: 'INVALID_GRID',
            message: `Layer grid must be a ${gridSize}x${gridSize} integer array.`,
          });
        } else {
          outer: for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
              const cell = grid[r][c];
              if (!isSafeInt(cell) || cell < 0 || cell > SimCellType.HOLE) {
                errors.push({
                  path: `${lPath}.grid[${r}][${c}]`,
                  code: 'INVALID_CELL_TYPE',
                  message: `Invalid cell type ${String(cell)} at (${r}, ${c}).`,
                });
                break outer;
              }
            }
          }
        }
        validateTexMatrix(layer.wallTextures, `layers[${i}].wallTextures`);
        validateTexMatrix(layer.floorTextures, `layers[${i}].floorTextures`);
        validateTexMatrix(layer.ceilingTextures, `layers[${i}].ceilingTextures`);
        validateHeightMatrix(layer.floorHeights, `${lPath}.floorHeights`, gridSize, 0, LAYER, errors);
        validateHeightMatrix(layer.ceilingHeights, `${lPath}.ceilingHeights`, gridSize, 0, LAYER, errors);
        validateSlopes(layer.slopes, `${lPath}.slopes`, gridSize, errors);
      });
    }
  }

  if (input.movement !== undefined) {
    const m = input.movement;
    if (
      !isPlainObject(m) ||
      typeof m.jump !== 'boolean' ||
      typeof m.crouch !== 'boolean' ||
      typeof m.fallDamage !== 'boolean' ||
      !isSafeInt(m.stepUnits) ||
      m.stepUnits < 0 ||
      m.stepUnits > SIM_CONFIG.MAX_STEP_UNITS ||
      (m.aim !== 'free' && m.aim !== 'auto')
    ) {
      errors.push({
        path: '$.movement',
        code: 'INVALID_MOVEMENT',
        message: `movement needs jump, crouch, fallDamage (booleans), stepUnits (0..${SIM_CONFIG.MAX_STEP_UNITS}) and aim ('free' or 'auto').`,
      });
    } else {
      unknownKeys(m, MOVEMENT_KEYS, '$.movement', errors);
    }
  }
}

/** Highest layer index a level allows (layer 0 plus its stacked layers) */
export function maxLayerIndex(input: Record<string, unknown>): number {
  return Array.isArray(input.layers) ? input.layers.length : 0;
}

/** Validates the free 3D placement fields of one entity */
export function validateEntityVerticalFields(
  ent: Record<string, unknown>,
  ePath: string,
  maxLayer: number,
  errors: ValidationErrorItem[]
): void {
  const fail = (key: string, message: string) =>
    errors.push({
      path: `${ePath}.${key}`,
      code: 'INVALID_PLACEMENT',
      message: `Entity '${String(ent.id)}' ${message}`,
    });

  if (ent.layer !== undefined && (!isSafeInt(ent.layer) || ent.layer < 0 || ent.layer > maxLayer)) {
    fail('layer', `layer must be an integer from 0 to ${maxLayer}.`);
  }
  for (const key of ['offsetXUnits', 'offsetZUnits'] as const) {
    const v = ent[key];
    if (v !== undefined && (!isFineUnits(v) || Math.abs(v) > MAX_WORLD_UNITS)) {
      fail(key, `${key} must be a number with at most 3 decimals within ±${MAX_WORLD_UNITS}.`);
    }
  }
  if (
    ent.elevationUnits !== undefined &&
    (!isFineUnits(ent.elevationUnits) || Math.abs(ent.elevationUnits) > MAX_ABS_HEIGHT_UNITS)
  ) {
    fail(
      'elevationUnits',
      `elevationUnits must be a number with at most 3 decimals within ±${MAX_ABS_HEIGHT_UNITS}.`
    );
  }
  const bottom = ent.modelBottomUnits;
  const top = ent.modelTopUnits;
  if (bottom !== undefined || top !== undefined) {
    const inRange = (v: unknown) => isSafeInt(v) && Math.abs(v) <= MAX_ABS_HEIGHT_UNITS;
    if (!inRange(bottom) || !inRange(top) || (top as number) <= (bottom as number)) {
      fail(
        'modelTopUnits',
        `modelBottomUnits and modelTopUnits must both be integers within ±${MAX_ABS_HEIGHT_UNITS}, top above bottom.`
      );
    }
  }
  for (const key of ['pitchBam', 'rollBam'] as const) {
    const v = ent[key];
    if (v !== undefined && (!isSafeInt(v) || v < 0 || v >= 65536)) {
      fail(key, `${key} must be an integer in [0, 65535].`);
    }
  }
  if (ent.walkable !== undefined && typeof ent.walkable !== 'boolean') {
    fail('walkable', 'walkable must be a boolean.');
  }
  if (ent.walkSurface !== undefined) {
    const ws = ent.walkSurface;
    const ok =
      isPlainObject(ws) &&
      isSafeInt(ws.originXUnits) &&
      Math.abs(ws.originXUnits) <= MAX_WORLD_UNITS &&
      isSafeInt(ws.originZUnits) &&
      Math.abs(ws.originZUnits) <= MAX_WORLD_UNITS &&
      isSafeInt(ws.spacingUnits) &&
      ws.spacingUnits >= 1 &&
      isSafeInt(ws.cols) &&
      ws.cols >= 1 &&
      isSafeInt(ws.rows) &&
      ws.rows >= 1 &&
      ws.cols * ws.rows <= SIM_CONFIG.WALK_SURFACE_MAX_SAMPLES &&
      Array.isArray(ws.top) &&
      Array.isArray(ws.bottom) &&
      ws.top.length === ws.cols * ws.rows &&
      ws.bottom.length === ws.cols * ws.rows &&
      ws.top.every(isSafeInt) &&
      ws.bottom.every(isSafeInt);
    if (!ok) {
      fail(
        'walkSurface',
        `walkSurface must be a grid of at most ${SIM_CONFIG.WALK_SURFACE_MAX_SAMPLES} integer samples.`
      );
    } else {
      unknownKeys(ws as Record<string, unknown>, WALK_SURFACE_KEYS, `${ePath}.walkSurface`, errors);
    }
  }
}

/** Entity fields vertical levels add to the allowed key list */
export const ENTITY_VERTICAL_KEYS = [
  'layer',
  'offsetXUnits',
  'offsetZUnits',
  'elevationUnits',
  'pitchBam',
  'rollBam',
  'walkable',
  'walkSurface',
  'modelBottomUnits',
  'modelTopUnits',
] as const;
