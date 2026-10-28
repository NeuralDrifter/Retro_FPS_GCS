/**
 * ============================================================================
 * LAYERED SURFACE BUILDER (VERTICAL LEVELS)
 * ============================================================================
 * Turns stacked layers, tile heights, floor and ceiling slopes and holes into triangle
 * lists grouped by texture, with no Three.js dependency so it can be tested
 * in Node. `WorldBuilder` turns each batch into one mesh.
 *
 * The simulation's own column model (`tileColumnSpans`) decides where the open
 * air is, so what you see always matches what you collide with:
 *  - every open span of a tile gets a floor (unless bottomless) and a ceiling
 *    (unless it is the open sky above the top layer);
 *  - along each tile edge, wherever the neighbour is solid and this tile is
 *    open, a wall face fills the gap: room walls, steps, slab edges, pit sides.
 * Ground-layer wall blocks are left to the existing instanced cubes, which push
 * walls need to slide.
 */

import {
  CardinalDirection,
  MovementSettingsSpec,
  OpenSpan,
  SIM_CONFIG,
  SimCellType,
  VerticalWorldView,
  NO_FLOOR_UNITS,
  tileColumnSpans,
} from './sim';
import { ENGINE_CONFIG, VerticalLevelData } from './types';

const LAYER = SIM_CONFIG.LAYER_HEIGHT_UNITS;
const CELL = SIM_CONFIG.CELL_UNITS;
const M = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS; // Meters per unit

export type SurfaceKind = 'wall' | 'floor' | 'ceiling';

export interface SurfaceBatch {
  kind: SurfaceKind;
  textureId: string;
  /** xyz per vertex, three vertices per triangle, in meters */
  positions: number[];
  normals: number[];
  uvs: number[];
}

export interface LayeredSurfaceInput {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  vertical: VerticalLevelData;
  /** Current ground-layer heights (lifts move them during play) */
  floorHeights?: number[][];
  ceilingHeights?: number[][];
  showCeiling: boolean;
  /** Draws only the tiles this accepts (each tile draws its floors, ceilings and edge walls) */
  includeTile?: (row: number, col: number) => boolean;
}

/** Doors and keys are drawn as their own meshes, so the surfaces treat them as open floor */
const openForDrawing = (cell: number) =>
  cell === SimCellType.DOOR || cell === SimCellType.KEY ? SimCellType.EMPTY : cell;

/** A read-only world view of the level for the column queries */
export function surfaceWorldView(input: LayeredSurfaceInput): VerticalWorldView {
  const v = input.vertical;
  const movement: MovementSettingsSpec = v.movement;
  return {
    gridSize: input.grid.length,
    grid: input.grid.map((row) => row.map(openForDrawing)),
    floorHeights: input.floorHeights ?? v.floorHeights,
    ceilingHeights: input.ceilingHeights ?? v.ceilingHeights,
    movers: {},
    vertical: {
      slopes: v.slopes,
      layers: v.layers.map((l) => ({ ...l, grid: l.grid.map((row) => row.map(openForDrawing)) })),
      movement,
      walkSurfaces: [],
      solidBoxes: [],
    },
  };
}

class BatchSet {
  private readonly batches = new Map<string, SurfaceBatch>();

  get(kind: SurfaceKind, textureId: string): SurfaceBatch {
    const key = `${kind}|${textureId}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { kind, textureId, positions: [], normals: [], uvs: [] };
      this.batches.set(key, b);
    }
    return b;
  }

  all(): SurfaceBatch[] {
    return [...this.batches.values()].filter((b) => b.positions.length > 0);
  }
}

type Vec3 = [number, number, number];

/**
 * Adds a quad (corners in order around its edge) as two triangles, wound so its front
 * faces along `facing`; the normal is the true surface normal on that side.
 */
function pushQuad(
  batch: SurfaceBatch,
  corners: [Vec3, Vec3, Vec3, Vec3],
  uvs: [number, number][],
  facing: Vec3
): void {
  const [a, b, c] = corners;
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  let order = [0, 1, 2, 0, 2, 3];
  if (n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0) {
    order = [0, 2, 1, 0, 3, 2];
    n = [-n[0], -n[1], -n[2]];
  }
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return; // Degenerate (zero-height) face
  const nn: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  for (const i of order) {
    batch.positions.push(...corners[i]);
    batch.normals.push(...nn);
    batch.uvs.push(...uvs[i]);
  }
}

/** World corner of a tile in units: (dx, dz) are 0 or 1 */
function cornerUnits(row: number, col: number, gridSize: number, dx: number, dz: number) {
  const half = Math.trunc((gridSize * CELL) / 2);
  return { x: -half + (col + dx) * CELL, z: -half + (row + dz) * CELL };
}

const DIRS: { dir: CardinalDirection; dr: number; dc: number; a: [number, number]; b: [number, number] }[] = [
  // Edge endpoints given as corner offsets (dx, dz) of the tile
  { dir: 'N', dr: -1, dc: 0, a: [0, 0], b: [1, 0] },
  { dir: 'S', dr: 1, dc: 0, a: [0, 1], b: [1, 1] },
  { dir: 'W', dr: 0, dc: -1, a: [0, 0], b: [0, 1] },
  { dir: 'E', dr: 0, dc: 1, a: [1, 0], b: [1, 1] },
];

/** Stretches of `span` where the other column is solid */
function solidPartsWithin(span: OpenSpan, others: OpenSpan[]): [number, number][] {
  let parts: [number, number][] = [[span.floorUnits, span.ceilingUnits]];
  for (const o of others) {
    const next: [number, number][] = [];
    for (const [lo, hi] of parts) {
      if (o.ceilingUnits <= lo || o.floorUnits >= hi) {
        next.push([lo, hi]);
        continue;
      }
      if (o.floorUnits > lo) next.push([lo, o.floorUnits]);
      if (o.ceilingUnits < hi) next.push([o.ceilingUnits, hi]);
    }
    parts = next;
  }
  return parts.filter(([lo, hi]) => hi > lo);
}

/** Lowest height a face may reach: bottomless pits get side walls down to here */
const PIT_DEPTH_UNITS = -2 * LAYER;

export function buildLayeredSurfaces(input: LayeredSurfaceInput): SurfaceBatch[] {
  const view = surfaceWorldView(input);
  const gridSize = view.gridSize;
  const layers = [
    {
      grid: view.grid,
      wallTextures: input.wallTextures,
      floorTextures: input.floorTextures,
      ceilingTextures: input.ceilingTextures,
    },
    ...input.vertical.layers,
  ];
  const topLayer = layers.length - 1;
  const batches = new BatchSet();
  const tex = (m: string[][] | undefined, r: number, c: number, fallback: string) =>
    m?.[r]?.[c] || fallback;
  const layerOf = (units: number) => Math.max(0, Math.min(topLayer, Math.floor(units / LAYER)));

  const spansCache = new Map<string, OpenSpan[]>();
  const spansAt = (r: number, c: number, dx: number, dz: number): OpenSpan[] => {
    if (r < 0 || c < 0 || r >= gridSize || c >= gridSize) return [];
    const key = `${r},${c},${dx},${dz}`;
    let s = spansCache.get(key);
    if (!s) {
      const p = cornerUnits(r, c, gridSize, dx, dz);
      s = tileColumnSpans(view, r, c, p.x, p.z).map((sp) =>
        sp.floorUnits === NO_FLOOR_UNITS ? { ...sp, floorUnits: PIT_DEPTH_UNITS } : sp
      );
      spansCache.set(key, s);
    }
    return s;
  };

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (input.includeTile && !input.includeTile(r, c)) continue;
      const corners = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ] as const;
      const cornerSpans = corners.map(([dx, dz]) => spansAt(r, c, dx, dz));
      const spanCount = cornerSpans[0].length;

      // Floors and ceilings of every open span in this tile's column
      for (let i = 0; i < spanCount; i++) {
        const span = cornerSpans[0][i];
        const pts = corners.map(([dx, dz]) => cornerUnits(r, c, gridSize, dx, dz));
        const uv = pts.map((p) => [p.x / CELL, p.z / CELL] as [number, number]);

        if (span.floorUnits !== PIT_DEPTH_UNITS) {
          const fl = span.floorLayer ?? layerOf(span.floorUnits);
          const floorTex = tex(layers[fl]?.floorTextures, r, c, 'floor-obsidian');
          const quad = pts.map(
            (p, k) => [p.x * M, (cornerSpans[k][i]?.floorUnits ?? span.floorUnits) * M, p.z * M] as Vec3
          ) as [Vec3, Vec3, Vec3, Vec3];
          pushQuad(batches.get('floor', floorTex), quad, uv, [0, 1, 0]);
        }

        const cl = span.ceilingLayer ?? layerOf(span.ceilingUnits - 1);
        const isSky = cl === topLayer && !input.showCeiling;
        if (!isSky) {
          const ceilTex = tex(layers[cl]?.ceilingTextures, r, c, 'ceiling-coffer');
          const quad = pts.map(
            (p, k) => [p.x * M, (cornerSpans[k][i]?.ceilingUnits ?? span.ceilingUnits) * M, p.z * M] as Vec3
          ) as [Vec3, Vec3, Vec3, Vec3];
          pushQuad(batches.get('ceiling', ceilTex), quad, uv, [0, -1, 0]);
        }
      }

      // Wall caps: the top of a top-layer wall block is visible under an open sky
      if (topLayer > 0 && !input.showCeiling && layers[topLayer].grid[r]?.[c] === SimCellType.WALL) {
        const pts = corners.map(([dx, dz]) => cornerUnits(r, c, gridSize, dx, dz));
        const y = (topLayer + 1) * LAYER * M;
        const quad = pts.map((p) => [p.x * M, y, p.z * M] as Vec3) as [Vec3, Vec3, Vec3, Vec3];
        const uv = pts.map((p) => [p.x / CELL, p.z / CELL] as [number, number]);
        pushQuad(
          batches.get('wall', tex(layers[topLayer].wallTextures, r, c, 'default-grid')),
          quad,
          uv,
          [0, 1, 0]
        );
      }

      // Wall faces along each edge, seen from this tile into its neighbour
      for (const d of DIRS) {
        const nr = r + d.dr;
        const nc = c + d.dc;
        const mineA = spansAt(r, c, d.a[0], d.a[1]);
        const mineB = spansAt(r, c, d.b[0], d.b[1]);
        // The neighbour's matching corners: the same world points seen from its side
        const otherA = spansAt(nr, nc, d.a[0] - d.dc, d.a[1] - d.dr);
        const otherB = spansAt(nr, nc, d.b[0] - d.dc, d.b[1] - d.dr);
        const pa = cornerUnits(r, c, gridSize, d.a[0], d.a[1]);
        const pb = cornerUnits(r, c, gridSize, d.b[0], d.b[1]);
        const facing: Vec3 = [-d.dc, 0, -d.dr];
        const inGrid = nr >= 0 && nc >= 0 && nr < gridSize && nc < gridSize;

        for (let i = 0; i < Math.min(mineA.length, mineB.length); i++) {
          let partsA = solidPartsWithin(mineA[i], otherA);
          let partsB = solidPartsWithin(mineB[i], otherB);
          if (partsA.length !== partsB.length) {
            // A slope crosses a neighbouring height along this edge: use the edge's middle
            const mid = solidPartsWithin(
              { floorUnits: Math.min(mineA[i].floorUnits, mineB[i].floorUnits), ceilingUnits: mineA[i].ceilingUnits },
              otherA
            );
            partsA = mid;
            partsB = mid;
          }
          for (let j = 0; j < partsA.length; j++) {
            for (const [loA, hiA, loB, hiB] of splitAtLayers(partsA[j], partsB[j])) {
              const midY = (loA + hiA + loB + hiB) / 4;
              const k = Math.max(0, Math.min(topLayer, Math.floor(midY / LAYER)));
              const wallSource = inGrid ? [nr, nc] : [r, c];
              // Ground-layer wall blocks are drawn by the instanced cubes
              if (
                inGrid &&
                k === 0 &&
                Math.min(loA, loB) >= 0 &&
                Math.max(hiA, hiB) <= LAYER &&
                view.grid[nr][nc] === SimCellType.WALL
              ) {
                continue;
              }
              const wallTex = tex(layers[k]?.wallTextures, wallSource[0], wallSource[1], 'default-grid');
              const along = (p: { x: number; z: number }) => (d.dr !== 0 ? p.x : p.z) / CELL;
              pushQuad(
                batches.get('wall', wallTex),
                [
                  [pa.x * M, loA * M, pa.z * M],
                  [pb.x * M, loB * M, pb.z * M],
                  [pb.x * M, hiB * M, pb.z * M],
                  [pa.x * M, hiA * M, pa.z * M],
                ],
                [
                  [along(pa), loA / CELL],
                  [along(pb), loB / CELL],
                  [along(pb), hiB / CELL],
                  [along(pa), hiA / CELL],
                ],
                facing
              );
            }
          }
        }
      }
    }
  }
  return batches.all();
}

/**
 * Splits a wall face at layer boundaries that cross it cleanly, so each piece takes the
 * wall texture of its own layer. Returns [bottomA, topA, bottomB, topB] per piece.
 */
function splitAtLayers(
  a: [number, number],
  b: [number, number]
): [number, number, number, number][] {
  const pieces: [number, number, number, number][] = [];
  let loA = a[0];
  let loB = b[0];
  const top = Math.min(a[1], b[1]);
  for (let y = (Math.floor(Math.max(loA, loB) / LAYER) + 1) * LAYER; y < top; y += LAYER) {
    pieces.push([loA, y, loB, y]);
    loA = y;
    loB = y;
  }
  pieces.push([loA, a[1], loB, b[1]]);
  return pieces;
}
