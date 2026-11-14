/**
 * Map edits: cells, textures, tile heights and slopes, the spawn point, and whole-map
 * operations (resize, clear, perimeter walls). Each command dispatches to the project store
 * (release plan P2.4); a drag of a map tool is one undo step.
 */
import React, { useCallback } from 'react';
import { CellType, ENGINE_CONFIG, SurfaceTarget } from '../types/engine';
import { SIM_CONFIG } from '../../sim';
import type { CardinalDirection, FloorSlopeSpec, SlopeSurface } from '../../sim';
import { resizeSquareMatrix, resizeVerticalData } from '../../runtime';
import type { EditorLayerData, TextureAsset, VerticalLevelData } from '../../runtime';
import type { SurfaceHit } from '../editor3d/EditorScene';
import { entitiesFittingGrid, getEntitiesCoveringCell } from '../engine/modelLibrary/placement';
import type { CellChange, DocumentAction } from '../store/documentActions';
import type { DispatchOptions } from '../store/documentStore';
import { spawnToStored, storedLevelFromView, verticalToStored } from '../store/levelView';
import type { EditorLevelView } from '../store/levelView';
import type { DocContext } from '../store/useEditorDocument';

type HeightFields = Pick<EditorLayerData, 'floorHeights' | 'ceilingHeights' | 'slopes'>;

const DEFAULT_TEXTURE: Record<SurfaceTarget, string> = {
  wall: 'default-grid',
  floor: 'floor-obsidian',
  ceiling: 'ceiling-coffer',
};
const SURFACE_FIELD = { wall: 'wall', floor: 'floor', ceiling: 'ceiling' } as const;

/** The matrices of one layer of a level view (layer 0 is the ground) */
export function layerOf(view: EditorLevelView, layer: number): EditorLayerData {
  const upper = layer > 0 ? view.vertical.layers[layer - 1] : undefined;
  return (
    upper ?? {
      grid: view.grid,
      wallTextures: view.wallTextures,
      floorTextures: view.floorTextures,
      ceilingTextures: view.ceilingTextures,
      floorHeights: view.vertical.floorHeights,
      ceilingHeights: view.vertical.ceilingHeights,
      slopes: view.vertical.slopes,
    }
  );
}

export interface UseMapCommandsOptions {
  ctx: DocContext;
  activeLayerRef: React.RefObject<number>;
  toolMode: string;
  targetSurface: SurfaceTarget;
  selectedTextureId: string;
  heightTarget: 'floor' | 'ceiling';
  heightStep: number;
  heightRaise: boolean;
  allTextures: TextureAsset[];
  trackRecentTexture: (id: string) => void;
  setSelectedCell: (cell: { row: number; col: number }) => void;
  setSelectedTextureId: (id: string) => void;
  setActiveLayer: (layer: number) => void;
  /** Respawns the playtest player (after edits that move or remove the floor under them) */
  requestRespawn: () => void;
}

export function useMapCommands({
  ctx,
  activeLayerRef,
  toolMode,
  targetSurface,
  selectedTextureId,
  heightTarget,
  heightStep,
  heightRaise,
  allTextures,
  trackRecentTexture,
  setSelectedCell,
  setSelectedTextureId,
  setActiveLayer,
  requestRespawn,
}: UseMapCommandsOptions) {
  const { log } = ctx;

  /** A cell edit on a layer (the active one by default) */
  const cells = useCallback(
    (changes: CellChange[], layer = activeLayerRef.current): DocumentAction => ({
      type: 'cells/set',
      levelId: ctx.level().id,
      layer,
      changes,
    }),
    [ctx, activeLayerRef]
  );

  /** Shows the ceiling, which painting a ceiling texture implies; null when it already shows */
  const showCeilingAction = useCallback((): DocumentAction | null => {
    const level = ctx.level();
    if (level.data.skybox.showCeiling) return null;
    return { type: 'world/update', levelId: level.id, patch: { skybox: { ...level.data.skybox, showCeiling: true } } };
  }, [ctx]);

  /** One cell's texture on a surface, plus showing the ceiling when it is a ceiling texture */
  const textureActions = useCallback(
    (row: number, col: number, surface: SurfaceTarget, texId: string, layer = activeLayerRef.current) => {
      const actions: DocumentAction[] = [cells([{ row, col, [SURFACE_FIELD[surface]]: texId }], layer)];
      const ceiling = surface === 'ceiling' ? showCeilingAction() : null;
      if (ceiling) actions.push(ceiling);
      return actions;
    },
    [cells, showCeilingAction, activeLayerRef]
  );

  const editBatch = useCallback(
    (actions: DocumentAction[], label: string, options?: DispatchOptions) => {
      ctx.edit(actions.length === 1 ? actions[0] : { type: 'batch', actions }, label, options);
    },
    [ctx]
  );

  /** Changes the floor or ceiling heights or slopes of one layer */
  const editHeights = useCallback(
    (layer: number, edit: (cur: HeightFields) => Partial<HeightFields>, label: string, options?: DispatchOptions) => {
      const v = ctx.view().vertical;
      let next: VerticalLevelData;
      if (layer === 0) {
        next = { ...v, ...edit(v) };
      } else {
        const target = v.layers[layer - 1];
        if (!target) return;
        const layers = [...v.layers];
        layers[layer - 1] = { ...target, ...edit(target) };
        next = { ...v, layers };
      }
      ctx.edit({ type: 'vertical/set', levelId: ctx.level().id, vertical: verticalToStored(next) }, label, options);
    },
    [ctx]
  );

  const handleAssignCellTextureFromInspector = useCallback(
    (row: number, col: number, surface: SurfaceTarget, texId: string) => {
      trackRecentTexture(texId);
      editBatch(textureActions(row, col, surface, texId), `Assign ${surface} texture '${texId}' at [X:${col}, Z:${row}]`);
    },
    [trackRecentTexture, editBatch, textureActions]
  );

  /** A texture thumbnail dragged from the Asset Library onto a 2D grid cell */
  const handleDropTextureOnCell = useCallback(
    (row: number, col: number, texId: string) => {
      const texAsset = allTextures.find((t) => t.id === texId);
      if (!texAsset) return;
      setSelectedCell({ row, col });
      setSelectedTextureId(texId);
      trackRecentTexture(texId);
      const actions = textureActions(row, col, targetSurface, texId);
      // A wall texture dropped on an empty cell also makes the cell a wall
      if (targetSurface === 'wall') actions.unshift(cells([{ row, col, cell: CellType.WALL }]));
      editBatch(actions, `Drop texture '${texAsset.name}' onto ${targetSurface} at [X:${col}, Z:${row}]`);
      log(`Asset Library Drop: Applied '${texAsset.name}' to ${targetSurface} at [X:${col}, Z:${row}].`);
    },
    [allTextures, targetSurface, textureActions, cells, editBatch, trackRecentTexture, setSelectedCell, setSelectedTextureId, log]
  );

  const handleFillSurfaceWithTexture = useCallback(
    (surface: SurfaceTarget, texId: string) => {
      trackRecentTexture(texId);
      const size = ctx.view().gridSize;
      const changes: CellChange[] = [];
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) changes.push({ row, col, [SURFACE_FIELD[surface]]: texId });
      }
      const actions = [cells(changes)];
      const ceiling = surface === 'ceiling' ? showCeilingAction() : null;
      if (ceiling) actions.push(ceiling);
      editBatch(actions, `Fill all ${surface}s with '${texId}'`);
      log(`Assets: Applied texture '${texId}' to all ${surface} cells.`);
    },
    [ctx, cells, showCeilingAction, editBatch, trackRecentTexture, log]
  );

  /**
   * Clears whatever is on cell [row, col] of the active layer: placed models covering it, any
   * wall, door or keycard, and any texture assigned to it.
   */
  const handleEraseCell = useCallback(
    (row: number, col: number) => {
      const view = ctx.view();
      const layer = activeLayerRef.current;
      const current = layerOf(view, layer);
      const prevCell = current.grid[row]?.[col] ?? CellType.EMPTY;
      const covering = getEntitiesCoveringCell(
        view.entities.filter((e) => (e.layer ?? 0) === layer),
        row,
        col
      );
      const prevFloorTex = current.floorTextures[row]?.[col];
      const prevWallTex = current.wallTextures[row]?.[col];
      const prevCeilTex = current.ceilingTextures[row]?.[col];
      const actions: DocumentAction[] = [
        cells([{ row, col, cell: CellType.EMPTY, wall: DEFAULT_TEXTURE.wall, floor: DEFAULT_TEXTURE.floor, ceiling: DEFAULT_TEXTURE.ceiling }]),
        ...covering.map((e): DocumentAction => ({ type: 'entity/remove', levelId: view.id, entityId: e.id })),
      ];
      editBatch(actions, ctx.strokeLabel(`Erase [X:${col}, Z:${row}]`), ctx.strokeOptions());

      const removed: string[] = [];
      if (covering.length > 0) removed.push(covering.map((e) => `'${e.name}'`).join(', '));
      if (prevCell === CellType.WALL) removed.push('Wall');
      else if (prevCell === CellType.DOOR) removed.push('Door');
      else if (prevCell === CellType.KEY) removed.push('Keycard');
      if (prevFloorTex && prevFloorTex !== DEFAULT_TEXTURE.floor) removed.push(`Floor (${prevFloorTex})`);
      if (prevWallTex && prevWallTex !== DEFAULT_TEXTURE.wall && prevCell !== CellType.WALL) removed.push(`Wall Tex (${prevWallTex})`);
      if (prevCeilTex && prevCeilTex !== DEFAULT_TEXTURE.ceiling) removed.push(`Ceiling (${prevCeilTex})`);
      log(
        removed.length > 0
          ? `Erase: Removed ${removed.join(' + ')} at [X:${col}, Z:${row}].`
          : `Erase: Cleared cell [X:${col}, Z:${row}].`
      );
    },
    [ctx, activeLayerRef, cells, editBatch, log]
  );

  /** Height tool: raises or lowers the floor or ceiling of a tile by one step */
  const adjustTileHeight = useCallback(
    (row: number, col: number) => {
      const layer = activeLayerRef.current;
      const delta = heightRaise ? heightStep : -heightStep;
      const minFloor = layer === 0 ? SIM_CONFIG.MIN_FLOOR_HEIGHT_UNITS : 0;
      const LAYER = SIM_CONFIG.LAYER_HEIGHT_UNITS;
      editHeights(
        layer,
        (cur) => {
          const floors = cur.floorHeights.map((r) => [...r]);
          const ceilings = cur.ceilingHeights.map((r) => [...r]);
          if (heightTarget === 'floor') {
            floors[row][col] = Math.max(minFloor, Math.min(ceilings[row][col] - 100, floors[row][col] + delta));
          } else {
            ceilings[row][col] = Math.max(floors[row][col] + 100, Math.min(LAYER, ceilings[row][col] + delta));
          }
          return { floorHeights: floors, ceilingHeights: ceilings };
        },
        ctx.strokeLabel(`Height at [X:${col}, Z:${row}]`),
        ctx.strokeOptions()
      );
      log(
        `Height: ${heightRaise ? 'Raised' : 'Lowered'} the ${heightTarget} at [X:${col}, Z:${row}] by ${((heightStep * ENGINE_CONFIG.CELL_SIZE) / SIM_CONFIG.CELL_UNITS).toFixed(2)} m.`
      );
    },
    [ctx, activeLayerRef, heightRaise, heightStep, heightTarget, editHeights, log]
  );

  /** Slope tool: turns a tile's floor (or ceiling) slope through none, N, E, S, W */
  const cycleTileSlope = useCallback(
    (row: number, col: number) => {
      const order: (CardinalDirection | null)[] = [null, 'N', 'E', 'S', 'W'];
      const surface = heightTarget;
      const isThis = (sl: FloorSlopeSpec) => sl.row === row && sl.col === col && (sl.surface ?? 'floor') === surface;
      let label = 'flat';
      editHeights(
        activeLayerRef.current,
        (cur) => {
          const existing = cur.slopes.find(isThis);
          const nextDir = order[(order.indexOf(existing?.dir ?? null) + 1) % order.length];
          const others = cur.slopes.filter((sl) => !isThis(sl));
          label = nextDir ? `rising to the ${nextDir}` : 'flat';
          const riseUnits = Math.min(SIM_CONFIG.MAX_SLOPE_RISE_UNITS, heightStep);
          return {
            slopes: nextDir
              ? [...others, { row, col, dir: nextDir, riseUnits, ...(surface === 'ceiling' ? { surface } : {}) }]
              : others,
          };
        },
        ctx.strokeLabel(`Slope at [X:${col}, Z:${row}]`),
        ctx.strokeOptions()
      );
      log(`Slope: The ${surface} of tile [X:${col}, Z:${row}] is now ${label}.`);
    },
    [ctx, activeLayerRef, heightStep, heightTarget, editHeights, log]
  );

  /** One click or drag step of a map tool (the stroke's undo step began in MapEditor2D) */
  const handleMapToolCell = useCallback(
    (row: number, col: number, forceValue?: number) => {
      const view = ctx.view();
      const stroke = ctx.strokeOptions();
      const label = ctx.strokeLabel(`${toolMode} at [X:${col}, Z:${row}]`);
      const layer = activeLayerRef.current;
      const currentCell = layerOf(view, layer).grid[row]?.[col];

      if (toolMode === 'spawn') {
        editBatch(
          [
            cells([{ row, col, cell: CellType.EMPTY }]),
            { type: 'spawn/set', levelId: view.id, spawn: spawnToStored({ ...view.spawn, row, col }, layer) },
          ],
          label,
          stroke
        );
        log(`Spawn: Relocated Player Spawn to [X:${col}, Z:${row}].`);
        return;
      }
      if (view.vertical.classic && (toolMode === 'height' || toolMode === 'slope' || toolMode === 'hole')) {
        log('Classic retro movement keeps one flat floor (World tab).');
        return;
      }
      if (toolMode === 'height') {
        adjustTileHeight(row, col);
        return;
      }
      if (toolMode === 'slope') {
        cycleTileSlope(row, col);
        return;
      }
      if (toolMode === 'hole') {
        editBatch([cells([{ row, col, cell: currentCell === CellType.HOLE ? CellType.EMPTY : CellType.HOLE }])], label, stroke);
        log(
          layer === 0
            ? `Hole: Toggled a bottomless pit at [X:${col}, Z:${row}] (falling in kills the player).`
            : `Hole: Toggled an opening to the layer below at [X:${col}, Z:${row}].`
        );
        return;
      }
      if (toolMode === 'paint') {
        trackRecentTexture(selectedTextureId);
        const actions = textureActions(row, col, targetSurface, selectedTextureId);
        if (targetSurface === 'wall') actions.unshift(cells([{ row, col, cell: CellType.WALL }]));
        editBatch(actions, label, stroke);
        log(`Paint: Assigned '${selectedTextureId}' to ${targetSurface} at [X:${col}, Z:${row}].`);
        return;
      }
      if (toolMode === 'empty') {
        handleEraseCell(row, col);
        return;
      }

      let change: CellChange | null = null;
      if (toolMode === 'toggle') {
        const nextVal = forceValue ?? (currentCell === CellType.WALL ? CellType.EMPTY : CellType.WALL);
        change = { row, col, cell: nextVal };
        if (nextVal === CellType.WALL && targetSurface === 'wall') {
          change.wall = selectedTextureId;
          trackRecentTexture(selectedTextureId);
        }
      } else if (toolMode === 'wall') {
        change = { row, col, cell: CellType.WALL, wall: selectedTextureId };
        trackRecentTexture(selectedTextureId);
      } else if (toolMode === 'door') {
        change = { row, col, cell: currentCell === CellType.DOOR ? CellType.EMPTY : CellType.DOOR };
      } else if (toolMode === 'key') {
        change = { row, col, cell: currentCell === CellType.KEY ? CellType.EMPTY : CellType.KEY };
      }
      if (change) editBatch([cells([change])], label, stroke);
    },
    [
      ctx,
      toolMode,
      activeLayerRef,
      targetSurface,
      selectedTextureId,
      cells,
      editBatch,
      textureActions,
      adjustTileHeight,
      cycleTileSlope,
      handleEraseCell,
      trackRecentTexture,
      log,
    ]
  );

  const handleSetCellType = useCallback(
    (row: number, col: number, cellType: CellType) => {
      editBatch([cells([{ row, col, cell: cellType }])], `Set cell [X:${col}, Z:${row}] to type ${cellType}`);
      log(`Inspector: Set cell [X:${col}, Z:${row}] to type ${cellType}.`);
    },
    [cells, editBatch, log]
  );

  const handleSetSpawnCell = useCallback(
    (row: number, col: number) => {
      const view = ctx.view();
      const layer = activeLayerRef.current;
      editBatch(
        [
          cells([{ row, col, cell: CellType.EMPTY }]),
          { type: 'spawn/set', levelId: view.id, spawn: spawnToStored({ ...view.spawn, row, col }, layer) },
        ],
        `Move Player Spawn to [X:${col}, Z:${row}]`
      );
    },
    [ctx, activeLayerRef, cells, editBatch]
  );

  const handleRotateSpawn = useCallback(() => {
    const view = ctx.view();
    const spawn = { ...view.spawn, yaw: (view.spawn.yaw + Math.PI / 2) % (Math.PI * 2) };
    ctx.edit({ type: 'spawn/set', levelId: view.id, spawn: spawnToStored(spawn, view.vertical.spawnLayer) }, 'Rotate Player Spawn Yaw');
  }, [ctx]);

  const handleBorderWalls = useCallback(() => {
    const size = ctx.view().gridSize;
    const changes: CellChange[] = [];
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (row === 0 || col === 0 || row === size - 1 || col === size - 1) changes.push({ row, col, cell: CellType.WALL });
      }
    }
    editBatch([cells(changes)], 'Build Perimeter Walls');
    log('Editor: Generated perimeter walls around map boundary.');
  }, [ctx, cells, editBatch, log]);

  /** Empties the ground grid, removes every model, and flattens the level (movement settings stay) */
  const handleClearGrid = useCallback(() => {
    const level = ctx.level();
    const { floorHeights: _f, ceilingHeights: _c, slopes: _s, layers: _l, classicMovement: _cm, ...rest } = level.data;
    const { layer: _spawnLayer, ...spawn } = level.data.spawn;
    ctx.edit(
      {
        type: 'level/setData',
        levelId: level.id,
        data: { ...rest, spawn, grid: level.data.grid.map((row) => row.map(() => CellType.EMPTY)), entities: [] },
      },
      'Clear Grid'
    );
    setActiveLayer(0);
    requestRespawn();
    log('Editor: Cleared grid and removed all entities.');
  }, [ctx, setActiveLayer, requestRespawn, log]);

  const handleResizeMap = useCallback(
    (requestedSize: number) => {
      const size = Math.max(ENGINE_CONFIG.MIN_GRID_SIZE, Math.min(ENGINE_CONFIG.MAX_GRID_SIZE, Math.trunc(requestedSize)));
      const view = ctx.view();
      if (!Number.isFinite(size) || size === view.gridSize) return;
      const maxIdx = size - 1;
      const resized: EditorLevelView = {
        ...view,
        gridSize: size,
        grid: resizeSquareMatrix(view.grid, size, CellType.EMPTY as number),
        wallTextures: resizeSquareMatrix(view.wallTextures, size, DEFAULT_TEXTURE.wall),
        floorTextures: resizeSquareMatrix(view.floorTextures, size, DEFAULT_TEXTURE.floor),
        ceilingTextures: resizeSquareMatrix(view.ceilingTextures, size, DEFAULT_TEXTURE.ceiling),
        entities: entitiesFittingGrid(view.entities, size),
        vertical: resizeVerticalData(view.vertical, size),
        spawn: { ...view.spawn, row: Math.min(view.spawn.row, maxIdx), col: Math.min(view.spawn.col, maxIdx) },
      };
      ctx.edit({ type: 'level/setData', levelId: view.id, data: storedLevelFromView(resized) }, `Resize Map to ${size}x${size}`);
      requestRespawn();
      log(`Editor: Resized map to ${size}x${size}.`);
    },
    [ctx, requestRespawn, log]
  );

  /** Inspector: exact floor and ceiling height and slopes of the selected tile */
  const handleSetTileVertical = useCallback(
    (
      row: number,
      col: number,
      values: {
        floor?: number;
        ceiling?: number;
        slope?: { dir: CardinalDirection; riseUnits: number } | null;
        ceilingSlope?: { dir: CardinalDirection; riseUnits: number } | null;
      }
    ) => {
      editHeights(
        activeLayerRef.current,
        (cur) => {
          const out: Partial<HeightFields> = {};
          if (values.floor !== undefined) {
            const floors = cur.floorHeights.map((r) => [...r]);
            floors[row][col] = Math.trunc(values.floor);
            out.floorHeights = floors;
          }
          if (values.ceiling !== undefined) {
            const ceilings = cur.ceilingHeights.map((r) => [...r]);
            ceilings[row][col] = Math.trunc(values.ceiling);
            out.ceilingHeights = ceilings;
          }
          let slopes = cur.slopes;
          const setSlope = (surface: SlopeSurface, value: { dir: CardinalDirection; riseUnits: number } | null) => {
            const others = slopes.filter((sl) => !(sl.row === row && sl.col === col && (sl.surface ?? 'floor') === surface));
            slopes = value ? [...others, { row, col, ...value, ...(surface === 'ceiling' ? { surface } : {}) }] : others;
            out.slopes = slopes;
          };
          if (values.slope !== undefined) setSlope('floor', values.slope);
          if (values.ceilingSlope !== undefined) setSlope('ceiling', values.ceilingSlope);
          return out;
        },
        `Edit heights at [X:${col}, Z:${row}]`
      );
    },
    [activeLayerRef, editHeights]
  );

  /** A texture dropped on a surface in the 3D view (any layer, not only the active one) */
  const handleDropTexture3D = useCallback(
    (texId: string, hit: SurfaceHit) => {
      const size = ctx.view().gridSize;
      let { row, col } = hit;
      if (hit.surface === 'wall') {
        // A wall face belongs to the solid tile behind it
        row = Math.max(0, Math.min(size - 1, row - Math.round(hit.normal.z)));
        col = Math.max(0, Math.min(size - 1, col - Math.round(hit.normal.x)));
      }
      editBatch(textureActions(row, col, hit.surface, texId, hit.layer), `Paint ${hit.surface} at [X:${col}, Z:${row}] (layer ${hit.layer})`);
      setSelectedTextureId(texId);
      trackRecentTexture(texId);
      log(`3D Paint: Applied '${texId}' to the ${hit.surface} at [X:${col}, Z:${row}].`);
    },
    [ctx, editBatch, textureActions, setSelectedTextureId, trackRecentTexture, log]
  );

  return {
    handleAssignCellTextureFromInspector,
    handleDropTextureOnCell,
    handleFillSurfaceWithTexture,
    handleEraseCell,
    handleMapToolCell,
    handleSetCellType,
    handleSetSpawnCell,
    handleRotateSpawn,
    handleBorderWalls,
    handleClearGrid,
    handleResizeMap,
    handleSetTileVertical,
    handleDropTexture3D,
  };
}
