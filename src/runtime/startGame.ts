/**
 * ============================================================================
 * STANDALONE ENGINE RUNTIME ENTRY POINT (`startGame`)
 * ============================================================================
 * Pure Three.js + Vanilla DOM runtime with zero React or editor dependencies.
 * Extracted from Viewport3D.tsx for 1:1 parity between editor preview and
 * standalone exported games.
 */

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import {
  CampaignSettings,
  DEFAULT_CAMPAIGN_SETTINGS,
  ENGINE_CONFIG,
  GameManifest,
} from './types';
import { emitDebugEvent, registerDebugProbe } from './debugEvents';
import { InputState, bindInputListeners, createInputReader } from './core/InputController';
import type { GameRuntimeHandle, StartGameOptions } from './core/api';
export type { GameRuntimeHandle, InputSourceOption, StartGameOptions, TickInputProvider } from './core/api';
export { createInputReader } from './core/InputController';
import { createRenderSystem } from './core/RenderSystem';
import { RUNTIME_CONTEXT } from './core/RuntimeState';
import type { RuntimeContext, RuntimeState } from './core/RuntimeState';
import { UNITS_TO_METERS } from './core/constants';
import { syncHud } from './core/hud';
import { handleFireWeapon, handleReloadAmmo } from './core/combat';
import { updateSkybox, rebuild3DWorld } from './core/WorldView';
import { teleportToSpawn, handleFullRespawn, loadCampaignLevel, handleAdvanceToNextLevel } from './core/campaign';
import { runSingleSimTick } from './core/simTick';
import { mountHudAndMenus } from './core/hudSetup';
import { FrameLoopState, createFrameTick } from './core/GameLoop';
import { verticalFromLevelV3 } from './verticalLevelData';
import {
  PlayerTickInput,
  bamToRadians,
  createInitialSimulationState,
  isVerticalLevel,
} from '../sim';
import {
  placedEntitiesFromLevelV3,
} from './LevelSerializer';
import { TextureGenerator } from './TextureGenerator';
import { EntityLoader } from './EntityLoader';
import { AssetRegistry } from './AssetRegistry';
import { CollisionSystem } from './CollisionSystem';
import { WorldBuilder } from './WorldBuilder';
import { CombatSystem } from './CombatSystem';
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
} from './menu';





/**
 * Starts the game runtime on a validated GameManifest. Load untrusted manifest JSON with
 * `loadGameManifest` first; the editor builds manifests with `createGameManifestFromEditor`.
 */
export function startGame(
  manifest: GameManifest,
  canvasOrContainer: HTMLCanvasElement | HTMLElement | null,
  options: StartGameOptions = {}
): GameRuntimeHandle {
  // All mutable state of one running game; subsystems in ./core receive it (P1.4)
  const rt = {} as RuntimeState;
  if (options.assetBaseUrl !== undefined) {
    TextureGenerator.setAssetBaseUrl(options.assetBaseUrl);
    EntityLoader.setAssetBaseUrl(options.assetBaseUrl);
  }
  if (options.dracoDecoderPath !== undefined) {
    EntityLoader.setDracoDecoderPath(options.dracoDecoderPath);
  }

  const activeManifest: GameManifest = manifest;

  rt.campaignLevels = options.levels && options.levels.length > 0
      ? options.levels.map((l) => JSON.parse(JSON.stringify(l)))
      : activeManifest.levels && activeManifest.levels.length > 0
      ? activeManifest.levels.map((l) => JSON.parse(JSON.stringify(l)))
      : [activeManifest.level];

  rt.currentLevelIndex = Math.max(
    0,
    Math.min(
      rt.campaignLevels.length - 1,
      options.currentLevelIndex ?? 0
    )
  );

  rt.campaignSettings = {
    ...(options.campaign ??
      activeManifest.campaign ??
      DEFAULT_CAMPAIGN_SETTINGS),
  };

  rt.currentLevelV3 = rt.campaignLevels[rt.currentLevelIndex] ?? activeManifest.level;

  if (activeManifest.assets?.textures) {
    for (const tex of activeManifest.assets.textures) {
      if (tex.path && !AssetRegistry.getTexture(tex.id)) {
        AssetRegistry.registerTexture({
          id: tex.id,
          name: tex.id,
          sourceType: 'file',
          previewUrl: tex.path,
          recommendedSurface: 'any',
        });
      }
    }
  }

  if (activeManifest.assets?.models) {
    for (const mdl of activeManifest.assets.models) {
      if (mdl.path && !AssetRegistry.getModel(mdl.id)) {
        AssetRegistry.registerModel({
          id: mdl.id,
          blueprintId: 'custom-glb',
          name: mdl.id,
          sourceType: 'file',
          customGlbUrl: mdl.path,
          isEnemy: false,
          defaultHealth: 75,
          moveSpeed: 0,
          attackDamage: 0,
          accentHex: '#38BDF8',
          badgeText: 'GLB',
        });
      }
    }
  }

  rt.customTextures = options.customTextures ?? [];

  rt.grid = rt.currentLevelV3.grid.map((r) => [...r]);
  rt.wallTextures = rt.currentLevelV3.wallTextures.map((r) => [...r]);
  rt.floorTextures = rt.currentLevelV3.floorTextures.map((r) => [
    ...r,
  ]);
  rt.ceilingTextures = rt.currentLevelV3.ceilingTextures.map((r) => [
    ...r,
  ]);
  rt.entities = placedEntitiesFromLevelV3(rt.currentLevelV3);
  rt.spawn = {
    row: rt.currentLevelV3.spawn.row,
    col: rt.currentLevelV3.spawn.col,
    yaw: bamToRadians(rt.currentLevelV3.spawn.yawBam),
  };
  rt.skyboxTheme = rt.currentLevelV3.skybox.theme;
  rt.skyboxSeed = rt.currentLevelV3.skybox.seed;
  rt.showCeiling = options.showCeiling ?? rt.currentLevelV3.skybox.showCeiling ?? true;
  rt.showWireframe = options.showWireframe ?? false;
  rt.collisionEnabled = options.collisionEnabled ?? true;
  rt.minimapEnabled = options.minimapEnabled ?? rt.currentLevelV3.minimapEnabled ?? true;
  // Flat levels (classic retro ones included) draw with the flat world builder
  rt.vertical = isVerticalLevel(rt.currentLevelV3)
    ? verticalFromLevelV3(rt.currentLevelV3)
    : undefined;
  rt.updateLayeredHeights = null;

  const inputReader = createInputReader(options.inputSource);
  const isReplayOrDeterministic =
    Boolean(inputReader) || Boolean(options.deterministicSimOnly);
  const recordInputs = Boolean(options.recordInputs);
  const hashEveryTick = Boolean(
    options.recordTickHashes ?? (recordInputs || options.onTickHash || !canvasOrContainer)
  );
  const recordedInputs: PlayerTickInput[] = [];
  const tickHashes: string[] = [];

  const initialSim =
    options.initialSimState ?? createInitialSimulationState(rt.currentLevelV3, [0]);
  rt.prevSimState = initialSim;
  rt.currSimState = initialSim;
  rt.lastLogCount = rt.currSimState.logs.length;
  rt.lastSoundCount = rt.currSimState.soundsPlayed.length;

  const countLevelEnemies = () =>
    rt.entities.filter(
      (e) => e.isEnemy !== false && e.blueprintId !== 'supply-crate'
    ).length;

  // Enemy models load asynchronously, so the AI reports 0 enemies at first.
  // Keep the level's count on the HUD until the AI has registered at least that many.
  rt.aiEnemiesLoaded = false;

  rt.levelEntryState = {
    health:
      initialSim.players[0]?.health ?? ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: initialSim.players[0]?.ammo ?? ENGINE_CONFIG.PLAYER_START_AMMO,
  };

  rt.combatState = {
    health: rt.levelEntryState.health,
    maxHealth: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: rt.levelEntryState.ammo,
    maxAmmo: ENGINE_CONFIG.PLAYER_MAX_AMMO,
    kills: 0,
    totalEnemies: countLevelEnemies(),
    isDead: false,
    lastHitEnemyName: null,
    lastHitEnemyHealth: null,
    lastHitEnemyMaxHealth: null,
  };

  rt.isMuzzleFlashing = false;
  rt.isHitMarkerActive = false;
  rt.isPlayerHurtFlashing = false;
  rt.enemySnapshots = [];
  rt.ammoDrops = [];

  rt.muzzleFlashTimeout = 0;
  rt.hitMarkerTimeout = 0;
  rt.hurtFlashTimeout = 0;

  rt.scene = null;
  rt.camera = null;
  rt.renderer = null;
  rt.controls = null;
  rt.hemiLight = null;
  rt.dirLight = null;
  rt.worldGroup = null;
  rt.wallMeshes = [];
  rt.getWallBlockGroup = () =>
    undefined;
  rt.doorMeshes = new Map();
  rt.keyMeshes = new Map();
  rt.floorLayer = null;
  rt.ceilingLayer = null;
  rt.enemyAI = null;
  rt.combatSystem = null;
  rt.doorTex = null;
  rt.skyboxTex = null;
  rt.renderSystem = null;
  rt.removeRendererProbe = () => {};
  rt.removeWorldBuildProbe = () => {};
  rt.worldBuildCount = 0;

  const input = new InputState();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const ctx: RuntimeContext = {
    rt,
    options,
    input,
    euler,
    inputReader,
    isReplayOrDeterministic,
    recordInputs,
    hashEveryTick,
    recordedInputs,
    tickHashes,
    countLevelEnemies,
  };

  const initialWorld = CollisionSystem.gridToWorld(
    rt.spawn.row,
    rt.spawn.col,
    rt.grid.length
  );
  rt.playerTransform = {
    x: initialWorld.x,
    y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
    z: initialWorld.z,
    yaw: rt.spawn.yaw,
    pitch: 0,
    gridRow: rt.spawn.row,
    gridCol: rt.spawn.col,
    speed: 0,
  };

  rt.combatHud = null;
  rt.minimapHud = null;
  rt.menuController = null;
  rt.runtimeSettings = {
    ...DEFAULT_MENU_RUNTIME_SETTINGS,
  };
  rt.elapsedSec = 0;














  const resolvedHudRoot =
    options.hudRoot !== undefined
      ? options.hudRoot
      : canvasOrContainer &&
        typeof HTMLElement !== 'undefined' &&
        canvasOrContainer instanceof HTMLElement &&
        !(canvasOrContainer instanceof HTMLCanvasElement)
      ? canvasOrContainer
      : null;

  // PointerLockControls.lock() drops the promise requestPointerLock() returns, so a refusal
  // (e.g. clicking again within ~1 s of pressing Esc) surfaced as an uncaught rejection.
  // Request the lock on the controls' own element instead; the controls still see the change.
  const requestPointerLockSafely = () => {
    const el = rt.controls?.domElement as HTMLElement | undefined;
    if (!el?.requestPointerLock) return;
    input.pointerLockRequested = true;
    const onRefused = () => {
      // Fall back to drag-look instead of turning on every mouse move
      input.pointerLockRequested = false;
    };
    try {
      const pending = el.requestPointerLock() as unknown as Promise<void> | undefined;
      pending?.catch?.(onRefused);
    } catch {
      onRefused();
    }
  };

  mountHudAndMenus(ctx, resolvedHudRoot, requestPointerLockSafely, activeManifest);

  rt.frameId = 0;
  rt.stopped = false;
  rt.disposed = false;
  rt.cleanupDomListeners = null;

  // Initialize Three.js WebGL scene if a canvas or container element is provided in a browser environment
  if (canvasOrContainer && typeof document !== 'undefined') {
    try {
      // Frame clock and HUD-sync bookkeeping of the render loop
      const loop = {} as FrameLoopState;
      rt.renderSystem = createRenderSystem(canvasOrContainer);
      const { mountEl } = rt.renderSystem;
      rt.scene = rt.renderSystem.scene;
      rt.camera = rt.renderSystem.camera;
      rt.renderer = rt.renderSystem.renderer;
      rt.hemiLight = rt.renderSystem.hemiLight;
      rt.dirLight = rt.renderSystem.dirLight;
      const probedRenderer = rt.renderer;
      rt.removeRendererProbe = registerDebugProbe('runtimeRenderer', () => ({ ...probedRenderer.info.memory }));
      rt.removeWorldBuildProbe = registerDebugProbe('runtimeWorldBuilds', () => rt.worldBuildCount);

      rt.combatSystem = new CombatSystem(rt.camera, rt.scene);
      rt.scene.add(rt.camera);

      rt.controls = new PointerLockControls(rt.camera, rt.renderer.domElement);
      const onLock = () => {
        input.pointerLockRequested = true;
        options.onPointerLockChange?.(true);
      };
      const onUnlock = () => {
        input.pointerLockRequested = false;
        options.onPointerLockChange?.(false);
        if (
          rt.menuController &&
          rt.menuController.getAppState() === 'ACTIVE_GAMEPLAY' &&
          rt.campaignSettings.menus?.enablePauseOverlay
        ) {
          rt.menuController.openInGameOverlay();
        }
      };
      rt.controls.addEventListener('lock', onLock);
      rt.controls.addEventListener('unlock', onUnlock);

      const domCanvas = rt.renderer.domElement;
      const unbindInput = bindInputListeners(input, {
        domCanvas,
        mountEl,
        isReplaying: () => Boolean(inputReader),
        isGameplayActive: () => !rt.menuController || rt.menuController.getAppState() === 'ACTIVE_GAMEPLAY',
        menuHandlesKey: (code) => Boolean(rt.menuController && rt.menuController.handleKeyDown(code)),
        lookSettings: () => rt.runtimeSettings,
        autoLockPointerOnClick: Boolean(options.autoLockPointerOnClick),
        requestPointerLock: requestPointerLockSafely,
        spaceJumps: () => Boolean(rt.currSimState.vertical?.movement.jump),
        fire: () => handleFireWeapon(ctx),
        reload: () => handleReloadAmmo(ctx),
        toggleMinimap: () => {
          if (options.onMinimapToggleRequest) {
            options.onMinimapToggleRequest();
          } else {
            rt.minimapEnabled = !rt.minimapEnabled;
            syncHud(ctx);
          }
        },
      });


      rt.camera.position.set(
        initialWorld.x,
        rt.currSimState.vertical
          ? (rt.currSimState.players[0]?.yUnits ?? 0) * UNITS_TO_METERS
          : ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
        initialWorld.z
      );
      euler.set(0, rt.spawn.yaw, 0, 'YXZ');
      rt.camera.quaternion.setFromEuler(euler);

      updateSkybox(ctx);
      rebuild3DWorld(ctx);

      loop.lastFrameTimeMs = performance.now();
      loop.accumulatorMs = 0;
      loop.lastHudSyncTime = 0;
      loop.hasSyncedHud = false;
      loop.lastSyncX = initialWorld.x;
      loop.lastSyncZ = initialWorld.z;
      loop.lastSyncYaw = rt.spawn.yaw;
      loop.lastSyncPitch = 0;
      loop.lastSyncRow = rt.spawn.row;
      loop.lastSyncCol = rt.spawn.col;
      loop.lastSyncSpeed = 0;
      loop.dioramaAngleRad = 0;

      const onVisibilityChange = () => {
        if (document.hidden) {
          loop.accumulatorMs = 0;
          input.releaseAllKeys();
        } else {
          loop.lastFrameTimeMs = performance.now();
          loop.accumulatorMs = 0;
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      const afterDraw = (cb: () => void) => {
        if (!rt.renderer || rt.stopped) return;
        const gl = rt.renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync
          ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
          : null;
        gl.flush();
        let polls = 0;
        const poll = () => {
          if (rt.stopped) return;
          polls += 1;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED && polls < 20) {
            rt.frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            rt.frameId = window.setTimeout(cb, 16);
          }
        };
        rt.frameId = window.setTimeout(poll, 5);
      };

      const tick = createFrameTick(ctx, loop, afterDraw);

      if (!inputReader && rt.currSimState.tick === 0 && !options.initialSimState) {
        runSingleSimTick(ctx, 0);
        syncHud(ctx);
      }
      rt.renderer.render(rt.scene, rt.camera);
      emitDebugEvent('first-frame');

      rt.frameId = requestAnimationFrame(tick);

      rt.cleanupDomListeners = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        rt.controls?.removeEventListener('lock', onLock);
        rt.controls?.removeEventListener('unlock', onUnlock);
        unbindInput();
      };
    } catch {
      // Headless / non-WebGL test environment fallback: simulation and stepTicks still work
    }
  }

  function stop(): void {
    rt.stopped = true;
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rt.frameId);
    }
    if (typeof clearTimeout !== 'undefined') {
      clearTimeout(rt.frameId);
      clearTimeout(rt.muzzleFlashTimeout);
      clearTimeout(rt.hitMarkerTimeout);
      clearTimeout(rt.hurtFlashTimeout);
    }
  }

  function dispose(): void {
    if (rt.disposed) return;
    rt.disposed = true;
    stop();
    rt.cleanupDomListeners?.();
    rt.cleanupDomListeners = null;
    rt.combatHud?.dispose();
    rt.combatHud = null;
    rt.minimapHud?.dispose();
    rt.minimapHud = null;
    rt.menuController?.dispose();
    rt.menuController = null;
    rt.skyboxTex?.dispose();
    rt.skyboxTex = null;
    rt.doorTex?.dispose();
    rt.doorTex = null;
    rt.combatSystem?.dispose();
    rt.combatSystem = null;
    WorldBuilder.disposeWorldGroup(rt.worldGroup);
    rt.worldGroup = null;
    rt.controls?.dispose();
    rt.controls = null;
    rt.removeRendererProbe();
    rt.removeWorldBuildProbe();
    // Releases the renderer, its WebGL context, the environment map and the shadow map
    rt.renderSystem?.dispose();
    rt.renderSystem = null;
    rt.renderer = null;
    rt.dirLight = null;
  }

  const handle: GameRuntimeHandle = {
    stop,
    dispose,
    getState: () => rt.currSimState,
    getManifest: () => activeManifest,
    stepTicks: (count: number) => {
      for (let i = 0; i < count; i++) {
        runSingleSimTick(ctx, i);
      }
      syncHud(ctx);
      return tickHashes;
    },
    getTickHashes: () => [...tickHashes],
    getRecordedInputs: () => [...recordedInputs],
    getCurrentLevelIndex: () => rt.currentLevelIndex,
    getTotalLevels: () => rt.campaignLevels.length,
    goToLevel: (
      index: number,
      carryOver?: { health?: number; ammo?: number }
    ) => {
      loadCampaignLevel(ctx, index, carryOver);
    },
    advanceToNextLevel: () => handleAdvanceToNextLevel(ctx),
    setCampaignSettings: (nextCampaign: CampaignSettings) => {
      rt.campaignSettings = { ...nextCampaign };
      rt.menuController?.setMenuPack(rt.campaignSettings.menus);
      syncHud(ctx);
    },
    resetToSpawn: () => teleportToSpawn(ctx),
    fullRespawn: () => handleFullRespawn(ctx),
    lockPointer: requestPointerLockSafely,
    getMenuAppState: () => rt.menuController?.getAppState() ?? 'ACTIVE_GAMEPLAY',
    openMainMenu: () => rt.menuController?.enterMainMenu(),
    openInGameOverlay: (screenId?: string) => {
      rt.menuController?.openInGameOverlay(screenId);
    },
    resumeFromOverlay: () => rt.menuController?.closeMenuAndResume(),
  };
  // startPlaytest (debug/editorControls.ts) reads the context to add the editor's controls
  Object.defineProperty(handle, RUNTIME_CONTEXT, { value: ctx });
  return handle;
}
