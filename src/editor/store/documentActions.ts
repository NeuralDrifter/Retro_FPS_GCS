/**
 * Every edit to the project document, as a typed action, and the pure reducer that applies it
 * (release plan P2.3, decision D6). The reducer never mutates its input: it returns a new
 * document that shares every object it did not change, so undo history can keep whole earlier
 * documents cheaply. Cell edits copy only the rows they touch.
 */
import type {
  EventDefinition,
  FloorSlopeSpec,
  LevelDataV3,
  LevelLayerV3,
  MovementSettingsSpec,
  RegionDefinition,
  SimPlacedEntityV3,
  VariableRegistrySpec,
} from '../../sim';
import type {
  ExportFormat,
  GameData,
  MultiplayerSettings,
  ProjectCampaign,
  ProjectDocV4,
  ProjectLevel,
  ProjectMeta,
  UserAsset,
} from '../../shared/project';

/** One cell's new values; omitted fields keep their current value */
export interface CellChange {
  row: number;
  col: number;
  cell?: number;
  wall?: string;
  floor?: string;
  ceiling?: string;
  floorHeight?: number;
  ceilingHeight?: number;
}

export type DocumentAction =
  | { type: 'meta/update'; patch: Partial<Omit<ProjectMeta, 'createdAt'>> }
  | { type: 'level/add'; level: ProjectLevel; index?: number }
  | { type: 'level/remove'; levelId: string }
  | { type: 'level/move'; levelId: string; toIndex: number }
  | { type: 'level/rename'; levelId: string; title: string }
  /** Replaces a level's data wholesale (resize, clear, preset load) */
  | { type: 'level/setData'; levelId: string; data: LevelDataV3; title?: string }
  /** `layer` 0 is the ground layer; 1 and up index `data.layers`. `stroke` merges a drag into one undo step. */
  | { type: 'cells/set'; levelId: string; layer?: number; changes: CellChange[]; stroke?: string }
  | { type: 'cellTags/set'; levelId: string; changes: { row: number; col: number; tag: number }[] }
  | { type: 'spawn/set'; levelId: string; spawn: LevelDataV3['spawn'] }
  | { type: 'entity/add'; levelId: string; entity: SimPlacedEntityV3 }
  | { type: 'entity/update'; levelId: string; entityId: string; patch: Partial<SimPlacedEntityV3>; stroke?: string }
  /** Replaces one entity whole (fields it leaves out are removed) */
  | { type: 'entity/set'; levelId: string; entity: SimPlacedEntityV3 }
  | { type: 'entity/remove'; levelId: string; entityId: string }
  | { type: 'events/set'; levelId: string; events: EventDefinition[] }
  | { type: 'regions/set'; levelId: string; regions: RegionDefinition[] }
  | { type: 'variables/set'; levelId: string; variables: VariableRegistrySpec }
  /** Fields set to `undefined` are removed from the level */
  | {
      type: 'world/update';
      levelId: string;
      patch: {
        skybox?: LevelDataV3['skybox'];
        minimapEnabled?: boolean;
        movement?: MovementSettingsSpec;
        classicMovement?: boolean | undefined;
      };
    }
  /** Fields set to `undefined` are removed from the level (a flat level stores no heights) */
  | {
      type: 'vertical/set';
      levelId: string;
      vertical: {
        layers?: LevelLayerV3[] | undefined;
        floorHeights?: number[][] | undefined;
        ceilingHeights?: number[][] | undefined;
        slopes?: FloorSlopeSpec[] | undefined;
      };
    }
  | { type: 'campaign/update'; patch: Partial<ProjectCampaign> }
  | { type: 'gameData/set'; gameData: GameData }
  | { type: 'userAsset/add'; asset: UserAsset }
  | { type: 'userAsset/remove'; assetId: string }
  | { type: 'export/setSlug'; slug: string }
  | { type: 'export/setFormat'; format: ExportFormat }
  | { type: 'multiplayer/set'; multiplayer: MultiplayerSettings | undefined }
  /** Several edits applied as one undo step */
  | { type: 'batch'; actions: DocumentAction[] };

export type DocumentActionType = DocumentAction['type'];

function mapLevel(doc: ProjectDocV4, levelId: string, update: (level: ProjectLevel) => ProjectLevel): ProjectDocV4 {
  const index = doc.levels.findIndex((l) => l.id === levelId);
  if (index < 0) return doc;
  const next = update(doc.levels[index]);
  if (next === doc.levels[index]) return doc;
  const levels = doc.levels.slice();
  levels[index] = next;
  return { ...doc, levels };
}

const withData = (level: ProjectLevel, patch: Partial<LevelDataV3>): ProjectLevel => ({
  ...level,
  data: { ...level.data, ...patch },
});

/**
 * Applies a patch whose `undefined` values remove the field. Returns the level itself when every
 * value is already in place, so a repeated setting adds no undo step.
 */
function patchData(level: ProjectLevel, patch: Partial<LevelDataV3>): ProjectLevel {
  const current = level.data as unknown as Record<string, unknown>;
  const entries = Object.entries(patch);
  if (entries.every(([key, value]) => (value === undefined ? !(key in current) : current[key] === value))) return level;
  const data: Record<string, unknown> = { ...current };
  for (const [key, value] of entries) {
    if (value === undefined) delete data[key];
    else data[key] = value;
  }
  return { ...level, data: data as unknown as LevelDataV3 };
}

/** Writes values into a matrix, copying each touched row once; returns the input when nothing changed */
function writeCells<T>(matrix: T[][] | undefined, edits: { row: number; col: number; value: T | undefined }[]): T[][] | undefined {
  if (!matrix) return matrix;
  let out: T[][] | null = null;
  const copied = new Set<number>();
  for (const { row, col, value } of edits) {
    if (value === undefined || !matrix[row] || col < 0 || col >= matrix[row].length) continue;
    if (matrix[row][col] === value && !copied.has(row)) continue;
    if (!out) out = matrix.slice();
    if (!copied.has(row)) {
      out[row] = matrix[row].slice();
      copied.add(row);
    }
    out[row][col] = value;
  }
  return out ?? matrix;
}

interface CellSurface {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  floorHeights?: number[][];
  ceilingHeights?: number[][];
}

function applyCells<S extends CellSurface>(surface: S, changes: CellChange[]): S {
  const pick = <K extends keyof CellChange>(key: K) => changes.map((c) => ({ row: c.row, col: c.col, value: c[key] }));
  const grid = writeCells(surface.grid, pick('cell') as { row: number; col: number; value: number | undefined }[])!;
  const wallTextures = writeCells(surface.wallTextures, pick('wall') as { row: number; col: number; value: string | undefined }[])!;
  const floorTextures = writeCells(surface.floorTextures, pick('floor') as { row: number; col: number; value: string | undefined }[])!;
  const ceilingTextures = writeCells(surface.ceilingTextures, pick('ceiling') as { row: number; col: number; value: string | undefined }[])!;
  const floorHeights = writeCells(surface.floorHeights, pick('floorHeight') as { row: number; col: number; value: number | undefined }[]);
  const ceilingHeights = writeCells(surface.ceilingHeights, pick('ceilingHeight') as { row: number; col: number; value: number | undefined }[]);
  if (
    grid === surface.grid &&
    wallTextures === surface.wallTextures &&
    floorTextures === surface.floorTextures &&
    ceilingTextures === surface.ceilingTextures &&
    floorHeights === surface.floorHeights &&
    ceilingHeights === surface.ceilingHeights
  ) {
    return surface;
  }
  return {
    ...surface,
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    ...(floorHeights ? { floorHeights } : {}),
    ...(ceilingHeights ? { ceilingHeights } : {}),
  };
}

/** The number at the end of an entity id (`ent-12` is 12), or 0 */
function idNumber(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** Applies one action; returns the same document object when the action changes nothing */
export function reduceDocument(doc: ProjectDocV4, action: DocumentAction): ProjectDocV4 {
  switch (action.type) {
    case 'meta/update':
      return { ...doc, meta: { ...doc.meta, ...action.patch } };
    case 'level/add': {
      const levels = doc.levels.slice();
      const at = action.index === undefined ? levels.length : Math.max(0, Math.min(levels.length, action.index));
      levels.splice(at, 0, action.level);
      return { ...doc, levels };
    }
    case 'level/remove':
      if (doc.levels.length <= 1 || !doc.levels.some((l) => l.id === action.levelId)) return doc;
      return { ...doc, levels: doc.levels.filter((l) => l.id !== action.levelId) };
    case 'level/move': {
      const from = doc.levels.findIndex((l) => l.id === action.levelId);
      const to = Math.max(0, Math.min(doc.levels.length - 1, action.toIndex));
      if (from < 0 || from === to) return doc;
      const levels = doc.levels.slice();
      const [moved] = levels.splice(from, 1);
      levels.splice(to, 0, moved);
      return { ...doc, levels };
    }
    case 'level/rename':
      return mapLevel(doc, action.levelId, (l) => (l.title === action.title ? l : { ...l, title: action.title }));
    case 'level/setData':
      return mapLevel(doc, action.levelId, (l) =>
        l.data === action.data && (action.title === undefined || action.title === l.title)
          ? l
          : { ...l, data: action.data, ...(action.title !== undefined ? { title: action.title } : {}) }
      );
    case 'cells/set':
      return mapLevel(doc, action.levelId, (level) => {
        const layer = action.layer ?? 0;
        if (layer === 0) {
          const data = applyCells(level.data, action.changes);
          return data === level.data ? level : { ...level, data };
        }
        const layers = level.data.layers;
        const target = layers?.[layer - 1];
        if (!layers || !target) return level;
        const updated = applyCells(target, action.changes);
        if (updated === target) return level;
        const nextLayers = layers.slice();
        nextLayers[layer - 1] = updated;
        return withData(level, { layers: nextLayers });
      });
    case 'cellTags/set':
      return mapLevel(doc, action.levelId, (level) => {
        const size = level.data.gridSize;
        const tags = level.data.cellTags ?? Array.from({ length: size }, () => new Array<number>(size).fill(0));
        const cellTags = writeCells(tags, action.changes.map((c) => ({ row: c.row, col: c.col, value: c.tag })))!;
        return cellTags === level.data.cellTags ? level : withData(level, { cellTags });
      });
    case 'spawn/set':
      return mapLevel(doc, action.levelId, (l) => withData(l, { spawn: { ...action.spawn } }));
    case 'entity/add':
      return mapLevel(doc, action.levelId, (l) =>
        withData(l, {
          entities: [...l.data.entities, action.entity],
          // Keep the id counter past every numbered id, so a later add never reuses one
          nextEntityId: Math.max(l.data.nextEntityId, idNumber(action.entity.id) + 1),
        })
      );
    case 'entity/update':
      return mapLevel(doc, action.levelId, (l) => {
        const i = l.data.entities.findIndex((e) => e.id === action.entityId);
        if (i < 0) return l;
        const entities = l.data.entities.slice();
        entities[i] = { ...entities[i], ...action.patch, id: action.entityId };
        return withData(l, { entities });
      });
    case 'entity/set':
      return mapLevel(doc, action.levelId, (l) => {
        const i = l.data.entities.findIndex((e) => e.id === action.entity.id);
        if (i < 0) return l;
        const entities = l.data.entities.slice();
        entities[i] = action.entity;
        return withData(l, { entities });
      });
    case 'entity/remove':
      return mapLevel(doc, action.levelId, (l) => {
        const entities = l.data.entities.filter((e) => e.id !== action.entityId);
        return entities.length === l.data.entities.length ? l : withData(l, { entities });
      });
    case 'events/set':
      return mapLevel(doc, action.levelId, (l) => withData(l, { events: action.events }));
    case 'regions/set':
      return mapLevel(doc, action.levelId, (l) => withData(l, { regions: action.regions }));
    case 'variables/set':
      return mapLevel(doc, action.levelId, (l) => withData(l, { variables: action.variables }));
    case 'world/update':
      return mapLevel(doc, action.levelId, (l) => patchData(l, action.patch));
    case 'vertical/set':
      return mapLevel(doc, action.levelId, (l) => patchData(l, action.vertical));
    case 'campaign/update':
      return { ...doc, campaign: { ...doc.campaign, ...action.patch } };
    case 'gameData/set':
      return { ...doc, gameData: action.gameData };
    case 'userAsset/add':
      if (doc.userAssets.some((a) => a.id === action.asset.id)) return doc;
      return { ...doc, userAssets: [...doc.userAssets, action.asset] };
    case 'userAsset/remove':
      if (!doc.userAssets.some((a) => a.id === action.assetId)) return doc;
      return { ...doc, userAssets: doc.userAssets.filter((a) => a.id !== action.assetId) };
    case 'export/setSlug':
      return doc.export.slug === action.slug ? doc : { ...doc, export: { ...doc.export, slug: action.slug } };
    case 'export/setFormat':
      return (doc.export.format ?? 'zip') === action.format ? doc : { ...doc, export: { ...doc.export, format: action.format } };
    case 'batch':
      return action.actions.reduce(reduceDocument, doc);
    case 'multiplayer/set': {
      if (action.multiplayer === undefined) {
        if (!doc.multiplayer) return doc;
        const { multiplayer: _removed, ...rest } = doc;
        return rest;
      }
      return { ...doc, multiplayer: action.multiplayer };
    }
  }
}
