/**
 * ============================================================================
 * PIE3D GAME CREATION SYSTEM - CORE ENGINE, COMBAT & AI TYPES (PHASE 1, 2 & 3)
 * ============================================================================
 * Defines the shared data structures across our modular architecture:
 *  - `src/types/engine.ts`          : Data contracts, constants & starter presets
 *  - `src/engine/TextureGenerator.ts`: Procedural + Custom URL/File Texture Manager
 *  - `src/engine/EntityLoader.ts`   : Modular GLTFLoader (.glb) & AnimationMixer pipeline
 *  - `src/engine/WorldBuilder.ts`   : Per-cell 3D extruder (walls, floors, ceilings, entities)
 *  - `src/engine/CollisionSystem.ts`: Circle-vs-AABB collision & entity proximity solver
 *  - `src/engine/CombatSystem.ts`   : Phase 3 Raycaster shooting, muzzle flash, hit flash & 3D weapon
 *  - `src/engine/EnemyAISystem.ts`  : Phase 3 Enemy FSM (Idle, Chase, Attack, Dead) + LOS Raycaster & Loot
 *  - `src/engine/LevelSerializer.ts`: Save Map / Load Map JSON state serialization
 */

import type {
  EventDefinition,
  RegionDefinition,
  VariableRegistrySpec,
} from '../engine/sim/types';
import { SIM_CONFIG } from '../engine/sim/types';
import type { ModelCategoryId, ModelCollision } from './modelLibrary';

export enum CellType {
  EMPTY = 0, // Walkable corridor / floor space
  WALL = 1,  // Solid extruded 3D wall block (collidable)
  DOOR = 2,  // Interactive bulkhead door (opens when player has key or presses E)
  KEY = 3,   // Collectible keycard pickup (unlocks doors; the player still opens them)
}

/**
 * Editor Paint Modes (Phase 1 + Phase 2 + Phase 3)
 * ------------------------------------------------
 * - 'toggle'  : Phase 1 Default — Click toggles Empty Space (0) <-> Solid Wall (1)
 * - 'wall'    : Paint Solid Wall block + assign active Wall Texture
 * - 'paint'   : Paint active Texture onto existing Wall, Floor, or Ceiling cell
 * - 'entity'  : Phase 2/3 Entity Mode — Click a grid cell to place/remove a 3D .glb Entity/Enemy
 * - 'empty'   : Erase cell back to walkable Empty Space
 * - 'spawn'   : Relocate First-Person Player Spawn & Facing Angle
 * - 'door'    : Place Interactive Bulkhead Door
 * - 'key'     : Place Collectible Keycard
 */
export type EditorToolMode =
  | 'toggle'
  | 'wall'
  | 'paint'
  | 'entity'
  | 'empty'
  | 'spawn'
  | 'door'
  | 'key';

/**
 * Target Surface Channel when painting textures in the 2D Grid
 */
export type SurfaceTarget = 'wall' | 'floor' | 'ceiling';

/**
 * Built-in Procedural Texture Asset IDs
 */
export type BuiltInTextureId =
  | 'default-grid'     // Crisp UV architectural measurement grid
  | 'techbase-panel'   // Doom-inspired riveted industrial steel bulkhead
  | 'dungeon-stone'    // Classic 90s shareware mossy stone masonry
  | 'labyrinth-check'  // Ken's Labyrinth high-contrast retro checkerboard
  | 'floor-obsidian'   // Default dark industrial floor grating
  | 'ceiling-coffer';  // Default recessed acoustic coffer ceiling

export type WallTexturePresetId = BuiltInTextureId | string;

/**
 * Texture Asset Item in the Phase 2 Asset Panel
 */
export interface TextureAsset {
  id: string;
  name: string;
  sourceType: 'procedural' | 'file' | 'url';
  /** DataURL or remote URL (for 'file' and 'url' textures) or thumbnail preview */
  previewUrl: string;
  recommendedSurface: SurfaceTarget | 'any';
}

/**
 * Built-in Entity Archetypes (Loaded via the modular GLTFLoader pipeline)
 */
export type EntityArchetypeId =
  | 'sentinel-bot'   // Hostile Cyber Sentinel Droid (.glb Enemy AI)
  | 'turret-guardian'// Hostile Heavy Quad-Laser Defense Guerilla (.glb Enemy AI)
  | 'supply-crate'   // Armored Techbase Supply Crate (.glb Prop)
  | 'custom-glb';    // User-uploaded or URL-linked custom rigged .glb avatar

/**
 * Phase 3 Finite State Machine (FSM) States for Enemy AI
 */
export type EnemyAIState = 'Idle' | 'Chase' | 'Attack' | 'Dead';

export interface EntityBlueprint {
  id: EntityArchetypeId;
  name: string;
  role: 'enemy' | 'object';
  isEnemy: boolean;
  defaultHealth: number;
  moveSpeed: number;      // World units per second during Chase state
  attackDamage: number;   // Health points deducted per melee attack
  accentHex: string;
  badgeText: string;
  /** Optional custom .glb URL or ObjectURL supplied by the user */
  customGlbUrl?: string;
}

export const DEFAULT_ENTITY_BLUEPRINTS: EntityBlueprint[] = [
  {
    id: 'sentinel-bot',
    name: 'Cyber Sentinel Bot (.glb)',
    role: 'enemy',
    isEnemy: true,
    defaultHealth: 75,
    moveSpeed: 4.8,
    attackDamage: 12,
    accentHex: '#F43F5E',
    badgeText: 'E1',
  },
  {
    id: 'turret-guardian',
    name: 'Heavy Mech Stalker (.glb)',
    role: 'enemy',
    isEnemy: true,
    defaultHealth: 100,
    moveSpeed: 3.4,
    attackDamage: 18,
    accentHex: '#A855F7',
    badgeText: 'E2',
  },
  {
    id: 'supply-crate',
    name: 'Supply Crate (.glb)',
    role: 'object',
    isEnemy: false,
    defaultHealth: 50,
    moveSpeed: 0,
    attackDamage: 0,
    accentHex: '#38BDF8',
    badgeText: 'E3',
  },
];

/**
 * 3D Model Asset Item in the Asset Library (.glb / .gltf)
 * -------------------------------------------------------
 * Represents either a built-in procedural .glb archetype OR a user-uploaded
 * .glb/.gltf file OR a remote .glb URL that can be dragged and dropped
 * directly onto cells in the 2D Map Editor.
 */
export interface Model3DAsset {
  id: string;
  blueprintId: EntityArchetypeId;
  name: string;
  sourceType: 'builtin' | 'file' | 'url';
  isEnemy: boolean;
  defaultHealth: number;
  moveSpeed: number;
  attackDamage: number;
  accentHex: string;
  badgeText: string;
  customGlbUrl?: string;
  /** World-building category (absent on legacy assets: resolved from isEnemy) */
  category?: ModelCategoryId;
  tags?: string[];
  /** Slash path of the custom folder the model was found in on disk or in the manifest */
  folderPath?: string;
  /** True when `folderPath` starts at the library root instead of inside the category folder */
  folderAtRoot?: boolean;
  collision?: ModelCollision;
  footprintW?: number;
  footprintD?: number;
  /** Footprint in cells measured from the model's real size */
  measuredFootprint?: { w: number; d: number };
}

/**
 * Instance of an Entity placed on the Grid
 */
export interface PlacedEntity {
  id: string;
  row: number;
  col: number;
  blueprintId: EntityArchetypeId;
  modelAssetId?: string; // Deterministic AssetRegistry model ID (used in v3 levels instead of customGlbUrl)
  name: string;
  yaw: number;          // Facing angle in radians (converted to integer yawBam in v3 level & sim)
  scale: number;        // Uniform scale multiplier (default 1.0, converted to scalePct in v3)
  customGlbUrl?: string;// UI/runtime resolved URL (never persisted in v3 LevelDataV3)
  /** Phase 3 Combat & AI Properties */
  isEnemy?: boolean;
  maxHealth?: number;
  moveSpeed?: number;
  attackDamage?: number;
  tag?: number;
  patrol?: boolean;
  ambush?: boolean;
  /** Resolved placement settings (absent on legacy entities) */
  category?: ModelCategoryId;
  collision?: ModelCollision;
  footprintW?: number;
  footprintD?: number;
  /** True when the footprint was set by hand instead of measured */
  footprintOverride?: boolean;
}

/**
 * Live Telemetry Snapshot of an Active Enemy in the 3D World
 * (Used to sync real-time AI coordinates & states to the HUD and Minimap)
 */
export interface EnemyTelemetrySnapshot {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  state: EnemyAIState;
  isEnemy: boolean;
}

/**
 * Live Snapshot of a Dropped Ammo Loot Pickup at a Dead Enemy's Coordinates
 */
export interface AmmoLootSnapshot {
  id: string;
  x: number;
  z: number;
  amount: number;
  collected: boolean;
}

/**
 * Phase 3 Player Combat HUD State
 */
export interface PlayerCombatState {
  health: number;
  maxHealth: number;
  ammo: number;
  maxAmmo: number;
  kills: number;
  totalEnemies: number;
  isDead: boolean;
  lastHitEnemyName: string | null;
  lastHitEnemyHealth: number | null;
  lastHitEnemyMaxHealth: number | null;
}

/**
 * Procedural 360° Equirectangular Skybox Themes
 */
export type SkyboxThemeId =
  | 'retro-nebula'
  | 'starry-void'
  | 'crimson-dusk'
  | 'emerald-grid';

export const SKYBOX_THEMES: {
  id: SkyboxThemeId;
  label: string;
  fogHex: number;
}[] = [
  { id: 'retro-nebula', label: 'Purple Nebula', fogHex: 0x160b24 },
  { id: 'starry-void', label: 'Dark Starry Void', fogHex: 0x070a10 },
  { id: 'crimson-dusk', label: 'Crimson Dusk', fogHex: 0x1f0c11 },
  { id: 'emerald-grid', label: 'Vector Horizon', fogHex: 0x061512 },
];

export interface GridCoord {
  row: number;
  col: number;
}

export interface PlayerTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gridRow: number;
  gridCol: number;
  speed: number;
}

/**
 * Complete Serializable Level State (Save/Load Format)
 */
export interface LevelStateData {
  engine: string;
  version: '2.0';
  formatVersion?: 3;
  timestamp: string;
  gridSize: number;
  nextEntityId?: number;
  rngSeed?: number;
  spawn: { row: number; col: number; yaw: number };
  /** Whether the exported game displays the in-game Minimap HUD overlay */
  minimapEnabled?: boolean;
  skybox: {
    theme: SkyboxThemeId;
    seed: number;
    showCeiling: boolean;
  };
  /** gridSize x gridSize numeric layout array (0=Empty, 1=Wall, 2=Door, 3=Key) */
  grid: number[][];
  /** Per-cell wall texture asset IDs */
  wallTextures: string[][];
  /** Per-cell floor texture asset IDs */
  floorTextures: string[][];
  /** Per-cell ceiling texture asset IDs */
  ceilingTextures: string[][];
  /** Custom user-uploaded or URL texture definitions */
  customTextures: TextureAsset[];
  /** One line per custom model the level uses that this library lacks (set by parseLevelJson) */
  missingModelWarnings?: string[];
  /** Placed 3D entities (.glb Enemies and Objects) */
  entities: PlacedEntity[];
  /** Optional per-cell tag numbers for event triggers */
  cellTags?: number[][];
  /** Optional declarative regions, variables, and events */
  regions?: RegionDefinition[];
  variables?: VariableRegistrySpec;
  events?: EventDefinition[];
}

export const ENGINE_CONFIG = {
  GRID_SIZE: 10, // Default size for new levels; each level's size is its grid's length
  MIN_GRID_SIZE: SIM_CONFIG.MIN_GRID_SIZE,
  MAX_GRID_SIZE: SIM_CONFIG.MAX_GRID_SIZE,
  CELL_SIZE: 4.0,
  WALL_HEIGHT: 4.0,
  PLAYER_EYE_HEIGHT: 1.75,
  PLAYER_RADIUS: 0.95,
  ENTITY_RADIUS: 0.78,
  WALK_SPEED: 10.5,
  SPRINT_MULTIPLIER: 1.6,
  TURN_SPEED: 2.2,
  // Phase 3 Combat & Enemy AI Constants
  PLAYER_MAX_HEALTH: 100,
  PLAYER_START_AMMO: 32,
  PLAYER_MAX_AMMO: 99,
  WEAPON_DAMAGE: 25,
  WEAPON_FIRE_COOLDOWN: 0.2,    // Seconds between shots
  HIT_FLASH_DURATION: 0.12,     // 0.12s red flash when an enemy is hit
  ENEMY_LOS_RANGE: 22.0,        // Max distance (world units) for Line-of-Sight chase
  ENEMY_ATTACK_RANGE: 2.35,     // Melee range (world units) where Enemy attacks Player
  ENEMY_ATTACK_COOLDOWN: 0.95,  // Seconds between enemy melee strikes
  AMMO_DROP_AMOUNT: 12,         // Ammo restored when picking up dropped loot
  AMMO_PICKUP_RADIUS: 1.55,     // World units pickup distance
} as const;

export interface MapPreset {
  id: string;
  name: string;
  description: string;
  nextEntityId?: number;
  spawn: { row: number; col: number; yaw: number };
  grid: number[][];
  defaultWallTex?: BuiltInTextureId;
  entities?: PlacedEntity[];
  cellTags?: number[][];
  regions?: RegionDefinition[];
  variables?: VariableRegistrySpec;
  events?: EventDefinition[];
}

export const MAP_PRESETS: MapPreset[] = [
  {
    id: 'classic-maze',
    name: 'GridForge Classic Maze (Wolf3D Parity)',
    description:
      'Perimeter fortress with a key-locked bulkhead door, a secret sliding push wall at [X:1, Z:6], and an extraction switch at [X:8, Z:8].',
    spawn: { row: 1, col: 1, yaw: Math.PI },
    defaultWallTex: 'default-grid',
    events: [
      {
        id: 'evt-start-lock-door',
        name: 'Lock Bulkhead Door at Start',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'lock_door',
            row: 4,
            col: 5,
            required_key: 'keycard',
          },
          {
            type: 'show_message',
            text: 'Find the Keycard [X:8, Z:1], push Secret Wall [X:1, Z:6] with [E/Space], and reach Exit [X:8, Z:8].',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-keycard-pickup',
        name: 'Keycard Pickup Audio & Briefing',
        enabled: true,
        trigger: { type: 'pickup_item', item: 'keycard' },
        conditions: [],
        actions: [
          { type: 'play_sound', sound_id: 'key_pickup' },
          {
            type: 'show_message',
            text: 'Security Keycard acquired — Bulkhead Door at [X:5, Z:4] unlocked!',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-secret-pushwall',
        name: 'Wolf3D Secret Push Wall at (6, 1)',
        enabled: true,
        trigger: { type: 'use', row: 6, col: 1 },
        conditions: [],
        actions: [
          {
            type: 'slide_wall',
            row: 6,
            col: 1,
            direction: 'S',
            distance_cells: 2,
          },
          { type: 'mark_secret_found', secret_id: 'west_alcove_secret' },
          { type: 'play_sound', sound_id: 'secret_found', row: 6, col: 1 },
          {
            type: 'show_message',
            text: 'Secret Push Wall discovered! Passage opened to the southern chamber.',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-level-exit-switch',
        name: 'Sector Extraction Switch at (8, 8)',
        enabled: true,
        trigger: { type: 'use', row: 8, col: 8 },
        conditions: [],
        actions: [
          { type: 'play_sound', sound_id: 'level_exit', row: 8, col: 8 },
          {
            type: 'show_message',
            text: 'Extraction switch activated — Sector Complete!',
          },
          { type: 'exit_level', secret: false },
        ],
        options: { once: true },
      },
    ],
    entities: [
      {
        id: 'ent-starter-1',
        row: 3,
        col: 3,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: true,
        maxHealth: 75,
        moveSpeed: 4.6,
        attackDamage: 12,
      },
      {
        id: 'ent-starter-2',
        row: 5,
        col: 3,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot (.glb)',
        yaw: Math.PI / 2,
        scale: 1,
        isEnemy: true,
        maxHealth: 75,
        moveSpeed: 4.6,
        attackDamage: 12,
      },
      {
        id: 'ent-starter-3',
        row: 7,
        col: 5,
        blueprintId: 'turret-guardian',
        name: 'Heavy Mech Stalker (.glb)',
        yaw: Math.PI,
        scale: 1,
        isEnemy: true,
        maxHealth: 100,
        moveSpeed: 3.4,
        attackDamage: 18,
      },
      {
        id: 'ent-starter-4',
        row: 1,
        col: 7,
        blueprintId: 'supply-crate',
        name: 'Supply Crate (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: false,
        maxHealth: 50,
      },
    ],
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 3, 1],
      [1, 0, 1, 0, 1, 0, 1, 1, 0, 1],
      [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 2, 1, 1, 0, 1],
      [1, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      [1, 1, 1, 0, 1, 0, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      [1, 0, 1, 1, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: 'doom-techbase-outpost',
    name: 'Doom Techbase Outpost (Doom Parity)',
    description:
      'Classic Doom mechanics: hydraulic lift at [X:7, Z:3], monster closet ambush at [X:2, Z:1], lock-in arena at [X:7, Z:7] with all_dead unlock, and instant teleporters.',
    spawn: { row: 3, col: 1, yaw: 0 },
    defaultWallTex: 'techbase-panel',
    regions: [
      {
        id: 'reg_closet_tripwire',
        name: 'Closet Tripwire Zone',
        cells: [{ row: 3, col: 2 }],
      },
      {
        id: 'reg_arena_chamber',
        name: 'Lock-in Arena Zone',
        cells: [
          { row: 7, col: 7 },
          { row: 7, col: 8 },
          { row: 8, col: 7 },
          { row: 8, col: 8 },
        ],
      },
    ],
    variables: {
      flags: {
        arena_cleared: false,
      },
      counters: {},
      timers: [],
    },
    events: [
      {
        id: 'evt-intro-briefing',
        name: 'Mission Briefing',
        enabled: true,
        trigger: { type: 'level_start' },
        conditions: [],
        actions: [
          {
            type: 'show_message',
            text: 'Welcome to Techbase Outpost — Test hydraulic lift [X:7, Z:3], beware monster closets, and survive the arena.',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-closet-ambush',
        name: 'Monster Closet Ambush',
        enabled: true,
        trigger: { type: 'enter_region', region: 'reg_closet_tripwire' },
        conditions: [],
        actions: [
          { type: 'open_door', row: 1, col: 3 },
          { type: 'wake_entities', tag: 101 },
          {
            type: 'show_message',
            text: 'Ambush detected! Security closet opened!',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-hydraulic-lift',
        name: 'Hydraulic Freight Lift at (3, 7)',
        enabled: true,
        trigger: { type: 'use', row: 3, col: 7 },
        conditions: [],
        actions: [
          {
            type: 'toggle_lift',
            row: 3,
            col: 7,
            lower_height_units: -500,
            upper_height_units: 0,
            speed_per_tick: 250,
            wait_ticks: 90,
          },
          {
            type: 'show_message',
            text: 'Hydraulic freight lift cycling down to lower depot.',
          },
        ],
      },
      {
        id: 'evt-arena-lockin',
        name: 'Arena Door Lock-in',
        enabled: true,
        trigger: { type: 'enter_region', region: 'reg_arena_chamber' },
        conditions: [],
        actions: [
          { type: 'close_door', row: 6, col: 7 },
          {
            type: 'show_message',
            text: 'Lockdown engaged! Eliminate all arena hostiles to reopen bulkhead.',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-arena-victory',
        name: 'Arena Victory Door Release',
        enabled: true,
        trigger: { type: 'all_dead', tag: 202 },
        conditions: [],
        actions: [
          { type: 'open_door', row: 6, col: 7 },
          { type: 'set_flag', name: 'arena_cleared', value: true },
          {
            type: 'show_message',
            text: 'All arena hostiles eliminated — Lockdown released!',
          },
        ],
        options: { once: true },
      },
      {
        id: 'evt-teleport-forward',
        name: 'Teleport to High Observation Balcony',
        enabled: true,
        trigger: { type: 'enter_cell', row: 8, col: 2 },
        conditions: [],
        actions: [
          {
            type: 'teleport_player',
            row: 2,
            col: 8,
            yaw_bam: 49152,
          },
          {
            type: 'show_message',
            text: 'Matter transporter activated -> Observation Balcony [X:8, Z:2].',
          },
        ],
      },
    ],
    entities: [
      {
        id: 'ent-closet-stalker',
        row: 1,
        col: 2,
        blueprintId: 'turret-guardian',
        name: 'Heavy Mech Stalker (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: true,
        maxHealth: 100,
        moveSpeed: 4.0,
        attackDamage: 18,
        ambush: true,
        tag: 101,
      },
      {
        id: 'ent-arena-boss',
        row: 8,
        col: 8,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot (.glb)',
        yaw: Math.PI,
        scale: 1,
        isEnemy: true,
        maxHealth: 100,
        moveSpeed: 4.8,
        attackDamage: 14,
        tag: 202,
      },
      {
        id: 'ent-techbase-crate',
        row: 5,
        col: 1,
        blueprintId: 'supply-crate',
        name: 'Supply Crate (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: false,
      },
    ],
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 0, 2, 0, 0, 0, 1, 0, 1],
      [1, 1, 1, 1, 1, 0, 0, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
      [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 1, 0, 2, 0, 1],
      [1, 0, 1, 0, 1, 1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1, 1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: 'arena-pillars',
    name: 'Quad Pillar Combat Arena',
    description:
      'Symmetrical combat arena with four structural columns and hostile Sentinel & Mech guardians.',
    spawn: { row: 8, col: 4, yaw: 0 },
    defaultWallTex: 'techbase-panel',
    entities: [
      {
        id: 'ent-arena-1',
        row: 4,
        col: 4,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot (.glb)',
        yaw: Math.PI,
        scale: 1,
        isEnemy: true,
        maxHealth: 75,
        moveSpeed: 5.0,
        attackDamage: 12,
      },
      {
        id: 'ent-arena-2',
        row: 2,
        col: 4,
        blueprintId: 'turret-guardian',
        name: 'Heavy Mech Stalker (.glb)',
        yaw: Math.PI,
        scale: 1,
        isEnemy: true,
        maxHealth: 100,
        moveSpeed: 3.6,
        attackDamage: 18,
      },
      {
        id: 'ent-arena-3',
        row: 1,
        col: 8,
        blueprintId: 'supply-crate',
        name: 'Supply Crate (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: false,
      },
    ],
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
      [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
      [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: 'spiral-labyrinth',
    name: 'Ken’s Spiral Gauntlet',
    description: 'Tight winding spiral corridor guarded by patrolling sentinels.',
    spawn: { row: 1, col: 1, yaw: -Math.PI / 2 },
    defaultWallTex: 'labyrinth-check',
    entities: [
      {
        id: 'ent-spiral-1',
        row: 1,
        col: 6,
        blueprintId: 'sentinel-bot',
        name: 'Cyber Sentinel Bot (.glb)',
        yaw: Math.PI / 2,
        scale: 1,
        isEnemy: true,
        maxHealth: 75,
        moveSpeed: 4.5,
        attackDamage: 12,
      },
      {
        id: 'ent-spiral-2',
        row: 5,
        col: 4,
        blueprintId: 'turret-guardian',
        name: 'Heavy Mech Stalker (.glb)',
        yaw: 0,
        scale: 1,
        isEnemy: true,
        maxHealth: 100,
        moveSpeed: 3.5,
        attackDamage: 18,
      },
    ],
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 1, 0, 1],
      [1, 0, 1, 1, 1, 1, 0, 1, 0, 1],
      [1, 0, 1, 3, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 1, 0, 2, 0, 1, 0, 1],
      [1, 0, 0, 1, 1, 1, 1, 1, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: 'empty-sandbox',
    name: 'Open Sandbox Perimeter',
    description: 'Clean walled 10x10 room ready for custom wall sculpting and AI testing.',
    spawn: { row: 5, col: 5, yaw: 0 },
    defaultWallTex: 'default-grid',
    entities: [],
    grid: [
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
];

/**
 * Helper to create a size x size 2D string matrix filled with a default texture ID
 */
export function createUniformTextureMatrix(
  defaultId: string,
  size: number
): string[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => defaultId)
  );
}

/**
 * Returns a copy of a square per-cell matrix resized to size x size, anchored at
 * the top-left [X:0, Z:0] corner. Cropped cells are dropped and new cells get `fill`.
 */
export function resizeSquareMatrix<T>(
  matrix: T[][],
  size: number,
  fill: T
): T[][] {
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (__, c) =>
      r < matrix.length && c < (matrix[r]?.length ?? 0) ? matrix[r][c] : fill
    )
  );
}
