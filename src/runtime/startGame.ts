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
  PlacedEntity,
  PlayerTransform,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
} from './types';
import { emitDebugEvent, registerDebugProbe } from './debugEvents';
import { InputState, bindInputListeners } from './core/InputController';
import { createRenderSystem } from './core/RenderSystem';
import type { RuntimeContext, RuntimeState } from './core/RuntimeState';
import { UNITS_TO_METERS } from './core/constants';
import { hudEnemyTotals, syncHud } from './core/hud';
import { emitLog, handleFireWeapon, handleReloadAmmo } from './core/combat';
import { updateSkybox, rebuild3DWorld } from './core/WorldView';
import { teleportToSpawn, handleFullRespawn, loadCampaignLevel, handleAdvanceToNextLevel, handleRestartCampaign } from './core/campaign';
import { runSingleSimTick } from './core/simTick';
import { verticalFromLevelV3 } from './verticalLevelData';
import {
  LevelDataV3,
  PlayerTickInput,
  SIM_CONFIG,
  SimulationState,
  bamToRadians,
  buildSolidFootprintGrid,
  checkCircleCollisionUnits,
  createInitialSimulationState,
  depenetrateCircleUnits,
  getOpenDoorsSetFromSim,
  isVerticalLevel,
  lerpBamToRadians,
  radiansToBam,
  worldUnitsToGrid,
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
import { SoundEffects } from './SoundEffects';
import { CombatHUDController } from './hud/CombatHUD';
import { MinimapHUDController } from './hud/MinimapHUD';
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
  MenuRuntimeController,
  RuntimeAppState,
} from './menu';

const TICK_MS = 1000 / SIM_CONFIG.TICKS_PER_SECOND;

export interface TickInputProvider {
  nextInput: (tick: number) => PlayerTickInput | undefined;
}

export type InputSourceOption =
  | readonly PlayerTickInput[]
  | TickInputProvider
  | ((tick: number) => PlayerTickInput | undefined);


export interface StartGameOptions {
  assetBaseUrl?: string;
  dracoDecoderPath?: string;
  inputSource?: InputSourceOption;
  hudRoot?: HTMLElement | null;
  autoLockPointerOnClick?: boolean;
  recordInputs?: boolean;
  deterministicSimOnly?: boolean;
  onTickHash?: (tick: number, hash: string, state: SimulationState) => void;
  /**
   * Hash the full sim state every tick and keep the hashes (getTickHashes). Hashing costs about
   * 1 ms per tick on a 64x64 level, so live play leaves it off. It is on when this is true, when
   * recordInputs or onTickHash is set, and in headless runs (no canvas), which replay tests use.
   */
  recordTickHashes?: boolean;
  // Multi-level campaign options
  levels?: LevelDataV3[];
  currentLevelIndex?: number;
  campaign?: CampaignSettings;
  onLevelChange?: (
    levelIndex: number,
    carryOver: { health: number; ammo: number },
    simState: SimulationState
  ) => void;
  // Editor integration hooks (all optional; unused in standalone exports)
  initialSimState?: SimulationState;
  showCeiling?: boolean;
  showWireframe?: boolean;
  collisionEnabled?: boolean;
  minimapEnabled?: boolean;
  customTextures?: TextureAsset[];
  onSimStateChange?: (state: SimulationState) => void;
  onPlayerMove?: (transform: PlayerTransform) => void;
  onEngineLog?: (message: string) => void;
  onPointerLockChange?: (locked: boolean) => void;
  onMinimapToggleRequest?: () => void;
  startInMainMenu?: boolean;
  onMenuStateChange?: (
    state: RuntimeAppState,
    activeScreenId: string | null
  ) => void;
}

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

export interface GameRuntimeHandle {
  stop: () => void;
  dispose: () => void;
  getState: () => SimulationState;
  getManifest: () => GameManifest;
  stepTicks: (count: number) => string[];
  getTickHashes: () => string[];
  getRecordedInputs: () => PlayerTickInput[];
  // Campaign progression methods
  getCurrentLevelIndex: () => number;
  getTotalLevels: () => number;
  goToLevel: (
    index: number,
    carryOver?: { health?: number; ammo?: number }
  ) => void;
  advanceToNextLevel: () => void;
  setCampaignSettings: (campaign: CampaignSettings) => void;
  // Editor control methods
  setShowCeiling: (show: boolean) => void;
  setShowWireframe: (wireframe: boolean) => void;
  setCollisionEnabled: (enabled: boolean) => void;
  setMinimapEnabled: (enabled: boolean) => void;
  setSkybox: (theme: SkyboxThemeId, seed: number) => void;
  syncEditorLevel: (payload: EditorLevelSyncPayload) => void;
  setSimState: (nextSim: SimulationState) => void;
  resetToSpawn: () => void;
  fullRespawn: () => void;
  lockPointer: () => void;
  getMenuAppState: () => RuntimeAppState;
  openMainMenu: () => void;
  openInGameOverlay: (screenId?: string) => void;
  resumeFromOverlay: () => void;
}


/** Heights partway between two ticks; returns `curr` itself when nothing is moving */
function lerpHeights(prev: number[][], curr: number[][], alpha: number): number[][] {
  if (prev === curr || prev.every((row, r) => row.every((h, c) => h === curr[r]?.[c]))) return curr;
  return curr.map((row, r) =>
    row.map((h, c) => {
      const from = prev[r]?.[c] ?? h;
      return from + (h - from) * alpha;
    })
  );
}


export function createInputReader(
  source: InputSourceOption | undefined
): ((tick: number) => PlayerTickInput | undefined) | null {
  if (!source) return null;
  if (typeof source === 'function') {
    return source;
  }
  if (Array.isArray(source)) {
    return (tick: number) => source[tick];
  }
  if (typeof (source as TickInputProvider).nextInput === 'function') {
    return (tick: number) => (source as TickInputProvider).nextInput(tick);
  }
  return null;
}


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

  // Mount vanilla HUDs if hudRoot is provided or defaulted to container
  if (resolvedHudRoot) {
    rt.combatHud = new CombatHUDController(resolvedHudRoot, {
      onFireWeapon: () => handleFireWeapon(ctx),
      onReloadAmmo: () => handleReloadAmmo(ctx),
      onUseAction: () => {
        input.pendingUse = true;
      },
      onRespawnPlayer: () => handleFullRespawn(ctx),
      onNextLevel: () => handleAdvanceToNextLevel(ctx),
      onRestartCampaign: () => handleRestartCampaign(ctx),
    });
    rt.minimapHud = new MinimapHUDController(resolvedHudRoot, () => {
      if (options.onMinimapToggleRequest) {
        options.onMinimapToggleRequest();
      } else {
        rt.minimapEnabled = false;
        syncHud(ctx);
      }
    });

    if (!isReplayOrDeterministic) {
      const bootInMainMenu =
        options.startInMainMenu !== undefined
          ? options.startInMainMenu
          : Boolean(
              rt.campaignSettings.menus?.enableMainMenuOnBoot &&
                !options.initialSimState
            );

      rt.menuController = new MenuRuntimeController(
        resolvedHudRoot,
        rt.campaignSettings.menus,
        {
          getGameTitle: () =>
            activeManifest.meta?.title ||
            rt.campaignLevels[0]?.metadata?.title ||
            'GridForge Game',
          getCombatState: () => rt.combatState,
          getSimState: () => rt.currSimState,
          getCurrentLevelIndex: () => rt.currentLevelIndex,
          getTotalLevels: () => rt.campaignLevels.length,
          getCurrentLevelTitle: () =>
            rt.campaignLevels[rt.currentLevelIndex]?.metadata?.title ||
            `Level ${rt.currentLevelIndex + 1}`,
          getElapsedSeconds: () => rt.elapsedSec,
          getCustomTextures: () => rt.customTextures,
          onStartNewGame: (startIdx) => {
            loadCampaignLevel(ctx, startIdx, {
              health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
              ammo: ENGINE_CONFIG.PLAYER_START_AMMO,
            });
            syncHud(ctx);
            requestPointerLockSafely();
            emitLog(ctx, 
              `Menu System: Launched campaign at Level ${startIdx + 1}/${rt.campaignLevels.length}.`
            );
          },
          onResumeGame: () => {
            syncHud(ctx);
            requestPointerLockSafely();
          },
          onRestartCurrentLevel: () => {
            handleFullRespawn(ctx);
            requestPointerLockSafely();
          },
          onRestoreCheckpoint: (payload) => {
            loadCampaignLevel(ctx, payload.levelIndex, {
              health: payload.combatState.health,
              ammo: payload.combatState.ammo,
            });
            rt.currSimState = payload.simState;
            rt.prevSimState = payload.simState;
            rt.combatState = { ...payload.combatState };
            rebuild3DWorld(ctx);
            syncHud(ctx);
            requestPointerLockSafely();
          },
          onFireSimEvent: (action) => {
            if (action.flagName) {
              rt.currSimState = {
                ...rt.currSimState,
                flags: {
                  ...rt.currSimState.flags,
                  [action.flagName]: action.flagValue ?? true,
                },
              };
            }
            if (action.counterName) {
              const prevVal = rt.currSimState.counters[action.counterName] ?? 0;
              rt.currSimState = {
                ...rt.currSimState,
                counters: {
                  ...rt.currSimState.counters,
                  [action.counterName]: prevVal + (action.counterDelta ?? 1),
                },
              };
            }
            options.onSimStateChange?.(rt.currSimState);
            syncHud(ctx);
          },
          onQuitToMainMenu: () => {
            if (typeof document !== 'undefined' && document.pointerLockElement) {
              try {
                document.exitPointerLock?.();
              } catch {
                // Ignore
              }
            }
            syncHud(ctx);
          },
          onApplySettings: (nextSettings) => {
            rt.runtimeSettings = { ...nextSettings };
            SoundEffects.setMasterVolume(nextSettings.masterVolume);
            rt.minimapEnabled = nextSettings.minimapEnabled;
            if (rt.camera) {
              rt.camera.fov = nextSettings.fov;
              rt.camera.updateProjectionMatrix();
            }
            syncHud(ctx);
          },
          onAppStateChange: (state, activeScreen) => {
            syncHud(ctx);
            options.onMenuStateChange?.(state, activeScreen?.id ?? null);
          },
          onEngineLog: (msg) => emitLog(ctx, msg),
        },
        { startInMainMenu: bootInMainMenu }
      );
      rt.runtimeSettings = { ...rt.menuController.getSettings() };
      SoundEffects.setMasterVolume(rt.runtimeSettings.masterVolume);
    }

    syncHud(ctx);
  }

  rt.frameId = 0;
  rt.stopped = false;
  rt.disposed = false;
  rt.cleanupDomListeners = null;

  // Initialize Three.js WebGL scene if a canvas or container element is provided in a browser environment
  if (canvasOrContainer && typeof document !== 'undefined') {
    try {
      rt.renderSystem = createRenderSystem(canvasOrContainer);
      const { isSoftwareGl, mountEl } = rt.renderSystem;
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

      let lastFrameTimeMs = performance.now();
      let accumulatorMs = 0;
      let lastHudSyncTime = 0;
      let hasSyncedHud = false;
      let lastSyncX = initialWorld.x;
      let lastSyncZ = initialWorld.z;
      let lastSyncYaw = rt.spawn.yaw;
      let lastSyncPitch = 0;
      let lastSyncRow = rt.spawn.row;
      let lastSyncCol = rt.spawn.col;
      let lastSyncSpeed = 0;
      let dioramaAngleRad = 0;

      const onVisibilityChange = () => {
        if (document.hidden) {
          accumulatorMs = 0;
          input.releaseAllKeys();
        } else {
          lastFrameTimeMs = performance.now();
          accumulatorMs = 0;
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

      const tick = () => {
        if (rt.stopped || !rt.renderer || !rt.scene || !rt.camera) return;

        const nowMs = performance.now();
        const rawDeltaMs = Math.max(0, nowMs - lastFrameTimeMs);
        lastFrameTimeMs = nowMs;

        if (document.hidden) {
          accumulatorMs = 0;
          rt.frameId = requestAnimationFrame(tick);
          return;
        }

        const dtSec = Math.min(rawDeltaMs / 1000, 0.1);
        const isMenuPaused = Boolean(
          rt.menuController && rt.menuController.isSimulationPaused()
        );

        if (isMenuPaused) {
          accumulatorMs = 0;
          const activeScreen = rt.menuController?.getActiveScreen();
          if (
            rt.menuController?.getAppState() === 'MAIN_MENU' &&
            activeScreen?.backgroundConfig.type === '3d-scene'
          ) {
            const bg = activeScreen.backgroundConfig;
            const targetWorld = CollisionSystem.gridToWorld(
              bg.cameraTarget.row,
              bg.cameraTarget.col,
              rt.grid.length
            );
            const targetY = bg.cameraTarget.elevationMeters ?? 1.8;
            if (bg.cameraMode === 'orbit') {
              dioramaAngleRad += (bg.orbitSpeedRadPerSec || 0.2) * dtSec;
              const radius = Math.max(2, bg.orbitRadiusMeters || 10);
              rt.camera.position.set(
                targetWorld.x + Math.cos(dioramaAngleRad) * radius,
                targetY + 2.2,
                targetWorld.z + Math.sin(dioramaAngleRad) * radius
              );
              rt.camera.lookAt(targetWorld.x, targetY, targetWorld.z);
            } else {
              rt.camera.position.set(targetWorld.x, targetY, targetWorld.z);
              euler.set(bg.fixedPitchRad ?? 0, bg.fixedYawRad ?? 0, 0, 'YXZ');
              rt.camera.quaternion.setFromEuler(euler);
            }
          }
          rt.renderer.render(rt.scene, rt.camera);
          if (isSoftwareGl) {
            afterDraw(tick);
          } else {
            rt.frameId = requestAnimationFrame(tick);
          }
          return;
        }

        rt.elapsedSec += dtSec;
        accumulatorMs += rawDeltaMs;

        let ticksToRun = Math.floor(accumulatorMs / TICK_MS);
        if (ticksToRun > SIM_CONFIG.MAX_TICKS_PER_FRAME) {
          ticksToRun = SIM_CONFIG.MAX_TICKS_PER_FRAME;
          accumulatorMs = accumulatorMs % TICK_MS;
        } else {
          accumulatorMs -= ticksToRun * TICK_MS;
        }

        const frameStartSim = rt.currSimState;
        let stateChangedThisFrame = false;

        for (let tickIdx = 0; tickIdx < ticksToRun; tickIdx++) {
          runSingleSimTick(ctx, tickIdx);
          stateChangedThisFrame = true;
        }

        const curSim = rt.currSimState;
        const prevSim = rt.prevSimState;

        if (curSim.logs.length > rt.lastLogCount) {
          const latestLog = curSim.logs[curSim.logs.length - 1];
          rt.lastLogCount = curSim.logs.length;
          emitLog(ctx, `Event: ${latestLog.message}`);
        }

        if (curSim.soundsPlayed.length > rt.lastSoundCount) {
          for (
            let sIdx = rt.lastSoundCount;
            sIdx < curSim.soundsPlayed.length;
            sIdx++
          ) {
            const cue = curSim.soundsPlayed[sIdx];
            if (cue) {
              SoundEffects.playById(cue.soundId);
            }
          }
          rt.lastSoundCount = curSim.soundsPlayed.length;
        }

        if (
          stateChangedThisFrame &&
          (curSim.collectedKeys.length !== frameStartSim.collectedKeys.length ||
            curSim.messages.length !== frameStartSim.messages.length ||
            curSim.secretsFound !== frameStartSim.secretsFound ||
            curSim.levelEnded !== frameStartSim.levelEnded ||
            Object.keys(curSim.movers).length !==
              Object.keys(frameStartSim.movers).length ||
            Object.keys(curSim.movers).some(
              (k) =>
                curSim.movers[k]?.state !== frameStartSim.movers[k]?.state ||
                (curSim.movers[k]?.progress ?? 0) >= 5000 !==
                  (frameStartSim.movers[k]?.progress ?? 0) >= 5000
            ))
        ) {
          options.onSimStateChange?.(curSim);
          syncHud(ctx);
        }

        const alpha = Math.max(0, Math.min(1, accumulatorMs / TICK_MS));
        const prevP = prevSim.players[0];
        const currP = curSim.players[0];

        let currentSpeedMetersPerSec = 0;
        let currentYawRad = lastSyncYaw;
        let currentPitchRad = lastSyncPitch;

        if (prevP && currP) {
          const interpXUnits =
            prevP.xUnits + (currP.xUnits - prevP.xUnits) * alpha;
          const interpZUnits =
            prevP.zUnits + (currP.zUnits - prevP.zUnits) * alpha;

          rt.camera.position.x = interpXUnits * UNITS_TO_METERS;
          rt.camera.position.z = interpZUnits * UNITS_TO_METERS;

          const interpYawRad = lerpBamToRadians(
            prevP.yawBam,
            currP.yawBam,
            alpha
          );
          const interpPitchBam =
            prevP.pitchBam + (currP.pitchBam - prevP.pitchBam) * alpha;
          const interpPitchRad = (interpPitchBam / 65536) * (Math.PI * 2);

          currentYawRad = interpYawRad;
          currentPitchRad = interpPitchRad;

          euler.set(interpPitchRad, interpYawRad, 0, 'YXZ');
          rt.camera.quaternion.setFromEuler(euler);

          currentSpeedMetersPerSec =
            currP.speedUnitsPerTick *
            UNITS_TO_METERS *
            SIM_CONFIG.TICKS_PER_SECOND;

          const playerCellRow = currP.gridRow;
          const playerCellCol = currP.gridCol;
          const prevFloorH =
            prevSim.floorHeights?.[playerCellRow]?.[playerCellCol] ?? 0;
          const currFloorH =
            curSim.floorHeights?.[playerCellRow]?.[playerCellCol] ?? 0;
          const interpFloorH =
            (prevFloorH + (currFloorH - prevFloorH) * alpha) * UNITS_TO_METERS;

          if (curSim.vertical) {
            // Vertical levels: the sim tracks the eye height through steps, jumps and falls
            const eyeY =
              (prevP.yUnits + (currP.yUnits - prevP.yUnits) * alpha) * UNITS_TO_METERS;
            const bob =
              currP.speedUnitsPerTick > 0 && currP.onGround && !rt.combatState.isDead
                ? Math.sin(rt.elapsedSec * 10) * 0.045
                : 0;
            rt.camera.position.y = eyeY + bob;
          } else if (currP.speedUnitsPerTick > 0 && !rt.combatState.isDead) {
            const isSprinting = Boolean(
              input.keys['ShiftLeft'] || input.keys['ShiftRight']
            );
            rt.camera.position.y =
              interpFloorH +
              ENGINE_CONFIG.PLAYER_EYE_HEIGHT +
              Math.sin(rt.elapsedSec * (isSprinting ? 14 : 10)) * 0.055;
          } else {
            rt.camera.position.y = THREE.MathUtils.damp(
              rt.camera.position.y,
              interpFloorH + ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
              10,
              dtSec
            );
          }

          if (curSim.earthquake && curSim.earthquake.remainingTicks > 0) {
            const shakeMag = (curSim.earthquake.intensity / 1000) * 0.25;
            const tremorX =
              Math.sin(curSim.tick * 1.7 + rt.elapsedSec * 25) * shakeMag;
            const tremorY =
              Math.cos(curSim.tick * 2.3 + rt.elapsedSec * 30) * shakeMag * 0.6;
            rt.camera.position.x += tremorX;
            rt.camera.position.y += tremorY;
          }
        }

        rt.combatSystem?.update(dtSec, rt.elapsedSec, currentSpeedMetersPerSec);

        const openDoorsSet = getOpenDoorsSetFromSim(curSim);

        if (rt.enemyAI && !isReplayOrDeterministic) {
          rt.enemyAI.setVerticalWorld(curSim.vertical ? curSim : null);
          const occluders = [...rt.wallMeshes];
          rt.doorMeshes.forEach((doorGroup, cKey) => {
            if (!openDoorsSet.has(cKey)) {
              occluders.push(doorGroup);
            }
          });

          rt.enemyAI.update(
            dtSec,
            rt.elapsedSec,
            rt.camera.position,
            curSim.grid,
            openDoorsSet,
            occluders,
            rt.combatState.isDead,
            {
              onPlayerDamaged: (damage, attackerName) => {
                if (rt.combatState.isDead) return;
                const nextHealth = Math.max(0, rt.combatState.health - damage);
                const nowDead = nextHealth <= 0;

                rt.isPlayerHurtFlashing = true;
                window.clearTimeout(rt.hurtFlashTimeout);
                rt.hurtFlashTimeout = window.setTimeout(() => {
                  rt.isPlayerHurtFlashing = false;
                  syncHud(ctx);
                }, 180);

                rt.combatState = {
                  ...rt.combatState,
                  health: nextHealth,
                  isDead: nowDead,
                };
                syncHud(ctx);

                emitLog(ctx, 
                  nowDead
                    ? `Combat: Player defeated by ${attackerName}!`
                    : `Combat: ${attackerName} melee attack (-${damage} HP).`
                );
              },
              onAmmoCollected: (amount) => {
                rt.combatState = {
                  ...rt.combatState,
                  ammo: Math.min(rt.combatState.maxAmmo, rt.combatState.ammo + amount),
                };
                syncHud(ctx);
                emitLog(ctx, 
                  `Loot: Picked up +${amount} Plasma Cells from defeated enemy.`
                );
              },
            },
            curSim.solidFootprint
          );
        }

        rt.keyMeshes.forEach((keyGroup, cellKey) => {
          const isCollected = curSim.collectedKeys.includes(cellKey);
          keyGroup.visible = !isCollected;
          if (!isCollected) {
            const card = keyGroup.getObjectByName('floatingKeycard');
            if (card) {
              card.rotation.y = rt.elapsedSec * 2.2;
              card.position.y = 1.25 + Math.sin(rt.elapsedSec * 3.5) * 0.14;
            }
          }
        });

        rt.doorMeshes.forEach((doorGroup, dKey) => {
          const leaf = doorGroup.getObjectByName('doorLeaf');
          if (leaf) {
            const moverId = `door:${dKey}`;
            const prevProg = prevSim.movers[moverId]?.progress ?? 0;
            const currProg = curSim.movers[moverId]?.progress ?? 0;
            const interpProg =
              (prevProg + (currProg - prevProg) * alpha) /
              SIM_CONFIG.MOVER_MAX_PROGRESS;

            const closedY = (ENGINE_CONFIG.WALL_HEIGHT * 0.96) / 2;
            const openY = ENGINE_CONFIG.WALL_HEIGHT * 1.38;
            leaf.position.y = closedY + (openY - closedY) * interpProg;
          }
        });

        for (const mKey of Object.keys(curSim.movers)) {
          const currMover = curSim.movers[mKey];
          if (!currMover || currMover.kind !== 'pushwall') continue;

          const cellKey = `${currMover.row},${currMover.col}`;
          const wallGroup = rt.getWallBlockGroup(cellKey);
          if (!wallGroup) continue;

          const prevProg = prevSim.movers[mKey]?.progress ?? 0;
          const currProg = currMover.progress;
          const interpProg =
            (prevProg + (currProg - prevProg) * alpha) /
            SIM_CONFIG.MOVER_MAX_PROGRESS;

          const dRow =
            currMover.direction === 'N'
              ? -1
              : currMover.direction === 'S'
              ? 1
              : 0;
          const dCol =
            currMover.direction === 'E'
              ? 1
              : currMover.direction === 'W'
              ? -1
              : 0;
          const distCells = currMover.distanceCells ?? 2;
          const baseWorld = CollisionSystem.gridToWorld(
            currMover.row,
            currMover.col,
            curSim.gridSize
          );

          wallGroup.position.x =
            baseWorld.x +
            dCol * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;
          wallGroup.position.z =
            baseWorld.z +
            dRow * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;

          if (
            currMover.state === 'done' &&
            currMover.targetRow === undefined
          ) {
            wallGroup.visible = false;
          }
        }

        // Lifts and moving floors glide between ticks, like the flat levels' floor tiles
        if (rt.updateLayeredHeights) {
          rt.updateLayeredHeights(
            lerpHeights(prevSim.floorHeights, curSim.floorHeights, alpha),
            lerpHeights(prevSim.ceilingHeights, curSim.ceilingHeights, alpha)
          );
        }

        const defaultCeilH = SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
        for (let r = 0; r < curSim.gridSize; r++) {
          const prevFloorRow = prevSim.floorHeights?.[r];
          const currFloorRow = curSim.floorHeights?.[r];
          const prevCeilRow = prevSim.ceilingHeights?.[r];
          const currCeilRow = curSim.ceilingHeights?.[r];
          for (let c = 0; c < curSim.gridSize; c++) {
            const prevH = prevFloorRow?.[c] ?? 0;
            const currH = currFloorRow?.[c] ?? 0;
            if (rt.floorLayer && (prevH !== 0 || currH !== 0)) {
              const interpH = prevH + (currH - prevH) * alpha;
              rt.floorLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
            }
            const prevCeilH = prevCeilRow?.[c] ?? defaultCeilH;
            const currCeilH = currCeilRow?.[c] ?? defaultCeilH;
            if (
              rt.ceilingLayer &&
              (prevCeilH !== defaultCeilH || currCeilH !== defaultCeilH)
            ) {
              const interpH = prevCeilH + (currCeilH - prevCeilH) * alpha;
              rt.ceilingLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
            }
          }
        }

        if (rt.elapsedSec - lastHudSyncTime > 0.05 && currP) {
          lastHudSyncTime = rt.elapsedSec;
          const nx = rt.camera.position.x;
          const nz = rt.camera.position.z;
          const nyaw = currentYawRad;
          const npitch = currentPitchRad;
          if (
            !hasSyncedHud ||
            Math.abs(nx - lastSyncX) > 0.005 ||
            Math.abs(nz - lastSyncZ) > 0.005 ||
            Math.abs(nyaw - lastSyncYaw) > 0.005 ||
            Math.abs(npitch - lastSyncPitch) > 0.005 ||
            currP.gridRow !== lastSyncRow ||
            currP.gridCol !== lastSyncCol ||
            Math.abs(currentSpeedMetersPerSec - lastSyncSpeed) > 0.05
          ) {
            hasSyncedHud = true;
            lastSyncX = nx;
            lastSyncZ = nz;
            lastSyncYaw = nyaw;
            lastSyncPitch = npitch;
            lastSyncRow = currP.gridRow;
            lastSyncCol = currP.gridCol;
            lastSyncSpeed = currentSpeedMetersPerSec;
            rt.playerTransform = {
              x: nx,
              y: rt.camera.position.y,
              z: nz,
              yaw: nyaw,
              pitch: npitch,
              gridRow: currP.gridRow,
              gridCol: currP.gridCol,
              speed: currentSpeedMetersPerSec,
            };
            options.onPlayerMove?.(rt.playerTransform);
          }

          if (rt.enemyAI) {
            const snapshots = rt.enemyAI.getTelemetrySnapshots();
            rt.enemySnapshots = snapshots.enemies;
            rt.ammoDrops = snapshots.ammoDrops;
            const totals = hudEnemyTotals(ctx, snapshots);
            if (
              rt.combatState.kills !== totals.kills ||
              rt.combatState.totalEnemies !== totals.totalEnemies
            ) {
              rt.combatState = { ...rt.combatState, ...totals };
            }
          }

          syncHud(ctx);
        }

        if (rt.dirLight) {
          rt.dirLight.position.set(
            rt.camera.position.x + 14,
            28,
            rt.camera.position.z + 12
          );
          rt.dirLight.target.position.set(rt.camera.position.x, 0, rt.camera.position.z);
          rt.dirLight.target.updateMatrixWorld();
        }

        rt.renderer.render(rt.scene, rt.camera);

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          rt.frameId = requestAnimationFrame(tick);
        }
      };

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

  return {
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
}
