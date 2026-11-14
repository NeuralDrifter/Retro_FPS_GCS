/**
 * Stacked layers and movement settings of the level being edited. Each command dispatches to
 * the project store (release plan P2.4).
 */
import { useCallback, useMemo } from 'react';
import { EditorToolMode } from '../types/engine';
import { createSolidLayer, editorVerticalFeatures } from '../../runtime';
import { SIM_CONFIG } from '../../sim';
import type { MovementSettingsSpec } from '../../sim';
import type { DocumentAction } from '../store/documentActions';
import { spawnToStored, verticalToStored } from '../store/levelView';
import type { EditorLevelView } from '../store/levelView';
import type { DocContext } from '../store/useEditorDocument';

export interface UseLayerManagerProps {
  ctx: DocContext;
  /** The active level, for the vertical features in use */
  view: EditorLevelView;
  setActiveLayer: React.Dispatch<React.SetStateAction<number>>;
  setToolMode: React.Dispatch<React.SetStateAction<EditorToolMode>>;
}

export function useLayerManager({ ctx, view, setActiveLayer, setToolMode }: UseLayerManagerProps) {
  const { log } = ctx;

  const handleAddLayer = useCallback(() => {
    const current = ctx.view();
    if (current.vertical.classic) {
      log('Classic retro movement keeps one floor (World tab).');
      return;
    }
    const layers = current.vertical.layers;
    if (layers.length >= SIM_CONFIG.MAX_LAYERS - 1) {
      log(`Layers: A level can have at most ${SIM_CONFIG.MAX_LAYERS} layers.`);
      return;
    }
    const newIndex = layers.length + 1;
    const layer = createSolidLayer(current.gridSize, { wall: 'default-grid', floor: 'floor-obsidian', ceiling: 'ceiling-coffer' });
    ctx.edit({ type: 'vertical/set', levelId: current.id, vertical: { layers: [...layers, layer] } }, 'Add Layer');
    setActiveLayer(newIndex);
    log(`Layers: Added layer ${newIndex} (solid; carve rooms into it, and use the Hole tool to open floors).`);
  }, [ctx, setActiveLayer, log]);

  const handleRemoveTopLayer = useCallback(() => {
    const current = ctx.view();
    const top = current.vertical.layers.length;
    if (top === 0) return;
    const remaining = current.vertical.layers.slice(0, -1);
    const actions: DocumentAction[] = [
      { type: 'vertical/set', levelId: current.id, vertical: { layers: verticalToStored({ ...current.vertical, layers: remaining }).layers } },
      ...current.entities
        .filter((e) => (e.layer ?? 0) >= top)
        .map((e): DocumentAction => ({ type: 'entity/remove', levelId: current.id, entityId: e.id })),
    ];
    if (current.vertical.spawnLayer > top - 1) {
      actions.push({ type: 'spawn/set', levelId: current.id, spawn: spawnToStored(current.spawn, top - 1) });
    }
    ctx.edit({ type: 'batch', actions }, `Remove Layer ${top}`);
    setActiveLayer((l) => Math.min(l, top - 1));
    log(`Layers: Removed layer ${top} and the models on it.`);
  }, [ctx, setActiveLayer, log]);

  /** Vertical features in use; classic retro movement can only be switched on without them */
  const verticalFeatures = useMemo(
    () => editorVerticalFeatures(view.grid, view.vertical, view.entities),
    [view.grid, view.vertical, view.entities]
  );

  const handleToggleClassic = useCallback(
    (on: boolean) => {
      if (on && verticalFeatures.length > 0) return;
      ctx.edit(
        { type: 'world/update', levelId: ctx.level().id, patch: { classicMovement: on ? true : undefined } },
        on ? 'Use Classic Retro Movement' : 'Use Full 3D Movement'
      );
      if (on) {
        setActiveLayer(0);
        setToolMode((mode) => (mode === 'height' || mode === 'slope' || mode === 'hole' ? 'toggle' : mode));
      }
      log(
        on
          ? 'Movement: Classic retro (one flat floor; layer, height, slope and hole tools are off).'
          : 'Movement: Full 3D (layers, heights, slopes, jumping and crouching are available).'
      );
    },
    [ctx, verticalFeatures.length, setActiveLayer, setToolMode, log]
  );

  const handleUpdateMovement = useCallback(
    (movement: MovementSettingsSpec) => {
      ctx.edit({ type: 'world/update', levelId: ctx.level().id, patch: { movement } }, 'Edit Movement Settings');
    },
    [ctx]
  );

  return { verticalFeatures, handleAddLayer, handleRemoveTopLayer, handleToggleClassic, handleUpdateMovement };
}
