import React, { useCallback, useMemo } from 'react';
import {
  EditorToolMode,
  PlacedEntity,
} from '../types/engine';
import {
  VerticalLevelData,
  createSolidLayer,
} from '../runtime/types';
import {
  MovementSettingsSpec,
  SIM_CONFIG,
} from '../runtime/sim';
import { editorVerticalFeatures } from '../runtime/verticalLevelData';

export interface UseLayerManagerProps {
  grid: number[][];
  vertical: VerticalLevelData;
  setVertical: React.Dispatch<React.SetStateAction<VerticalLevelData>>;
  activeLayer: number;
  setActiveLayer: React.Dispatch<React.SetStateAction<number>>;
  classicRef: React.RefObject<boolean>;
  entities: PlacedEntity[];
  setEntities: React.Dispatch<React.SetStateAction<PlacedEntity[]>>;
  setToolMode: React.Dispatch<React.SetStateAction<EditorToolMode>>;
  recordHistorySnapshot: (actionLabel: string) => void;
  setEngineLog: (msg: string) => void;
}

export function useLayerManager({
  grid,
  vertical,
  setVertical,
  setActiveLayer,
  classicRef,
  entities,
  setEntities,
  setToolMode,
  recordHistorySnapshot,
  setEngineLog,
}: UseLayerManagerProps) {
  const handleAddLayer = useCallback(() => {
    if (classicRef.current) {
      setEngineLog('Classic retro movement keeps one floor (World tab).');
      return;
    }
    if (vertical.layers.length >= SIM_CONFIG.MAX_LAYERS - 1) {
      setEngineLog(`Layers: A level can have at most ${SIM_CONFIG.MAX_LAYERS} layers.`);
      return;
    }
    recordHistorySnapshot('Add Layer');
    const newIndex = vertical.layers.length + 1;
    setVertical((v) => ({
      ...v,
      layers: [
        ...v.layers,
        createSolidLayer(grid.length, {
          wall: 'default-grid',
          floor: 'floor-obsidian',
          ceiling: 'ceiling-coffer',
        }),
      ],
    }));
    setActiveLayer(newIndex);
    setEngineLog(
      `Layers: Added layer ${newIndex} (solid; carve rooms into it, and use the Hole tool to open floors).`
    );
  }, [grid.length, recordHistorySnapshot, vertical.layers.length, setVertical, setActiveLayer, setEngineLog, classicRef]);

  const handleRemoveTopLayer = useCallback(() => {
    const top = vertical.layers.length;
    if (top === 0) return;
    recordHistorySnapshot(`Remove Layer ${top}`);
    setVertical((v) => ({
      ...v,
      layers: v.layers.slice(0, -1),
      spawnLayer: Math.min(v.spawnLayer, top - 1),
    }));
    setEntities((prev) => prev.filter((e) => (e.layer ?? 0) < top));
    setActiveLayer((l) => Math.min(l, top - 1));
    setEngineLog(`Layers: Removed layer ${top} and the models on it.`);
  }, [recordHistorySnapshot, vertical.layers.length, setVertical, setEntities, setActiveLayer, setEngineLog]);

  /** Vertical features in use; classic retro movement can only be switched on without them */
  const verticalFeatures = useMemo(
    () => editorVerticalFeatures(grid, vertical, entities),
    [grid, vertical, entities]
  );

  const handleToggleClassic = useCallback(
    (on: boolean) => {
      if (on && verticalFeatures.length > 0) return;
      recordHistorySnapshot(on ? 'Use Classic Retro Movement' : 'Use Full 3D Movement');
      setVertical((v) => {
        const next = { ...v };
        if (on) next.classic = true;
        else delete next.classic;
        return next;
      });
      if (on) {
        setActiveLayer(0);
        setToolMode((mode) => (mode === 'height' || mode === 'slope' || mode === 'hole' ? 'toggle' : mode));
      }
      setEngineLog(
        on
          ? 'Movement: Classic retro (one flat floor; layer, height, slope and hole tools are off).'
          : 'Movement: Full 3D (layers, heights, slopes, jumping and crouching are available).'
      );
    },
    [recordHistorySnapshot, verticalFeatures.length, setVertical, setActiveLayer, setToolMode, setEngineLog]
  );

  const handleUpdateMovement = useCallback(
    (movement: MovementSettingsSpec) => {
      recordHistorySnapshot('Edit Movement Settings');
      setVertical((v) => ({ ...v, movement }));
    },
    [recordHistorySnapshot, setVertical]
  );

  return {
    verticalFeatures,
    handleAddLayer,
    handleRemoveTopLayer,
    handleToggleClassic,
    handleUpdateMovement,
  };
}
