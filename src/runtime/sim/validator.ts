/**
 * ============================================================================
 * STRICT SCHEMA ALLOWLIST VALIDATOR FOR LEVEL V3 & RUNTIME SIMULATION STATE
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 *
 * Enforces:
 *  1. Strict schema allowlist (unknown fields and prototype-pollution keys rejected).
 *  2. Coordinate bounds, door/wall target type checks, and budget caps.
 *  3. Variable & event reference integrity (`event_id`, `flag`, `counter`, `timer`, `region`).
 *  4. Static cycle detection on `fire_event` / `trigger_event` graphs without `once` or `delay`.
 *  5. Untrusted saved `SimulationState` validation (continuations, float absence, bounds).
 */

import {
  ActionSpec,
  ConditionSpec,
  EventDefinition,
  LevelDataV3,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
  TriggerSpec,
} from './types';
import { findFloatPaths } from './hash';
import {
  FootprintSource,
  getFootprintRect,
  isStaticFootprintSource,
} from './footprint';
import {
  ENTITY_VERTICAL_KEYS,
  maxLayerIndex,
  validateEntityVerticalFields,
  validateVerticalLevelFields,
} from './verticalValidator';
import {
  BUILTIN_MODEL_IDS,
  BUILTIN_SOUND_IDS,
  BUILTIN_TEXTURE_IDS,
} from '../AssetRegistry';

export interface ValidationErrorItem {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
}

export interface ValidatorOptions {
  allowedTextureIds?: ReadonlySet<string>;
  allowedModelIds?: ReadonlySet<string>;
  allowedSoundIds?: ReadonlySet<string>;
  skipStaticCycleCheck?: boolean;
}

const SAFE_ID_REGEX = /^[a-z0-9_-]+$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== 'object' || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function hasRawDangerousKeys(rawJson?: string): string | null {
  if (!rawJson) return null;
  if (/"__proto__"\s*:/.test(rawJson)) return '__proto__';
  if (/"constructor"\s*:/.test(rawJson)) return 'constructor';
  if (/"prototype"\s*:/.test(rawJson)) return 'prototype';
  return null;
}

function checkAllowedKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: ValidationErrorItem[]
): void {
  const allowedSet = new Set(allowed);
  const ownNames = Object.getOwnPropertyNames(obj);
  for (const key of ownNames) {
    if (FORBIDDEN_KEYS.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'FORBIDDEN_KEY',
        message: `Forbidden property key '${key}' at ${path}.`,
      });
      continue;
    }
    if (!allowedSet.has(key)) {
      errors.push({
        path: `${path}.${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Unknown schema field '${key}' at ${path}.`,
      });
    }
  }
}

function isSafeInt(val: unknown): val is number {
  return (
    typeof val === 'number' &&
    Number.isFinite(val) &&
    Number.isInteger(val) &&
    Number.isSafeInteger(val) &&
    !Object.is(val, -0)
  );
}

const LEVEL_V3_KEYS = [
  'formatVersion',
  'gridSize',
  'rngSeed',
  'nextEntityId',
  'spawn',
  'minimapEnabled',
  'skybox',
  'grid',
  'wallTextures',
  'floorTextures',
  'ceilingTextures',
  'cellTags',
  'floorHeights',
  'ceilingHeights',
  'slopes',
  'layers',
  'movement',
  'entities',
  'regions',
  'variables',
  'events',
  'metadata',
] as const;

const EVENT_KEYS = [
  'id',
  'name',
  'enabled',
  'trigger',
  'conditions',
  'actions',
  'options',
] as const;

const EVENT_OPTIONS_KEYS = [
  'once',
  'fire',
  'cooldown_ticks',
  'cooldown_sec',
  'modes',
  'skill',
] as const;

const TRIGGER_ALLOWED_KEYS: Record<string, readonly string[]> = {
  enter_cell: ['type', 'row', 'col', 'who'],
  leave_cell: ['type', 'row', 'col', 'who'],
  enter_region: ['type', 'region', 'who'],
  leave_region: ['type', 'region', 'who'],
  use: ['type', 'row', 'col', 'tag', 'entityId'],
  shoot: ['type', 'row', 'col', 'tag', 'entityId'],
  pickup_item: ['type', 'item', 'row', 'col', 'tag'],
  level_start: ['type'],
  mover_finished: ['type', 'tag', 'row', 'col', 'state'],
  timer_fired: ['type', 'timer'],
  flag_changed: ['type', 'name', 'is'],
  counter_reached: ['type', 'name', 'op', 'value'],
  all_dead: ['type', 'region', 'tag'],
  entity_killed: ['type', 'entityId', 'tag', 'blueprintId'],
  entity_alerted: ['type', 'entityId', 'tag'],
  stand_in_region: ['type', 'region', 'dwell_ticks', 'dwell_sec', 'who'],
};

const CONDITION_ALLOWED_KEYS: Record<string, readonly string[]> = {
  flag: ['type', 'name', 'is'],
  counter: ['type', 'name', 'op', 'value'],
  has_item: ['type', 'item'],
  player_health: ['type', 'op', 'value'],
  player_ammo: ['type', 'op', 'value'],
  all_dead: ['type', 'region', 'tag'],
  entities_alive: ['type', 'region', 'tag', 'op', 'value'],
  mover_state: ['type', 'row', 'col', 'tag', 'state'],
  chance: ['type', 'percent'],
};

const ACTION_ALLOWED_KEYS: Record<string, readonly string[]> = {
  open_door: ['type', 'row', 'col', 'tag', 'speed_per_tick', 'wait_ticks'],
  close_door: ['type', 'row', 'col', 'tag', 'speed_per_tick'],
  toggle_door: ['type', 'row', 'col', 'tag', 'speed_per_tick'],
  lock_door: ['type', 'row', 'col', 'tag', 'required_key'],
  unlock_door: ['type', 'row', 'col', 'tag'],
  slide_wall: [
    'type',
    'row',
    'col',
    'direction',
    'distance_cells',
    'speed_per_tick',
  ],
  lower_floor: [
    'type',
    'tag',
    'row',
    'col',
    'target_height_units',
    'speed_per_tick',
    'wait_ticks',
    'return_height_units',
  ],
  raise_floor: [
    'type',
    'tag',
    'row',
    'col',
    'target_height_units',
    'speed_per_tick',
    'wait_ticks',
    'return_height_units',
  ],
  toggle_lift: [
    'type',
    'tag',
    'row',
    'col',
    'lower_height_units',
    'upper_height_units',
    'speed_per_tick',
    'wait_ticks',
  ],
  start_crusher: [
    'type',
    'tag',
    'row',
    'col',
    'lower_height_units',
    'upper_height_units',
    'speed_per_tick',
    'damage',
  ],
  stop_crusher: ['type', 'tag', 'row', 'col'],
  build_stairs: ['type', 'tag', 'step_height_units', 'speed_per_tick'],
  wake_entities: ['type', 'tag', 'region'],
  spawn_entity: [
    'type',
    'blueprintId',
    'row',
    'col',
    'yaw_bam',
    'tag',
    'ambush',
    'isEnemy',
    'maxHealth',
  ],
  remove_entity: ['type', 'entityId', 'tag'],
  damage_entity: ['type', 'entityId', 'tag', 'amount'],
  set_cell: ['type', 'row', 'col', 'cell_type'],
  set_wall_texture: ['type', 'row', 'col', 'texture_id'],
  set_floor_texture: ['type', 'row', 'col', 'texture_id'],
  set_ceiling_texture: ['type', 'row', 'col', 'texture_id'],
  mark_secret_found: ['type', 'secret_id'],
  give_item: ['type', 'item', 'amount', 'target'],
  take_item: ['type', 'item', 'amount', 'target'],
  heal_player: ['type', 'amount', 'target'],
  damage_player: ['type', 'amount', 'target'],
  teleport_player: ['type', 'row', 'col', 'yaw_bam', 'target'],
  set_flag: ['type', 'name', 'value'],
  toggle_flag: ['type', 'name'],
  set_counter: ['type', 'name', 'value'],
  add_counter: ['type', 'name', 'delta'],
  start_timer: ['type', 'timer', 'duration_ticks', 'duration_sec'],
  stop_timer: ['type', 'timer'],
  delay: ['type', 'delay_ticks', 'delay_sec'],
  fire_event: ['type', 'event_id'],
  trigger_event: ['type', 'event_id'],
  enable_event: ['type', 'event_id'],
  disable_event: ['type', 'event_id'],
  reset_event_once: ['type', 'event_id'],
  show_message: ['type', 'text', 'target'],
  play_sound: ['type', 'sound_id', 'row', 'col'],
  exit_level: ['type', 'secret'],
  earthquake: ['type', 'duration_ticks', 'duration_sec', 'intensity'],
  set_light_effect: ['type', 'region', 'tag', 'effect', 'speed_ticks'],
  stop_light_effect: ['type', 'region', 'tag'],
  set_hazard_region: [
    'type',
    'region',
    'damage_per_interval',
    'interval_ticks',
  ],
  clear_hazard_region: ['type', 'region'],
  if_then_else: ['type', 'condition', 'then_actions', 'else_actions'],
  random_branch: ['type', 'branches'],
  move_along_track: [
    'type',
    'tag',
    'waypoints',
    'speed_per_tick',
    'loop',
    'ping_pong',
  ],
};

/**
 * Converts any author-facing `delay_sec` / `cooldown_sec` / `duration_sec` on events
 * to integer ticks (`TICKS_PER_SECOND = 30`) so runtime state is 100% integer-only.
 */
function normalizeSingleAction(act: ActionSpec): ActionSpec {
  if (act.type === 'delay') {
    const ticks =
      typeof act.delay_ticks === 'number'
        ? Math.trunc(act.delay_ticks)
        : typeof act.delay_sec === 'number'
        ? Math.max(1, Math.round(act.delay_sec * SIM_CONFIG.TICKS_PER_SECOND))
        : 1;
    return {
      type: 'delay',
      delay_ticks: ticks,
    };
  }
  if (act.type === 'start_timer') {
    const ticks =
      typeof act.duration_ticks === 'number'
        ? Math.trunc(act.duration_ticks)
        : typeof act.duration_sec === 'number'
        ? Math.max(
            1,
            Math.round(act.duration_sec * SIM_CONFIG.TICKS_PER_SECOND)
          )
        : SIM_CONFIG.TICKS_PER_SECOND;
    return {
      type: 'start_timer',
      timer: act.timer,
      duration_ticks: ticks,
    };
  }
  if (act.type === 'earthquake') {
    const ticks =
      typeof act.duration_ticks === 'number'
        ? Math.trunc(act.duration_ticks)
        : typeof act.duration_sec === 'number'
        ? Math.max(
            1,
            Math.round(act.duration_sec * SIM_CONFIG.TICKS_PER_SECOND)
          )
        : SIM_CONFIG.TICKS_PER_SECOND;
    return {
      type: 'earthquake',
      duration_ticks: ticks,
      intensity: act.intensity ?? 30,
    };
  }
  if (act.type === 'if_then_else') {
    return {
      type: 'if_then_else',
      condition: { ...act.condition },
      then_actions: act.then_actions.map(normalizeSingleAction),
      ...(act.else_actions
        ? { else_actions: act.else_actions.map(normalizeSingleAction) }
        : {}),
    };
  }
  if (act.type === 'random_branch') {
    return {
      type: 'random_branch',
      branches: act.branches.map((b) => ({
        weight: Math.max(1, Math.trunc(b.weight || 1)),
        actions: b.actions.map(normalizeSingleAction),
      })),
    };
  }
  return { ...act };
}

/**
 * Converts any author-facing `delay_sec` / `cooldown_sec` / `duration_sec` on events
 * to integer ticks (`TICKS_PER_SECOND = 30`) so runtime state is 100% integer-only.
 */
export function normalizeEventsToIntegerTicks(
  events: EventDefinition[]
): EventDefinition[] {
  return events.map((evt) => {
    const normalizedTrigger = { ...evt.trigger };
    if (normalizedTrigger.type === 'stand_in_region') {
      const dwell =
        typeof normalizedTrigger.dwell_ticks === 'number'
          ? Math.trunc(normalizedTrigger.dwell_ticks)
          : typeof normalizedTrigger.dwell_sec === 'number'
          ? Math.max(
              1,
              Math.round(normalizedTrigger.dwell_sec * SIM_CONFIG.TICKS_PER_SECOND)
            )
          : SIM_CONFIG.TICKS_PER_SECOND;
      normalizedTrigger.dwell_ticks = dwell;
      delete normalizedTrigger.dwell_sec;
    }

    const normalizedActions: ActionSpec[] = evt.actions.map(normalizeSingleAction);

    const normalizedOptions = evt.options ? { ...evt.options } : undefined;
    if (normalizedOptions) {
      if (
        normalizedOptions.cooldown_ticks === undefined &&
        typeof normalizedOptions.cooldown_sec === 'number'
      ) {
        normalizedOptions.cooldown_ticks = Math.max(
          0,
          Math.round(
            normalizedOptions.cooldown_sec * SIM_CONFIG.TICKS_PER_SECOND
          )
        );
      }
      delete normalizedOptions.cooldown_sec;
    }

    return {
      ...evt,
      trigger: normalizedTrigger,
      conditions: evt.conditions.map((c) => ({ ...c })),
      actions: normalizedActions,
      ...(normalizedOptions ? { options: normalizedOptions } : {}),
    };
  });
}

/**
 * Validates a `LevelDataV3` object (or parsed JSON) against the strict schema.
 */
const ENTITY_CATEGORIES = new Set([
  'characters',
  'decorations',
  'items',
  'buildings',
  'vehicles',
]);

/** Checks an entity's optional category, collision and footprint fields */
function validateEntityPlacement(
  ent: Record<string, unknown>,
  ePath: string,
  gridSize: number,
  errors: ValidationErrorItem[]
): void {
  if (ent.category !== undefined && !ENTITY_CATEGORIES.has(ent.category as string)) {
    errors.push({
      path: `${ePath}.category`,
      code: 'INVALID_CATEGORY',
      message: `Entity '${String(ent.id)}' category '${String(ent.category)}' is not a known category.`,
    });
  }
  if (
    ent.collision !== undefined &&
    ent.collision !== 'solid' &&
    ent.collision !== 'nonSolid'
  ) {
    errors.push({
      path: `${ePath}.collision`,
      code: 'INVALID_COLLISION',
      message: `Entity '${String(ent.id)}' collision must be 'solid' or 'nonSolid'.`,
    });
  }
  if (ent.footprintOverride !== undefined && typeof ent.footprintOverride !== 'boolean') {
    errors.push({
      path: `${ePath}.footprintOverride`,
      code: 'INVALID_FOOTPRINT',
      message: `Entity '${String(ent.id)}' footprintOverride must be a boolean.`,
    });
  }

  let footprintValid = true;
  for (const key of ['footprintW', 'footprintD'] as const) {
    const v = ent[key];
    if (v === undefined) continue;
    if (!isSafeInt(v) || v < 1 || v > SIM_CONFIG.MAX_FOOTPRINT_CELLS) {
      footprintValid = false;
      errors.push({
        path: `${ePath}.${key}`,
        code: 'INVALID_FOOTPRINT',
        message: `Entity '${String(ent.id)}' ${key} must be an integer in [1, ${SIM_CONFIG.MAX_FOOTPRINT_CELLS}].`,
      });
    }
  }

  if (footprintValid && isSafeInt(ent.row) && isSafeInt(ent.col)) {
    const rect = getFootprintRect({
      row: ent.row as number,
      col: ent.col as number,
      footprintW: ent.footprintW as number | undefined,
      footprintD: ent.footprintD as number | undefined,
      yawBam: isSafeInt(ent.yawBam) ? (ent.yawBam as number) : 0,
      blueprintId: String(ent.blueprintId),
    });
    if (rect.row1 >= gridSize || rect.col1 >= gridSize) {
      errors.push({
        path: ePath,
        code: 'OUT_OF_RANGE_FOOTPRINT',
        message: `Entity '${String(ent.id)}' footprint extends past the map edge.`,
      });
    }
  }
}

export function validateLevelDataV3(
  input: unknown,
  options: ValidatorOptions = {},
  rawJsonString?: string
): ValidationResult {
  const errors: ValidationErrorItem[] = [];
  const warnings: ValidationErrorItem[] = [];

  const rawDangerous = hasRawDangerousKeys(rawJsonString);
  if (rawDangerous) {
    errors.push({
      path: '$',
      code: 'FORBIDDEN_KEY',
      message: `Raw JSON contains forbidden key '${rawDangerous}'.`,
    });
    return { valid: false, errors, warnings };
  }

  if (!isPlainObject(input)) {
    errors.push({
      path: '$',
      code: 'INVALID_ROOT',
      message: 'Level data must be a plain JSON object.',
    });
    return { valid: false, errors, warnings };
  }

  checkAllowedKeys(input, LEVEL_V3_KEYS, '$', errors);

  if (input.formatVersion !== 3) {
    errors.push({
      path: '$.formatVersion',
      code: 'INVALID_FORMAT_VERSION',
      message: `Expected formatVersion 3, got ${String(input.formatVersion)}.`,
    });
  }

  const isGridSizeValid =
    isSafeInt(input.gridSize) &&
    input.gridSize >= SIM_CONFIG.MIN_GRID_SIZE &&
    input.gridSize <= SIM_CONFIG.MAX_GRID_SIZE;
  // An out-of-range size falls back to the default so later checks stay bounded
  const gridSize = isGridSizeValid
    ? (input.gridSize as number)
    : SIM_CONFIG.GRID_SIZE;
  if (!isGridSizeValid) {
    errors.push({
      path: '$.gridSize',
      code: 'INVALID_GRID_SIZE',
      message: `gridSize must be an integer from ${SIM_CONFIG.MIN_GRID_SIZE} to ${SIM_CONFIG.MAX_GRID_SIZE}.`,
    });
  }

  if (
    !isSafeInt(input.rngSeed) ||
    input.rngSeed < 0 ||
    input.rngSeed > 0xffffffff
  ) {
    errors.push({
      path: '$.rngSeed',
      code: 'INVALID_RNG_SEED',
      message: 'rngSeed must be an unsigned 32-bit integer.',
    });
  }

  if (!isSafeInt(input.nextEntityId) || input.nextEntityId < 1) {
    errors.push({
      path: '$.nextEntityId',
      code: 'INVALID_NEXT_ENTITY_ID',
      message: 'nextEntityId must be a positive integer >= 1.',
    });
  }

  const allowedTextures =
    options.allowedTextureIds ?? new Set<string>(BUILTIN_TEXTURE_IDS);
  const allowedModels =
    options.allowedModelIds ?? new Set<string>(BUILTIN_MODEL_IDS);
  const allowedSounds =
    options.allowedSoundIds ?? new Set<string>(BUILTIN_SOUND_IDS);

  // Validate grid
  const grid = input.grid;
  if (
    !Array.isArray(grid) ||
    grid.length !== gridSize ||
    !grid.every((r) => Array.isArray(r) && r.length === gridSize)
  ) {
    errors.push({
      path: '$.grid',
      code: 'INVALID_GRID',
      message: `grid must be a ${gridSize}x${gridSize} 2D integer array.`,
    });
  } else {
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell = grid[r][c];
        if (!isSafeInt(cell) || cell < 0 || cell > SimCellType.HOLE) {
          errors.push({
            path: `$.grid[${r}][${c}]`,
            code: 'INVALID_CELL_TYPE',
            message: `Invalid cell type ${String(cell)} at (${r}, ${c}).`,
          });
        }
      }
    }
  }

  // Validate texture matrices
  const validateTexMatrix = (mat: unknown, name: string) => {
    if (
      !Array.isArray(mat) ||
      mat.length !== gridSize ||
      !mat.every((r) => Array.isArray(r) && r.length === gridSize)
    ) {
      errors.push({
        path: `$.${name}`,
        code: 'INVALID_TEXTURE_MATRIX',
        message: `${name} must be a ${gridSize}x${gridSize} 2D string array.`,
      });
      return;
    }
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const tid = mat[r][c];
        if (typeof tid !== 'string' || !SAFE_ID_REGEX.test(tid)) {
          errors.push({
            path: `$.${name}[${r}][${c}]`,
            code: 'INVALID_ASSET_ID',
            message: `Invalid texture asset ID '${String(tid)}' at ${name}[${r}][${c}].`,
          });
        } else if (!allowedTextures.has(tid)) {
          errors.push({
            path: `$.${name}[${r}][${c}]`,
            code: 'UNREGISTERED_ASSET_ID',
            message: `Texture ID '${tid}' is not registered in AssetRegistry.`,
          });
        }
      }
    }
  };

  validateTexMatrix(input.wallTextures, 'wallTextures');
  validateTexMatrix(input.floorTextures, 'floorTextures');
  validateTexMatrix(input.ceilingTextures, 'ceilingTextures');
  validateVerticalLevelFields(input, gridSize, validateTexMatrix, errors);
  const maxLayer = maxLayerIndex(input);

  // Spawn validation
  if (!isPlainObject(input.spawn)) {
    errors.push({
      path: '$.spawn',
      code: 'INVALID_SPAWN',
      message: 'spawn must be an object with row, col, yawBam.',
    });
  } else {
    checkAllowedKeys(input.spawn, ['row', 'col', 'yawBam', 'layer'], '$.spawn', errors);
    if (
      input.spawn.layer !== undefined &&
      (!isSafeInt(input.spawn.layer) || input.spawn.layer < 0 || input.spawn.layer > maxLayer)
    ) {
      errors.push({
        path: '$.spawn.layer',
        code: 'INVALID_LAYER',
        message: `spawn.layer must be an integer from 0 to ${maxLayer}.`,
      });
    }
    if (
      !isSafeInt(input.spawn.row) ||
      input.spawn.row < 0 ||
      input.spawn.row >= gridSize ||
      !isSafeInt(input.spawn.col) ||
      input.spawn.col < 0 ||
      input.spawn.col >= gridSize
    ) {
      errors.push({
        path: '$.spawn',
        code: 'OUT_OF_RANGE_COORD',
        message: 'spawn row/col out of grid bounds.',
      });
    }
    if (
      !isSafeInt(input.spawn.yawBam) ||
      input.spawn.yawBam < 0 ||
      input.spawn.yawBam >= 65536
    ) {
      errors.push({
        path: '$.spawn.yawBam',
        code: 'INVALID_YAW_BAM',
        message: 'spawn.yawBam must be an integer in [0, 65535].',
      });
    }
  }

  // Skybox validation
  if (!isPlainObject(input.skybox)) {
    errors.push({
      path: '$.skybox',
      code: 'INVALID_SKYBOX',
      message: 'skybox must be an object.',
    });
  } else {
    checkAllowedKeys(
      input.skybox,
      ['theme', 'seed', 'showCeiling'],
      '$.skybox',
      errors
    );
    if (!isSafeInt(input.skybox.seed)) {
      errors.push({
        path: '$.skybox.seed',
        code: 'INVALID_SKYBOX_SEED',
        message: 'skybox.seed must be an integer.',
      });
    }
  }

  // Optional metadata block
  if (input.metadata !== undefined) {
    if (!isPlainObject(input.metadata)) {
      errors.push({
        path: '$.metadata',
        code: 'INVALID_METADATA',
        message: 'metadata must be an object.',
      });
    } else {
      checkAllowedKeys(
        input.metadata,
        ['title', 'author', 'exportedAt'],
        '$.metadata',
        errors
      );
    }
  }

  // Entities validation
  const entityIds = new Set<string>();
  if (!Array.isArray(input.entities)) {
    errors.push({
      path: '$.entities',
      code: 'INVALID_ENTITIES',
      message: 'entities must be an array.',
    });
  } else {
    // Static models (decorations, items, buildings, vehicles) have their own, larger budget
    const staticCount = input.entities.filter(
      (ent) =>
        isPlainObject(ent) &&
        isStaticFootprintSource(ent as unknown as FootprintSource)
    ).length;
    const characterCount = input.entities.length - staticCount;
    if (characterCount > SIM_CONFIG.MAX_ENTITIES) {
      errors.push({
        path: '$.entities',
        code: 'BUDGET_EXCEEDED',
        message: `character entities count (${characterCount}) exceeds MAX_ENTITIES (${SIM_CONFIG.MAX_ENTITIES}).`,
      });
    }
    if (staticCount > SIM_CONFIG.MAX_STATIC_MODELS) {
      errors.push({
        path: '$.entities',
        code: 'BUDGET_EXCEEDED',
        message: `static model count (${staticCount}) exceeds MAX_STATIC_MODELS (${SIM_CONFIG.MAX_STATIC_MODELS}).`,
      });
    }
    input.entities.forEach((ent, idx) => {
      const ePath = `$.entities[${idx}]`;
      if (!isPlainObject(ent)) {
        errors.push({
          path: ePath,
          code: 'INVALID_ENTITY',
          message: 'Entity must be an object.',
        });
        return;
      }
      checkAllowedKeys(
        ent,
        [
          'id',
          'row',
          'col',
          'blueprintId',
          'modelAssetId',
          'name',
          'yawBam',
          'scalePct',
          'isEnemy',
          'maxHealth',
          'moveSpeedUnitsPerTick',
          'attackDamage',
          'tag',
          'patrol',
          'ambush',
          'category',
          'collision',
          'footprintW',
          'footprintD',
          'footprintOverride',
          ...ENTITY_VERTICAL_KEYS,
        ],
        ePath,
        errors
      );
      validateEntityVerticalFields(ent, ePath, maxLayer, errors);
      if (typeof ent.id !== 'string' || !SAFE_ID_REGEX.test(ent.id)) {
        errors.push({
          path: `${ePath}.id`,
          code: 'INVALID_ENTITY_ID',
          message: `Invalid entity id '${String(ent.id)}'.`,
        });
      } else if (entityIds.has(ent.id)) {
        errors.push({
          path: `${ePath}.id`,
          code: 'DUPLICATE_ENTITY_ID',
          message: `Duplicate entity id '${ent.id}'.`,
        });
      } else {
        entityIds.add(ent.id);
      }

      if (
        !isSafeInt(ent.row) ||
        ent.row < 0 ||
        ent.row >= gridSize ||
        !isSafeInt(ent.col) ||
        ent.col < 0 ||
        ent.col >= gridSize
      ) {
        errors.push({
          path: ePath,
          code: 'OUT_OF_RANGE_COORD',
          message: `Entity '${String(ent.id)}' coordinates out of bounds.`,
        });
      }
      if (!isSafeInt(ent.yawBam) || ent.yawBam < 0 || ent.yawBam >= 65536) {
        errors.push({
          path: `${ePath}.yawBam`,
          code: 'INVALID_YAW_BAM',
          message: `Entity '${String(ent.id)}' yawBam must be an integer in [0, 65535].`,
        });
      }
      if (!isSafeInt(ent.scalePct) || ent.scalePct < 1 || ent.scalePct > 500) {
        errors.push({
          path: `${ePath}.scalePct`,
          code: 'INVALID_SCALE',
          message: `Entity '${String(ent.id)}' scalePct must be an integer in [1, 500].`,
        });
      }
      validateEntityPlacement(ent, ePath, gridSize, errors);
      if (
        ent.modelAssetId !== undefined &&
        (typeof ent.modelAssetId !== 'string' || !SAFE_ID_REGEX.test(ent.modelAssetId))
      ) {
        errors.push({
          path: `${ePath}.modelAssetId`,
          code: 'UNREGISTERED_ASSET_ID',
          message: `Entity '${String(ent.id)}' modelAssetId must be a safe asset id.`,
        });
      } else if (ent.modelAssetId !== undefined && !allowedModels.has(ent.modelAssetId)) {
        // The level still loads; the copy shows a stand-in until the model is added back
        warnings.push({
          path: `${ePath}.modelAssetId`,
          code: 'MISSING_MODEL_ASSET',
          message: `Model '${ent.modelAssetId}' used by '${String(
            ent.name ?? ent.id
          )}' is not in this library.`,
        });
      }
    });
  }

  // Regions validation
  const regionIds = new Set<string>();
  if (!Array.isArray(input.regions)) {
    errors.push({
      path: '$.regions',
      code: 'INVALID_REGIONS',
      message: 'regions must be an array.',
    });
  } else {
    input.regions.forEach((reg, idx) => {
      const rPath = `$.regions[${idx}]`;
      if (!isPlainObject(reg)) {
        errors.push({
          path: rPath,
          code: 'INVALID_REGION',
          message: 'Region must be an object.',
        });
        return;
      }
      checkAllowedKeys(reg, ['id', 'name', 'cells'], rPath, errors);
      if (typeof reg.id !== 'string' || !SAFE_ID_REGEX.test(reg.id)) {
        errors.push({
          path: `${rPath}.id`,
          code: 'INVALID_REGION_ID',
          message: 'Invalid region id.',
        });
      } else {
        regionIds.add(reg.id);
      }
      if (!Array.isArray(reg.cells)) {
        errors.push({
          path: `${rPath}.cells`,
          code: 'INVALID_REGION_CELLS',
          message: 'Region cells must be an array.',
        });
      } else {
        reg.cells.forEach((cell, cIdx) => {
          if (
            !isPlainObject(cell) ||
            !isSafeInt(cell.row) ||
            cell.row < 0 ||
            cell.row >= gridSize ||
            !isSafeInt(cell.col) ||
            cell.col < 0 ||
            cell.col >= gridSize
          ) {
            errors.push({
              path: `${rPath}.cells[${cIdx}]`,
              code: 'OUT_OF_RANGE_COORD',
              message: 'Region cell coordinate out of bounds.',
            });
          } else {
            checkAllowedKeys(
              cell,
              ['row', 'col'],
              `${rPath}.cells[${cIdx}]`,
              errors
            );
          }
        });
      }
    });
  }

  // Variables validation
  const declaredFlags = new Set<string>();
  const declaredCounters = new Set<string>();
  const declaredTimers = new Set<string>();

  if (!isPlainObject(input.variables)) {
    errors.push({
      path: '$.variables',
      code: 'INVALID_VARIABLES',
      message: 'variables must be an object with flags, counters, timers.',
    });
  } else {
    checkAllowedKeys(
      input.variables,
      ['flags', 'counters', 'timers'],
      '$.variables',
      errors
    );
    if (!isPlainObject(input.variables.flags)) {
      errors.push({
        path: '$.variables.flags',
        code: 'INVALID_FLAGS',
        message: 'variables.flags must be an object.',
      });
    } else {
      const flagKeys = Object.getOwnPropertyNames(input.variables.flags);
      if (flagKeys.length > SIM_CONFIG.MAX_FLAGS) {
        errors.push({
          path: '$.variables.flags',
          code: 'BUDGET_EXCEEDED',
          message: `Flags count exceeds ${SIM_CONFIG.MAX_FLAGS}.`,
        });
      }
      for (const fk of flagKeys) {
        if (FORBIDDEN_KEYS.has(fk) || !SAFE_ID_REGEX.test(fk)) {
          errors.push({
            path: `$.variables.flags.${fk}`,
            code: 'INVALID_FLAG_NAME',
            message: `Invalid flag name '${fk}'.`,
          });
        } else if (typeof input.variables.flags[fk] !== 'boolean') {
          errors.push({
            path: `$.variables.flags.${fk}`,
            code: 'INVALID_FLAG_VALUE',
            message: `Flag '${fk}' initial value must be boolean.`,
          });
        } else {
          declaredFlags.add(fk);
        }
      }
    }

    if (!isPlainObject(input.variables.counters)) {
      errors.push({
        path: '$.variables.counters',
        code: 'INVALID_COUNTERS',
        message: 'variables.counters must be an object.',
      });
    } else {
      const counterKeys = Object.getOwnPropertyNames(input.variables.counters);
      if (counterKeys.length > SIM_CONFIG.MAX_COUNTERS) {
        errors.push({
          path: '$.variables.counters',
          code: 'BUDGET_EXCEEDED',
          message: `Counters count exceeds ${SIM_CONFIG.MAX_COUNTERS}.`,
        });
      }
      for (const ck of counterKeys) {
        const val = input.variables.counters[ck];
        if (FORBIDDEN_KEYS.has(ck) || !SAFE_ID_REGEX.test(ck)) {
          errors.push({
            path: `$.variables.counters.${ck}`,
            code: 'INVALID_COUNTER_NAME',
            message: `Invalid counter name '${ck}'.`,
          });
        } else if (
          !isSafeInt(val) ||
          val < SIM_CONFIG.COUNTER_MIN ||
          val > SIM_CONFIG.COUNTER_MAX
        ) {
          errors.push({
            path: `$.variables.counters.${ck}`,
            code: 'INVALID_COUNTER_VALUE',
            message: `Counter '${ck}' initial value must be an integer in [${SIM_CONFIG.COUNTER_MIN}, ${SIM_CONFIG.COUNTER_MAX}].`,
          });
        } else {
          declaredCounters.add(ck);
        }
      }
    }

    if (!Array.isArray(input.variables.timers)) {
      errors.push({
        path: '$.variables.timers',
        code: 'INVALID_TIMERS',
        message: 'variables.timers must be an array of timer names.',
      });
    } else {
      if (input.variables.timers.length > SIM_CONFIG.MAX_TIMERS) {
        errors.push({
          path: '$.variables.timers',
          code: 'BUDGET_EXCEEDED',
          message: `Timers count exceeds ${SIM_CONFIG.MAX_TIMERS}.`,
        });
      }
      input.variables.timers.forEach((tName, idx) => {
        if (
          typeof tName !== 'string' ||
          FORBIDDEN_KEYS.has(tName) ||
          !SAFE_ID_REGEX.test(tName)
        ) {
          errors.push({
            path: `$.variables.timers[${idx}]`,
            code: 'INVALID_TIMER_NAME',
            message: `Invalid timer name '${String(tName)}'.`,
          });
        } else {
          declaredTimers.add(tName);
        }
      });
    }
  }

  // Events validation
  const eventIds = new Set<string>();
  const eventsList: EventDefinition[] = [];

  if (!Array.isArray(input.events)) {
    errors.push({
      path: '$.events',
      code: 'INVALID_EVENTS',
      message: 'events must be an array.',
    });
  } else {
    if (input.events.length > SIM_CONFIG.MAX_EVENTS_PER_LEVEL) {
      errors.push({
        path: '$.events',
        code: 'BUDGET_EXCEEDED',
        message: `Events count (${input.events.length}) exceeds MAX_EVENTS_PER_LEVEL (${SIM_CONFIG.MAX_EVENTS_PER_LEVEL}).`,
      });
    }

    // First pass: collect event IDs
    input.events.forEach((evt, idx) => {
      if (isPlainObject(evt) && typeof evt.id === 'string') {
        if (eventIds.has(evt.id)) {
          errors.push({
            path: `$.events[${idx}].id`,
            code: 'DUPLICATE_EVENT_ID',
            message: `Duplicate event id '${evt.id}'.`,
          });
        } else {
          eventIds.add(evt.id);
        }
      }
    });

    // Second pass: full schema check per event
    input.events.forEach((evt, idx) => {
      const evPath = `$.events[${idx}]`;
      if (!isPlainObject(evt)) {
        errors.push({
          path: evPath,
          code: 'INVALID_EVENT',
          message: 'Event must be an object.',
        });
        return;
      }

      checkAllowedKeys(evt, EVENT_KEYS, evPath, errors);

      if (
        typeof evt.id !== 'string' ||
        FORBIDDEN_KEYS.has(evt.id) ||
        !SAFE_ID_REGEX.test(evt.id)
      ) {
        errors.push({
          path: `${evPath}.id`,
          code: 'INVALID_EVENT_ID',
          message: `Invalid event id '${String(evt.id)}'.`,
        });
      }
      if (typeof evt.name !== 'string' || evt.name.trim().length === 0) {
        errors.push({
          path: `${evPath}.name`,
          code: 'INVALID_EVENT_NAME',
          message: 'Event name must be a non-empty string.',
        });
      }
      if (typeof evt.enabled !== 'boolean') {
        errors.push({
          path: `${evPath}.enabled`,
          code: 'INVALID_EVENT_ENABLED',
          message: 'Event enabled must be a boolean.',
        });
      }

      // Options validation
      if (evt.options !== undefined) {
        if (!isPlainObject(evt.options)) {
          errors.push({
            path: `${evPath}.options`,
            code: 'INVALID_EVENT_OPTIONS',
            message: 'Event options must be an object.',
          });
        } else {
          checkAllowedKeys(
            evt.options,
            EVENT_OPTIONS_KEYS,
            `${evPath}.options`,
            errors
          );
          if (
            evt.options.cooldown_ticks !== undefined &&
            (!isSafeInt(evt.options.cooldown_ticks) ||
              evt.options.cooldown_ticks < 0)
          ) {
            errors.push({
              path: `${evPath}.options.cooldown_ticks`,
              code: 'INVALID_COOLDOWN',
              message: 'cooldown_ticks must be a non-negative integer.',
            });
          }
          if (
            evt.options.cooldown_sec !== undefined &&
            (typeof evt.options.cooldown_sec !== 'number' ||
              !Number.isFinite(evt.options.cooldown_sec) ||
              evt.options.cooldown_sec < 0)
          ) {
            errors.push({
              path: `${evPath}.options.cooldown_sec`,
              code: 'INVALID_COOLDOWN',
              message: 'cooldown_sec must be a non-negative number.',
            });
          }
        }
      }

      // Trigger validation
      if (!isPlainObject(evt.trigger)) {
        errors.push({
          path: `${evPath}.trigger`,
          code: 'INVALID_TRIGGER',
          message: 'Event trigger must be an object.',
        });
      } else {
        const trig = evt.trigger;
        const tType = trig.type;
        if (typeof tType !== 'string' || !(tType in TRIGGER_ALLOWED_KEYS)) {
          errors.push({
            path: `${evPath}.trigger.type`,
            code: 'UNKNOWN_TRIGGER_TYPE',
            message: `Unknown trigger type '${String(tType)}'.`,
          });
        } else {
          checkAllowedKeys(
            trig,
            TRIGGER_ALLOWED_KEYS[tType],
            `${evPath}.trigger`,
            errors
          );
          validateTriggerFields(
            trig as unknown as TriggerSpec,
            `${evPath}.trigger`,
            gridSize,
            regionIds,
            declaredFlags,
            declaredCounters,
            declaredTimers,
            errors
          );
        }
      }

      // Conditions validation
      if (!Array.isArray(evt.conditions)) {
        errors.push({
          path: `${evPath}.conditions`,
          code: 'INVALID_CONDITIONS',
          message: 'Event conditions must be an array.',
        });
      } else {
        if (evt.conditions.length > SIM_CONFIG.MAX_CONDITIONS_PER_EVENT) {
          errors.push({
            path: `${evPath}.conditions`,
            code: 'BUDGET_EXCEEDED',
            message: `Event conditions count (${evt.conditions.length}) exceeds cap (${SIM_CONFIG.MAX_CONDITIONS_PER_EVENT}).`,
          });
        }
        evt.conditions.forEach((cond, cIdx) => {
          const cPath = `${evPath}.conditions[${cIdx}]`;
          if (!isPlainObject(cond)) {
            errors.push({
              path: cPath,
              code: 'INVALID_CONDITION',
              message: 'Condition must be an object.',
            });
            return;
          }
          const cType = cond.type;
          if (typeof cType !== 'string' || !(cType in CONDITION_ALLOWED_KEYS)) {
            errors.push({
              path: `${cPath}.type`,
              code: 'UNKNOWN_CONDITION_TYPE',
              message: `Unknown condition type '${String(cType)}'.`,
            });
            return;
          }
          checkAllowedKeys(cond, CONDITION_ALLOWED_KEYS[cType], cPath, errors);
          validateConditionFields(
            cond as unknown as ConditionSpec,
            cPath,
            gridSize,
            declaredFlags,
            declaredCounters,
            errors
          );
        });
      }

      // Actions validation
      if (!Array.isArray(evt.actions) || evt.actions.length === 0) {
        errors.push({
          path: `${evPath}.actions`,
          code: 'INVALID_ACTIONS',
          message: 'Event actions must be a non-empty array.',
        });
      } else {
        if (evt.actions.length > SIM_CONFIG.MAX_ACTIONS_PER_EVENT) {
          errors.push({
            path: `${evPath}.actions`,
            code: 'BUDGET_EXCEEDED',
            message: `Event actions count (${evt.actions.length}) exceeds cap (${SIM_CONFIG.MAX_ACTIONS_PER_EVENT}).`,
          });
        }
        evt.actions.forEach((act, aIdx) => {
          const aPath = `${evPath}.actions[${aIdx}]`;
          if (!isPlainObject(act)) {
            errors.push({
              path: aPath,
              code: 'INVALID_ACTION',
              message: 'Action must be an object.',
            });
            return;
          }
          const aType = act.type;
          if (typeof aType !== 'string' || !(aType in ACTION_ALLOWED_KEYS)) {
            errors.push({
              path: `${aPath}.type`,
              code: 'UNKNOWN_ACTION_TYPE',
              message: `Unknown action type '${String(aType)}'.`,
            });
            return;
          }
          checkAllowedKeys(act, ACTION_ALLOWED_KEYS[aType], aPath, errors);
          validateActionFields(
            act as unknown as ActionSpec,
            aPath,
            gridSize,
            Array.isArray(grid) ? (grid as number[][]) : undefined,
            eventIds,
            declaredFlags,
            declaredCounters,
            declaredTimers,
            allowedTextures,
            allowedSounds,
            errors,
            regionIds
          );
        });
      }

      eventsList.push(evt as unknown as EventDefinition);
    });

    // Static cycle detection across `fire_event` / `trigger_event`
    if (!options.skipStaticCycleCheck && errors.length === 0) {
      detectStaticEventCycles(eventsList, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validateTriggerFields(
  trig: TriggerSpec,
  path: string,
  gridSize: number,
  regionIds: Set<string>,
  declaredFlags: Set<string>,
  declaredCounters: Set<string>,
  declaredTimers: Set<string>,
  errors: ValidationErrorItem[]
): void {
  switch (trig.type) {
    case 'enter_cell':
    case 'leave_cell': {
      if (
        !isSafeInt(trig.row) ||
        trig.row < 0 ||
        trig.row >= gridSize ||
        !isSafeInt(trig.col) ||
        trig.col < 0 ||
        trig.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: `Trigger ${trig.type} row/col out of grid bounds.`,
        });
      }
      break;
    }
    case 'enter_region':
    case 'leave_region': {
      if (typeof trig.region !== 'string' || !regionIds.has(trig.region)) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `Trigger references undeclared region '${String(trig.region)}'.`,
        });
      }
      break;
    }
    case 'use':
    case 'shoot':
    case 'pickup_item':
    case 'mover_finished': {
      if (trig.row !== undefined || trig.col !== undefined) {
        if (
          !isSafeInt(trig.row) ||
          trig.row < 0 ||
          trig.row >= gridSize ||
          !isSafeInt(trig.col) ||
          trig.col < 0 ||
          trig.col >= gridSize
        ) {
          errors.push({
            path,
            code: 'OUT_OF_RANGE_COORD',
            message: `Trigger ${trig.type} row/col out of grid bounds.`,
          });
        }
      }
      break;
    }
    case 'timer_fired': {
      if (typeof trig.timer !== 'string' || !declaredTimers.has(trig.timer)) {
        errors.push({
          path: `${path}.timer`,
          code: 'UNKNOWN_TIMER',
          message: `Trigger references undeclared timer '${String(trig.timer)}'.`,
        });
      }
      break;
    }
    case 'flag_changed': {
      if (typeof trig.name !== 'string' || !declaredFlags.has(trig.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_FLAG',
          message: `Trigger references undeclared flag '${String(trig.name)}'.`,
        });
      }
      break;
    }
    case 'counter_reached': {
      if (typeof trig.name !== 'string' || !declaredCounters.has(trig.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_COUNTER',
          message: `Trigger references undeclared counter '${String(trig.name)}'.`,
        });
      }
      if (!isSafeInt(trig.value)) {
        errors.push({
          path: `${path}.value`,
          code: 'INVALID_COUNTER_VALUE',
          message: 'counter_reached value must be an integer.',
        });
      }
      break;
    }
    case 'stand_in_region': {
      if (typeof trig.region !== 'string' || !regionIds.has(trig.region)) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `Trigger references undeclared region '${String(trig.region)}'.`,
        });
      }
      const hasTicks =
        trig.dwell_ticks !== undefined &&
        isSafeInt(trig.dwell_ticks) &&
        trig.dwell_ticks >= 1;
      const hasSec =
        trig.dwell_sec !== undefined &&
        typeof trig.dwell_sec === 'number' &&
        Number.isFinite(trig.dwell_sec) &&
        trig.dwell_sec > 0;
      if (!hasTicks && !hasSec) {
        errors.push({
          path,
          code: 'INVALID_DWELL_TIME',
          message:
            'stand_in_region trigger requires a positive dwell_ticks or dwell_sec.',
        });
      }
      break;
    }
    case 'level_start':
      break;
  }
}

function validateConditionFields(
  cond: ConditionSpec,
  path: string,
  gridSize: number,
  declaredFlags: Set<string>,
  declaredCounters: Set<string>,
  errors: ValidationErrorItem[]
): void {
  switch (cond.type) {
    case 'flag': {
      if (typeof cond.name !== 'string' || !declaredFlags.has(cond.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_FLAG',
          message: `Condition references undeclared flag '${String(cond.name)}'.`,
        });
      }
      if (typeof cond.is !== 'boolean') {
        errors.push({
          path: `${path}.is`,
          code: 'INVALID_CONDITION_VALUE',
          message: 'Flag condition `is` must be boolean.',
        });
      }
      break;
    }
    case 'counter': {
      if (typeof cond.name !== 'string' || !declaredCounters.has(cond.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_COUNTER',
          message: `Condition references undeclared counter '${String(cond.name)}'.`,
        });
      }
      if (
        !isSafeInt(cond.value) ||
        cond.value < SIM_CONFIG.COUNTER_MIN ||
        cond.value > SIM_CONFIG.COUNTER_MAX
      ) {
        errors.push({
          path: `${path}.value`,
          code: 'INVALID_COUNTER_VALUE',
          message: 'Counter condition value out of range.',
        });
      }
      break;
    }
    case 'has_item': {
      if (typeof cond.item !== 'string' || !SAFE_ID_REGEX.test(cond.item)) {
        errors.push({
          path: `${path}.item`,
          code: 'INVALID_ITEM_ID',
          message: `Invalid item ID '${String(cond.item)}'.`,
        });
      }
      break;
    }
    case 'player_health':
    case 'player_ammo': {
      if (!isSafeInt(cond.value) || cond.value < 0 || cond.value > 10000) {
        errors.push({
          path: `${path}.value`,
          code: 'INVALID_CONDITION_VALUE',
          message: `${cond.type} value must be an integer in [0, 10000].`,
        });
      }
      break;
    }
    case 'mover_state': {
      if (cond.row !== undefined || cond.col !== undefined) {
        if (
          !isSafeInt(cond.row) ||
          cond.row < 0 ||
          cond.row >= gridSize ||
          !isSafeInt(cond.col) ||
          cond.col < 0 ||
          cond.col >= gridSize
        ) {
          errors.push({
            path,
            code: 'OUT_OF_RANGE_COORD',
            message: 'mover_state row/col out of bounds.',
          });
        }
      }
      break;
    }
    case 'chance': {
      if (!isSafeInt(cond.percent) || cond.percent < 0 || cond.percent > 100) {
        errors.push({
          path: `${path}.percent`,
          code: 'INVALID_CHANCE_PERCENT',
          message: 'chance.percent must be an integer between 0 and 100.',
        });
      }
      break;
    }
  }
}

function validateActionFields(
  act: ActionSpec,
  path: string,
  gridSize: number,
  grid: number[][] | undefined,
  eventIds: Set<string>,
  declaredFlags: Set<string>,
  declaredCounters: Set<string>,
  declaredTimers: Set<string>,
  allowedTextures: ReadonlySet<string>,
  allowedSounds: ReadonlySet<string>,
  errors: ValidationErrorItem[],
  regionIds?: Set<string>
): void {
  switch (act.type) {
    case 'open_door':
    case 'close_door':
    case 'toggle_door':
    case 'lock_door':
    case 'unlock_door': {
      const hasCoords = act.row !== undefined || act.col !== undefined;
      const hasTag = act.tag !== undefined && act.tag > 0;
      if (!hasCoords && !hasTag) {
        errors.push({
          path,
          code: 'MISSING_DOOR_TARGET',
          message: `Action '${act.type}' must specify either (row, col) or a non-zero tag.`,
        });
        return;
      }
      if (hasCoords) {
        if (
          !isSafeInt(act.row) ||
          act.row < 0 ||
          act.row >= gridSize ||
          !isSafeInt(act.col) ||
          act.col < 0 ||
          act.col >= gridSize
        ) {
          errors.push({
            path,
            code: 'OUT_OF_RANGE_COORD',
            message: `Action '${act.type}' target (${String(act.row)}, ${String(act.col)}) is out of grid bounds.`,
          });
          return;
        }
        if (grid && grid[act.row]?.[act.col] !== SimCellType.DOOR) {
          errors.push({
            path,
            code: 'TARGET_NOT_A_DOOR',
            message: `Action '${act.type}' targets cell (${act.row}, ${act.col}) which is not a door (cell type=${String(
              grid[act.row]?.[act.col]
            )}).`,
          });
        }
      }
      break;
    }
    case 'slide_wall': {
      if (
        !isSafeInt(act.row) ||
        act.row < 0 ||
        act.row >= gridSize ||
        !isSafeInt(act.col) ||
        act.col < 0 ||
        act.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: 'slide_wall target coordinates out of bounds.',
        });
        return;
      }
      if (grid && grid[act.row]?.[act.col] !== SimCellType.WALL) {
        errors.push({
          path,
          code: 'TARGET_NOT_A_WALL',
          message: `slide_wall targets cell (${act.row}, ${act.col}) which is not a solid wall.`,
        });
      }
      if (!['N', 'S', 'E', 'W'].includes(act.direction)) {
        errors.push({
          path: `${path}.direction`,
          code: 'INVALID_DIRECTION',
          message: 'slide_wall direction must be N, S, E, or W.',
        });
      }
      break;
    }
    case 'lower_floor':
    case 'raise_floor':
    case 'toggle_lift':
    case 'start_crusher': {
      const hasCoords = act.row !== undefined || act.col !== undefined;
      const hasTag = act.tag !== undefined && act.tag > 0;
      if (!hasCoords && !hasTag) {
        errors.push({
          path,
          code: 'MISSING_MOVER_TARGET',
          message: `Action '${act.type}' must specify either (row, col) or a non-zero tag.`,
        });
      }
      if (hasCoords) {
        if (
          !isSafeInt(act.row) ||
          act.row < 0 ||
          act.row >= gridSize ||
          !isSafeInt(act.col) ||
          act.col < 0 ||
          act.col >= gridSize
        ) {
          errors.push({
            path,
            code: 'OUT_OF_RANGE_COORD',
            message: `Action '${act.type}' target coordinates out of bounds.`,
          });
        }
      }
      break;
    }
    case 'stop_crusher': {
      const hasCoords = act.row !== undefined || act.col !== undefined;
      const hasTag = act.tag !== undefined && act.tag > 0;
      if (!hasCoords && !hasTag) {
        errors.push({
          path,
          code: 'MISSING_MOVER_TARGET',
          message: `Action '${act.type}' must specify either (row, col) or a non-zero tag.`,
        });
      }
      break;
    }
    case 'build_stairs': {
      if (act.tag === undefined || act.tag <= 0) {
        errors.push({
          path,
          code: 'MISSING_TAG',
          message: 'build_stairs requires a positive tag.',
        });
      }
      break;
    }
    case 'wake_entities': {
      if ((act.tag === undefined || act.tag <= 0) && !act.region) {
        errors.push({
          path,
          code: 'MISSING_TARGET',
          message: 'wake_entities requires either a tag or a region.',
        });
      }
      break;
    }
    case 'spawn_entity': {
      if (
        !isSafeInt(act.row) ||
        act.row < 0 ||
        act.row >= gridSize ||
        !isSafeInt(act.col) ||
        act.col < 0 ||
        act.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: 'spawn_entity coordinates out of bounds.',
        });
      }
      break;
    }
    case 'remove_entity': {
      if (!act.entityId && (act.tag === undefined || act.tag <= 0)) {
        errors.push({
          path,
          code: 'MISSING_ENTITY_TARGET',
          message: 'remove_entity requires either entityId or tag.',
        });
      }
      break;
    }
    case 'damage_entity': {
      if (!act.entityId && (act.tag === undefined || act.tag <= 0)) {
        errors.push({
          path,
          code: 'MISSING_ENTITY_TARGET',
          message: 'damage_entity requires either entityId or tag.',
        });
      }
      if (!isSafeInt(act.amount) || act.amount <= 0) {
        errors.push({
          path: `${path}.amount`,
          code: 'INVALID_AMOUNT',
          message: 'damage_entity amount must be a positive integer.',
        });
      }
      break;
    }
    case 'set_cell': {
      if (
        !isSafeInt(act.row) ||
        act.row < 0 ||
        act.row >= gridSize ||
        !isSafeInt(act.col) ||
        act.col < 0 ||
        act.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: 'set_cell coordinates out of bounds.',
        });
      }
      if (
        !isSafeInt(act.cell_type) ||
        act.cell_type < 0 ||
        act.cell_type > 3
      ) {
        errors.push({
          path: `${path}.cell_type`,
          code: 'INVALID_CELL_TYPE',
          message: 'set_cell cell_type must be 0, 1, 2, or 3.',
        });
      }
      break;
    }
    case 'set_wall_texture':
    case 'set_floor_texture':
    case 'set_ceiling_texture': {
      if (
        !isSafeInt(act.row) ||
        act.row < 0 ||
        act.row >= gridSize ||
        !isSafeInt(act.col) ||
        act.col < 0 ||
        act.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: `${act.type} coordinates out of bounds.`,
        });
      }
      if (
        typeof act.texture_id !== 'string' ||
        !SAFE_ID_REGEX.test(act.texture_id) ||
        !allowedTextures.has(act.texture_id)
      ) {
        errors.push({
          path: `${path}.texture_id`,
          code: 'UNREGISTERED_ASSET_ID',
          message: `${act.type} references unregistered texture_id '${String(act.texture_id)}'.`,
        });
      }
      break;
    }
    case 'give_item':
    case 'take_item': {
      if (typeof act.item !== 'string' || !SAFE_ID_REGEX.test(act.item)) {
        errors.push({
          path: `${path}.item`,
          code: 'INVALID_ITEM_ID',
          message: `Invalid item id '${String(act.item)}'.`,
        });
      }
      if (
        act.amount !== undefined &&
        (!isSafeInt(act.amount) || act.amount < 1 || act.amount > 999)
      ) {
        errors.push({
          path: `${path}.amount`,
          code: 'INVALID_AMOUNT',
          message: 'Item amount must be an integer in [1, 999].',
        });
      }
      break;
    }
    case 'heal_player':
    case 'damage_player': {
      if (!isSafeInt(act.amount) || act.amount < 1 || act.amount > 1000) {
        errors.push({
          path: `${path}.amount`,
          code: 'INVALID_AMOUNT',
          message: `${act.type} amount must be an integer in [1, 1000].`,
        });
      }
      break;
    }
    case 'teleport_player': {
      if (
        !isSafeInt(act.row) ||
        act.row < 0 ||
        act.row >= gridSize ||
        !isSafeInt(act.col) ||
        act.col < 0 ||
        act.col >= gridSize
      ) {
        errors.push({
          path,
          code: 'OUT_OF_RANGE_COORD',
          message: 'teleport_player target row/col out of bounds.',
        });
      }
      break;
    }
    case 'set_flag': {
      if (typeof act.name !== 'string' || !declaredFlags.has(act.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_FLAG',
          message: `set_flag references undeclared flag '${String(act.name)}'.`,
        });
      }
      if (typeof act.value !== 'boolean') {
        errors.push({
          path: `${path}.value`,
          code: 'INVALID_FLAG_VALUE',
          message: 'set_flag value must be boolean.',
        });
      }
      break;
    }
    case 'toggle_flag': {
      if (typeof act.name !== 'string' || !declaredFlags.has(act.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_FLAG',
          message: `toggle_flag references undeclared flag '${String(act.name)}'.`,
        });
      }
      break;
    }
    case 'set_counter': {
      if (typeof act.name !== 'string' || !declaredCounters.has(act.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_COUNTER',
          message: `set_counter references undeclared counter '${String(act.name)}'.`,
        });
      }
      if (
        !isSafeInt(act.value) ||
        act.value < SIM_CONFIG.COUNTER_MIN ||
        act.value > SIM_CONFIG.COUNTER_MAX
      ) {
        errors.push({
          path: `${path}.value`,
          code: 'INVALID_COUNTER_VALUE',
          message: 'set_counter value out of range.',
        });
      }
      break;
    }
    case 'add_counter': {
      if (typeof act.name !== 'string' || !declaredCounters.has(act.name)) {
        errors.push({
          path: `${path}.name`,
          code: 'UNKNOWN_COUNTER',
          message: `add_counter references undeclared counter '${String(act.name)}'.`,
        });
      }
      if (
        !isSafeInt(act.delta) ||
        act.delta < SIM_CONFIG.COUNTER_MIN ||
        act.delta > SIM_CONFIG.COUNTER_MAX
      ) {
        errors.push({
          path: `${path}.delta`,
          code: 'INVALID_COUNTER_VALUE',
          message: 'add_counter delta out of range.',
        });
      }
      break;
    }
    case 'start_timer':
    case 'stop_timer': {
      if (typeof act.timer !== 'string' || !declaredTimers.has(act.timer)) {
        errors.push({
          path: `${path}.timer`,
          code: 'UNKNOWN_TIMER',
          message: `${act.type} references undeclared timer '${String(act.timer)}'.`,
        });
      }
      if (act.type === 'start_timer') {
        const hasTicks =
          act.duration_ticks !== undefined &&
          isSafeInt(act.duration_ticks) &&
          act.duration_ticks >= 1;
        const hasSec =
          act.duration_sec !== undefined &&
          typeof act.duration_sec === 'number' &&
          Number.isFinite(act.duration_sec) &&
          act.duration_sec > 0;
        if (!hasTicks && !hasSec) {
          errors.push({
            path,
            code: 'INVALID_DURATION',
            message:
              'start_timer requires a positive integer duration_ticks or positive duration_sec.',
          });
        }
      }
      break;
    }
    case 'delay': {
      const hasTicks =
        act.delay_ticks !== undefined &&
        isSafeInt(act.delay_ticks) &&
        act.delay_ticks >= 1 &&
        act.delay_ticks <= 36000;
      const hasSec =
        act.delay_sec !== undefined &&
        typeof act.delay_sec === 'number' &&
        Number.isFinite(act.delay_sec) &&
        act.delay_sec > 0 &&
        act.delay_sec <= 1200;
      if (!hasTicks && !hasSec) {
        errors.push({
          path,
          code: 'INVALID_DELAY',
          message:
            'delay action requires a positive integer delay_ticks or positive delay_sec.',
        });
      }
      break;
    }
    case 'fire_event':
    case 'trigger_event':
    case 'enable_event':
    case 'disable_event':
    case 'reset_event_once': {
      if (typeof act.event_id !== 'string' || !eventIds.has(act.event_id)) {
        errors.push({
          path: `${path}.event_id`,
          code: 'UNKNOWN_EVENT_ID',
          message: `${act.type} references non-existent event_id '${String(act.event_id)}'.`,
        });
      }
      break;
    }
    case 'show_message': {
      if (
        typeof act.text !== 'string' ||
        act.text.length === 0 ||
        act.text.length > SIM_CONFIG.MAX_MESSAGE_LENGTH
      ) {
        errors.push({
          path: `${path}.text`,
          code: 'INVALID_MESSAGE_TEXT',
          message: `show_message text must be 1..${SIM_CONFIG.MAX_MESSAGE_LENGTH} characters.`,
        });
      }
      break;
    }
    case 'play_sound': {
      if (
        typeof act.sound_id !== 'string' ||
        !SAFE_ID_REGEX.test(act.sound_id) ||
        !allowedSounds.has(act.sound_id)
      ) {
        errors.push({
          path: `${path}.sound_id`,
          code: 'UNREGISTERED_ASSET_ID',
          message: `play_sound references unregistered sound_id '${String(act.sound_id)}'.`,
        });
      }
      break;
    }
    case 'mark_secret_found':
    case 'exit_level':
      break;
    case 'earthquake': {
      const hasTicks =
        act.duration_ticks !== undefined &&
        isSafeInt(act.duration_ticks) &&
        act.duration_ticks >= 1;
      const hasSec =
        act.duration_sec !== undefined &&
        typeof act.duration_sec === 'number' &&
        Number.isFinite(act.duration_sec) &&
        act.duration_sec > 0;
      if (!hasTicks && !hasSec) {
        errors.push({
          path,
          code: 'INVALID_DURATION',
          message:
            'earthquake requires a positive integer duration_ticks or positive duration_sec.',
        });
      }
      if (
        act.intensity !== undefined &&
        (!isSafeInt(act.intensity) || act.intensity < 1 || act.intensity > 1000)
      ) {
        errors.push({
          path: `${path}.intensity`,
          code: 'INVALID_INTENSITY',
          message: 'earthquake intensity must be an integer in [1, 1000].',
        });
      }
      break;
    }
    case 'set_light_effect': {
      const allowedEffects = ['flicker', 'strobe', 'pulse', 'glow'];
      if (!allowedEffects.includes(act.effect)) {
        errors.push({
          path: `${path}.effect`,
          code: 'INVALID_LIGHT_EFFECT',
          message: `Light effect must be one of ${allowedEffects.join(', ')}.`,
        });
      }
      if (!act.region && (act.tag === undefined || act.tag <= 0)) {
        errors.push({
          path,
          code: 'MISSING_TARGET',
          message:
            'set_light_effect requires either a region or a positive tag.',
        });
      }
      if (act.region && regionIds && !regionIds.has(act.region)) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `set_light_effect references unknown region '${act.region}'.`,
        });
      }
      if (
        act.speed_ticks !== undefined &&
        (!isSafeInt(act.speed_ticks) || act.speed_ticks < 1)
      ) {
        errors.push({
          path: `${path}.speed_ticks`,
          code: 'INVALID_SPEED_TICKS',
          message: 'speed_ticks must be a positive integer.',
        });
      }
      break;
    }
    case 'stop_light_effect': {
      if (!act.region && (act.tag === undefined || act.tag <= 0)) {
        errors.push({
          path,
          code: 'MISSING_TARGET',
          message:
            'stop_light_effect requires either a region or a positive tag.',
        });
      }
      if (act.region && regionIds && !regionIds.has(act.region)) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `stop_light_effect references unknown region '${act.region}'.`,
        });
      }
      break;
    }
    case 'set_hazard_region': {
      if (!act.region || (regionIds && !regionIds.has(act.region))) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `set_hazard_region references unknown region '${act.region}'.`,
        });
      }
      if (!isSafeInt(act.damage_per_interval) || act.damage_per_interval < 0) {
        errors.push({
          path: `${path}.damage_per_interval`,
          code: 'INVALID_HAZARD_DAMAGE',
          message: 'damage_per_interval must be a non-negative integer.',
        });
      }
      if (!isSafeInt(act.interval_ticks) || act.interval_ticks < 1) {
        errors.push({
          path: `${path}.interval_ticks`,
          code: 'INVALID_HAZARD_INTERVAL',
          message: 'interval_ticks must be a positive integer.',
        });
      }
      break;
    }
    case 'clear_hazard_region': {
      if (!act.region || (regionIds && !regionIds.has(act.region))) {
        errors.push({
          path: `${path}.region`,
          code: 'UNKNOWN_REGION',
          message: `clear_hazard_region references unknown region '${act.region}'.`,
        });
      }
      break;
    }
    case 'if_then_else': {
      if (!isPlainObject(act.condition)) {
        errors.push({
          path: `${path}.condition`,
          code: 'INVALID_CONDITION',
          message: 'if_then_else condition must be an object.',
        });
      } else {
        const cType = act.condition.type;
        if (typeof cType !== 'string' || !(cType in CONDITION_ALLOWED_KEYS)) {
          errors.push({
            path: `${path}.condition.type`,
            code: 'UNKNOWN_CONDITION_TYPE',
            message: `Unknown condition type '${String(cType)}'.`,
          });
        } else {
          checkAllowedKeys(
            act.condition,
            CONDITION_ALLOWED_KEYS[cType],
            `${path}.condition`,
            errors
          );
          validateConditionFields(
            act.condition as unknown as ConditionSpec,
            `${path}.condition`,
            gridSize,
            declaredFlags,
            declaredCounters,
            errors
          );
        }
      }
      if (!Array.isArray(act.then_actions) || act.then_actions.length === 0) {
        errors.push({
          path: `${path}.then_actions`,
          code: 'INVALID_ACTIONS',
          message: 'then_actions must be a non-empty array.',
        });
      } else {
        act.then_actions.forEach((subAct, idx) => {
          const subPath = `${path}.then_actions[${idx}]`;
          if (!isPlainObject(subAct)) {
            errors.push({
              path: subPath,
              code: 'INVALID_ACTION',
              message: 'Action must be an object.',
            });
            return;
          }
          const sType = subAct.type;
          if (typeof sType !== 'string' || !(sType in ACTION_ALLOWED_KEYS)) {
            errors.push({
              path: `${subPath}.type`,
              code: 'UNKNOWN_ACTION_TYPE',
              message: `Unknown action type '${String(sType)}'.`,
            });
            return;
          }
          checkAllowedKeys(subAct, ACTION_ALLOWED_KEYS[sType], subPath, errors);
          validateActionFields(
            subAct as unknown as ActionSpec,
            subPath,
            gridSize,
            grid,
            eventIds,
            declaredFlags,
            declaredCounters,
            declaredTimers,
            allowedTextures,
            allowedSounds,
            errors,
            regionIds
          );
        });
      }
      if (act.else_actions !== undefined) {
        if (!Array.isArray(act.else_actions)) {
          errors.push({
            path: `${path}.else_actions`,
            code: 'INVALID_ACTIONS',
            message: 'else_actions must be an array.',
          });
        } else {
          act.else_actions.forEach((subAct, idx) => {
            const subPath = `${path}.else_actions[${idx}]`;
            if (!isPlainObject(subAct)) {
              errors.push({
                path: subPath,
                code: 'INVALID_ACTION',
                message: 'Action must be an object.',
              });
              return;
            }
            const sType = subAct.type;
            if (typeof sType !== 'string' || !(sType in ACTION_ALLOWED_KEYS)) {
              errors.push({
                path: `${subPath}.type`,
                code: 'UNKNOWN_ACTION_TYPE',
                message: `Unknown action type '${String(sType)}'.`,
              });
              return;
            }
            checkAllowedKeys(
              subAct,
              ACTION_ALLOWED_KEYS[sType],
              subPath,
              errors
            );
            validateActionFields(
              subAct as unknown as ActionSpec,
              subPath,
              gridSize,
              grid,
              eventIds,
              declaredFlags,
              declaredCounters,
              declaredTimers,
              allowedTextures,
              allowedSounds,
              errors,
              regionIds
            );
          });
        }
      }
      break;
    }
    case 'random_branch': {
      if (!Array.isArray(act.branches) || act.branches.length === 0) {
        errors.push({
          path: `${path}.branches`,
          code: 'INVALID_BRANCHES',
          message: 'random_branch branches must be a non-empty array.',
        });
      } else {
        act.branches.forEach((branch, bIdx) => {
          const bPath = `${path}.branches[${bIdx}]`;
          if (!isPlainObject(branch)) {
            errors.push({
              path: bPath,
              code: 'INVALID_BRANCH',
              message: 'Branch must be an object.',
            });
            return;
          }
          checkAllowedKeys(branch, ['weight', 'actions'], bPath, errors);
          if (!isSafeInt(branch.weight) || branch.weight < 1) {
            errors.push({
              path: `${bPath}.weight`,
              code: 'INVALID_BRANCH_WEIGHT',
              message: 'Branch weight must be an integer >= 1.',
            });
          }
          if (!Array.isArray(branch.actions) || branch.actions.length === 0) {
            errors.push({
              path: `${bPath}.actions`,
              code: 'INVALID_ACTIONS',
              message: 'Branch actions must be a non-empty array.',
            });
          } else {
            branch.actions.forEach((subAct, idx) => {
              const subPath = `${bPath}.actions[${idx}]`;
              if (!isPlainObject(subAct)) {
                errors.push({
                  path: subPath,
                  code: 'INVALID_ACTION',
                  message: 'Action must be an object.',
                });
                return;
              }
              const sType = subAct.type;
              if (typeof sType !== 'string' || !(sType in ACTION_ALLOWED_KEYS)) {
                errors.push({
                  path: `${subPath}.type`,
                  code: 'UNKNOWN_ACTION_TYPE',
                  message: `Unknown action type '${String(sType)}'.`,
                });
                return;
              }
              checkAllowedKeys(
                subAct,
                ACTION_ALLOWED_KEYS[sType],
                subPath,
                errors
              );
              validateActionFields(
                subAct as unknown as ActionSpec,
                subPath,
                gridSize,
                grid,
                eventIds,
                declaredFlags,
                declaredCounters,
                declaredTimers,
                allowedTextures,
                allowedSounds,
                errors,
                regionIds
              );
            });
          }
        });
      }
      break;
    }
    case 'move_along_track': {
      if (act.tag === undefined || act.tag <= 0) {
        errors.push({
          path: `${path}.tag`,
          code: 'MISSING_TAG',
          message: 'move_along_track requires a positive integer tag.',
        });
      }
      if (!Array.isArray(act.waypoints) || act.waypoints.length < 2) {
        errors.push({
          path: `${path}.waypoints`,
          code: 'INVALID_WAYPOINTS',
          message: 'move_along_track requires at least 2 waypoints.',
        });
      } else {
        act.waypoints.forEach((wp, wIdx) => {
          const wPath = `${path}.waypoints[${wIdx}]`;
          if (!isPlainObject(wp)) {
            errors.push({
              path: wPath,
              code: 'INVALID_WAYPOINT',
              message: 'Waypoint must be an object.',
            });
            return;
          }
          checkAllowedKeys(
            wp,
            [
              'row',
              'col',
              'floorHeightUnits',
              'ceilingHeightUnits',
              'waitTicks',
            ],
            wPath,
            errors
          );
          if (
            !isSafeInt(wp.row) ||
            wp.row < 0 ||
            wp.row >= gridSize ||
            !isSafeInt(wp.col) ||
            wp.col < 0 ||
            wp.col >= gridSize
          ) {
            errors.push({
              path: wPath,
              code: 'OUT_OF_RANGE_COORD',
              message: 'Waypoint row/col out of bounds.',
            });
          }
        });
      }
      if (
        act.speed_per_tick !== undefined &&
        (!isSafeInt(act.speed_per_tick) || act.speed_per_tick < 1)
      ) {
        errors.push({
          path: `${path}.speed_per_tick`,
          code: 'INVALID_SPEED_PER_TICK',
          message: 'speed_per_tick must be a positive integer.',
        });
      }
      break;
    }
  }
}

/**
 * Static cycle check on immediate synchronous `fire_event` / `trigger_event` edges
 * that occur BEFORE any `delay` action and on events without `once: true` / `fire: 'once'`.
 */
function detectStaticEventCycles(
  events: EventDefinition[],
  errors: ValidationErrorItem[]
): void {
  const eventMap = new Map<string, EventDefinition>();
  for (const evt of events) {
    eventMap.set(evt.id, evt);
  }

  const isOnceEvent = (evt: EventDefinition): boolean =>
    evt.options?.once === true || evt.options?.fire === 'once';

  // Build adjacency of synchronous (pre-delay) fire_event / trigger_event calls
  const syncEdges = new Map<string, string[]>();
  for (const evt of events) {
    const targets: string[] = [];
    for (const act of evt.actions) {
      if (act.type === 'delay') {
        break; // Actions after a delay run on a future tick via continuation queue
      }
      if (act.type === 'fire_event' || act.type === 'trigger_event') {
        targets.push(act.event_id);
      }
    }
    syncEdges.set(evt.id, targets);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (currentId: string, chain: string[]): void => {
    visited.add(currentId);
    inStack.add(currentId);

    const neighbors = syncEdges.get(currentId) || [];
    for (const nextId of neighbors) {
      const nextEvt = eventMap.get(nextId);
      if (!nextEvt) continue;

      if (inStack.has(nextId)) {
        // Check if any node in the cycle has a `once` guard
        const cycleStartIdx = chain.indexOf(nextId);
        const cycleNodes = chain.slice(cycleStartIdx);
        const hasOnceGuard = cycleNodes.some((nid) => {
          const e = eventMap.get(nid);
          return e ? isOnceEvent(e) : false;
        });

        if (!hasOnceGuard) {
          errors.push({
            path: `$.events`,
            code: 'EVENT_CYCLE_DETECTED',
            message: `Unguarded synchronous event cycle detected: ${[
              ...cycleNodes,
              nextId,
            ].join(' -> ')}. Add a delay or once guard.`,
          });
        }
      } else if (!visited.has(nextId)) {
        dfs(nextId, [...chain, nextId]);
      }
    }

    inStack.delete(currentId);
  };

  for (const evt of events) {
    if (!visited.has(evt.id)) {
      dfs(evt.id, [evt.id]);
    }
  }
}

/**
 * Validates an untrusted saved `SimulationState` snapshot before loading/resuming.
 * Enforces Constraint 5 (no floats) and Constraint 8 (valid continuations, bounds, caps).
 */
export function validateSimulationState(
  input: unknown,
  rawJsonString?: string
): ValidationResult {
  const errors: ValidationErrorItem[] = [];
  const warnings: ValidationErrorItem[] = [];

  const rawDangerous = hasRawDangerousKeys(rawJsonString);
  if (rawDangerous) {
    errors.push({
      path: '$',
      code: 'FORBIDDEN_KEY',
      message: `Saved state contains forbidden key '${rawDangerous}'.`,
    });
    return { valid: false, errors, warnings };
  }

  if (!isPlainObject(input)) {
    errors.push({
      path: '$',
      code: 'INVALID_STATE_ROOT',
      message: 'SimulationState must be a plain object.',
    });
    return { valid: false, errors, warnings };
  }

  // 1. Float check across the entire state tree
  const floatPaths = findFloatPaths(input);
  if (floatPaths.length > 0) {
    errors.push({
      path: floatPaths[0],
      code: 'FLOAT_IN_SIMULATION_STATE',
      message: `SimulationState must be integer-only; found non-integers at: ${floatPaths.join(
        ', '
      )}`,
    });
  }

  if (input.formatVersion !== 1) {
    errors.push({
      path: '$.formatVersion',
      code: 'INVALID_FORMAT_VERSION',
      message: `Expected SimulationState formatVersion 1, got ${String(
        input.formatVersion
      )}.`,
    });
  }

  if (!isSafeInt(input.tick) || input.tick < 0) {
    errors.push({
      path: '$.tick',
      code: 'INVALID_TICK',
      message: 'tick must be a non-negative integer.',
    });
  }

  if (
    !isSafeInt(input.rngState) ||
    input.rngState < 0 ||
    input.rngState > 0xffffffff
  ) {
    errors.push({
      path: '$.rngState',
      code: 'INVALID_RNG_STATE',
      message: 'rngState must be an unsigned 32-bit integer.',
    });
  }

  const eventMap = new Map<string, EventDefinition>();
  if (!Array.isArray(input.events)) {
    errors.push({
      path: '$.events',
      code: 'INVALID_EVENTS',
      message: 'state.events must be an array.',
    });
  } else {
    for (const evt of input.events) {
      if (isPlainObject(evt) && typeof evt.id === 'string') {
        eventMap.set(evt.id, evt as unknown as EventDefinition);
      }
    }
  }

  // Validate pendingContinuations
  if (!Array.isArray(input.pendingContinuations)) {
    errors.push({
      path: '$.pendingContinuations',
      code: 'INVALID_CONTINUATIONS',
      message: 'pendingContinuations must be an array.',
    });
  } else {
    if (
      input.pendingContinuations.length > SIM_CONFIG.MAX_PENDING_CONTINUATIONS
    ) {
      errors.push({
        path: '$.pendingContinuations',
        code: 'CONTINUATION_CAP_EXCEEDED',
        message: `pendingContinuations count (${input.pendingContinuations.length}) exceeds MAX_PENDING_CONTINUATIONS (${SIM_CONFIG.MAX_PENDING_CONTINUATIONS}).`,
      });
    }

    input.pendingContinuations.forEach((cont, idx) => {
      const cPath = `$.pendingContinuations[${idx}]`;
      if (!isPlainObject(cont)) {
        errors.push({
          path: cPath,
          code: 'INVALID_CONTINUATION',
          message: 'Continuation must be an object.',
        });
        return;
      }
      checkAllowedKeys(
        cont,
        [
          'id',
          'eventId',
          'nextActionIndex',
          'remainingTicks',
          'activator',
          'depth',
        ],
        cPath,
        errors
      );

      const targetEvent =
        typeof cont.eventId === 'string'
          ? eventMap.get(cont.eventId)
          : undefined;
      if (!targetEvent) {
        errors.push({
          path: `${cPath}.eventId`,
          code: 'UNKNOWN_CONTINUATION_EVENT_ID',
          message: `Continuation references unknown eventId '${String(
            cont.eventId
          )}'.`,
        });
      } else {
        if (
          !isSafeInt(cont.nextActionIndex) ||
          cont.nextActionIndex < 0 ||
          cont.nextActionIndex >= targetEvent.actions.length
        ) {
          errors.push({
            path: `${cPath}.nextActionIndex`,
            code: 'CONTINUATION_ACTION_INDEX_OUT_OF_RANGE',
            message: `Continuation nextActionIndex (${String(
              cont.nextActionIndex
            )}) is out of range for event '${targetEvent.id}' (actions length=${
              targetEvent.actions.length
            }).`,
          });
        }
      }

      if (!isSafeInt(cont.remainingTicks) || cont.remainingTicks < 1) {
        errors.push({
          path: `${cPath}.remainingTicks`,
          code: 'INVALID_CONTINUATION_TICKS',
          message: 'Continuation remainingTicks must be an integer >= 1.',
        });
      }

      if (
        !isSafeInt(cont.depth) ||
        cont.depth < 0 ||
        cont.depth > SIM_CONFIG.MAX_EVENT_DEPTH
      ) {
        errors.push({
          path: `${cPath}.depth`,
          code: 'INVALID_CONTINUATION_DEPTH',
          message: `Continuation depth must be in [0, ${SIM_CONFIG.MAX_EVENT_DEPTH}].`,
        });
      }
    });
  }

  // Validate movers
  if (!isPlainObject(input.movers)) {
    errors.push({
      path: '$.movers',
      code: 'INVALID_MOVERS',
      message: 'movers must be an object.',
    });
  } else {
    const moverKeys = Object.keys(input.movers);
    if (moverKeys.length > SIM_CONFIG.MAX_MOVERS) {
      errors.push({
        path: '$.movers',
        code: 'BUDGET_EXCEEDED',
        message: `movers count exceeds ${SIM_CONFIG.MAX_MOVERS}.`,
      });
    }
    for (const mk of moverKeys) {
      const m = input.movers[mk];
      if (!isPlainObject(m)) continue;
      if (
        !isSafeInt(m.progress) ||
        m.progress < 0 ||
        m.progress > SIM_CONFIG.MOVER_MAX_PROGRESS
      ) {
        errors.push({
          path: `$.movers.${mk}.progress`,
          code: 'INVALID_MOVER_PROGRESS',
          message: `Mover '${mk}' progress must be in [0, ${SIM_CONFIG.MOVER_MAX_PROGRESS}].`,
        });
      }
    }
  }

  // Validate the static solid-model occupancy grid if present
  if (input.solidFootprint !== undefined) {
    const sf = input.solidFootprint;
    const size = isSafeInt(input.gridSize) ? (input.gridSize as number) : -1;
    if (
      !Array.isArray(sf) ||
      sf.length !== size ||
      !sf.every(
        (r) =>
          Array.isArray(r) &&
          r.length === size &&
          r.every((v) => isSafeInt(v) && (v as number) >= 0)
      )
    ) {
      errors.push({
        path: '$.solidFootprint',
        code: 'INVALID_SOLID_FOOTPRINT',
        message: 'solidFootprint must be a gridSize x gridSize matrix of non-negative integers.',
      });
    }
  }

  // Validate entities if present
  if (input.entities !== undefined) {
    if (!isPlainObject(input.entities)) {
      errors.push({
        path: '$.entities',
        code: 'INVALID_ENTITIES',
        message: 'entities must be an object.',
      });
    } else {
      const entKeys = Object.keys(input.entities);
      if (entKeys.length > SIM_CONFIG.MAX_ENTITIES) {
        errors.push({
          path: '$.entities',
          code: 'BUDGET_EXCEEDED',
          message: `entities count exceeds ${SIM_CONFIG.MAX_ENTITIES}.`,
        });
      }
    }
  }

  // Validate earthquake if present
  if (input.earthquake !== undefined) {
    if (!isPlainObject(input.earthquake)) {
      errors.push({
        path: '$.earthquake',
        code: 'INVALID_EARTHQUAKE',
        message: 'earthquake must be an object.',
      });
    } else {
      checkAllowedKeys(
        input.earthquake,
        ['remainingTicks', 'intensity'],
        '$.earthquake',
        errors
      );
      if (
        !isSafeInt(input.earthquake.remainingTicks) ||
        input.earthquake.remainingTicks < 0
      ) {
        errors.push({
          path: '$.earthquake.remainingTicks',
          code: 'INVALID_EARTHQUAKE_TICKS',
          message: 'earthquake.remainingTicks must be a non-negative integer.',
        });
      }
      if (
        !isSafeInt(input.earthquake.intensity) ||
        input.earthquake.intensity < 0
      ) {
        errors.push({
          path: '$.earthquake.intensity',
          code: 'INVALID_EARTHQUAKE_INTENSITY',
          message: 'earthquake.intensity must be a non-negative integer.',
        });
      }
    }
  }

  // Validate hazardRegions if present
  if (input.hazardRegions !== undefined) {
    if (!isPlainObject(input.hazardRegions)) {
      errors.push({
        path: '$.hazardRegions',
        code: 'INVALID_HAZARDS',
        message: 'hazardRegions must be an object.',
      });
    } else {
      for (const [rId, h] of Object.entries(input.hazardRegions)) {
        if (!isPlainObject(h)) {
          errors.push({
            path: `$.hazardRegions.${rId}`,
            code: 'INVALID_HAZARD',
            message: 'hazard region entry must be an object.',
          });
        } else {
          checkAllowedKeys(
            h,
            ['damagePerInterval', 'intervalTicks'],
            `$.hazardRegions.${rId}`,
            errors
          );
          if (
            !isSafeInt(h.damagePerInterval) ||
            (h.damagePerInterval as number) < 0
          ) {
            errors.push({
              path: `$.hazardRegions.${rId}.damagePerInterval`,
              code: 'INVALID_HAZARD_DAMAGE',
              message: 'damagePerInterval must be a non-negative integer.',
            });
          }
          if (
            !isSafeInt(h.intervalTicks) ||
            (h.intervalTicks as number) < 1
          ) {
            errors.push({
              path: `$.hazardRegions.${rId}.intervalTicks`,
              code: 'INVALID_HAZARD_INTERVAL',
              message: 'intervalTicks must be a positive integer.',
            });
          }
        }
      }
    }
  }

  // Validate lightEffects if present
  if (input.lightEffects !== undefined) {
    if (!isPlainObject(input.lightEffects)) {
      errors.push({
        path: '$.lightEffects',
        code: 'INVALID_LIGHT_EFFECTS',
        message: 'lightEffects must be an object.',
      });
    } else {
      const allowedEffects = new Set(['flicker', 'strobe', 'pulse', 'glow']);
      for (const [k, le] of Object.entries(input.lightEffects)) {
        if (!isPlainObject(le)) {
          errors.push({
            path: `$.lightEffects.${k}`,
            code: 'INVALID_LIGHT_EFFECT',
            message: 'light effect entry must be an object.',
          });
        } else {
          checkAllowedKeys(
            le,
            ['effect', 'speedTicks'],
            `$.lightEffects.${k}`,
            errors
          );
          if (
            typeof le.effect !== 'string' ||
            !allowedEffects.has(le.effect)
          ) {
            errors.push({
              path: `$.lightEffects.${k}.effect`,
              code: 'INVALID_LIGHT_EFFECT_TYPE',
              message: 'Invalid light effect type.',
            });
          }
          if (!isSafeInt(le.speedTicks) || (le.speedTicks as number) < 1) {
            errors.push({
              path: `$.lightEffects.${k}.speedTicks`,
              code: 'INVALID_LIGHT_SPEED',
              message: 'speedTicks must be a positive integer.',
            });
          }
        }
      }
    }
  }

  // Validate regionDwellTicks if present
  if (input.regionDwellTicks !== undefined) {
    if (!isPlainObject(input.regionDwellTicks)) {
      errors.push({
        path: '$.regionDwellTicks',
        code: 'INVALID_REGION_DWELL',
        message: 'regionDwellTicks must be an object.',
      });
    } else {
      for (const [rId, players] of Object.entries(input.regionDwellTicks)) {
        if (!isPlainObject(players)) {
          errors.push({
            path: `$.regionDwellTicks.${rId}`,
            code: 'INVALID_REGION_DWELL_PLAYERS',
            message: 'regionDwellTicks entry must be an object.',
          });
        } else {
          for (const [pId, dwell] of Object.entries(players)) {
            if (!isSafeInt(dwell) || (dwell as number) < 0) {
              errors.push({
                path: `$.regionDwellTicks.${rId}.${pId}`,
                code: 'INVALID_DWELL_TICKS',
                message: 'dwell ticks must be a non-negative integer.',
              });
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
