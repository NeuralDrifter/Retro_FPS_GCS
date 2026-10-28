/**
 * ============================================================================
 * PURE INTEGER VERTICAL WORLD: STACKED LAYERS, TILE HEIGHTS, SLOPES, HOLES
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 *
 * Layer k spans heights k * 1000 .. (k + 1) * 1000. At any point of the map,
 * the open air forms a few vertical spans (one per layer, merged where a hole
 * removes the floor between two layers). Movement asks which span an actor
 * stands in, how high its floor is there, and how much head room it has.
 */

import { gridToWorldUnits, isDoorPassable, worldUnitsToGrid } from './raycast';
import { isqrt } from './trigTable';
import {
  getFootprintRect,
  isStaticFootprintSource,
  getFootprintCenter,
} from './footprint';
import {
  DEFAULT_MOVEMENT_SETTINGS,
  FloorSlopeSpec,
  LevelDataV3,
  MoverSimState,
  MovementSettingsSpec,
  SimCellType,
  SimLayerState,
  SimPlacedEntityV3,
  SIM_CONFIG,
  SlopeSurface,
  SolidModelBox,
  VerticalSimState,
  WALK_SURFACE_EMPTY,
  WalkSurfaceSpec,
} from './types';

const LAYER = SIM_CONFIG.LAYER_HEIGHT_UNITS;
const CELL = SIM_CONFIG.CELL_UNITS;
/** Floor of a bottomless pit */
export const NO_FLOOR_UNITS = -1_000_000_000;

/** A vertical stretch of open air at one point of the map, in absolute units */
export interface OpenSpan {
  floorUnits: number;
  ceilingUnits: number;
  /** Layers whose floor and ceiling bound the span (for picking textures when drawing) */
  floorLayer?: number;
  ceilingLayer?: number;
}

/** What the vertical queries read; `SimulationState` satisfies it */
export interface VerticalWorldView {
  gridSize: number;
  grid: number[][];
  floorHeights: number[][];
  ceilingHeights: number[][];
  movers: Record<string, MoverSimState>;
  vertical?: VerticalSimState;
}

// ----------------------------------------------------------------------------
// Detecting and building the vertical state
// ----------------------------------------------------------------------------

function anyCell(matrix: number[][] | undefined, test: (v: number) => boolean): boolean {
  return Boolean(matrix?.some((row) => row.some(test)));
}

function entityUsesVertical(ent: SimPlacedEntityV3): boolean {
  return (
    (ent.layer ?? 0) > 0 ||
    ent.elevationUnits !== undefined ||
    Boolean(ent.walkable) ||
    (ent.pitchBam ?? 0) !== 0 ||
    (ent.rollBam ?? 0) !== 0
  );
}

/** True when a level uses any vertical feature, so it needs the vertical movement code */
export function isVerticalLevel(level: LevelDataV3): boolean {
  const movement = level.movement;
  return (
    (level.layers?.length ?? 0) > 0 ||
    (level.slopes?.length ?? 0) > 0 ||
    (level.spawn.layer ?? 0) > 0 ||
    anyCell(level.grid, (v) => v === SimCellType.HOLE) ||
    anyCell(level.floorHeights, (v) => v !== SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS) ||
    anyCell(level.ceilingHeights, (v) => v !== SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS) ||
    Boolean(movement?.jump || movement?.crouch || movement?.fallDamage) ||
    (movement !== undefined && movement.stepUnits !== DEFAULT_MOVEMENT_SETTINGS.stepUnits) ||
    level.entities.some(entityUsesVertical)
  );
}

const constMatrix = (size: number, val: number) =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => val));

/** Absolute height of an entity's origin: its elevation, or the floor under its anchor */
export function entityBaseUnits(
  ent: SimPlacedEntityV3,
  view: Pick<VerticalWorldView, 'floorHeights'> & { vertical?: Pick<VerticalSimState, 'layers'> }
): number {
  const layer = Math.max(0, Math.trunc(ent.layer ?? 0));
  if (ent.elevationUnits !== undefined) return layer * LAYER + Math.round(ent.elevationUnits);
  const heights = layer === 0 ? view.floorHeights : view.vertical?.layers[layer - 1]?.floorHeights;
  return layer * LAYER + (heights?.[ent.row]?.[ent.col] ?? 0);
}

/**
 * Builds the vertical state for a level, or `undefined` for flat levels so they keep the
 * original movement code and their state (and hashes) stay exactly as before.
 */
export function buildVerticalSimState(level: LevelDataV3): VerticalSimState | undefined {
  if (!isVerticalLevel(level)) return undefined;
  const size = level.gridSize;

  const layers: SimLayerState[] = (level.layers ?? []).map((layer) => ({
    grid: layer.grid.map((r) => r.map((c) => Math.trunc(c))),
    wallTextures: layer.wallTextures.map((r) => [...r]),
    floorTextures: layer.floorTextures.map((r) => [...r]),
    ceilingTextures: layer.ceilingTextures.map((r) => [...r]),
    floorHeights: layer.floorHeights
      ? layer.floorHeights.map((r) => [...r])
      : constMatrix(size, 0),
    ceilingHeights: layer.ceilingHeights
      ? layer.ceilingHeights.map((r) => [...r])
      : constMatrix(size, SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS),
    slopes: (layer.slopes ?? []).map((s) => ({ ...s })),
  }));

  const movement: MovementSettingsSpec = { ...DEFAULT_MOVEMENT_SETTINGS, ...(level.movement ?? {}) };
  const layer0Floors = level.floorHeights ?? constMatrix(size, 0);
  const heightView = { floorHeights: layer0Floors, vertical: { layers } };

  const walkSurfaces: WalkSurfaceSpec[] = [];
  const solidBoxes: SolidModelBox[] = [];
  for (const ent of level.entities) {
    if (ent.walkable && ent.walkSurface) {
      walkSurfaces.push(cloneWalkSurface(ent.walkSurface));
      continue;
    }
    if (!isStaticFootprintSource(ent) || ent.collision !== 'solid') continue;
    const rect = getFootprintRect(ent);
    const base = entityBaseUnits(ent, heightView);
    // Models the editor has measured block only their own height; others a whole layer
    const measured =
      ent.modelBottomUnits !== undefined &&
      ent.modelTopUnits !== undefined &&
      ent.modelTopUnits > ent.modelBottomUnits;
    solidBoxes.push({
      row0: rect.row0,
      col0: rect.col0,
      row1: rect.row1,
      col1: rect.col1,
      bottomUnits: measured ? base + ent.modelBottomUnits! : base,
      topUnits: measured ? base + ent.modelTopUnits! : base + LAYER,
    });
  }

  return {
    slopes: (level.slopes ?? []).map((s) => ({ ...s })),
    layers,
    movement,
    walkSurfaces,
    solidBoxes,
  };
}

function cloneWalkSurface(ws: WalkSurfaceSpec): WalkSurfaceSpec {
  return { ...ws, top: [...ws.top], bottom: [...ws.bottom] };
}

/** Where a character entity stands at level start: on the floor of its layer at its footprint center */
export function entitySpawnPointUnits(
  ent: SimPlacedEntityV3,
  view: VerticalWorldView
): { xUnits: number; zUnits: number; yUnits: number } {
  const center = getFootprintCenter(ent, view.gridSize);
  const x = center.xUnits + Math.round(ent.offsetXUnits ?? 0);
  const z = center.zUnits + Math.round(ent.offsetZUnits ?? 0);
  const base = entityBaseUnits(ent, view);
  const support = findSupportUnits(view, x, z, base, SIM_CONFIG.DEFAULT_STEP_UNITS);
  return { xUnits: x, zUnits: z, yUnits: support === NO_FLOOR_UNITS ? base : support };
}

// ----------------------------------------------------------------------------
// Point queries
// ----------------------------------------------------------------------------

/** Cell bounds in world units */
function cellBounds(row: number, col: number, gridSize: number) {
  const halfWorld = Math.trunc((gridSize * CELL) / 2);
  const minX = -halfWorld + col * CELL;
  const minZ = -halfWorld + row * CELL;
  return { minX, minZ, maxX: minX + CELL, maxZ: minZ + CELL };
}

/** The floor slope (or ceiling slope) of a tile, if it has one */
export function findSlope(
  slopes: FloorSlopeSpec[],
  row: number,
  col: number,
  surface: SlopeSurface = 'floor'
): FloorSlopeSpec | undefined {
  for (const s of slopes) {
    if (s.row === row && s.col === col && (s.surface ?? 'floor') === surface) return s;
  }
  return undefined;
}

/**
 * Floor (or ceiling) height of a tile at a point inside it, relative to its layer's base.
 * A sloped tile rises linearly from its stored height on the low edge to height + rise on the high edge.
 */
export function tileFloorAt(
  baseFloor: number,
  slope: FloorSlopeSpec | undefined,
  row: number,
  col: number,
  xUnits: number,
  zUnits: number,
  gridSize: number
): number {
  if (!slope || slope.riseUnits === 0) return baseFloor;
  const b = cellBounds(row, col, gridSize);
  const clampX = Math.max(b.minX, Math.min(b.maxX, xUnits));
  const clampZ = Math.max(b.minZ, Math.min(b.maxZ, zUnits));
  // 0 at the low edge, CELL at the high edge; north is -z (lower rows), east is +x
  const along =
    slope.dir === 'N'
      ? b.maxZ - clampZ
      : slope.dir === 'S'
      ? clampZ - b.minZ
      : slope.dir === 'E'
      ? clampX - b.minX
      : b.maxX - clampX;
  return baseFloor + Math.trunc((slope.riseUnits * along) / CELL);
}

interface LayerView {
  grid: number[][];
  floorHeights: number[][];
  ceilingHeights: number[][];
  slopes: FloorSlopeSpec[];
}

function layerViews(view: VerticalWorldView): LayerView[] {
  return [
    {
      grid: view.grid,
      floorHeights: view.floorHeights,
      ceilingHeights: view.ceilingHeights,
      slopes: view.vertical?.slopes ?? [],
    },
    ...(view.vertical?.layers ?? []),
  ];
}

/** True when the ground-layer cell is solid right now (walls, closed doors) */
function isGroundCellSolid(view: VerticalWorldView, row: number, col: number): boolean {
  const cell = view.grid[row][col];
  if (cell === SimCellType.WALL) {
    const pushwall = view.movers[`pushwall:${row},${col}`];
    return !(pushwall && pushwall.state === 'active');
  }
  if (cell === SimCellType.DOOR) return !isDoorPassable(row, col, view.movers);
  return false;
}

/** Cell type of a tile on any layer (layer 0 is the ground grid) */
export function cellOnLayer(
  view: Pick<VerticalWorldView, 'grid' | 'vertical'>,
  layer: number,
  row: number,
  col: number
): number {
  const grid = layer === 0 ? view.grid : view.vertical?.layers[layer - 1]?.grid;
  return grid?.[row]?.[col] ?? SimCellType.WALL;
}

/**
 * Layer an actor is on, from its feet: standing on a layer's floor counts as that layer.
 * A little slack keeps an actor on its layer while it bobs over a seam.
 */
export function actorLayer(view: { vertical?: VerticalSimState }, feetUnits: number): number {
  return layerAtHeight(feetUnits + 1, layerCountOf(view));
}

/**
 * Open air spans of one tile's column, from the ground layer up, at a point inside the tile.
 * Models are not included; see `openSpansAt`.
 */
export function tileColumnSpans(
  view: VerticalWorldView,
  row: number,
  col: number,
  xUnits: number,
  zUnits: number
): OpenSpan[] {
  const spans: OpenSpan[] = [];
  const layers = layerViews(view);
  let below: OpenSpan | null = null;

  for (let k = 0; k < layers.length; k++) {
    const layer = layers[k];
    const base = k * LAYER;
    const cell = layer.grid[row]?.[col] ?? SimCellType.WALL;
    const solid =
      k === 0
        ? isGroundCellSolid(view, row, col)
        : cell === SimCellType.WALL ||
          (cell === SimCellType.DOOR && !isDoorPassable(row, col, view.movers, k));
    if (solid) {
      below = null;
      continue;
    }
    // A sloped ceiling never reaches past the top of its layer
    const ceiling =
      base +
      Math.min(
        LAYER,
        tileFloorAt(
          layer.ceilingHeights[row]?.[col] ?? LAYER,
          findSlope(layer.slopes, row, col, 'ceiling'),
          row,
          col,
          xUnits,
          zUnits,
          view.gridSize
        )
      );
    if (cell === SimCellType.HOLE) {
      if (k === 0) {
        below = { floorUnits: NO_FLOOR_UNITS, ceilingUnits: ceiling, floorLayer: 0, ceilingLayer: 0 };
        spans.push(below);
      } else if (below) {
        // No floor between the two layers: the lower room reaches up into this one
        below.ceilingUnits = ceiling;
        below.ceilingLayer = k;
      } else {
        // A hole over solid wall: you stand on top of the wall
        below = { floorUnits: base, ceilingUnits: ceiling, floorLayer: k, ceilingLayer: k };
        spans.push(below);
      }
      continue;
    }
    const floor =
      base +
      tileFloorAt(
        layer.floorHeights[row]?.[col] ?? 0,
        findSlope(layer.slopes, row, col),
        row,
        col,
        xUnits,
        zUnits,
        view.gridSize
      );
    below = {
      floorUnits: floor,
      ceilingUnits: Math.max(floor, ceiling),
      floorLayer: k,
      ceilingLayer: k,
    };
    spans.push(below);
  }
  return spans;
}

/** Removes the solid stretch [bottom, top] from a list of open spans */
function subtractSolid(spans: OpenSpan[], bottom: number, top: number): OpenSpan[] {
  if (top <= bottom) return spans;
  const out: OpenSpan[] = [];
  for (const s of spans) {
    if (top <= s.floorUnits || bottom >= s.ceilingUnits) {
      out.push(s);
      continue;
    }
    if (bottom > s.floorUnits) out.push({ ...s, ceilingUnits: bottom });
    if (top < s.ceilingUnits) out.push({ ...s, floorUnits: top });
  }
  return out;
}

/** Top and bottom of a walkable model at a point, or null when it does not cover the point */
export function walkSurfaceAt(
  ws: WalkSurfaceSpec,
  xUnits: number,
  zUnits: number
): { topUnits: number; bottomUnits: number } | null {
  const sp = Math.max(1, ws.spacingUnits);
  const fx = xUnits - ws.originXUnits;
  const fz = zUnits - ws.originZUnits;
  if (fx < 0 || fz < 0) return null;
  const c0 = Math.trunc(fx / sp);
  const r0 = Math.trunc(fz / sp);
  if (c0 >= ws.cols || r0 >= ws.rows) return null;
  const tx = fx - c0 * sp;
  const tz = fz - r0 * sp;
  const nearestC = Math.min(ws.cols - 1, c0 + (tx * 2 >= sp ? 1 : 0));
  const nearestR = Math.min(ws.rows - 1, r0 + (tz * 2 >= sp ? 1 : 0));
  const nearest = nearestR * ws.cols + nearestC;
  if (ws.top[nearest] === WALK_SURFACE_EMPTY) return null;

  // Blend the top between the four samples around the point when all four are covered
  const c1 = Math.min(ws.cols - 1, c0 + 1);
  const r1 = Math.min(ws.rows - 1, r0 + 1);
  const t00 = ws.top[r0 * ws.cols + c0];
  const t10 = ws.top[r0 * ws.cols + c1];
  const t01 = ws.top[r1 * ws.cols + c0];
  const t11 = ws.top[r1 * ws.cols + c1];
  let top = ws.top[nearest];
  if (
    t00 !== WALK_SURFACE_EMPTY &&
    t10 !== WALK_SURFACE_EMPTY &&
    t01 !== WALK_SURFACE_EMPTY &&
    t11 !== WALK_SURFACE_EMPTY
  ) {
    const north = t00 * (sp - tx) + t10 * tx;
    const south = t01 * (sp - tx) + t11 * tx;
    top = Math.trunc((north * (sp - tz) + south * tz) / (sp * sp));
  }
  return { topUnits: top, bottomUnits: ws.bottom[nearest] };
}

/** Steepness of a walkable model at a point, as rise per run in percent */
export function walkSurfaceGradientPct(ws: WalkSurfaceSpec, xUnits: number, zUnits: number): number {
  const sp = Math.max(1, ws.spacingUnits);
  const here = walkSurfaceAt(ws, xUnits, zUnits);
  if (!here) return 0;
  let steepest = 0;
  for (const [dx, dz] of [
    [sp, 0],
    [-sp, 0],
    [0, sp],
    [0, -sp],
  ]) {
    const there = walkSurfaceAt(ws, xUnits + dx, zUnits + dz);
    if (!there) continue;
    steepest = Math.max(steepest, Math.trunc((Math.abs(there.topUnits - here.topUnits) * 100) / sp));
  }
  return steepest;
}

/** Open air spans at a point, including solid models and walkable model shapes */
export function openSpansAt(view: VerticalWorldView, xUnits: number, zUnits: number): OpenSpan[] {
  const { row, col } = worldUnitsToGrid(xUnits, zUnits, view.gridSize);
  if (row < 0 || col < 0 || row >= view.gridSize || col >= view.gridSize) return [];
  let spans = tileColumnSpans(view, row, col, xUnits, zUnits);
  const vertical = view.vertical;
  if (!vertical) return spans;

  for (const box of vertical.solidBoxes) {
    if (row < box.row0 || row > box.row1 || col < box.col0 || col > box.col1) continue;
    spans = subtractSolid(spans, box.bottomUnits, box.topUnits);
  }
  for (const ws of vertical.walkSurfaces) {
    const hit = walkSurfaceAt(ws, xUnits, zUnits);
    if (hit) spans = subtractSolid(spans, hit.bottomUnits, hit.topUnits);
  }
  return spans;
}

/**
 * The span an actor with its feet at `feetUnits` can be in at a point: the highest floor
 * it can reach (at most `stepUnits` above its feet) that still has air above its feet.
 */
export function spanForFeet(
  spans: OpenSpan[],
  feetUnits: number,
  stepUnits: number
): OpenSpan | null {
  let best: OpenSpan | null = null;
  for (const s of spans) {
    if (s.floorUnits > feetUnits + stepUnits) continue;
    if (s.ceilingUnits <= Math.max(s.floorUnits, feetUnits)) continue;
    if (!best || s.floorUnits > best.floorUnits) best = s;
  }
  return best;
}

/** Height of the floor an actor would stand on at a point, or `NO_FLOOR_UNITS` */
export function findSupportUnits(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  feetUnits: number,
  stepUnits: number
): number {
  const span = spanForFeet(openSpansAt(view, xUnits, zUnits), feetUnits, stepUnits);
  return span ? span.floorUnits : NO_FLOOR_UNITS;
}

/** Lowest ceiling above an actor's feet at a point (very high when there is none) */
export function findCeilingUnits(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  feetUnits: number,
  stepUnits: number
): number {
  const span = spanForFeet(openSpansAt(view, xUnits, zUnits), feetUnits, stepUnits);
  return span ? span.ceilingUnits : feetUnits;
}

/** True when an actor fits at a point: a reachable floor with enough head room above it */
function fitsAtPoint(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  feetUnits: number,
  bodyUnits: number,
  stepUnits: number
): boolean {
  const span = spanForFeet(openSpansAt(view, xUnits, zUnits), feetUnits, stepUnits);
  if (!span) return false;
  return span.ceilingUnits - Math.max(span.floorUnits, feetUnits) >= bodyUnits;
}

/** Sliding push walls block the ground layer along their path */
function hitsMovingPushwall(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  feetUnits: number
): boolean {
  if (feetUnits >= LAYER) return false;
  const halfWorld = Math.trunc((view.gridSize * CELL) / 2);
  const rSq = radiusUnits * radiusUnits;
  for (const mKey of Object.keys(view.movers)) {
    const mover = view.movers[mKey];
    if (!mover || mover.kind !== 'pushwall' || mover.state !== 'active') continue;
    const dRow = mover.direction === 'N' ? -1 : mover.direction === 'S' ? 1 : 0;
    const dCol = mover.direction === 'E' ? 1 : mover.direction === 'W' ? -1 : 0;
    const offset = Math.trunc(
      ((mover.distanceCells ?? 2) * CELL * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
    );
    const minX = -halfWorld + mover.col * CELL + dCol * offset;
    const minZ = -halfWorld + mover.row * CELL + dRow * offset;
    const dx = xUnits - Math.max(minX, Math.min(xUnits, minX + CELL));
    const dz = zUnits - Math.max(minZ, Math.min(zUnits, minZ + CELL));
    if (dx * dx + dz * dz < rSq) return true;
  }
  return false;
}

/**
 * True when a circular actor cannot be at (x, z) with its feet at `feetUnits`: a wall, a
 * floor higher than one step, too little head room, a solid model, or the map edge.
 * Checks the nearest point of each nearby tile plus points around the circle, so it also
 * catches the shapes of walkable models.
 */
export function isBlockedVertical(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  feetUnits: number,
  bodyUnits: number,
  stepUnits: number
): boolean {
  const gridSize = view.gridSize;
  const halfWorld = Math.trunc((gridSize * CELL) / 2);
  if (
    xUnits - radiusUnits < -halfWorld ||
    xUnits + radiusUnits > halfWorld ||
    zUnits - radiusUnits < -halfWorld ||
    zUnits + radiusUnits > halfWorld
  ) {
    return true;
  }
  if (hitsMovingPushwall(view, xUnits, zUnits, radiusUnits, feetUnits)) return true;

  const center = worldUnitsToGrid(xUnits, zUnits, gridSize);
  const rSq = radiusUnits * radiusUnits;
  for (let r = center.row - 1; r <= center.row + 1; r++) {
    for (let c = center.col - 1; c <= center.col + 1; c++) {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
      const b = cellBounds(r, c, gridSize);
      // Stay 1 unit inside the cell so the point belongs to it, not its neighbour
      const px = Math.max(b.minX, Math.min(b.maxX - 1, xUnits));
      const pz = Math.max(b.minZ, Math.min(b.maxZ - 1, zUnits));
      const dx = xUnits - px;
      const dz = zUnits - pz;
      if (dx * dx + dz * dz >= rSq) continue;
      if (!fitsAtPoint(view, px, pz, feetUnits, bodyUnits, stepUnits)) return true;
    }
  }

  if (view.vertical && view.vertical.walkSurfaces.length > 0) {
    for (const [ox, oz] of CIRCLE_OFFSETS_PER_MILLE) {
      const px = xUnits + Math.trunc((ox * radiusUnits) / 1000);
      const pz = zUnits + Math.trunc((oz * radiusUnits) / 1000);
      if (!fitsAtPoint(view, px, pz, feetUnits, bodyUnits, stepUnits)) return true;
    }
  }
  return false;
}

/** Eight directions around a circle, scaled by 1000 */
const CIRCLE_OFFSETS_PER_MILLE: readonly [number, number][] = [
  [1000, 0],
  [707, 707],
  [0, 1000],
  [-707, 707],
  [-1000, 0],
  [-707, -707],
  [0, -1000],
  [707, -707],
];

/** Points an actor's weight can rest on: its center and four points halfway to its edge */
const SUPPORT_OFFSETS_PER_MILLE: readonly [number, number][] = [
  [0, 0],
  [500, 0],
  [-500, 0],
  [0, 500],
  [0, -500],
];

/**
 * Floor an actor stands on: the highest reachable floor under its center or near its
 * edge, so it can rest on a ledge it overhangs (like most 3D games).
 */
export function findActorSupportUnits(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  feetUnits: number,
  stepUnits: number
): number {
  let best = NO_FLOOR_UNITS;
  for (const [ox, oz] of SUPPORT_OFFSETS_PER_MILLE) {
    const h = findSupportUnits(
      view,
      xUnits + Math.trunc((ox * radiusUnits) / 1000),
      zUnits + Math.trunc((oz * radiusUnits) / 1000),
      feetUnits,
      stepUnits
    );
    if (h > best) best = h;
  }
  return best;
}

/** Lowest ceiling over an actor's footprint */
export function findActorCeilingUnits(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  feetUnits: number,
  stepUnits: number
): number {
  let lowest = Number.MAX_SAFE_INTEGER;
  for (const [ox, oz] of SUPPORT_OFFSETS_PER_MILLE) {
    const h = findCeilingUnits(
      view,
      xUnits + Math.trunc((ox * radiusUnits) / 1000),
      zUnits + Math.trunc((oz * radiusUnits) / 1000),
      feetUnits,
      stepUnits
    );
    if (h < lowest) lowest = h;
  }
  return lowest;
}

/** Walkable model under a point whose surface is too steep to stand on, if any */
export function steepWalkSurfaceAt(
  view: VerticalWorldView,
  xUnits: number,
  zUnits: number,
  feetUnits: number
): WalkSurfaceSpec | null {
  for (const ws of view.vertical?.walkSurfaces ?? []) {
    const hit = walkSurfaceAt(ws, xUnits, zUnits);
    if (!hit || Math.abs(hit.topUnits - feetUnits) > 4) continue;
    if (walkSurfaceGradientPct(ws, xUnits, zUnits) > SIM_CONFIG.WALK_SURFACE_MAX_GRADIENT_PCT) {
      return ws;
    }
  }
  return null;
}

/** Direction downhill on a walkable model at a point, scaled to `lengthUnits` */
export function downhillOnWalkSurface(
  ws: WalkSurfaceSpec,
  xUnits: number,
  zUnits: number,
  lengthUnits: number
): { dx: number; dz: number } {
  const sp = Math.max(1, ws.spacingUnits);
  const here = walkSurfaceAt(ws, xUnits, zUnits)?.topUnits ?? 0;
  // Past the model's edge counts as a drop, so you slide off toward the edge
  const h = (x: number, z: number) => walkSurfaceAt(ws, x, z)?.topUnits ?? here - sp;
  const gx = h(xUnits + sp, zUnits) - h(xUnits - sp, zUnits);
  const gz = h(xUnits, zUnits + sp) - h(xUnits, zUnits - sp);
  const len = Math.max(1, isqrt(gx * gx + gz * gz));
  return {
    dx: -Math.trunc((gx * lengthUnits) / len),
    dz: -Math.trunc((gz * lengthUnits) / len),
  };
}

/** Which layer an absolute height belongs to */
export function layerAtHeight(yUnits: number, layerCount: number): number {
  return Math.max(0, Math.min(layerCount - 1, Math.floor(yUnits / LAYER)));
}

/** Number of layers in a vertical world (the ground layer plus stacked ones) */
export function layerCountOf(view: { vertical?: VerticalSimState }): number {
  return 1 + (view.vertical?.layers.length ?? 0);
}

/** Absolute floor height at the spawn cell of a layer (where the player appears) */
export function spawnFeetUnits(
  view: VerticalWorldView,
  row: number,
  col: number,
  layer: number
): number {
  const { xUnits, zUnits } = gridToWorldUnits(row, col, view.gridSize);
  const base = Math.max(0, layer) * LAYER;
  // The highest floor among the spans that reach into this layer's height range
  let best: number | null = null;
  for (const s of openSpansAt(view, xUnits, zUnits)) {
    if (s.floorUnits >= base + LAYER || s.ceilingUnits <= base) continue;
    if (s.floorUnits === NO_FLOOR_UNITS) continue;
    if (best === null || s.floorUnits > best) best = s.floorUnits;
  }
  return best ?? base;
}
