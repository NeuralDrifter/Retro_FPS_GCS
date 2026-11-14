/**
 * The editor's view of a project level, and the way back (release plan P2.4).
 *
 * The store keeps levels in the integer level format (LevelDataV3: sim units, BAM angles). The
 * editor's panels work in meters and radians (`PlacedEntity`, `VerticalLevelData`). These
 * functions convert between the two. Reads are memoized on the stored objects, so an unchanged
 * part of a level keeps the same view object and React skips the work that depends on it.
 */
import {
  DEFAULT_MOVEMENT_SETTINGS,
  SIM_CONFIG,
  bamToRadians,
  radiansToBam,
} from '../../sim';
import type {
  EventDefinition,
  LevelDataV3,
  LevelLayerV3,
  RegionDefinition,
  SimPlacedEntityV3,
  VariableRegistrySpec,
} from '../../sim';
import {
  isFlatVerticalData,
  placedEntityFromV3,
  placedEntityToV3,
} from '../../runtime';
import type {
  EditorLayerData,
  LevelStateData,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
} from '../../runtime';
import { LevelSerializer } from '../engine/LevelSerializer';
import type { ProjectLevel } from '../../shared/project';

export interface SpawnView {
  row: number;
  col: number;
  /** Radians */
  yaw: number;
}

/** One level as the editor's panels read it */
export interface EditorLevelView {
  id: string;
  title: string;
  gridSize: number;
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  entities: PlacedEntity[];
  nextEntityId: number;
  spawn: SpawnView;
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  minimapEnabled: boolean;
  vertical: VerticalLevelData;
  cellTags?: number[][];
  events: EventDefinition[];
  regions: RegionDefinition[];
  variables: VariableRegistrySpec;
}

// ---------------------------------------------------------------------------
// Memoized reads
// ---------------------------------------------------------------------------

const entityViews = new WeakMap<SimPlacedEntityV3, PlacedEntity>();
const entityListViews = new WeakMap<SimPlacedEntityV3[], PlacedEntity[]>();

function entityView(e: SimPlacedEntityV3): PlacedEntity {
  let view = entityViews.get(e);
  if (!view) {
    view = placedEntityFromV3(e);
    entityViews.set(e, view);
  }
  return view;
}

function entityListView(list: SimPlacedEntityV3[]): PlacedEntity[] {
  let view = entityListViews.get(list);
  if (!view) {
    view = list.map(entityView);
    entityListViews.set(list, view);
  }
  return view;
}

const flatMatrices = new Map<string, number[][]>();
/** A shared, never-edited matrix of one value (edits copy rows before writing) */
function flatMatrix(size: number, value: number): number[][] {
  const key = `${size}:${value}`;
  let m = flatMatrices.get(key);
  if (!m) {
    m = Array.from({ length: size }, () => new Array<number>(size).fill(value));
    flatMatrices.set(key, m);
  }
  return m;
}

const NO_SLOPES: never[] = [];

const layerViews = new WeakMap<LevelLayerV3, EditorLayerData>();
function layerView(layer: LevelLayerV3, size: number): EditorLayerData {
  if (layer.floorHeights && layer.ceilingHeights && layer.slopes) return layer as EditorLayerData;
  let view = layerViews.get(layer);
  if (!view) {
    view = {
      ...layer,
      floorHeights: layer.floorHeights ?? flatMatrix(size, 0),
      ceilingHeights: layer.ceilingHeights ?? flatMatrix(size, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
      slopes: layer.slopes ?? NO_SLOPES,
    };
    layerViews.set(layer, view);
  }
  return view;
}

/** Remembers the last few results by their inputs, compared by identity */
function inputMemo<A extends readonly unknown[], R>(compute: (...args: A) => R, slots = 16) {
  const entries: { args: A; result: R }[] = [];
  return (...args: A): R => {
    const hit = entries.find((e) => e.args.length === args.length && e.args.every((a, i) => a === args[i]));
    if (hit) return hit.result;
    const result = compute(...args);
    entries.unshift({ args, result });
    if (entries.length > slots) entries.pop();
    return result;
  };
}

const layerListView = inputMemo((layers: LevelLayerV3[] | undefined, size: number): EditorLayerData[] =>
  (layers ?? []).map((l) => layerView(l, size))
);

const movementView = inputMemo((movement: LevelDataV3['movement']) => ({
  ...DEFAULT_MOVEMENT_SETTINGS,
  ...(movement ?? {}),
}));

const verticalView = inputMemo(
  (
    size: number,
    floorHeights: number[][] | undefined,
    ceilingHeights: number[][] | undefined,
    slopes: LevelDataV3['slopes'],
    layers: LevelLayerV3[] | undefined,
    movement: LevelDataV3['movement'],
    classic: boolean | undefined,
    spawnLayer: number | undefined
  ): VerticalLevelData => ({
    floorHeights: floorHeights ?? flatMatrix(size, SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS),
    ceilingHeights: ceilingHeights ?? flatMatrix(size, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
    slopes: slopes ?? NO_SLOPES,
    layers: layerListView(layers, size),
    movement: movementView(movement),
    spawnLayer: spawnLayer ?? 0,
    ...(classic ? { classic: true } : {}),
  })
);

const spawnView = inputMemo((row: number, col: number, yawBam: number): SpawnView => ({
  row,
  col,
  yaw: bamToRadians(yawBam),
}));

const levelViews = new WeakMap<ProjectLevel, EditorLevelView>();

/** The editor's view of a stored level; the same level object always gives the same view */
export function levelView(level: ProjectLevel): EditorLevelView {
  const cached = levelViews.get(level);
  if (cached) return cached;
  const d = level.data;
  const view: EditorLevelView = {
    id: level.id,
    title: level.title,
    gridSize: d.gridSize,
    grid: d.grid,
    wallTextures: d.wallTextures,
    floorTextures: d.floorTextures,
    ceilingTextures: d.ceilingTextures,
    entities: entityListView(d.entities),
    nextEntityId: d.nextEntityId,
    spawn: spawnView(d.spawn.row, d.spawn.col, d.spawn.yawBam),
    skyboxTheme: d.skybox.theme,
    skyboxSeed: d.skybox.seed,
    showCeiling: d.skybox.showCeiling,
    minimapEnabled: d.minimapEnabled,
    vertical: verticalView(
      d.gridSize,
      d.floorHeights,
      d.ceilingHeights,
      d.slopes,
      d.layers,
      d.movement,
      d.classicMovement,
      d.spawn.layer
    ),
    ...(d.cellTags ? { cellTags: d.cellTags } : {}),
    events: d.events,
    regions: d.regions,
    variables: d.variables,
  };
  levelViews.set(level, view);
  return view;
}

// ---------------------------------------------------------------------------
// Writes: editor values to stored fields
// ---------------------------------------------------------------------------

export function entityToStored(entity: PlacedEntity, gridSize: number): SimPlacedEntityV3 {
  return placedEntityToV3(entity, gridSize);
}

export function spawnToStored(spawn: SpawnView, layer: number): LevelDataV3['spawn'] {
  return {
    row: Math.trunc(spawn.row),
    col: Math.trunc(spawn.col),
    yawBam: radiansToBam(spawn.yaw || 0),
    ...(layer > 0 ? { layer: Math.trunc(layer) } : {}),
  };
}

const isUniform = (m: number[][], v: number) => m.every((row) => row.every((x) => x === v));

/**
 * The stored height, slope and layer fields for editor vertical data. Parts that match a flat
 * level are `undefined`, which removes them from the level (see the `vertical/set` action).
 */
export function verticalToStored(v: VerticalLevelData): {
  floorHeights: number[][] | undefined;
  ceilingHeights: number[][] | undefined;
  slopes: LevelDataV3['slopes'];
  layers: LevelLayerV3[] | undefined;
} {
  return {
    floorHeights: isUniform(v.floorHeights, SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS) ? undefined : v.floorHeights,
    ceilingHeights: isUniform(v.ceilingHeights, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS) ? undefined : v.ceilingHeights,
    slopes: v.slopes.length > 0 ? v.slopes : undefined,
    layers: v.layers.length > 0 ? v.layers : undefined,
  };
}

// ---------------------------------------------------------------------------
// Whole-level conversions
// ---------------------------------------------------------------------------

/** The fields every LevelSerializer call takes, read from a level view */
function serializerParams(view: EditorLevelView) {
  return {
    title: view.title,
    grid: view.grid,
    wallTextures: view.wallTextures,
    floorTextures: view.floorTextures,
    ceilingTextures: view.ceilingTextures,
    entities: view.entities,
    nextEntityId: view.nextEntityId,
    spawn: view.spawn,
    skyboxTheme: view.skyboxTheme,
    skyboxSeed: view.skyboxSeed,
    showCeiling: view.showCeiling,
    minimapEnabled: view.minimapEnabled,
    cellTags: view.cellTags,
    events: view.events,
    regions: view.regions,
    variables: view.variables,
    // Flat levels keep the exact original level data
    vertical: isFlatVerticalData(view.vertical) && !view.vertical.classic ? undefined : view.vertical,
  };
}

const runtimeLevels = new WeakMap<ProjectLevel, LevelDataV3>();

/** A fresh copy of the level as the game runtime receives it (the playtest may keep and change it) */
export function buildRuntimeLevel(level: ProjectLevel): LevelDataV3 {
  return LevelSerializer.serializeLevelV3(serializerParams(levelView(level)));
}

/**
 * The level as the game runtime receives it, built the same way playtest and export always
 * built it. Memoized per stored level.
 */
export function runtimeLevelOf(level: ProjectLevel): LevelDataV3 {
  let out = runtimeLevels.get(level);
  if (!out) {
    out = buildRuntimeLevel(level);
    runtimeLevels.set(level, out);
  }
  return out;
}

/** The level in the editor save format (LevelStateData), for save files and the export dialog */
export function levelStateOf(level: ProjectLevel, customTextures: TextureAsset[]): LevelStateData {
  return LevelSerializer.serializeLevel({ ...serializerParams(levelView(level)), customTextures });
}

/** Stored level data built from an editor save level (file load, presets, new levels) */
export function storedLevelFrom(state: {
  title?: string;
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  entities: PlacedEntity[];
  nextEntityId?: number;
  spawn: SpawnView;
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  minimapEnabled: boolean;
  cellTags?: number[][];
  events?: EventDefinition[];
  regions?: RegionDefinition[];
  variables?: VariableRegistrySpec;
  vertical?: VerticalLevelData;
}): LevelDataV3 {
  return LevelSerializer.serializeLevelV3({
    ...state,
    events: state.events ?? [],
    regions: state.regions ?? [],
  });
}

/** Stored level data for one editor save level (LevelStateData) */
export function storedLevelFromState(state: LevelStateData): LevelDataV3 {
  return storedLevelFrom({
    title: state.title,
    grid: state.grid,
    wallTextures: state.wallTextures,
    floorTextures: state.floorTextures,
    ceilingTextures: state.ceilingTextures,
    entities: state.entities,
    nextEntityId: state.nextEntityId,
    spawn: state.spawn,
    skyboxTheme: state.skybox.theme,
    skyboxSeed: state.skybox.seed,
    showCeiling: state.skybox.showCeiling,
    minimapEnabled: typeof state.minimapEnabled === 'boolean' ? state.minimapEnabled : true,
    cellTags: state.cellTags,
    events: state.events,
    regions: state.regions,
    variables: state.variables,
    vertical: state.vertical,
  });
}

/** A level's data rebuilt from an edited view (resize, clear) */
export function storedLevelFromView(view: EditorLevelView): LevelDataV3 {
  return storedLevelFrom({ ...view, vertical: view.vertical });
}
