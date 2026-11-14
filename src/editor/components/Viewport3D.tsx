/**
 * ============================================================================
 * GRIDFORGE 3D DESKTOP IDE — THIN REACT WRAPPER AROUND `/src/runtime/startGame`
 * ============================================================================
 * Mounts the standalone engine runtime (`startGame`) and renders only the
 * editor header controls (Wireframe, Collision/Noclip, Ceiling toggle, Minimap
 * toggle, Pointer Lock, Reset, Maximize 3D).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  CampaignSettings,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
} from '../types/engine';
import { LevelDataV3, SimulationState } from '../../sim';
import { VerticalLevelData, isFlatVerticalData } from '../../runtime';
import { LevelSerializer } from '../engine/LevelSerializer';
import { GameRuntimeHandle, startGame } from '../../runtime';
import { createGameManifest } from '../../runtime';
import { playtestStore } from '../playtest/playtestStore';
import {
  Crosshair,
  RotateCcw,
  ShieldCheck,
  Box,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Pencil,
} from 'lucide-react';

interface Viewport3DProps {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  customTextures: TextureAsset[];
  entities: PlacedEntity[];
  spawn: { row: number; col: number; yaw: number };
  showCeiling: boolean;
  onToggleCeiling: () => void;
  minimapEnabled: boolean;
  onToggleMinimap: () => void;
  isPlayFullscreen: boolean;
  onTogglePlayFullscreen: () => void;
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  simState: SimulationState;
  resetSignal: number;
  onEngineLog: (message: string) => void;
  /** Stacked layers, heights and movement settings (flat levels may leave it out) */
  vertical?: VerticalLevelData;
  /** Shows an Edit button that returns the center pane to the 3D editor */
  onExitPlay?: () => void;
  /** Full sequence of campaign gameplay levels */
  campaignLevels?: LevelDataV3[];
  /** Index of the active level in campaignLevels */
  activeLevelIndex?: number;
  /** Health & Ammo carry-over settings between levels */
  campaignSettings?: CampaignSettings;
  /** Whether to boot directly into the Out-of-Game Main Menu when entering play */
  startInMainMenu?: boolean;
  /** Callback when the player advances to another campaign level during play */
  onCampaignLevelChange?: (
    levelIndex: number,
    carriedStats: { health: number; ammo: number },
    nextSimState: SimulationState
  ) => void;
}

export const Viewport3D: React.FC<Viewport3DProps> = ({
  grid,
  wallTextures,
  floorTextures,
  ceilingTextures,
  customTextures,
  entities,
  spawn,
  showCeiling,
  onToggleCeiling,
  minimapEnabled,
  onToggleMinimap,
  isPlayFullscreen,
  onTogglePlayFullscreen,
  skyboxTheme,
  skyboxSeed,
  simState,
  resetSignal,
  onEngineLog,
  vertical,
  onExitPlay,
  campaignLevels,
  activeLevelIndex,
  campaignSettings,
  startInMainMenu,
  onCampaignLevelChange,
}) => {
  // Flat levels keep the exact original level data
  const levelVertical = vertical && !isFlatVerticalData(vertical) ? vertical : undefined;
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const hudRootRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<GameRuntimeHandle | null>(null);

  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [collisionEnabled, setCollisionEnabled] = useState(true);



  const onToggleMinimapRef = useRef(onToggleMinimap);
  onToggleMinimapRef.current = onToggleMinimap;

  const onEngineLogRef = useRef(onEngineLog);
  onEngineLogRef.current = onEngineLog;

  const onCampaignLevelChangeRef = useRef(onCampaignLevelChange);
  onCampaignLevelChangeRef.current = onCampaignLevelChange;

  useEffect(() => {
    const container = canvasMountRef.current;
    const hudRoot = hudRootRef.current;
    if (!container || !hudRoot) return;

    const initialLevelV3 = LevelSerializer.serializeLevelV3({
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      entities,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      cellTags: simState.cellTags,
      events: simState.events,
      regions: simState.regions,
      variables: {
        flags: simState.flags,
        counters: simState.counters,
        timers: Object.keys(simState.timers),
      },
      vertical: levelVertical,
    });

    const handle = startGame(createGameManifest(initialLevelV3), container, {
      hudRoot,
      initialSimState: simState,
      showCeiling,
      showWireframe,
      collisionEnabled,
      minimapEnabled,
      customTextures,
      levels: campaignLevels,
      currentLevelIndex: activeLevelIndex,
      campaign: campaignSettings,
      startInMainMenu,
      // Live game state goes to the playtest store, never back into the document (P1.7)
      onSimStateChange: playtestStore.setLiveSim,
      onPlayerMove: playtestStore.setPlayer,
      onEngineLog: playtestStore.setLog,
      onPointerLockChange: (locked) => setIsPointerLocked(locked),
      onMinimapToggleRequest: () => onToggleMinimapRef.current(),
      onLevelChange: (lvlIdx, carried, nextSim) =>
        onCampaignLevelChangeRef.current?.(lvlIdx, carried, nextSim),
    });

    runtimeRef.current = handle;

    return () => {
      handle.dispose();
      runtimeRef.current = null;
      playtestStore.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount the runtime once; the effects below push later prop changes into it
  }, []);

  useEffect(() => {
    runtimeRef.current?.setSimState(simState);
  }, [simState]);

  useEffect(() => {
    runtimeRef.current?.setShowCeiling(showCeiling);
  }, [showCeiling]);

  useEffect(() => {
    runtimeRef.current?.setShowWireframe(showWireframe);
  }, [showWireframe]);

  useEffect(() => {
    runtimeRef.current?.setCollisionEnabled(collisionEnabled);
  }, [collisionEnabled]);

  useEffect(() => {
    runtimeRef.current?.setMinimapEnabled(minimapEnabled);
  }, [minimapEnabled]);

  useEffect(() => {
    runtimeRef.current?.setSkybox(skyboxTheme, skyboxSeed);
  }, [skyboxTheme, skyboxSeed]);

  useEffect(() => {
    if (campaignSettings) {
      runtimeRef.current?.setCampaignSettings(campaignSettings);
    }
  }, [campaignSettings]);

  // The runtime starts with exactly these props, so the first run would only rebuild the same world
  const skipFirstSync = useRef(true);
  useEffect(() => {
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    runtimeRef.current?.syncEditorLevel({
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      vertical: levelVertical,
      levels: campaignLevels,
      currentLevelIndex: activeLevelIndex,
      campaign: campaignSettings,
    });
  }, [
    levelVertical,
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    customTextures,
    entities,
    spawn,
    skyboxTheme,
    skyboxSeed,
    showCeiling,
    minimapEnabled,
    campaignLevels,
    activeLevelIndex,
    campaignSettings,
  ]);

  const isFirstResetEffect = useRef(true);
  useEffect(() => {
    if (isFirstResetEffect.current) {
      isFirstResetEffect.current = false;
      return;
    }
    runtimeRef.current?.resetToSpawn();
  }, [spawn, resetSignal]);

  return (
    <section
      id="viewport-3d-container"
      aria-label="3D First-Person Viewport"
      className="flex flex-col w-full h-full bg-[#141414] select-none overflow-hidden"
    >
      {/* Compact 24px Desktop IDE Viewport Header Bar */}
      <div className="ide-panel-header">
        <div className="flex items-center gap-2">
          {onExitPlay && (
            <button
              type="button"
              onClick={onExitPlay}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-[#478cbf] hover:bg-[#5a9bd0] text-white"
              title="Stop playing and go back to the 3D editor"
            >
              <Pencil className="w-3 h-3" /> Edit
            </button>
          )}
          <span>Test Play</span>
          <span className="font-mono text-[#858585]">
            {isPointerLocked ? '[Mouse Locked - ESC]' : '[WASD + LMB/F Fire]'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {campaignSettings?.menus && (
            <>
              <button
                type="button"
                onClick={() => runtimeRef.current?.openMainMenu()}
                className="ide-btn !h-[18px] !px-1.5 !text-[10px] text-[#38bdf8]"
                title="Preview Out-of-Game Main Menu in Live 3D Runtime"
              >
                <span>Main Menu</span>
              </button>
              <button
                type="button"
                onClick={() => runtimeRef.current?.openInGameOverlay()}
                className="ide-btn !h-[18px] !px-1.5 !text-[10px] text-[#4ec9b0]"
                title="Trigger In-Game Pause Overlay [ESC / I]"
              >
                <span>Pause UI</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onToggleMinimap}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              minimapEnabled ? 'ide-btn--active' : ''
            }`}
            title="Toggle In-Game Minimap Radar [M]"
          >
            <MapIcon className="w-2.5 h-2.5" />
            <span>Minimap</span>
          </button>

          <button
            type="button"
            onClick={onToggleCeiling}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              showCeiling ? 'ide-btn--active' : ''
            }`}
            title="Toggle 3D Ceiling Mesh"
          >
            <Layers className="w-2.5 h-2.5" />
            <span>Ceiling</span>
          </button>

          <button
            type="button"
            onClick={() => setShowWireframe((prev) => !prev)}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              showWireframe ? 'ide-btn--active' : ''
            }`}
            title="Toggle Mesh Wireframe"
          >
            <Box className="w-2.5 h-2.5" />
            <span>Wire</span>
          </button>

          <button
            type="button"
            onClick={() => setCollisionEnabled((prev) => !prev)}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              collisionEnabled ? 'ide-btn--active' : ''
            }`}
            title="Toggle Wall & Entity Collision"
          >
            <ShieldCheck className="w-2.5 h-2.5" />
            <span>{collisionEnabled ? 'Collide' : 'Noclip'}</span>
          </button>

          <button
            type="button"
            onClick={() => runtimeRef.current?.lockPointer()}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              isPointerLocked ? 'ide-btn--active' : ''
            }`}
            title="Lock Mouse Pointer for 360° Mouselook"
          >
            <Crosshair className="w-2.5 h-2.5" />
            <span>{isPointerLocked ? 'Locked' : 'Lock Mouse'}</span>
          </button>

          <button
            type="button"
            onClick={() => runtimeRef.current?.fullRespawn()}
            className="ide-btn !h-[18px] !px-1.5 !text-[10px]"
            title="Reset Player Health, Ammo & Enemy AI"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>

          <button
            type="button"
            onClick={onTogglePlayFullscreen}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              isPlayFullscreen ? 'ide-btn--active' : ''
            }`}
            title="Toggle Fullscreen 3D Game View"
          >
            {isPlayFullscreen ? (
              <>
                <Minimize2 className="w-2.5 h-2.5" />
                <span>Editor View</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-2.5 h-2.5" />
                <span>Maximize 3D</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* WebGL Canvas + Vanilla DOM Runtime HUD Root */}
      <div className="relative flex-1 w-full min-h-0 overflow-hidden">
        <div ref={canvasMountRef} className="w-full h-full cursor-crosshair" />
        <div ref={hudRootRef} className="absolute inset-0 pointer-events-none" />
      </div>
    </section>
  );
};
