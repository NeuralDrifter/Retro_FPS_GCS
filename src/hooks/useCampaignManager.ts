import React, { useCallback } from 'react';
import {
  CampaignSettings,
  CellType,
  LevelStateData,
  SkyboxThemeId,
  createUniformTextureMatrix,
} from '../types/engine';
import { LevelSerializer } from '../engine/LevelSerializer';
import { SimulationState } from '../runtime/sim';

const DEFAULT_LEVEL_GRID_SIZE = 16;

export interface UseCampaignManagerOptions {
  levelTitle: string;
  setLevelTitle: React.Dispatch<React.SetStateAction<string>>;
  activeLevelIndex: number;
  setActiveLevelIndex: React.Dispatch<React.SetStateAction<number>>;
  campaignLevels: LevelStateData[];
  setCampaignLevels: React.Dispatch<React.SetStateAction<LevelStateData[]>>;
  campaignSettings: CampaignSettings;
  setCampaignSettings: React.Dispatch<React.SetStateAction<CampaignSettings>>;
  buildActiveSingleLevelState: (titleOverride?: string) => LevelStateData;
  applySingleLevelToEditor: (
    state: LevelStateData,
    targetIndex: number,
    options?: {
      preserveSimState?: SimulationState;
      resetUndoStacks?: boolean;
    }
  ) => void;
  setEngineLog: (msg: string) => void;
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
}

export function useCampaignManager({
  setLevelTitle,
  activeLevelIndex,
  setActiveLevelIndex,
  campaignLevels,
  setCampaignLevels,
  setCampaignSettings,
  buildActiveSingleLevelState,
  applySingleLevelToEditor,
  setEngineLog,
  skyboxTheme,
  skyboxSeed,
}: UseCampaignManagerOptions) {
  /** Returns the full `campaignLevels` array with `activeLevelIndex` synced to the live editor state. */
  const getSyncedCampaignLevels = useCallback(
    (titleOverride?: string): LevelStateData[] => {
      const activeSnap = buildActiveSingleLevelState(titleOverride);
      if (campaignLevels.length === 0) return [activeSnap];
      const clampedIdx = Math.max(
        0,
        Math.min(campaignLevels.length - 1, activeLevelIndex)
      );
      return campaignLevels.map((lvl, idx) =>
        idx === clampedIdx ? activeSnap : lvl
      );
    },
    [buildActiveSingleLevelState, campaignLevels, activeLevelIndex]
  );

  const handleSelectCampaignLevel = useCallback(
    (targetIndex: number) => {
      const synced = getSyncedCampaignLevels();
      if (targetIndex < 0 || targetIndex >= synced.length) return;
      if (targetIndex === activeLevelIndex) return;
      setCampaignLevels(synced);
      const targetLevel = synced[targetIndex];
      applySingleLevelToEditor(targetLevel, targetIndex, {
        resetUndoStacks: true,
      });
      setEngineLog(
        `Campaign: Switched editor to Level ${targetIndex + 1}/${synced.length} ('${
          targetLevel.title || `Level ${targetIndex + 1}`
        }').`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex, applySingleLevelToEditor, setEngineLog, setCampaignLevels]
  );

  const handleRenameCampaignLevel = useCallback(
    (nextTitle: string) => {
      setLevelTitle(nextTitle);
      setCampaignLevels((prev) =>
        prev.map((lvl, idx) =>
          idx === activeLevelIndex ? { ...lvl, title: nextTitle } : lvl
        )
      );
    },
    [activeLevelIndex, setLevelTitle, setCampaignLevels]
  );

  const handleAddCampaignLevel = useCallback(() => {
    const synced = getSyncedCampaignLevels();
    const newIndex = synced.length;
    const newTitle = `Level ${newIndex + 1}: Sector ${newIndex + 1}`;
    const size = DEFAULT_LEVEL_GRID_SIZE;
    const freshGrid: number[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_cell, c) =>
        r === 0 || r === size - 1 || c === 0 || c === size - 1
          ? CellType.WALL
          : CellType.EMPTY
      )
    );
    const freshLevel = LevelSerializer.serializeLevel({
      title: newTitle,
      grid: freshGrid,
      wallTextures: createUniformTextureMatrix('default-grid', size),
      floorTextures: createUniformTextureMatrix('floor-obsidian', size),
      ceilingTextures: createUniformTextureMatrix('ceiling-coffer', size),
      customTextures: [],
      entities: [],
      nextEntityId: 1,
      spawn: { row: Math.floor(size / 2), col: Math.floor(size / 2), yaw: 0 },
      skyboxTheme,
      skyboxSeed: skyboxSeed + 1,
      showCeiling: false,
      minimapEnabled: true,
    });
    const nextLevels = [...synced, freshLevel];
    setCampaignLevels(nextLevels);
    applySingleLevelToEditor(freshLevel, newIndex, { resetUndoStacks: true });
    setEngineLog(
      `Campaign: Added Level ${newIndex + 1}/${nextLevels.length} ('${newTitle}').`
    );
  }, [
    getSyncedCampaignLevels,
    skyboxTheme,
    skyboxSeed,
    applySingleLevelToEditor,
    setEngineLog,
    setCampaignLevels,
  ]);

  const handleDuplicateCampaignLevel = useCallback(() => {
    const synced = getSyncedCampaignLevels();
    const currentSnap = synced[activeLevelIndex] || buildActiveSingleLevelState();
    const cloneTitle = `${
      currentSnap.title || `Level ${activeLevelIndex + 1}`
    } (Copy)`;
    const clonedLevel: LevelStateData = JSON.parse(
      JSON.stringify({
        ...currentSnap,
        title: cloneTitle,
      })
    );
    const insertIndex = activeLevelIndex + 1;
    const nextLevels = [
      ...synced.slice(0, insertIndex),
      clonedLevel,
      ...synced.slice(insertIndex),
    ];
    setCampaignLevels(nextLevels);
    applySingleLevelToEditor(clonedLevel, insertIndex, {
      resetUndoStacks: true,
    });
    setEngineLog(
      `Campaign: Duplicated into Level ${insertIndex + 1}/${nextLevels.length} ('${cloneTitle}').`
    );
  }, [
    getSyncedCampaignLevels,
    activeLevelIndex,
    buildActiveSingleLevelState,
    applySingleLevelToEditor,
    setEngineLog,
    setCampaignLevels,
  ]);

  const handleDeleteCampaignLevel = useCallback(
    (deleteIndex: number) => {
      const synced = getSyncedCampaignLevels();
      if (synced.length <= 1) {
        setEngineLog('Campaign: A game must have at least 1 level.');
        return;
      }
      if (deleteIndex < 0 || deleteIndex >= synced.length) return;
      const removedTitle =
        synced[deleteIndex]?.title || `Level ${deleteIndex + 1}`;
      const nextLevels = synced.filter((_, idx) => idx !== deleteIndex);
      const nextActiveIdx =
        deleteIndex < activeLevelIndex
          ? activeLevelIndex - 1
          : Math.min(activeLevelIndex, nextLevels.length - 1);
      setCampaignLevels(nextLevels);
      applySingleLevelToEditor(nextLevels[nextActiveIdx], nextActiveIdx, {
        resetUndoStacks: true,
      });
      setEngineLog(
        `Campaign: Deleted '${removedTitle}'. Active level is now ${
          nextActiveIdx + 1
        }/${nextLevels.length}.`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex, applySingleLevelToEditor, setEngineLog, setCampaignLevels]
  );

  const handleMoveCampaignLevel = useCallback(
    (index: number, direction: -1 | 1) => {
      const synced = getSyncedCampaignLevels();
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= synced.length) return;
      const nextLevels = [...synced];
      const [moved] = nextLevels.splice(index, 1);
      nextLevels.splice(targetIndex, 0, moved);

      let nextActiveIdx = activeLevelIndex;
      if (activeLevelIndex === index) {
        nextActiveIdx = targetIndex;
      } else if (direction === -1 && activeLevelIndex === targetIndex) {
        nextActiveIdx = activeLevelIndex + 1;
      } else if (direction === 1 && activeLevelIndex === targetIndex) {
        nextActiveIdx = activeLevelIndex - 1;
      }

      setCampaignLevels(nextLevels);
      setActiveLevelIndex(nextActiveIdx);
      setEngineLog(
        `Campaign: Moved '${moved.title || `Level ${index + 1}`}' to position #${
          targetIndex + 1
        }.`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex, setEngineLog, setCampaignLevels, setActiveLevelIndex]
  );

  const handleUpdateCampaignSettings = useCallback(
    (nextSettings: CampaignSettings) => {
      setCampaignSettings(nextSettings);
      setEngineLog(
        `Campaign Carry-Over: Health=${
          nextSettings.carryOverHealth ? 'ON' : 'OFF'
        }, Ammo=${nextSettings.carryOverAmmo ? 'ON' : 'OFF'}.`
      );
    },
    [setEngineLog, setCampaignSettings]
  );

  return {
    getSyncedCampaignLevels,
    handleSelectCampaignLevel,
    handleRenameCampaignLevel,
    handleAddCampaignLevel,
    handleDuplicateCampaignLevel,
    handleDeleteCampaignLevel,
    handleMoveCampaignLevel,
    handleUpdateCampaignSettings,
  };
}
