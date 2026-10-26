/**
 * ============================================================================
 * PURE SIMULATION & EVENT/TRIGGER SCHEMA TYPES (PHASE 0 & 1 + AMENDMENT A)
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 * All runtime state is strictly integer-only (no floats).
 */

export const SIM_CONFIG = {
  TICKS_PER_SECOND: 30,
  MAX_TICKS_PER_FRAME: 5,
  GRID_SIZE: 10, // Default per-level grid size (levels store their own `gridSize`)
  MIN_GRID_SIZE: 8,
  MAX_GRID_SIZE: 128,
  CELL_UNITS: 1000, // 1 cell = 1000 millicells (corresponds to 4.0m in 3D view)
  DEFAULT_FLOOR_HEIGHT_UNITS: 0,
  DEFAULT_CEILING_HEIGHT_UNITS: 1000,
  PLAYER_EYE_HEIGHT_UNITS: 438,
  PLAYER_RADIUS_UNITS: 238, // 0.95 / 4.0 * 1000
  WALK_SPEED_UNITS_PER_TICK: 88, // ~2.64 cells/sec (10.56 m/s)
  SPRINT_SPEED_UNITS_PER_TICK: 140, // ~4.20 cells/sec (16.8 m/s)
  TURN_SPEED_BAM_PER_TICK: 764, // ~2.2 rad/s at 30 Hz
  DEFAULT_DOOR_SPEED_PER_TICK: 500, // 0..10000 in 20 ticks
  DEFAULT_PUSHWALL_SPEED_PER_TICK: 250, // 0..10000 in 40 ticks
  MOVER_MAX_PROGRESS: 10000, // Fixed-point basis points (0..10000)

  // Section 7.2 Execution & Authoring Budgets
  MAX_EVENTS_PER_LEVEL: 512,
  MAX_CONDITIONS_PER_EVENT: 8,
  MAX_ACTIONS_PER_EVENT: 16,
  MAX_EVENT_DEPTH: 8,
  MAX_ACTIONS_PER_TICK: 64,
  MAX_PENDING_CONTINUATIONS: 64,
  MAX_FIRES_PER_EVENT_PER_TICK: 4,
  MAX_MOVERS: 1024, // Every door cell owns a mover, so large maps need headroom
  MAX_ENTITIES: 512,
  MAX_STATIC_MODELS: 4096, // Decorations, items, buildings and vehicles placed in one level
  MAX_FOOTPRINT_CELLS: 16, // Largest model footprint width or depth in cells
  MAX_FLAGS: 256,
  MAX_COUNTERS: 64,
  MAX_TIMERS: 64,
  COUNTER_MIN: -1_000_000,
  COUNTER_MAX: 1_000_000,
  MAX_MESSAGE_LENGTH: 120,
  MAX_MESSAGES_PER_SECOND: 2,
} as const;

export enum SimCellType {
  EMPTY = 0,
  WALL = 1,
  DOOR = 2,
  KEY = 3,
}

export type GameModeFilter = 'single' | 'coop' | 'deathmatch';
export type SkillLevelFilter = 'easy' | 'normal' | 'hard';
export type TriggerWhoFilter = 'player' | 'enemy' | 'any';
export type CardinalDirection = 'N' | 'S' | 'E' | 'W';
export type MoverBlockedBehavior = 'reverse' | 'wait' | 'crush_damage' | 'ignore';

/**
 * Trigger Specification (Section 4)
 */
export type TriggerSpec =
  | {
      type: 'enter_cell';
      row: number;
      col: number;
      who?: TriggerWhoFilter;
    }
  | {
      type: 'leave_cell';
      row: number;
      col: number;
      who?: TriggerWhoFilter;
    }
  | {
      type: 'enter_region';
      region: string;
      who?: TriggerWhoFilter;
    }
  | {
      type: 'leave_region';
      region: string;
      who?: TriggerWhoFilter;
    }
  | {
      type: 'use';
      row?: number;
      col?: number;
      tag?: number;
      entityId?: string;
    }
  | {
      type: 'shoot';
      row?: number;
      col?: number;
      tag?: number;
      entityId?: string;
    }
  | {
      type: 'pickup_item';
      item?: string;
      row?: number;
      col?: number;
      tag?: number;
    }
  | {
      type: 'level_start';
    }
  | {
      type: 'mover_finished';
      tag?: number;
      row?: number;
      col?: number;
      state?: 'open' | 'closed' | 'done';
    }
  | {
      type: 'timer_fired';
      timer: string;
    }
  | {
      type: 'flag_changed';
      name: string;
      is?: boolean;
    }
  | {
      type: 'counter_reached';
      name: string;
      op: 'eq' | 'gte' | 'lte' | 'gt' | 'lt';
      value: number;
    }
  | {
      type: 'all_dead';
      region?: string;
      tag?: number;
    }
  | {
      type: 'entity_killed';
      entityId?: string;
      tag?: number;
      blueprintId?: string;
    }
  | {
      type: 'entity_alerted';
      entityId?: string;
      tag?: number;
    }
  | {
      type: 'stand_in_region';
      region: string;
      dwell_ticks?: number;
      dwell_sec?: number;
      who?: TriggerWhoFilter;
    };

/**
 * Condition Specification (Section 5 - All conditions on an event are ANDed)
 */
export type ConditionSpec =
  | {
      type: 'flag';
      name: string;
      is: boolean;
    }
  | {
      type: 'counter';
      name: string;
      op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
      value: number;
    }
  | {
      type: 'has_item';
      item: string;
    }
  | {
      type: 'player_health';
      op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
      value: number;
    }
  | {
      type: 'player_ammo';
      op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
      value: number;
    }
  | {
      type: 'all_dead';
      region?: string;
      tag?: number;
    }
  | {
      type: 'entities_alive';
      region?: string;
      tag?: number;
      op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte';
      value: number;
    }
  | {
      type: 'mover_state';
      row?: number;
      col?: number;
      tag?: number;
      state: 'closed' | 'opening' | 'open' | 'closing' | 'active' | 'done';
    }
  | {
      type: 'chance';
      percent: number; // Integer 0..100
    };

/**
 * Action Specification (Section 6)
 * Durations in level JSON (`delay_sec`) convert to integer `delay_ticks` at load/migration,
 * or authors/tests can specify `delay_ticks` directly.
 */
export type ActionSpec =
  | {
      type: 'open_door';
      row?: number;
      col?: number;
      tag?: number;
      speed_per_tick?: number;
      wait_ticks?: number;
    }
  | {
      type: 'close_door';
      row?: number;
      col?: number;
      tag?: number;
      speed_per_tick?: number;
    }
  | {
      type: 'toggle_door';
      row?: number;
      col?: number;
      tag?: number;
      speed_per_tick?: number;
    }
  | {
      type: 'lock_door';
      row?: number;
      col?: number;
      tag?: number;
      required_key?: string;
    }
  | {
      type: 'unlock_door';
      row?: number;
      col?: number;
      tag?: number;
    }
  | {
      type: 'slide_wall';
      row: number;
      col: number;
      direction: CardinalDirection;
      distance_cells?: number;
      speed_per_tick?: number;
    }
  | {
      type: 'lower_floor';
      tag?: number;
      row?: number;
      col?: number;
      target_height_units: number;
      speed_per_tick?: number;
      wait_ticks?: number;
      return_height_units?: number;
    }
  | {
      type: 'raise_floor';
      tag?: number;
      row?: number;
      col?: number;
      target_height_units: number;
      speed_per_tick?: number;
      wait_ticks?: number;
      return_height_units?: number;
    }
  | {
      type: 'toggle_lift';
      tag?: number;
      row?: number;
      col?: number;
      lower_height_units?: number;
      upper_height_units?: number;
      speed_per_tick?: number;
      wait_ticks?: number;
    }
  | {
      type: 'start_crusher';
      tag?: number;
      row?: number;
      col?: number;
      lower_height_units?: number;
      upper_height_units?: number;
      speed_per_tick?: number;
      damage?: number;
    }
  | {
      type: 'stop_crusher';
      tag?: number;
      row?: number;
      col?: number;
    }
  | {
      type: 'build_stairs';
      tag?: number;
      step_height_units?: number;
      speed_per_tick?: number;
    }
  | {
      type: 'wake_entities';
      tag?: number;
      region?: string;
    }
  | {
      type: 'spawn_entity';
      blueprintId: 'sentinel-bot' | 'turret-guardian' | 'supply-crate' | 'custom-glb';
      row: number;
      col: number;
      yaw_bam?: number;
      tag?: number;
      ambush?: boolean;
      isEnemy?: boolean;
      maxHealth?: number;
    }
  | {
      type: 'remove_entity';
      entityId?: string;
      tag?: number;
    }
  | {
      type: 'damage_entity';
      entityId?: string;
      tag?: number;
      amount: number;
    }
  | {
      type: 'set_cell';
      row: number;
      col: number;
      cell_type: SimCellType;
    }
  | {
      type: 'set_wall_texture';
      row: number;
      col: number;
      texture_id: string;
    }
  | {
      type: 'set_floor_texture';
      row: number;
      col: number;
      texture_id: string;
    }
  | {
      type: 'set_ceiling_texture';
      row: number;
      col: number;
      texture_id: string;
    }
  | {
      type: 'mark_secret_found';
      secret_id?: string;
    }
  | {
      type: 'give_item';
      item: string;
      amount?: number;
      target?: 'activator' | 'all';
    }
  | {
      type: 'take_item';
      item: string;
      amount?: number;
      target?: 'activator' | 'all';
    }
  | {
      type: 'heal_player';
      amount: number;
      target?: 'activator' | 'all';
    }
  | {
      type: 'damage_player';
      amount: number;
      target?: 'activator' | 'all';
    }
  | {
      type: 'teleport_player';
      row: number;
      col: number;
      yaw_bam?: number;
      target?: 'activator' | 'all';
    }
  | {
      type: 'set_flag';
      name: string;
      value: boolean;
    }
  | {
      type: 'toggle_flag';
      name: string;
    }
  | {
      type: 'set_counter';
      name: string;
      value: number;
    }
  | {
      type: 'add_counter';
      name: string;
      delta: number;
    }
  | {
      type: 'start_timer';
      timer: string;
      duration_ticks?: number;
      duration_sec?: number;
    }
  | {
      type: 'stop_timer';
      timer: string;
    }
  | {
      type: 'delay';
      delay_ticks?: number;
      delay_sec?: number;
    }
  | {
      type: 'fire_event';
      event_id: string;
    }
  | {
      type: 'trigger_event';
      event_id: string;
    }
  | {
      type: 'enable_event';
      event_id: string;
    }
  | {
      type: 'disable_event';
      event_id: string;
    }
  | {
      type: 'reset_event_once';
      event_id: string;
    }
  | {
      type: 'show_message';
      text: string;
      target?: 'activator' | 'all';
    }
  | {
      type: 'play_sound';
      sound_id: string;
      row?: number;
      col?: number;
    }
  | {
      type: 'exit_level';
      secret?: boolean;
    }
  | {
      type: 'earthquake';
      duration_ticks?: number;
      duration_sec?: number;
      intensity?: number;
    }
  | {
      type: 'set_light_effect';
      region?: string;
      tag?: number;
      effect: 'flicker' | 'strobe' | 'pulse' | 'glow';
      speed_ticks?: number;
    }
  | {
      type: 'stop_light_effect';
      region?: string;
      tag?: number;
    }
  | {
      type: 'set_hazard_region';
      region: string;
      damage_per_interval: number;
      interval_ticks?: number;
    }
  | {
      type: 'clear_hazard_region';
      region: string;
    }
  | {
      type: 'if_then_else';
      condition: ConditionSpec;
      then_actions: ActionSpec[];
      else_actions?: ActionSpec[];
    }
  | {
      type: 'random_branch';
      branches: {
        weight: number;
        actions: ActionSpec[];
      }[];
    }
  | {
      type: 'move_along_track';
      tag: number;
      waypoints: { row: number; col: number }[];
      speed_per_tick?: number;
      loop?: boolean;
      ping_pong?: boolean;
    };

export interface EventOptionsSpec {
  once?: boolean;
  fire?: 'once' | 'repeat' | 'repeat_with_cooldown';
  cooldown_ticks?: number;
  cooldown_sec?: number;
  modes?: GameModeFilter[];
  skill?: SkillLevelFilter[];
}

export interface EventDefinition {
  id: string;
  name: string;
  enabled: boolean;
  trigger: TriggerSpec;
  conditions: ConditionSpec[];
  actions: ActionSpec[];
  options?: EventOptionsSpec;
}

export interface RegionDefinition {
  id: string;
  name: string;
  cells: { row: number; col: number }[];
}

export interface VariableRegistrySpec {
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  timers: string[];
}

export interface SimPlacedEntityV3 {
  id: string;
  row: number;
  col: number;
  blueprintId: 'sentinel-bot' | 'turret-guardian' | 'supply-crate' | 'custom-glb';
  modelAssetId?: string;
  name?: string;
  yawBam?: number; // Integer 16-bit BAM angle [0..65535]
  scalePct?: number; // Integer percentage (100 = 1.0x)
  isEnemy?: boolean;
  maxHealth?: number;
  moveSpeedUnitsPerTick?: number;
  attackDamage?: number;
  tag?: number;
  patrol?: boolean;
  ambush?: boolean;
}

export interface LevelMetadataSpec {
  title?: string;
  author?: string;
  exportedAt?: string;
}

/**
 * Validated Level Data Format v3 (Strict Integer-Only & Asset-ID Referenced)
 */
export interface LevelDataV3 {
  formatVersion: 3;
  gridSize: number;
  rngSeed: number; // Unsigned 32-bit integer
  nextEntityId: number; // Persisted monotonic entity ID counter (>= 1)
  spawn: {
    row: number;
    col: number;
    yawBam: number; // Integer 16-bit BAM [0..65535]
  };
  minimapEnabled: boolean;
  skybox: {
    theme: 'retro-nebula' | 'starry-void' | 'crimson-dusk' | 'emerald-grid';
    seed: number;
    showCeiling: boolean;
  };
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  cellTags?: number[][];
  floorHeights?: number[][];
  ceilingHeights?: number[][];
  entities: SimPlacedEntityV3[];
  regions: RegionDefinition[];
  variables: VariableRegistrySpec;
  events: EventDefinition[];
  metadata?: LevelMetadataSpec;
}

/**
 * Activator Context passed to conditions, actions, and delayed continuations
 */
export interface ActivatorContext {
  kind: 'player' | 'entity' | 'system';
  playerId: number; // Integer player ID (single-player = 0)
  entityId?: string;
  row?: number;
  col?: number;
}

/**
 * Per-Player Runtime Simulation State (Strict Integer-Only)
 */
export interface PlayerSimState {
  playerId: number;
  xUnits: number; // World X in millicells [-5000..5000]
  zUnits: number; // World Z in millicells [-5000..5000]
  yUnits: number; // Eye height in millicells
  yawBam: number; // 16-bit BAM [0..65535]
  pitchBam: number; // Signed integer BAM pitch [-16384..16384]
  gridRow: number;
  gridCol: number;
  speedUnitsPerTick: number;
  health: number;
  maxHealth: number;
  ammo: number;
  maxAmmo: number;
  isDead: boolean;
  items: string[]; // Sorted or canonical list of collected item/key IDs
  controlsLockedTicks: number;
}

/**
 * Mover Runtime Simulation State (Doors, Push Walls, Lifts, Floors, Crushers - Strict Integer-Only)
 */
export interface MoverSimState {
  id: string; // e.g. "door:4,5", "pushwall:2,3", "lift:tag:2"
  kind: 'door' | 'pushwall' | 'lift' | 'floor' | 'ceiling' | 'crusher' | 'track';
  row: number;
  col: number;
  tag: number;
  state: 'closed' | 'opening' | 'open' | 'closing' | 'active' | 'done';
  progress: number; // 0..10000 basis points
  speedPerTick: number; // Integer basis points per tick
  waitTicks: number; // Remaining ticks to stay open/at target before auto-closing/returning (0 = manual)
  configuredWaitTicks: number;
  locked: boolean;
  requiredKey?: string;
  blockedBehavior: MoverBlockedBehavior;
  direction?: CardinalDirection;
  distanceCells?: number;
  targetRow?: number;
  targetCol?: number;
  startHeightUnits?: number;
  targetHeightUnits?: number;
  returnHeightUnits?: number;
  currentHeightUnits?: number;
  crushDamage?: number;
  waypoints?: { row: number; col: number }[];
  currentWaypointIndex?: number;
  trackDirection?: 1 | -1;
  trackLoop?: boolean;
  trackPingPong?: boolean;
}

/**
 * Runtime Simulation State for an Entity / Enemy in the 3D World (Strict Integer-Only)
 */
export interface SimEntityState {
  id: string; // e.g. "ent-1"
  blueprintId: 'sentinel-bot' | 'turret-guardian' | 'supply-crate' | 'custom-glb';
  modelAssetId?: string;
  name: string;
  row: number;
  col: number;
  xUnits: number; // World X in millicells [-5000..5000]
  zUnits: number; // World Z in millicells [-5000..5000]
  yUnits: number; // World Y / Floor height in millicells
  yawBam: number; // Integer 16-bit BAM angle [0..65535]
  health: number;
  maxHealth: number;
  isEnemy: boolean;
  state: 'idle' | 'patrol' | 'chase' | 'attack' | 'dead';
  tag: number;
  ambush: boolean;
  attackDamage: number;
  speedUnitsPerTick: number;
  attackCooldownTicks: number;
  hitFlashTicks: number;
  memoryTicks: number;
}

/**
 * Pending Delayed Continuation (Created when an event encounters a `delay` action)
 */
export interface PendingContinuation {
  id: number; // Monotonic integer continuation ID
  eventId: string;
  nextActionIndex: number;
  remainingTicks: number;
  activator: ActivatorContext;
  depth: number;
}

/**
 * Structured Simulation Log Entry
 */
export interface SimLogEntry {
  tick: number;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  eventId?: string;
}

/**
 * Complete Serializable Runtime Simulation State (Format Version 1)
 * Contains ZERO floats anywhere.
 */
export interface SimulationState {
  formatVersion: 1;
  tick: number;
  rngState: number; // Unsigned 32-bit integer [0..4294967295]
  gridSize: number;
  nextEntityId: number;
  nextContinuationId: number;
  levelEnded: boolean;
  secretExitTriggered: boolean;
  secretsFound: number;
  foundSecretIds: string[];
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  cellTags: number[][];
  floorHeights: number[][];
  ceilingHeights: number[][];
  players: Record<number, PlayerSimState>;
  movers: Record<string, MoverSimState>;
  entities?: Record<string, SimEntityState>;
  collectedKeys: string[]; // Canonical cell keys e.g. "1,8"
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  timers: Record<string, number>; // Remaining ticks (0 = inactive)
  events: EventDefinition[];
  regions: RegionDefinition[];
  firedOnceEvents: string[]; // Event IDs that have fired with once=true
  eventCooldowns: Record<string, number>; // Event ID -> tick when cooldown expires
  pendingContinuations: PendingContinuation[];
  messages: {
    tick: number;
    playerId: number;
    text: string;
  }[];
  soundsPlayed: {
    tick: number;
    soundId: string;
    row?: number;
    col?: number;
  }[];
  logs: SimLogEntry[];
  earthquake?: {
    remainingTicks: number;
    intensity: number;
  };
  hazardRegions?: Record<
    string,
    {
      damagePerInterval: number;
      intervalTicks: number;
    }
  >;
  lightEffects?: Record<
    string,
    {
      effect: 'flicker' | 'strobe' | 'pulse' | 'glow';
      speedTicks: number;
    }
  >;
  regionDwellTicks?: Record<string, Record<number, number>>;
}

/**
 * Per-Tick Player Input Command (Converted to integers at the input boundary)
 */
export interface PlayerTickInput {
  moveForward: -1 | 0 | 1;
  moveRight: -1 | 0 | 1;
  turnLeft?: boolean;
  turnRight?: boolean;
  sprint: boolean;
  yawDeltaBam: number; // Integer BAM delta
  pitchDeltaBam: number; // Integer BAM delta
  use: boolean;
  shoot: boolean;
  noclip?: boolean;
}
