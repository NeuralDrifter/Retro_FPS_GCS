/**
 * FORGECORE DETERMINISTIC SIMULATION TYPES & CONSTANTS (/src/runtime/sim/types.ts)
 */

export const SIM_CONFIG = {
  TICKS_PER_SECOND: 30,
  MAX_TICKS_PER_FRAME: 5,
  GRID_SIZE: 10,
  MIN_GRID_SIZE: 8,
  MAX_GRID_SIZE: 128,
  CELL_UNITS: 1000,
  DEFAULT_FLOOR_HEIGHT_UNITS: 0,
  DEFAULT_CEILING_HEIGHT_UNITS: 1000,
  PLAYER_EYE_HEIGHT_UNITS: 438,
  PLAYER_RADIUS_UNITS: 238,
  WALK_SPEED_UNITS_PER_TICK: 88,
  SPRINT_SPEED_UNITS_PER_TICK: 140,
  TURN_SPEED_BAM_PER_TICK: 764,
  DEFAULT_DOOR_SPEED_PER_TICK: 500,
  DEFAULT_PUSHWALL_SPEED_PER_TICK: 250,
  MOVER_MAX_PROGRESS: 10000,
  MAX_EVENTS_PER_LEVEL: 512,
  MAX_CONDITIONS_PER_EVENT: 8,
  MAX_ACTIONS_PER_EVENT: 16,
  MAX_EVENT_DEPTH: 8,
  MAX_ACTIONS_PER_TICK: 64,
  MAX_PENDING_CONTINUATIONS: 64,
  MAX_FIRES_PER_EVENT_PER_TICK: 4,
  MAX_MOVERS: 1024,
  MAX_ENTITIES: 512,
  MAX_STATIC_MODELS: 4096,
  MAX_FOOTPRINT_CELLS: 16,
  MAX_FLAGS: 256,
  MAX_COUNTERS: 64,
  MAX_TIMERS: 64,
  COUNTER_MIN: -1000000,
  COUNTER_MAX: 1000000,
  MAX_MESSAGE_LENGTH: 120,
  MAX_MESSAGES_PER_SECOND: 2,
} as const;

export enum SimCellType {
  EMPTY = 0,
  WALL = 1,
  DOOR = 2,
  KEY = 3,
}

export const BAM_HALF_TURN = 32768;
export const BAM_QUARTER_TURN = 16384;
export const TRIG_SCALE = 16384;

export interface SimPlacedEntityV3 {
  id: string;
  blueprintId?: any;
  modelAssetId?: string;
  name?: string;
  row: number;
  col: number;
  yawBam?: number;
  yaw?: number;
  scale?: number;
  scalePct?: number;
  tag?: number;
  isEnemy?: boolean;
  maxHealth?: number;
  health?: number;
  state?: string;
  ambush?: boolean;
  moveSpeed?: number;
  attackDamage?: number;
  category?: 'characters' | 'decorations' | 'items' | 'buildings' | 'vehicles' | string;
  collision?: 'solid' | 'nonSolid' | string;
  footprintW?: number;
  footprintD?: number;
  footprintOverride?: boolean;
  xUnits?: number;
  zUnits?: number;
  hitFlashTicks?: number;
  attackCooldownTicks?: number;
  [key: string]: any;
}

export interface RegionDefinition {
  id: string;
  name?: string;
  cells: { row: number; col: number }[];
  [key: string]: any;
}

export interface VariableRegistrySpec {
  flags?: Record<string, boolean>;
  counters?: Record<string, number>;
  timers?: string[];
  [key: string]: any;
}

export interface TriggerSpec {
  type: string;
  [key: string]: any;
}

export type EventTriggerSpec = TriggerSpec;

export interface ConditionSpec {
  type: string;
  [key: string]: any;
}

export interface ActionSpec {
  type: string;
  [key: string]: any;
}

export interface EventDefinition {
  id: string;
  name?: string;
  enabled?: boolean;
  trigger: TriggerSpec;
  conditions?: ConditionSpec[];
  actions: ActionSpec[];
  options?: {
    once?: boolean;
    fire?: 'once' | 'multiple' | 'repeat' | string;
    cooldown_ticks?: number;
    cooldown_sec?: number;
    modes?: string[];
    skill?: string[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface LevelDataV3 {
  formatVersion: 3;
  gridSize: number;
  rngSeed: number;
  nextEntityId: number;
  spawn: {
    row: number;
    col: number;
    yawBam: number;
  };
  minimapEnabled?: boolean;
  skybox: {
    theme: any;
    seed: number;
    showCeiling: boolean;
  };
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  floorHeights?: number[][];
  ceilingHeights?: number[][];
  cellTags?: number[][];
  entities: SimPlacedEntityV3[];
  regions?: RegionDefinition[];
  variables?: VariableRegistrySpec;
  events: EventDefinition[];
  metadata?: {
    title?: string;
    author?: string;
    description?: string;
    exportedAt?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface PlayerTickInput {
  moveForward: number;
  moveRight: number;
  sprint?: boolean;
  yawDeltaBam: number;
  pitchDeltaBam: number;
  use?: boolean;
  shoot?: boolean;
  turnLeft?: boolean;
  turnRight?: boolean;
  noclip?: boolean;
  [key: string]: any;
}

export interface SimPlayerState {
  playerId?: number;
  xUnits: number;
  zUnits: number;
  yUnits?: number;
  yawBam: number;
  pitchBam: number;
  gridRow: number;
  gridCol: number;
  speedUnitsPerTick: number;
  health: number;
  maxHealth?: number;
  ammo: number;
  maxAmmo?: number;
  isDead?: boolean;
  controlsLockedTicks?: number;
  items: string[];
  [key: string]: any;
}

export interface MoverState {
  id: string;
  kind: 'door' | 'pushwall' | 'floor' | 'ceiling' | 'lift' | 'crusher' | 'track';
  row: number;
  col: number;
  tag: number;
  state: string;
  progress: number;
  speedPerTick: number;
  waitTicks: number;
  configuredWaitTicks: number;
  locked?: boolean;
  requiredKey?: string;
  blockedBehavior?: string;
  direction?: 'N' | 'S' | 'E' | 'W';
  distanceCells?: number;
  targetRow?: number;
  targetCol?: number;
  lowerHeightUnits?: number;
  upperHeightUnits?: number;
  targetHeightUnits?: number;
  returnHeightUnits?: number;
  damage?: number;
  waypoints?: { row: number; col: number; floorHeightUnits?: number; ceilingHeightUnits?: number; waitTicks?: number }[];
  currentWaypointIndex?: number;
  loop?: boolean;
  pingPong?: boolean;
  forward?: boolean;
  [key: string]: any;
}

export interface PendingContinuation {
  id: number;
  eventId: string;
  nextActionIndex: number;
  remainingTicks?: number;
  resumeAtTick?: number;
  activator?: any;
  depth?: number;
  [key: string]: any;
}

export interface SimLogEntry {
  tick: number;
  message: string;
  code?: string;
  level?: string;
  [key: string]: any;
}

export interface SimSoundCue {
  tick: number;
  soundId: string;
  row?: number;
  col?: number;
  [key: string]: any;
}

export interface SimEarthquakeState {
  intensity: number;
  remainingTicks: number;
  [key: string]: any;
}

export interface HazardRegionState {
  region: string;
  damagePerInterval: number;
  intervalTicks: number;
  [key: string]: any;
}

export interface LightEffectState {
  effect: string;
  speedTicks?: number;
  region?: string;
  tag?: number;
  [key: string]: any;
}

export interface SimulationState {
  formatVersion: 3;
  tick: number;
  gridSize: number;
  rngState: number;
  grid: number[][];
  cellTags: number[][];
  floorHeights: number[][];
  ceilingHeights: number[][];
  players: Record<string, SimPlayerState>;
  movers: Record<string, MoverState>;
  solidFootprint?: number[][];
  entities?: Record<string, SimPlacedEntityV3>;
  collectedKeys: string[];
  firedOnceEvents: string[];
  eventCooldowns: Record<string, number>;
  eventFireCountsThisTick: Record<string, number>;
  foundSecretIds: string[];
  secretsFound: number;
  totalSecrets: number;
  levelEnded: boolean;
  secretExitTriggered?: boolean;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  timers: Record<string, number>;
  pendingContinuations: PendingContinuation[];
  regions: RegionDefinition[];
  events: EventDefinition[];
  regionDwellTicks?: Record<string, Record<string, number>>;
  hazardRegions?: Record<string, HazardRegionState>;
  lightEffects?: Record<string, LightEffectState>;
  earthquake?: SimEarthquakeState;
  logs: SimLogEntry[];
  soundsPlayed: SimSoundCue[];
  messages: { tick: number; text: string; target?: string }[];
  wallTextures: string[][];
  floorTextures?: string[][];
  ceilingTextures?: string[][];
  nextEntityId: number;
  nextContinuationId?: number;
  [key: string]: any;
}

export interface ValidationErrorItem {
  path: string;
  code: string;
  message: string;
}
