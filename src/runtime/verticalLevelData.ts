/**
 * ============================================================================
 * VERTICAL LEVEL DATA <-> LEVEL FORMAT V3 CONVERSION
 * ============================================================================
 * The editor keeps vertical data in meters and radians (`VerticalLevelData`,
 * `PlacedEntity`); levels store sim units and BAM angles. Model positions keep
 * three decimals of a unit so they come back exactly where they were placed.
 * Only parts that differ from a flat level are written, so flat levels
 * serialize exactly as before.
 */

import {
  ENGINE_CONFIG,
  PlacedEntity,
  VerticalLevelData,
  createDefaultVerticalData,
  resizeSquareMatrix,
} from './types';
import {
  DEFAULT_MOVEMENT_SETTINGS,
  LevelDataV3,
  SIM_CONFIG,
  SimPlacedEntityV3,
  bamToRadians,
  radiansToBam,
  verticalFeaturesOf,
} from './sim';

/** 1 cell = 4 m = 1000 units */
export const UNITS_PER_METER = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE;

/** Meters to units, kept to three decimals (finer than a millimeter) */
function fineUnits(meters: number): number {
  return Math.round(meters * UNITS_PER_METER * 1000) / 1000 || 0;
}

/** Signed radians (-pi..pi] from a BAM angle, so small tilts read as small numbers */
function bamToSignedRadians(bam: number): number {
  const r = bamToRadians(bam);
  return r > Math.PI ? r - 2 * Math.PI : r;
}

/** Converts an editor entity's free 3D placement to the integer level format */
export function verticalPlacementToV3(ent: PlacedEntity): Partial<SimPlacedEntityV3> {
  const out: Partial<SimPlacedEntityV3> = {};
  if (ent.layer !== undefined && ent.layer > 0) out.layer = Math.trunc(ent.layer);
  const ox = fineUnits(ent.offsetX ?? 0);
  const oz = fineUnits(ent.offsetZ ?? 0);
  if (ox !== 0) out.offsetXUnits = ox;
  if (oz !== 0) out.offsetZUnits = oz;
  if (ent.elevation !== undefined) out.elevationUnits = fineUnits(ent.elevation);
  const pitchBam = radiansToBam(ent.pitch ?? 0);
  const rollBam = radiansToBam(ent.roll ?? 0);
  if (pitchBam !== 0) out.pitchBam = pitchBam;
  if (rollBam !== 0) out.rollBam = rollBam;
  if (ent.walkable) {
    out.walkable = true;
    if (ent.walkSurface) {
      out.walkSurface = {
        ...ent.walkSurface,
        top: [...ent.walkSurface.top],
        bottom: [...ent.walkSurface.bottom],
      };
    }
  }
  if (
    ent.modelBottomUnits !== undefined &&
    ent.modelTopUnits !== undefined &&
    ent.modelTopUnits > ent.modelBottomUnits
  ) {
    out.modelBottomUnits = Math.round(ent.modelBottomUnits);
    out.modelTopUnits = Math.round(ent.modelTopUnits);
  }
  return out;
}

/** Converts a level entity's free 3D placement back to editor meters and radians */
export function verticalPlacementFromV3(e: SimPlacedEntityV3): Partial<PlacedEntity> {
  const out: Partial<PlacedEntity> = {};
  if (e.layer !== undefined) out.layer = e.layer;
  if (e.offsetXUnits !== undefined) out.offsetX = e.offsetXUnits / UNITS_PER_METER;
  if (e.offsetZUnits !== undefined) out.offsetZ = e.offsetZUnits / UNITS_PER_METER;
  if (e.elevationUnits !== undefined) out.elevation = e.elevationUnits / UNITS_PER_METER;
  if (e.pitchBam !== undefined) out.pitch = bamToSignedRadians(e.pitchBam);
  if (e.rollBam !== undefined) out.roll = bamToSignedRadians(e.rollBam);
  if (e.walkable !== undefined) out.walkable = e.walkable;
  if (e.walkSurface !== undefined) out.walkSurface = e.walkSurface;
  if (e.modelBottomUnits !== undefined) out.modelBottomUnits = e.modelBottomUnits;
  if (e.modelTopUnits !== undefined) out.modelTopUnits = e.modelTopUnits;
  return out;
}

/** Copies the editor's free 3D placement fields that are present on an untrusted entity */
export function pickEditorVerticalPlacement(e: Partial<PlacedEntity>): Partial<PlacedEntity> {
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: Partial<PlacedEntity> = {};
  if (num(e.layer)) out.layer = Math.trunc(e.layer);
  if (num(e.offsetX)) out.offsetX = e.offsetX;
  if (num(e.offsetZ)) out.offsetZ = e.offsetZ;
  if (num(e.elevation)) out.elevation = e.elevation;
  if (num(e.pitch)) out.pitch = e.pitch;
  if (num(e.roll)) out.roll = e.roll;
  if (typeof e.walkable === 'boolean') out.walkable = e.walkable;
  if (e.walkSurface && typeof e.walkSurface === 'object') out.walkSurface = e.walkSurface;
  if (num(e.modelBottomUnits)) out.modelBottomUnits = Math.round(e.modelBottomUnits);
  if (num(e.modelTopUnits)) out.modelTopUnits = Math.round(e.modelTopUnits);
  return out;
}

const isUniform = (m: number[][], v: number) => m.every((row) => row.every((x) => x === v));

/**
 * The level fields for a level's vertical data. Only parts that differ from a flat level
 * are written, so a flat level saves exactly as before and stays flat when loaded
 * (see `isVerticalLevel` in `sim/vertical.ts`).
 */
export function verticalToLevelV3Fields(
  vertical: VerticalLevelData | undefined,
  gridSize: number
): Partial<LevelDataV3> {
  if (!vertical) return {};
  const out: Partial<LevelDataV3> = {};
  const ints = (m: number[][], fill: number) =>
    resizeSquareMatrix(m, gridSize, fill).map((row) => row.map((h) => Math.trunc(h)));
  const floors = ints(vertical.floorHeights, 0);
  const ceilings = ints(vertical.ceilingHeights, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS);
  if (!isUniform(floors, 0)) out.floorHeights = floors;
  if (!isUniform(ceilings, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS)) out.ceilingHeights = ceilings;
  if (vertical.slopes.length > 0) out.slopes = vertical.slopes.map((sl) => ({ ...sl }));
  if (vertical.layers.length > 0) {
    out.layers = vertical.layers.map((layer) => ({
      grid: layer.grid.map((row) => row.map((c) => Math.trunc(c))),
      wallTextures: layer.wallTextures.map((row) => [...row]),
      floorTextures: layer.floorTextures.map((row) => [...row]),
      ceilingTextures: layer.ceilingTextures.map((row) => [...row]),
      floorHeights: ints(layer.floorHeights, 0),
      ceilingHeights: ints(layer.ceilingHeights, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
      ...(layer.slopes.length > 0 ? { slopes: layer.slopes.map((sl) => ({ ...sl })) } : {}),
    }));
  }
  const m = vertical.movement;
  const d = DEFAULT_MOVEMENT_SETTINGS;
  if (
    m.jump !== d.jump ||
    m.crouch !== d.crouch ||
    m.stepUnits !== d.stepUnits ||
    m.fallDamage !== d.fallDamage ||
    m.aim !== d.aim
  ) {
    out.movement = { ...m, stepUnits: Math.trunc(m.stepUnits) };
  }
  if (vertical.classic) out.classicMovement = true;
  return out;
}

/**
 * The vertical features an editor level uses (layers, heights, 3D-placed models, ...), in
 * words for the maker; empty when the level is flat. Uses the game's own test.
 */
export function editorVerticalFeatures(
  grid: number[][],
  vertical: VerticalLevelData,
  entities: PlacedEntity[]
): string[] {
  const size = grid.length;
  return verticalFeaturesOf({
    grid,
    spawn: { row: 0, col: 0, yawBam: 0, ...(vertical.spawnLayer > 0 ? { layer: vertical.spawnLayer } : {}) },
    ...verticalToLevelV3Fields(vertical, size),
    entities: entities.map(
      (e) => ({ id: e.id, row: e.row, col: e.col, ...verticalPlacementToV3(e) }) as SimPlacedEntityV3
    ),
  } as LevelDataV3);
}

/** The editor's vertical data for a level, or `undefined` when the level is flat */
export function verticalFromLevelV3(levelV3: LevelDataV3): VerticalLevelData | undefined {
  const hasAny =
    levelV3.floorHeights ||
    levelV3.ceilingHeights ||
    levelV3.slopes ||
    levelV3.layers ||
    levelV3.movement ||
    levelV3.classicMovement ||
    levelV3.spawn.layer !== undefined;
  if (!hasAny) return undefined;
  const size = levelV3.gridSize;
  const flat = createDefaultVerticalData(size);
  return {
    floorHeights: levelV3.floorHeights?.map((r) => [...r]) ?? flat.floorHeights,
    ceilingHeights: levelV3.ceilingHeights?.map((r) => [...r]) ?? flat.ceilingHeights,
    slopes: levelV3.slopes?.map((sl) => ({ ...sl })) ?? [],
    layers: (levelV3.layers ?? []).map((layer) => ({
      grid: layer.grid.map((r) => [...r]),
      wallTextures: layer.wallTextures.map((r) => [...r]),
      floorTextures: layer.floorTextures.map((r) => [...r]),
      ceilingTextures: layer.ceilingTextures.map((r) => [...r]),
      floorHeights: layer.floorHeights?.map((r) => [...r]) ?? flat.floorHeights.map((r) => [...r]),
      ceilingHeights:
        layer.ceilingHeights?.map((r) => [...r]) ?? flat.ceilingHeights.map((r) => [...r]),
      slopes: layer.slopes?.map((sl) => ({ ...sl })) ?? [],
    })),
    movement: { ...DEFAULT_MOVEMENT_SETTINGS, ...(levelV3.movement ?? {}) },
    spawnLayer: levelV3.spawn.layer ?? 0,
    ...(levelV3.classicMovement ? { classic: true } : {}),
  };
}

/**
 * Reads the `vertical` block of an editor save. Only the shape is checked here; the
 * level built from it is validated in full afterwards.
 */
export function readEditorVerticalData(
  raw: unknown,
  gridSize: number
): VerticalLevelData | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Partial<VerticalLevelData>;
  const flat = createDefaultVerticalData(gridSize);
  const matrix = (m: unknown, fallback: number[][]) =>
    Array.isArray(m) && m.length === gridSize ? (m as number[][]) : fallback;
  return {
    floorHeights: matrix(v.floorHeights, flat.floorHeights),
    ceilingHeights: matrix(v.ceilingHeights, flat.ceilingHeights),
    slopes: Array.isArray(v.slopes) ? v.slopes : [],
    layers: Array.isArray(v.layers) ? v.layers : [],
    movement:
      v.movement && typeof v.movement === 'object'
        ? { ...DEFAULT_MOVEMENT_SETTINGS, ...v.movement }
        : { ...DEFAULT_MOVEMENT_SETTINGS },
    spawnLayer: typeof v.spawnLayer === 'number' ? Math.trunc(v.spawnLayer) : 0,
    ...(v.classic === true ? { classic: true } : {}),
  };
}
