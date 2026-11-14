/**
 * The editor's playtest controls (moved out of startGame.ts in P1.4). The editor starts games with
 * startPlaytest, which adds these controls to the handle; exported games call startGame directly,
 * so none of this code ships in them.
 */
/**
 * ============================================================================
 * STANDALONE ENGINE RUNTIME ENTRY POINT (`startGame`)
 * ============================================================================
 * Pure Three.js + Vanilla DOM runtime with zero React or editor dependencies.
 * Extracted from Viewport3D.tsx for 1:1 parity between editor preview and
 * standalone exported games.
 */

import {
  CampaignSettings,
  GameManifest,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
} from '../types';
import { RUNTIME_CONTEXT } from '../core/RuntimeState';
import type { RuntimeContext } from '../core/RuntimeState';
import { syncHud } from '../core/hud';
import { updateSkybox, rebuild3DWorld } from '../core/WorldView';
import { teleportToSpawn } from '../core/campaign';
import {
  LevelDataV3,
  SIM_CONFIG,
  SimulationState,
  buildSolidFootprintGrid,
  checkCircleCollisionUnits,
  depenetrateCircleUnits,
  radiansToBam,
  worldUnitsToGrid,
} from '../../sim';
import { startGame } from '../startGame';
import type { GameRuntimeHandle, StartGameOptions } from '../core/api';

export interface EditorLevelSyncPayload {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  customTextures: TextureAsset[];
  entities: PlacedEntity[];
  spawn: { row: number; col: number; yaw: number };
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  minimapEnabled: boolean;
  vertical?: VerticalLevelData;
  levels?: LevelDataV3[];
  currentLevelIndex?: number;
  campaign?: CampaignSettings;
}

/** Live editing controls for a game running inside the editor */
export interface EditorControls {
  setShowCeiling: (show: boolean) => void;
  setShowWireframe: (wireframe: boolean) => void;
  setCollisionEnabled: (enabled: boolean) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  setSkybox: (theme: SkyboxThemeId, seed: number) => void;
  syncEditorLevel: (payload: EditorLevelSyncPayload) => void;
  setSimState: (nextSim: SimulationState) => void;
}

export type PlaytestRuntimeHandle = GameRuntimeHandle & EditorControls;

/** Starts a game like startGame and adds the editor's live controls */
export function startPlaytest(
  manifest: GameManifest,
  canvasOrContainer: HTMLCanvasElement | HTMLElement | null,
  options: StartGameOptions = {}
): PlaytestRuntimeHandle {
  const handle = startGame(manifest, canvasOrContainer, options);
  const ctx = (handle as unknown as Record<symbol, RuntimeContext>)[RUNTIME_CONTEXT];
  return Object.assign(handle, createEditorControls(ctx));
}

function createEditorControls(ctx: RuntimeContext): EditorControls {
  const { rt, countLevelEnemies } = ctx;
  return {
  setShowCeiling: (show: boolean) => {
    if (rt.showCeiling === show) return;
    rt.showCeiling = show;
    rebuild3DWorld(ctx);
  },
  setShowWireframe: (wireframe: boolean) => {
    if (rt.showWireframe === wireframe) return;
    rt.showWireframe = wireframe;
    rebuild3DWorld(ctx);
  },
  setCollisionEnabled: (enabled: boolean) => {
    rt.collisionEnabled = enabled;
  },
  setMinimapEnabled: (enabled: boolean) => {
    rt.minimapEnabled = enabled;
    syncHud(ctx);
  },
  setSkybox: (theme: SkyboxThemeId, seed: number) => {
    if (rt.skyboxTheme === theme && rt.skyboxSeed === seed) return;
    rt.skyboxTheme = theme;
    rt.skyboxSeed = seed;
    updateSkybox(ctx);
  },
  syncEditorLevel: (payload: EditorLevelSyncPayload) => {
    if (payload.campaign) {
      rt.campaignSettings = { ...payload.campaign };
      rt.menuController?.setMenuPack(rt.campaignSettings.menus);
    }
    if (payload.levels && payload.levels.length > 0) {
      rt.campaignLevels = payload.levels.map((l) =>
        JSON.parse(JSON.stringify(l))
      );
    }
    if (
      typeof payload.currentLevelIndex === 'number' &&
      payload.currentLevelIndex !== rt.currentLevelIndex
    ) {
      rt.currentLevelIndex = Math.max(
        0,
        Math.min(rt.campaignLevels.length - 1, payload.currentLevelIndex)
      );
    }

    rt.customTextures = payload.customTextures;
    rt.wallTextures = payload.wallTextures.map((r) => [...r]);
    rt.floorTextures = payload.floorTextures.map((r) => [...r]);
    rt.ceilingTextures = payload.ceilingTextures.map((r) => [...r]);
    rt.entities = payload.entities.map((e) => ({ ...e }));
    rt.spawn = { ...payload.spawn };
    rt.showCeiling = payload.showCeiling;
    rt.minimapEnabled = payload.minimapEnabled;

    if (
      rt.skyboxTheme !== payload.skyboxTheme ||
      rt.skyboxSeed !== payload.skyboxSeed
    ) {
      rt.skyboxTheme = payload.skyboxTheme;
      rt.skyboxSeed = payload.skyboxSeed;
      updateSkybox(ctx);
    }

    if (payload.grid.length !== rt.currSimState.gridSize || payload.vertical !== rt.vertical) {
      rt.grid = payload.grid.map((r) => [...r]);
      rt.vertical = payload.vertical;
      rebuild3DWorld(ctx);
      teleportToSpawn(ctx);
      return;
    }

    rt.grid = payload.grid.map((r) => [...r]);
    rt.currSimState.grid = rt.grid.map((r) => [...r]);
    rt.currSimState.solidFootprint = buildSolidFootprintGrid(
      rt.entities.map((e) => ({
        ...e,
        yawBam: radiansToBam(e.yaw || 0),
      })),
      rt.grid.length
    );

    for (let r = 0; r < rt.grid.length; r++) {
      for (let c = 0; c < rt.grid.length; c++) {
        const mKey = `door:${r},${c}`;
        if (rt.grid[r]?.[c] === 2 && !rt.currSimState.movers[mKey]) {
          rt.currSimState.movers[mKey] = {
            id: mKey,
            kind: 'door',
            row: r,
            col: c,
            tag: rt.currSimState.cellTags[r]?.[c] ?? 0,
            state: 'closed',
            progress: 0,
            speedPerTick: SIM_CONFIG.DEFAULT_DOOR_SPEED_PER_TICK,
            waitTicks: 0,
            configuredWaitTicks: 0,
            locked: false,
            blockedBehavior: 'wait',
          };
        }
      }
    }

    const p0 = rt.currSimState.players[0];
    if (
      p0 &&
      rt.collisionEnabled &&
      checkCircleCollisionUnits(
        p0.xUnits,
        p0.zUnits,
        SIM_CONFIG.PLAYER_RADIUS_UNITS,
        rt.currSimState.grid,
        rt.currSimState.movers,
        rt.currSimState.solidFootprint
      )
    ) {
      const unstuck = depenetrateCircleUnits(
        p0.xUnits,
        p0.zUnits,
        SIM_CONFIG.PLAYER_RADIUS_UNITS,
        rt.currSimState.grid,
        rt.currSimState.movers,
        rt.currSimState.solidFootprint
      );
      p0.xUnits = unstuck.xUnits;
      p0.zUnits = unstuck.zUnits;
      const nextCell = worldUnitsToGrid(
        p0.xUnits,
        p0.zUnits,
        rt.currSimState.gridSize
      );
      p0.gridRow = nextCell.row;
      p0.gridCol = nextCell.col;
      if (rt.prevSimState.players[0]) {
        rt.prevSimState.players[0].xUnits = unstuck.xUnits;
        rt.prevSimState.players[0].zUnits = unstuck.zUnits;
        rt.prevSimState.players[0].gridRow = nextCell.row;
        rt.prevSimState.players[0].gridCol = nextCell.col;
      }
    }

    rt.combatState = {
      ...rt.combatState,
      totalEnemies: countLevelEnemies(),
    };

    rebuild3DWorld(ctx);
    syncHud(ctx);
  },
  setSimState: (nextSim: SimulationState) => {
    rt.currSimState = nextSim;
    rt.prevSimState = nextSim;
    rt.lastLogCount = nextSim.logs.length;
    rt.lastSoundCount = nextSim.soundsPlayed.length;
    syncHud(ctx);
  },
  };
}
