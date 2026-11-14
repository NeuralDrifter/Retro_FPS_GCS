/**
 * Placed model edits: placing from the library (2D grid, inspector, 3D drops), moving, editing
 * and deleting copies. Each command dispatches to the project store (release plan P2.4).
 */
import React, { useCallback } from 'react';
import { Model3DAsset, PlacedEntity } from '../types/engine';
import { LAYER_METERS, entityAnchorWorld } from '../../runtime';
import type { WalkSurfaceSpec } from '../../sim';
import type { ModelLibraryState, ModelSettings, PlacementVariant } from '../types/modelLibrary';
import type { ModelBounds } from '../editor3d/EditorScene';
import type { SurfaceDrop } from '../components/EditorViewport3D';
import { AssetRegistry } from '../engine/AssetRegistry';
import { resolveModelSettings } from '../engine/modelLibrary/libraryState';
import {
  findPlacementConflicts,
  getEntitiesCoveringCell,
  getEntityRect,
} from '../engine/modelLibrary/placement';
import { entityToStored } from '../store/levelView';
import type { DispatchOptions } from '../store/documentStore';
import type { DocContext } from '../store/useEditorDocument';
import { layerOf } from './useMapCommands';

export interface UseEntityCommandsOptions {
  ctx: DocContext;
  activeLayerRef: React.RefObject<number>;
  allowOverlapRef: React.RefObject<boolean>;
  allModel3DAssets: Model3DAsset[];
  selectedModelAssetId: string;
  setSelectedModelAssetId: (id: string) => void;
  libraryState: ModelLibraryState;
  selectedVariant: PlacementVariant | null;
  setSelectedEntityId: (id: string | null) => void;
  setSelectedCell: (cell: { row: number; col: number }) => void;
  setActiveLayer: (layer: number) => void;
}

/** The library settings a copy carries, for placing another copy just like it (variant drags) */
function settingsOf(source: PlacedEntity): ModelSettings {
  return {
    category: source.category,
    collision: source.collision,
    footprintW: source.footprintW,
    footprintD: source.footprintD,
    footprintOverride: source.footprintOverride,
    scale: source.scale,
    isEnemy: source.isEnemy,
    maxHealth: source.maxHealth,
    moveSpeed: source.moveSpeed,
    attackDamage: source.attackDamage,
  };
}

export function useEntityCommands({
  ctx,
  activeLayerRef,
  allowOverlapRef,
  allModel3DAssets,
  selectedModelAssetId,
  setSelectedModelAssetId,
  libraryState,
  selectedVariant,
  setSelectedEntityId,
  setSelectedCell,
  setActiveLayer,
}: UseEntityCommandsOptions) {
  const { log } = ctx;
  const onActiveLayer = useCallback((e: PlacedEntity) => (e.layer ?? 0) === activeLayerRef.current, [activeLayerRef]);
  const findEntity = useCallback((id: string) => ctx.view().entities.find((e) => e.id === id), [ctx]);
  const assetOf = useCallback(
    (e: PlacedEntity) => allModel3DAssets.find((m) => m.id === (e.modelAssetId ?? e.blueprintId)),
    [allModel3DAssets]
  );

  /**
   * Places a model anchored at [row, col] using its library settings (or a picked variant's,
   * or `settingsOverride`). Returns false when the footprint leaves the map, or overlaps
   * something while overlap is off.
   */
  const placeEntityAtCell = useCallback(
    (
      row: number,
      col: number,
      label: string,
      options: {
        asset?: Model3DAsset;
        settings?: ModelSettings;
        surfaceDrop?: SurfaceDrop;
        dispatch?: DispatchOptions;
      } = {}
    ): boolean => {
      const targetAsset =
        options.asset || allModel3DAssets.find((m) => m.id === selectedModelAssetId) || allModel3DAssets[0];
      if (!targetAsset) return false;
      const view = ctx.view();

      const variantSettings =
        selectedVariant && selectedVariant.modelAssetId === targetAsset.id ? selectedVariant.settings : {};
      const settings = { ...resolveModelSettings(libraryState, targetAsset), ...(options.settings ?? variantSettings) };

      let idNum = Math.max(1, view.nextEntityId);
      while (view.entities.some((e) => e.id === `ent-${idNum}`)) idNum++;
      // The asset's own id is stable across reloads; ids derived from object URLs are not
      const modelAssetId = AssetRegistry.registerModel(targetAsset).id;
      const layer = activeLayerRef.current;

      const newEntity: PlacedEntity = {
        id: `ent-${idNum}`,
        row,
        col,
        blueprintId: targetAsset.blueprintId,
        modelAssetId,
        name: targetAsset.name,
        yaw: 0,
        scale: settings.scale ?? 1,
        customGlbUrl: targetAsset.customGlbUrl,
        category: settings.category,
        collision: settings.collision,
        footprintW: settings.footprintW,
        footprintD: settings.footprintD,
        ...(settings.footprintOverride ? { footprintOverride: true } : {}),
        isEnemy: settings.isEnemy,
        maxHealth: settings.maxHealth ?? 75,
        moveSpeed: settings.moveSpeed ?? 0,
        attackDamage: settings.attackDamage ?? 0,
        ...(layer > 0 ? { layer } : {}),
      };

      const drop = options.surfaceDrop;
      if (drop) {
        // Dropped in the 3D view: stick to the surface under the mouse, turned to face out of it
        const { hit, point } = drop;
        const gridSize = view.gridSize;
        newEntity.layer = hit.layer;
        if (hit.surface === 'wall') newEntity.yaw = Math.atan2(hit.normal.x, hit.normal.z);
        else if (hit.surface === 'ceiling') newEntity.roll = Math.PI;
        // Anchor the footprint on the tile in front of the surface, then offset to the exact point
        const rect = getEntityRect(newEntity);
        const w = rect.col1 - rect.col0 + 1;
        const d = rect.row1 - rect.row0 + 1;
        newEntity.col = Math.max(0, Math.min(gridSize - w, hit.col - Math.floor((w - 1) / 2)));
        newEntity.row = Math.max(0, Math.min(gridSize - d, hit.row - Math.floor((d - 1) / 2)));
        if (view.vertical.classic) {
          // Classic retro levels place models on their tile, standing on the one floor
          delete newEntity.layer;
          delete newEntity.roll;
        } else {
          const anchor = entityAnchorWorld(newEntity, gridSize);
          newEntity.offsetX = Math.round((point.x - anchor.x) * 1000) / 1000;
          newEntity.offsetZ = Math.round((point.z - anchor.z) * 1000) / 1000;
          newEntity.elevation = Math.round((point.y - hit.layer * LAYER_METERS) * 1000) / 1000;
        }
      } else {
        const reasons = findPlacementConflicts(layerOf(view, layer).grid, view.entities.filter(onActiveLayer), newEntity);
        if (reasons.includes('off the map edge') || (!allowOverlapRef.current && reasons.length > 0)) {
          log(`Placement blocked: ${reasons.join('; ')}`);
          return false;
        }
      }

      ctx.edit({ type: 'entity/add', levelId: view.id, entity: entityToStored(newEntity, view.gridSize) }, label, options.dispatch);
      setSelectedEntityId(newEntity.id);
      log(`Entity: Placed '${newEntity.name}' (${newEntity.id}) at cell [X:${col}, Z:${row}].`);
      return true;
    },
    [ctx, allModel3DAssets, selectedModelAssetId, libraryState, selectedVariant, activeLayerRef, allowOverlapRef, onActiveLayer, setSelectedEntityId, log]
  );

  /** The model tool on the 2D grid: clicking a copy of the active model removes it, else places one */
  const handleEntityTool = useCallback(
    (row: number, col: number) => {
      const view = ctx.view();
      const activeAsset = allModel3DAssets.find((m) => m.id === selectedModelAssetId) || allModel3DAssets[0];
      const existing = activeAsset
        ? getEntitiesCoveringCell(view.entities.filter(onActiveLayer), row, col).find(
            (e) => (e.modelAssetId ?? e.blueprintId) === activeAsset.id
          )
        : undefined;
      const label = ctx.strokeLabel(`Model at [X:${col}, Z:${row}]`);
      if (existing) {
        ctx.edit({ type: 'entity/remove', levelId: view.id, entityId: existing.id }, label, ctx.strokeOptions());
        log(`Entity: Removed '${existing.name}' from [X:${col}, Z:${row}].`);
        return;
      }
      placeEntityAtCell(row, col, label, { asset: activeAsset, dispatch: ctx.strokeOptions() });
    },
    [ctx, allModel3DAssets, selectedModelAssetId, onActiveLayer, placeEntityAtCell, log]
  );

  /** Places a copy with the same settings as an already placed model (variant drag) */
  const handleDropVariantOnCell = useCallback(
    (row: number, col: number, sourceEntityId: string) => {
      const source = findEntity(sourceEntityId);
      const asset = source ? assetOf(source) : undefined;
      if (!source) {
        log('Placement blocked: that variant is no longer in the level.');
        return;
      }
      if (!asset) {
        log(`Placement blocked: '${source.name}' uses a model that is not in this library.`);
        return;
      }
      setSelectedCell({ row, col });
      placeEntityAtCell(row, col, `Place '${source.name}' variant at [X:${col}, Z:${row}]`, { asset, settings: settingsOf(source) });
    },
    [findEntity, assetOf, placeEntityAtCell, setSelectedCell, log]
  );

  /** A model card dragged from the Asset Library onto a 2D grid cell */
  const handleDropModelOnCell = useCallback(
    (row: number, col: number, modelAssetId: string) => {
      const modelAsset = allModel3DAssets.find((m) => m.id === modelAssetId);
      if (!modelAsset) return;
      setSelectedCell({ row, col });
      setSelectedModelAssetId(modelAsset.id);
      if (placeEntityAtCell(row, col, `Drop 3D Model '${modelAsset.name}' at [X:${col}, Z:${row}]`, { asset: modelAsset })) {
        log(`Asset Library Drop: Spawned 3D model '${modelAsset.name}' at [X:${col}, Z:${row}].`);
      }
    },
    [allModel3DAssets, placeEntityAtCell, setSelectedCell, setSelectedModelAssetId, log]
  );

  const handlePlaceEntityFromInspector = useCallback(
    (row: number, col: number) => {
      placeEntityAtCell(row, col, `Spawn Entity at [X:${col}, Z:${row}]`);
    },
    [placeEntityAtCell]
  );

  const handleUpdateEntity = useCallback(
    (updatedIn: PlacedEntity) => {
      let updated = updatedIn;
      const view = ctx.view();
      const previous = view.entities.find((e) => e.id === updated.id);
      const placedIn3D = updated.elevation !== undefined || (updated.layer ?? 0) > 0;
      const pose = (e: PlacedEntity) =>
        JSON.stringify([e.row, e.col, e.layer, e.offsetX, e.offsetZ, e.elevation, e.yaw, e.pitch, e.roll, e.scale]);
      // A walkable model's baked shape is in world space: moving it means baking again
      if (previous && updated.walkable && updated.walkSurface && updated.walkSurface === previous.walkSurface && pose(previous) !== pose(updated)) {
        updated = { ...updated, walkSurface: undefined };
      }
      // Moving, rotating or resizing a footprint must still fit (and not overlap while overlap is off)
      if (previous && !placedIn3D && JSON.stringify(getEntityRect(previous)) !== JSON.stringify(getEntityRect(updated))) {
        const reasons = findPlacementConflicts(
          layerOf(view, activeLayerRef.current).grid,
          view.entities.filter(onActiveLayer),
          updated,
          updated.id
        );
        if (reasons.includes('off the map edge') || (!allowOverlapRef.current && reasons.length > 0)) {
          log(`Placement blocked: ${reasons.join('; ')}`);
          return;
        }
      }
      ctx.edit(
        { type: 'entity/set', levelId: view.id, entity: entityToStored(updated, view.gridSize) },
        `Edit Entity '${updated.name}' at [X:${updated.col}, Z:${updated.row}]`
      );
    },
    [ctx, activeLayerRef, allowOverlapRef, onActiveLayer, log]
  );

  const handleRemoveEntity = useCallback(
    (entityId: string) => {
      const target = findEntity(entityId);
      if (!target) return;
      ctx.edit({ type: 'entity/remove', levelId: ctx.level().id, entityId }, `Delete '${target.name}'`);
      log(`Inspector: Removed '${target.name}'.`);
    },
    [ctx, findEntity, log]
  );

  const handleDropModel3D = useCallback(
    (modelAssetId: string, drop: SurfaceDrop) => {
      const modelAsset = allModel3DAssets.find((m) => m.id === modelAssetId);
      if (!modelAsset) return;
      setSelectedModelAssetId(modelAsset.id);
      if (placeEntityAtCell(drop.hit.row, drop.hit.col, `Place '${modelAsset.name}' on ${drop.hit.surface}`, { asset: modelAsset, surfaceDrop: drop })) {
        setActiveLayer(drop.hit.layer);
        setSelectedCell({ row: drop.hit.row, col: drop.hit.col });
      }
    },
    [allModel3DAssets, placeEntityAtCell, setSelectedModelAssetId, setActiveLayer, setSelectedCell]
  );

  const handleDropVariant3D = useCallback(
    (sourceEntityId: string, drop: SurfaceDrop) => {
      const source = findEntity(sourceEntityId);
      const asset = source ? assetOf(source) : undefined;
      if (!source || !asset) {
        log('Placement blocked: that variant or its model is no longer available.');
        return;
      }
      placeEntityAtCell(drop.hit.row, drop.hit.col, `Place '${source.name}' variant on ${drop.hit.surface}`, {
        asset,
        settings: settingsOf(source),
        surfaceDrop: drop,
      });
    },
    [findEntity, assetOf, placeEntityAtCell, log]
  );

  const handleCommitEntityTransform = useCallback(
    (moved: PlacedEntity) => {
      let updated = moved;
      const view = ctx.view();
      if (view.vertical.classic) {
        // Classic retro levels keep models on their tile, on the floor, turned only flat
        const { layer: _l, offsetX: _x, offsetZ: _z, elevation: _e, pitch: _p, roll: _r, ...flat } = moved;
        updated = flat;
      }
      ctx.edit({ type: 'entity/set', levelId: view.id, entity: entityToStored(updated, view.gridSize) }, `Move/Rotate '${updated.name}'`);
      setSelectedCell({ row: updated.row, col: updated.col });
    },
    [ctx, setSelectedCell]
  );

  /** Values the 3D editor works out itself, so they add no undo step */
  const amendEntity = useCallback(
    (entityId: string, change: (e: PlacedEntity) => PlacedEntity | null) => {
      const view = ctx.view();
      const entity = view.entities.find((e) => e.id === entityId);
      const next = entity ? change(entity) : null;
      if (!next) return;
      ctx.edit({ type: 'entity/set', levelId: view.id, entity: entityToStored(next, view.gridSize) }, 'Measure model', { record: false });
    },
    [ctx]
  );
  const handleWalkSurfaceBaked = useCallback(
    (entityId: string, surface: WalkSurfaceSpec) => amendEntity(entityId, (e) => (e.walkable ? { ...e, walkSurface: surface } : null)),
    [amendEntity]
  );
  const handleModelBoundsMeasured = useCallback(
    (entityId: string, bounds: ModelBounds) =>
      amendEntity(entityId, (e) => {
        // Stored heights are whole units, and only a model with some height keeps them
        const bottom = Math.round(bounds.bottomUnits);
        const top = Math.round(bounds.topUnits);
        if (top <= bottom || (e.modelBottomUnits === bottom && e.modelTopUnits === top)) return null;
        return { ...e, modelBottomUnits: bottom, modelTopUnits: top };
      }),
    [amendEntity]
  );

  const handleSelectEntity3D = useCallback(
    (entityId: string | null) => {
      setSelectedEntityId(entityId);
      if (!entityId) return;
      const ent = findEntity(entityId);
      if (ent) {
        setSelectedCell({ row: ent.row, col: ent.col });
        setActiveLayer(ent.layer ?? 0);
      }
    },
    [findEntity, setSelectedEntityId, setSelectedCell, setActiveLayer]
  );

  return {
    handleEntityTool,
    handleDropVariantOnCell,
    handleDropModelOnCell,
    handlePlaceEntityFromInspector,
    handleUpdateEntity,
    handleRemoveEntity,
    handleDropModel3D,
    handleDropVariant3D,
    handleCommitEntityTransform,
    handleWalkSurfaceBaked,
    handleModelBoundsMeasured,
    handleSelectEntity3D,
  };
}
