import React, { useCallback } from 'react';
import {
  CampaignSettings,
  CellType,
  ENGINE_CONFIG,
  LevelStateData,
  MAP_PRESETS,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  createUniformTextureMatrix,
  resizeSquareMatrix,
} from '../types/engine';
import {
  LevelSerializer,
  computeNextEntityId,
} from '../engine/LevelSerializer';
import {
  EventDefinition,
  RegionDefinition,
  SimulationState,
  VariableRegistrySpec,
  createInitialSimulationState,
} from '../runtime/sim';
import {
  VerticalLevelData,
  createDefaultVerticalData,
  resizeVerticalData,
} from '../runtime/types';
import { entitiesFittingGrid } from '../engine/modelLibrary/placement';
import { SpawnPoint } from './useEditorHistory';

export interface UseLevelPersistenceProps {
  grid: number[][];
  setGrid: React.Dispatch<React.SetStateAction<number[][]>>;
  wallTextures: string[][];
  setWallTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  floorTextures: string[][];
  setFloorTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  ceilingTextures: string[][];
  setCeilingTextures: React.Dispatch<React.SetStateAction<string[][]>>;
  customTextures: TextureAsset[];
  entities: PlacedEntity[];
  setEntities: React.Dispatch<React.SetStateAction<PlacedEntity[]>>;
  nextEntityId: number;
  setNextEntityId: React.Dispatch<React.SetStateAction<number>>;
  spawn: SpawnPoint;
  setSpawn: React.Dispatch<React.SetStateAction<SpawnPoint>>;
  vertical: VerticalLevelData;
  setVertical: React.Dispatch<React.SetStateAction<VerticalLevelData>>;
  setActiveLayer: React.Dispatch<React.SetStateAction<number>>;
  setSelectedEntityId: React.Dispatch<React.SetStateAction<string | null>>;
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  minimapEnabled: boolean;
  levelTitle: string;
  setLevelTitle: React.Dispatch<React.SetStateAction<string>>;
  campaignSettings: CampaignSettings;
  setCampaignSettings: React.Dispatch<React.SetStateAction<CampaignSettings>>;
  activeLevelIndex: number;
  setCampaignLevels: React.Dispatch<React.SetStateAction<LevelStateData[]>>;
  getSyncedCampaignLevels: (titleOverride?: string) => LevelStateData[];
  buildActiveSingleLevelState: (titleOverride?: string) => LevelStateData;
  applySingleLevelToEditor: (
    state: LevelStateData,
    targetIndex: number,
    options?: {
      preserveSimState?: SimulationState;
      resetUndoStacks?: boolean;
    }
  ) => void;
  recordHistorySnapshot: (actionLabel: string) => void;
  setEngineLog: (msg: string) => void;
  setResetSignal: React.Dispatch<React.SetStateAction<number>>;
  setSimState: React.Dispatch<React.SetStateAction<SimulationState>>;
  setIsEventEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveGrid: (fn: (prev: number[][]) => number[][]) => void;
}

export function useLevelPersistence({
  grid,
  setGrid,
  wallTextures,
  setWallTextures,
  floorTextures,
  setFloorTextures,
  ceilingTextures,
  setCeilingTextures,
  customTextures,
  entities,
  setEntities,
  nextEntityId,
  setNextEntityId,
  spawn,
  setSpawn,
  vertical,
  setVertical,
  setActiveLayer,
  setSelectedEntityId,
  skyboxTheme,
  skyboxSeed,
  showCeiling,
  minimapEnabled,
  levelTitle,
  setLevelTitle,
  campaignSettings,
  setCampaignSettings,
  activeLevelIndex,
  setCampaignLevels,
  getSyncedCampaignLevels,
  buildActiveSingleLevelState,
  applySingleLevelToEditor,
  recordHistorySnapshot,
  setEngineLog,
  setResetSignal,
  setSimState,
  setIsEventEditorOpen,
  setActiveGrid,
}: UseLevelPersistenceProps) {
  const handleLoadPreset = useCallback(
    (presetId: string) => {
      const found = MAP_PRESETS.find((p) => p.id === presetId);
      if (!found) return;
      recordHistorySnapshot(`Load Preset '${found.name}'`);
      const nextGrid = found.grid.map((r) => [...r]);
      const nextWallTex = createUniformTextureMatrix(
        found.defaultWallTex || 'default-grid',
        nextGrid.length
      );
      const nextFloorTex = createUniformTextureMatrix(
        'floor-obsidian',
        nextGrid.length
      );
      const nextCeilTex = createUniformTextureMatrix(
        'ceiling-coffer',
        nextGrid.length
      );
      const nextEnts = found.entities
        ? found.entities.map((e) => ({ ...e }))
        : [];
      setLevelTitle(found.name);
      setGrid(nextGrid);
      setWallTextures(nextWallTex);
      setFloorTextures(nextFloorTex);
      setCeilingTextures(nextCeilTex);
      setEntities(nextEnts);
      setNextEntityId((prev) =>
        computeNextEntityId(nextEnts, Math.max(prev, found.nextEntityId ?? 1))
      );
      setSpawn({ ...found.spawn });
      setVertical(createDefaultVerticalData(nextGrid.length));
      setActiveLayer(0);
      setSelectedEntityId(null);
      const presetV3 = LevelSerializer.serializeLevelV3({
        title: found.name,
        grid: nextGrid,
        wallTextures: nextWallTex,
        floorTextures: nextFloorTex,
        ceilingTextures: nextCeilTex,
        entities: nextEnts,
        spawn: found.spawn,
        skyboxTheme,
        skyboxSeed,
        showCeiling,
        minimapEnabled,
        cellTags: found.cellTags,
        events: found.events || [],
        regions: found.regions || [],
        variables: found.variables,
      });
      setSimState(createInitialSimulationState(presetV3, [0]));
      setResetSignal((n) => n + 1);
      setEngineLog(
        `Preset: Loaded '${found.name}' into Level ${activeLevelIndex + 1}.`
      );
    },
    [
      recordHistorySnapshot,
      setLevelTitle,
      setGrid,
      setWallTextures,
      setFloorTextures,
      setCeilingTextures,
      setEntities,
      setNextEntityId,
      setSpawn,
      setVertical,
      setActiveLayer,
      setSelectedEntityId,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      setSimState,
      setResetSignal,
      setEngineLog,
      activeLevelIndex,
    ]
  );

  const handleRestoreLevelState = useCallback(
    (state: LevelStateData) => {
      recordHistorySnapshot('Import Level JSON');
      if (state.campaign) {
        setCampaignSettings({
          carryOverHealth: state.campaign.carryOverHealth !== false,
          carryOverAmmo: state.campaign.carryOverAmmo !== false,
        });
      }
      if (Array.isArray(state.levels) && state.levels.length > 0) {
        const targetIdx =
          typeof state.activeLevelIndex === 'number' &&
          state.activeLevelIndex >= 0 &&
          state.activeLevelIndex < state.levels.length
            ? state.activeLevelIndex
            : 0;
        setCampaignLevels(state.levels);
        applySingleLevelToEditor(state.levels[targetIdx], targetIdx, {
          resetUndoStacks: true,
        });
        setEngineLog(
          `File: Loaded Campaign JSON (${state.levels.length} Gameplay Levels, active Level ${
            targetIdx + 1
          }).`
        );
        return;
      }

      const singleSnap: LevelStateData = {
        ...state,
        title: state.title || 'Level 1',
      };
      setCampaignLevels([singleSnap]);
      applySingleLevelToEditor(singleSnap, 0, { resetUndoStacks: true });
      setEngineLog(
        state.missingModelWarnings?.length
          ? `Warning: ${state.missingModelWarnings.join(' ')}`
          : `File: Loaded Level JSON (${state.entities.length} Entities, ${state.customTextures.length} Custom Textures).`
      );
    },
    [recordHistorySnapshot, setCampaignSettings, setCampaignLevels, applySingleLevelToEditor, setEngineLog]
  );

  const handleSaveLevelDataFromEditor = useCallback(
    (updated: {
      events: EventDefinition[];
      regions: RegionDefinition[];
      variables: VariableRegistrySpec;
    }) => {
      recordHistorySnapshot('Edit Visual Triggers & Events');
      const updatedV3 = LevelSerializer.serializeLevelV3({
        title: levelTitle,
        grid,
        wallTextures,
        floorTextures,
        ceilingTextures,
        customTextures,
        entities,
        nextEntityId,
        spawn,
        skyboxTheme,
        skyboxSeed,
        showCeiling,
        minimapEnabled,
        cellTags: grid.map((r) => r.map(() => 0)),
        events: updated.events,
        regions: updated.regions,
        variables: updated.variables,
        vertical,
      });
      setSimState(createInitialSimulationState(updatedV3, [0]));
      setResetSignal((n) => n + 1);
      setIsEventEditorOpen(false);
      setEngineLog(
        `Visual Triggers: Updated ${updated.events.length} events, ${updated.regions.length} regions.`
      );
    },
    [
      recordHistorySnapshot,
      levelTitle,
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      nextEntityId,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      vertical,
      setSimState,
      setResetSignal,
      setIsEventEditorOpen,
      setEngineLog,
    ]
  );

  const buildCurrentLevelState = useCallback(() => {
    const syncedLevels = getSyncedCampaignLevels();
    const activeSingle = syncedLevels[activeLevelIndex] || buildActiveSingleLevelState();

    const usedTexIds = new Set<string>();
    for (const lvl of syncedLevels) {
      for (const row of lvl.wallTextures) for (const id of row) usedTexIds.add(id);
      for (const row of lvl.floorTextures) for (const id of row) usedTexIds.add(id);
      for (const row of lvl.ceilingTextures) for (const id of row) usedTexIds.add(id);
      if (lvl.vertical) {
        for (const layer of lvl.vertical.layers) {
          for (const m of [
            layer.wallTextures,
            layer.floorTextures,
            layer.ceilingTextures,
          ]) {
            for (const row of m) for (const id of row) usedTexIds.add(id);
          }
        }
      }
    }
    const allUsedCustomTextures = customTextures.filter(
      (t) => !t.fromProject || usedTexIds.has(t.id)
    );

    return LevelSerializer.serializeLevel({
      title: activeSingle.title || levelTitle,
      grid: activeSingle.grid,
      wallTextures: activeSingle.wallTextures,
      floorTextures: activeSingle.floorTextures,
      ceilingTextures: activeSingle.ceilingTextures,
      customTextures: allUsedCustomTextures,
      entities: activeSingle.entities,
      nextEntityId: activeSingle.nextEntityId,
      spawn: activeSingle.spawn,
      skyboxTheme: activeSingle.skybox.theme,
      skyboxSeed: activeSingle.skybox.seed,
      showCeiling: activeSingle.skybox.showCeiling,
      minimapEnabled: activeSingle.minimapEnabled ?? true,
      events: activeSingle.events,
      regions: activeSingle.regions,
      variables: activeSingle.variables,
      vertical: activeSingle.vertical,
      levels: syncedLevels,
      activeLevelIndex,
      campaign: campaignSettings,
    });
  }, [
    getSyncedCampaignLevels,
    activeLevelIndex,
    buildActiveSingleLevelState,
    customTextures,
    levelTitle,
    campaignSettings,
  ]);

  const handleSaveMap = useCallback(() => {
    LevelSerializer.downloadLevelJson(buildCurrentLevelState());
    setEngineLog('File: Exported level state to downloadable .json file.');
  }, [buildCurrentLevelState, setEngineLog]);

  const handleLoadMapFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          try {
            const parsed = LevelSerializer.parseLevelJson(reader.result);
            handleRestoreLevelState(parsed);
          } catch (err) {
            setEngineLog(
              err instanceof Error
                ? `Error: ${err.message}`
                : 'Error: Failed to parse uploaded JSON map file.'
            );
          }
        }
      };
      reader.readAsText(file);
    },
    [handleRestoreLevelState, setEngineLog]
  );

  const handleClearGrid = useCallback(() => {
    recordHistorySnapshot('Clear Grid');
    setGrid((prev) => prev.map((row) => row.map(() => CellType.EMPTY)));
    setEntities([]);
    setVertical((v) => ({ ...createDefaultVerticalData(v.floorHeights.length), movement: v.movement }));
    setActiveLayer(0);
    setResetSignal((n) => n + 1);
    setEngineLog('Editor: Cleared grid and removed all entities.');
  }, [recordHistorySnapshot, setGrid, setEntities, setVertical, setActiveLayer, setResetSignal, setEngineLog]);

  const handleResizeMap = useCallback(
    (requestedSize: number) => {
      const size = Math.max(
        ENGINE_CONFIG.MIN_GRID_SIZE,
        Math.min(ENGINE_CONFIG.MAX_GRID_SIZE, Math.trunc(requestedSize))
      );
      if (!Number.isFinite(size) || size === grid.length) return;
      recordHistorySnapshot(`Resize Map to ${size}x${size}`);
      const maxIdx = size - 1;
      setGrid((prev) => resizeSquareMatrix(prev, size, CellType.EMPTY as number));
      setWallTextures((prev) => resizeSquareMatrix(prev, size, 'default-grid'));
      setFloorTextures((prev) =>
        resizeSquareMatrix(prev, size, 'floor-obsidian')
      );
      setCeilingTextures((prev) =>
        resizeSquareMatrix(prev, size, 'ceiling-coffer')
      );
      setEntities((prev) => entitiesFittingGrid(prev, size));
      setVertical((v) => resizeVerticalData(v, size));
      setSpawn((prev) => ({
        ...prev,
        row: Math.min(prev.row, maxIdx),
        col: Math.min(prev.col, maxIdx),
      }));
      setResetSignal((n) => n + 1);
      setEngineLog(`Editor: Resized map to ${size}x${size}.`);
    },
    [
      grid.length,
      recordHistorySnapshot,
      setGrid,
      setWallTextures,
      setFloorTextures,
      setCeilingTextures,
      setEntities,
      setVertical,
      setSpawn,
      setResetSignal,
      setEngineLog,
    ]
  );

  const handleBorderWalls = useCallback(() => {
    recordHistorySnapshot('Build Perimeter Walls');
    setActiveGrid((prev) =>
      prev.map((row, rIdx) =>
        row.map((val, cIdx) => {
          const isEdge =
            rIdx === 0 ||
            rIdx === prev.length - 1 ||
            cIdx === 0 ||
            cIdx === prev.length - 1;
          return isEdge ? CellType.WALL : val;
        })
      )
    );
    setEngineLog('Editor: Generated perimeter walls around map boundary.');
  }, [recordHistorySnapshot, setActiveGrid, setEngineLog]);

  const handleRotateSpawn = useCallback(() => {
    recordHistorySnapshot('Rotate Player Spawn Yaw');
    setSpawn((prev) => ({
      ...prev,
      yaw: (prev.yaw + Math.PI / 2) % (Math.PI * 2),
    }));
  }, [recordHistorySnapshot, setSpawn]);

  return {
    handleLoadPreset,
    handleRestoreLevelState,
    handleSaveLevelDataFromEditor,
    buildCurrentLevelState,
    handleSaveMap,
    handleLoadMapFile,
    handleClearGrid,
    handleResizeMap,
    handleBorderWalls,
    handleRotateSpawn,
  };
}
