/**
 * ============================================================================
 * FORGECORE RUNTIME CORE TYPES & CONSTANTS (`/src/runtime/types.ts`)
 * ============================================================================
 * Pure runtime types and constants used by the 3D engine, simulation bridge,
 * HUD, and level serializer. Zero React or editor-only imports.
 */

import type {
  EventDefinition,
  FloorSlopeSpec,
  LevelDataV3,
  MovementSettingsSpec,
  RegionDefinition,
  VariableRegistrySpec,
  WalkSurfaceSpec,
} from './sim/types';
import { DEFAULT_MOVEMENT_SETTINGS, SIM_CONFIG } from './sim/types';

export type ModelCategoryId =
  | 'characters'
  | 'decorations'
  | 'items'
  | 'buildings'
  | 'vehicles';

/** 'solid' blocks movement like a wall; 'nonSolid' can be walked through */
export type ModelCollision = 'solid' | 'nonSolid';

/** 'normalized' scales to a fixed character height; 'real' keeps the model's own size */
export type ModelSizing = 'normalized' | 'real';

export interface ModelCategoryInfo {
  id: ModelCategoryId;
  label: string;
  defaultCollision: ModelCollision;
  sizing: ModelSizing;
  runsAI: boolean;
}

export enum CellType {
  EMPTY = 0, // Walkable corridor / floor space
  WALL = 1,  // Solid extruded 3D wall block (collidable)
  DOOR = 2,  // Interactive bulkhead door (opens when player has key or presses E)
  KEY = 3,   // Collectible keycard pickup (unlocks doors; the player still opens them)
  HOLE = 4,  // Open tile with no floor: you see and fall through to the layer below
}

/**
 * Target Surface Channel when painting or resolving textures
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
  | 'ceiling-coffer'   // Default recessed acoustic coffer ceiling
  | 'grate-alpha';     // See-through catwalk grate (alpha texture)

export type WallTexturePresetId = BuiltInTextureId | string;

/**
 * Texture Asset Item
 */
export interface TextureAsset {
  id: string;
  name: string;
  sourceType: 'procedural' | 'file' | 'url';
  /** DataURL or remote/relative URL (for 'file' and 'url' textures) or thumbnail preview */
  previewUrl: string;
  recommendedSurface: SurfaceTarget | 'any';
  /** True for textures shipped with the project (`src/assets/textures/` or the public manifest) */
  fromProject?: boolean;
  /** Disk subfolder under `src/assets/textures/`, e.g. "Horror/Brick" */
  folderPath?: string;
  /** Has see-through parts: drawn double-sided with fully transparent pixels cut out */
  hasAlpha?: boolean;
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
 * 3D Model Asset Item in the Asset Registry (.glb / .gltf)
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
  /** Real size in meters shipped with a project model (`models/model-sizes.json`), so it need not be loaded to be measured */
  measuredSizeMeters?: { width: number; depth: number };
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
  /** Free 3D placement (absent on flat, grid-placed entities) */
  layer?: number;
  /** Offset of the model's origin from its grid anchor, in meters */
  offsetX?: number;
  offsetZ?: number;
  /** Height of the model's origin above its layer's base in meters; absent = on the floor */
  elevation?: number;
  pitch?: number; // Radians
  roll?: number; // Radians
  /** Players and enemies can stand on the model's real shape (baked into `walkSurface`) */
  walkable?: boolean;
  walkSurface?: WalkSurfaceSpec;
  /**
   * The model's lowest and highest point relative to its origin, in sim units, measured
   * by the 3D editor so a solid model blocks only its real height on vertical levels.
   */
  modelBottomUnits?: number;
  modelTopUnits?: number;
}

/**
 * One stacked layer above the ground floor, as the editor holds it. Heights are in sim
 * units relative to the layer's base (layer k starts at k * 1000 units = k * 4 m).
 */
export interface EditorLayerData {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  floorHeights: number[][];
  ceilingHeights: number[][];
  slopes: FloorSlopeSpec[];
}

/**
 * Everything vertical about a level. The ground layer's grid and textures stay in the
 * level's top-level fields; its heights and slopes live here with the stacked layers.
 */
export interface VerticalLevelData {
  floorHeights: number[][];
  ceilingHeights: number[][];
  slopes: FloorSlopeSpec[];
  layers: EditorLayerData[];
  movement: MovementSettingsSpec;
  spawnLayer: number;
}

const constMatrix = (size: number, val: number): number[][] =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => val));

/** Vertical data of a flat level: one layer, default heights, default movement */
export function createDefaultVerticalData(gridSize: number): VerticalLevelData {
  return {
    floorHeights: constMatrix(gridSize, SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS),
    ceilingHeights: constMatrix(gridSize, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
    slopes: [],
    layers: [],
    movement: { ...DEFAULT_MOVEMENT_SETTINGS },
    spawnLayer: 0,
  };
}

/** A new layer: solid everywhere, so rooms are carved into it */
export function createSolidLayer(
  gridSize: number,
  textures: { wall: string; floor: string; ceiling: string }
): EditorLayerData {
  const texMatrix = (id: string) =>
    Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => id));
  return {
    grid: constMatrix(gridSize, CellType.WALL),
    wallTextures: texMatrix(textures.wall),
    floorTextures: texMatrix(textures.floor),
    ceilingTextures: texMatrix(textures.ceiling),
    floorHeights: constMatrix(gridSize, 0),
    ceilingHeights: constMatrix(gridSize, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
    slopes: [],
  };
}

/** True when vertical data adds nothing to a flat level (so saves can leave it out) */
export function isFlatVerticalData(v: VerticalLevelData): boolean {
  const d = DEFAULT_MOVEMENT_SETTINGS;
  const m = v.movement;
  return (
    v.layers.length === 0 &&
    v.slopes.length === 0 &&
    v.spawnLayer === 0 &&
    v.floorHeights.every((row) => row.every((h) => h === SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS)) &&
    v.ceilingHeights.every((row) => row.every((h) => h === SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS)) &&
    m.jump === d.jump &&
    m.crouch === d.crouch &&
    m.stepUnits === d.stepUnits &&
    m.fallDamage === d.fallDamage &&
    m.aim === d.aim
  );
}

/** Vertical data for a map resized to `size` (new tiles get default heights; new upper tiles are solid) */
export function resizeVerticalData(v: VerticalLevelData, size: number): VerticalLevelData {
  const inside = (s: { row: number; col: number }) => s.row < size && s.col < size;
  return {
    ...v,
    floorHeights: resizeSquareMatrix(v.floorHeights, size, SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS),
    ceilingHeights: resizeSquareMatrix(v.ceilingHeights, size, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
    slopes: v.slopes.filter(inside),
    layers: v.layers.map((l) => ({
      grid: resizeSquareMatrix(l.grid, size, CellType.WALL as number),
      wallTextures: resizeSquareMatrix(l.wallTextures, size, 'default-grid'),
      floorTextures: resizeSquareMatrix(l.floorTextures, size, 'floor-obsidian'),
      ceilingTextures: resizeSquareMatrix(l.ceilingTextures, size, 'ceiling-coffer'),
      floorHeights: resizeSquareMatrix(l.floorHeights, size, 0),
      ceilingHeights: resizeSquareMatrix(l.ceilingHeights, size, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
      slopes: l.slopes.filter(inside),
    })),
  };
}

export function cloneVerticalData(v: VerticalLevelData): VerticalLevelData {
  return {
    floorHeights: v.floorHeights.map((r) => [...r]),
    ceilingHeights: v.ceilingHeights.map((r) => [...r]),
    slopes: v.slopes.map((s) => ({ ...s })),
    layers: v.layers.map((l) => ({
      grid: l.grid.map((r) => [...r]),
      wallTextures: l.wallTextures.map((r) => [...r]),
      floorTextures: l.floorTextures.map((r) => [...r]),
      ceilingTextures: l.ceilingTextures.map((r) => [...r]),
      floorHeights: l.floorHeights.map((r) => [...r]),
      ceilingHeights: l.ceilingHeights.map((r) => [...r]),
      slopes: l.slopes.map((s) => ({ ...s })),
    })),
    movement: { ...v.movement },
    spawnLayer: v.spawnLayer,
  };
}

/**
 * Live Telemetry Snapshot of an Active Enemy in the 3D World
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
  /** Stacked layers, tile heights, slopes and movement settings (absent on flat levels) */
  vertical?: VerticalLevelData;
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

/**
 * ============================================================================
 * PHASE 2: GAME MANIFEST WRAPPING LEVELDATAV3
 * ============================================================================
 * Clean container format wrapping LevelDataV3 with export metadata and asset manifests.
 * No scripts field. No multiplayer field in v1.
 */
export interface GameManifestMeta {
  title: string;
  author: string;
  description: string;
  createdAt: string;
  engineVersion: string;
}

export interface ManifestTextureAsset {
  id: string;
  path: string;
  mimeType: string;
  license?: string;
  source?: string;
}

export interface ManifestModelAsset {
  id: string;
  path: string;
  draco: boolean;
  license?: string;
  source?: string;
}

export interface GameManifestAssets {
  textures: ManifestTextureAsset[];
  models: ManifestModelAsset[];
}

export interface GameManifest {
  schemaVersion: 1;
  meta: GameManifestMeta;
  level: LevelDataV3;
  assets: GameManifestAssets;
}

