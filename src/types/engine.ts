/**
 * ============================================================================
 * GRIDFORGE 3D GAME CREATION SYSTEM - CORE ENGINE, COMBAT & AI TYPES (PHASE 1, 2 & 3)
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
} from '../runtime/sim/types';
import {
  AmmoLootSnapshot,
  BuiltInTextureId,
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  ENGINE_CONFIG,
  EnemyAIState,
  EnemyTelemetrySnapshot,
  EntityArchetypeId,
  EntityBlueprint,
  GridCoord,
  LevelStateData,
  Model3DAsset,
  PlacedEntity,
  PlayerCombatState,
  PlayerTransform,
  SKYBOX_THEMES,
  SkyboxThemeId,
  SurfaceTarget,
  TextureAsset,
  WallTexturePresetId,
  createUniformTextureMatrix,
  resizeSquareMatrix,
} from '../runtime/types';

export {
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  SKYBOX_THEMES,
  ENGINE_CONFIG,
  createUniformTextureMatrix,
  resizeSquareMatrix,
};

export type {
  SurfaceTarget,
  BuiltInTextureId,
  WallTexturePresetId,
  TextureAsset,
  EntityArchetypeId,
  EnemyAIState,
  EntityBlueprint,
  Model3DAsset,
  PlacedEntity,
  EnemyTelemetrySnapshot,
  AmmoLootSnapshot,
  PlayerCombatState,
  SkyboxThemeId,
  GridCoord,
  PlayerTransform,
  LevelStateData,
};

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


