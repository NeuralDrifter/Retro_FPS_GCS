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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  AmmoLootSnapshot,
  ENGINE_CONFIG,
  EnemyTelemetrySnapshot,
  GameManifest,
  LevelStateData,
  PlacedEntity,
  PlayerCombatState,
  PlayerTransform,
  SkyboxThemeId,
  TextureAsset,
} from './types';
import { migrateGameManifest } from './manifest';
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
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
  hashSimulationState,
  lerpBamToRadians,
  radiansToBam,
  recordEntityKilledInSim,
  step,
  worldUnitsToGrid,
} from './sim';
import {
  RuntimeLevelSerializer,
  placedEntitiesFromLevelV3,
} from './LevelSerializer';
import { TextureGenerator } from './TextureGenerator';
import { EntityLoader } from './EntityLoader';
import { AssetRegistry } from './AssetRegistry';
import { CollisionSystem } from './CollisionSystem';
import { InstancedCellLayer, WorldBuilder } from './WorldBuilder';
import { EnemyAISystem } from './EnemyAISystem';
import { CombatSystem } from './CombatSystem';
import { SoundEffects } from './SoundEffects';
import { CombatHUDController } from './hud/CombatHUD';
import { MinimapHUDController } from './hud/MinimapHUD';

const TICK_MS = 1000 / SIM_CONFIG.TICKS_PER_SECOND;
const UNITS_TO_METERS = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS; // 4.0 / 1000 = 0.004
const METERS_TO_UNITS = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE; // 250

export interface TickInputProvider {
  nextInput: (tick: number) => PlayerTickInput | undefined;
}

export type InputSourceOption =
  | readonly PlayerTickInput[]
  | TickInputProvider
  | ((tick: number) => PlayerTickInput | undefined);

export interface RuntimeManifestLike {
  schemaVersion?: number;
  level: LevelDataV3;
  customTextures?: TextureAsset[];
}

export type StartGameManifestInput =
  | GameManifest
  | RuntimeManifestLike
  | LevelDataV3
  | LevelStateData;

export interface StartGameOptions {
  assetBaseUrl?: string;
  dracoDecoderPath?: string;
  inputSource?: InputSourceOption;
  hudRoot?: HTMLElement | null;
  autoLockPointerOnClick?: boolean;
  recordInputs?: boolean;
  deterministicSimOnly?: boolean;
  onTickHash?: (tick: number, hash: string, state: SimulationState) => void;
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
}

export interface GameRuntimeHandle {
  stop: () => void;
  dispose: () => void;
  getState: () => SimulationState;
  getManifest: () => GameManifest;
  stepTicks: (count: number) => string[];
  getTickHashes: () => string[];
  getRecordedInputs: () => PlayerTickInput[];
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
}

function normalizeManifestToLevelV3(input: StartGameManifestInput): {
  manifest: GameManifest;
  levelV3: LevelDataV3;
  customTextures: TextureAsset[];
} {
  const manifest = migrateGameManifest(input);
  const explicitTextures =
    input &&
    typeof input === 'object' &&
    'customTextures' in input &&
    Array.isArray((input as any).customTextures)
      ? ((input as any).customTextures as TextureAsset[])
      : undefined;

  return {
    manifest,
    levelV3: manifest.level,
    customTextures: explicitTextures ?? [],
  };
}

function createInputReader(
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

export function startGame(
  manifest: StartGameManifestInput,
  canvasOrContainer: HTMLCanvasElement | HTMLElement | null,
  options: StartGameOptions = {}
): GameRuntimeHandle {
  if (options.assetBaseUrl !== undefined) {
    TextureGenerator.setAssetBaseUrl(options.assetBaseUrl);
    EntityLoader.setAssetBaseUrl(options.assetBaseUrl);
  }
  if (options.dracoDecoderPath !== undefined) {
    EntityLoader.setDracoDecoderPath(options.dracoDecoderPath);
  }

  const normalized = normalizeManifestToLevelV3(manifest);
  const activeManifest: GameManifest = normalized.manifest;
  const currentLevelV3: LevelDataV3 = normalized.levelV3;

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

  let customTextures: TextureAsset[] =
    options.customTextures ?? normalized.customTextures;

  let grid: number[][] = currentLevelV3.grid.map((r) => [...r]);
  let wallTextures: string[][] = currentLevelV3.wallTextures.map((r) => [...r]);
  let floorTextures: string[][] = currentLevelV3.floorTextures.map((r) => [
    ...r,
  ]);
  let ceilingTextures: string[][] = currentLevelV3.ceilingTextures.map((r) => [
    ...r,
  ]);
  let entities: PlacedEntity[] = placedEntitiesFromLevelV3(currentLevelV3);
  let spawn: { row: number; col: number; yaw: number } = {
    row: currentLevelV3.spawn.row,
    col: currentLevelV3.spawn.col,
    yaw: bamToRadians(currentLevelV3.spawn.yawBam),
  };
  let skyboxTheme: SkyboxThemeId = currentLevelV3.skybox.theme;
  let skyboxSeed: number = currentLevelV3.skybox.seed;
  let showCeiling: boolean =
    options.showCeiling ?? currentLevelV3.skybox.showCeiling ?? true;
  let showWireframe: boolean = options.showWireframe ?? false;
  let collisionEnabled: boolean = options.collisionEnabled ?? true;
  let minimapEnabled: boolean =
    options.minimapEnabled ?? currentLevelV3.minimapEnabled ?? true;

  const inputReader = createInputReader(options.inputSource);
  const isReplayOrDeterministic =
    Boolean(inputReader) || Boolean(options.deterministicSimOnly);
  const recordInputs = Boolean(options.recordInputs);
  const recordedInputs: PlayerTickInput[] = [];
  const tickHashes: string[] = [];

  const initialSim =
    options.initialSimState ?? createInitialSimulationState(currentLevelV3, [0]);
  let prevSimState: SimulationState = initialSim;
  let currSimState: SimulationState = initialSim;
  let lastLogCount = currSimState.logs.length;
  let lastSoundCount = currSimState.soundsPlayed.length;

  let combatState: PlayerCombatState = {
    health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    maxHealth: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: ENGINE_CONFIG.PLAYER_START_AMMO,
    maxAmmo: ENGINE_CONFIG.PLAYER_MAX_AMMO,
    kills: 0,
    totalEnemies: entities.filter(
      (e) => e.isEnemy !== false && e.blueprintId !== 'supply-crate'
    ).length,
    isDead: false,
    lastHitEnemyName: null,
    lastHitEnemyHealth: null,
    lastHitEnemyMaxHealth: null,
  };

  let isMuzzleFlashing = false;
  let isHitMarkerActive = false;
  let isPlayerHurtFlashing = false;
  let enemySnapshots: EnemyTelemetrySnapshot[] = [];
  let ammoDrops: AmmoLootSnapshot[] = [];

  let muzzleFlashTimeout = 0;
  let hitMarkerTimeout = 0;
  let hurtFlashTimeout = 0;

  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let controls: PointerLockControls | null = null;
  let hemiLight: THREE.HemisphereLight | null = null;
  let dirLight: THREE.DirectionalLight | null = null;
  let worldGroup: THREE.Group | null = null;
  let wallMeshes: THREE.Object3D[] = [];
  let getWallBlockGroup: (cellKey: string) => THREE.Group | undefined = () =>
    undefined;
  let doorMeshes: Map<string, THREE.Group> = new Map();
  let keyMeshes: Map<string, THREE.Group> = new Map();
  let floorLayer: InstancedCellLayer | null = null;
  let ceilingLayer: InstancedCellLayer | null = null;
  let enemyAI: EnemyAISystem | null = null;
  let combatSystem: CombatSystem | null = null;
  let doorTex: THREE.Texture | null = null;
  let skyboxTex: THREE.CanvasTexture | null = null;

  const keysPressed: Record<string, boolean> = {};
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  let pendingYawDeltaBam = 0;
  let pendingPitchDeltaBam = 0;
  let pendingUse = false;
  let pendingShoot = false;

  const initialWorld = CollisionSystem.gridToWorld(
    spawn.row,
    spawn.col,
    grid.length
  );
  let playerTransform: PlayerTransform = {
    x: initialWorld.x,
    y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
    z: initialWorld.z,
    yaw: spawn.yaw,
    pitch: 0,
    gridRow: spawn.row,
    gridCol: spawn.col,
    speed: 0,
  };

  let combatHud: CombatHUDController | null = null;
  let minimapHud: MinimapHUDController | null = null;

  function syncHud(): void {
    if (combatHud) {
      combatHud.update({
        combatState,
        simState: currSimState,
        isMuzzleFlashing,
        isHitMarkerActive,
        isPlayerHurtFlashing,
      });
    }
    if (minimapHud) {
      minimapHud.update({
        visible: minimapEnabled,
        grid,
        entities,
        enemySnapshots,
        ammoDrops,
        playerTransform,
        collectedKeys: getCollectedKeysSetFromSim(currSimState),
        openDoors: getOpenDoorsSetFromSim(currSimState),
      });
    }
  }

  function emitLog(message: string): void {
    options.onEngineLog?.(message);
  }

  function getActiveOccluderMeshes(): THREE.Object3D[] {
    const occluders = [...wallMeshes];
    const openDoors = getOpenDoorsSetFromSim(currSimState);
    doorMeshes.forEach((doorGroup, cellKey) => {
      if (!openDoors.has(cellKey)) {
        occluders.push(doorGroup);
      }
    });
    return occluders;
  }

  function handleFireWeapon(): void {
    if (!camera || !combatSystem || !enemyAI || combatState.isDead) return;

    if (combatState.ammo <= 0) {
      pendingShoot = true;
      emitLog(
        'Combat: Out of Plasma Ammo — Press [R] to Reload or collect dropped Ammo Crates.'
      );
      return;
    }

    const occluders = getActiveOccluderMeshes();
    const shot = combatSystem.fireWeapon(
      camera,
      combatState.ammo,
      combatState.isDead,
      enemyAI,
      occluders
    );

    if (!shot.fired) return;

    if (!shot.hitEnemy) {
      pendingShoot = true;
    } else if (shot.killedEnemy && shot.hitEntityId && !isReplayOrDeterministic) {
      currSimState = recordEntityKilledInSim(
        currSimState,
        shot.hitEntityId,
        0
      );
    }

    isMuzzleFlashing = true;
    if (typeof window !== 'undefined') {
      window.clearTimeout(muzzleFlashTimeout);
      muzzleFlashTimeout = window.setTimeout(() => {
        isMuzzleFlashing = false;
        syncHud();
      }, 90);
    }

    if (shot.hitEnemy) {
      isHitMarkerActive = true;
      if (typeof window !== 'undefined') {
        window.clearTimeout(hitMarkerTimeout);
        hitMarkerTimeout = window.setTimeout(() => {
          isHitMarkerActive = false;
          syncHud();
        }, 150);
      }
    }

    const snapshots = enemyAI.getTelemetrySnapshots();
    enemySnapshots = snapshots.enemies;
    ammoDrops = snapshots.ammoDrops;

    combatState = {
      ...combatState,
      ammo: Math.max(0, combatState.ammo - 1),
      kills: snapshots.kills,
      totalEnemies: snapshots.totalEnemies,
      lastHitEnemyName: shot.hitEnemy
        ? shot.enemyName
        : combatState.lastHitEnemyName,
      lastHitEnemyHealth: shot.hitEnemy
        ? shot.enemyRemainingHealth
        : combatState.lastHitEnemyHealth,
      lastHitEnemyMaxHealth: shot.hitEnemy
        ? shot.enemyMaxHealth
        : combatState.lastHitEnemyMaxHealth,
    };

    syncHud();

    if (shot.killedEnemy && shot.enemyName) {
      emitLog(
        `Combat: Eliminated ${shot.enemyName} — Spawned +${ENGINE_CONFIG.AMMO_DROP_AMOUNT} Plasma Ammo Pickup.`
      );
    } else if (shot.hitEnemy && shot.enemyName) {
      emitLog(
        `Combat: Hit ${shot.enemyName} (-${ENGINE_CONFIG.WEAPON_DAMAGE} HP, ${shot.enemyRemainingHealth} HP remaining).`
      );
    }
  }

  function handleReloadAmmo(): void {
    if (combatState.isDead) return;
    const nextAmmo = Math.min(
      combatState.maxAmmo,
      Math.max(combatState.ammo + 24, ENGINE_CONFIG.PLAYER_START_AMMO)
    );
    combatState = {
      ...combatState,
      ammo: nextAmmo,
    };
    syncHud();
    emitLog('Combat: Reloaded Plasma Repeater (+24 Cells).');
  }

  function updateSkybox(): void {
    if (!scene) return;
    skyboxTex?.dispose();
    const generated = TextureGenerator.createSkyboxTexture(
      skyboxTheme,
      skyboxSeed
    );
    skyboxTex = generated.texture;
    scene.background = generated.texture;
    scene.fog = new THREE.FogExp2(generated.fogColor, 0.025);
    if (hemiLight) {
      hemiLight.color.setHex(generated.hemiSkyColor);
      hemiLight.groundColor.setHex(generated.hemiGroundColor);
    }
  }

  function rebuild3DWorld(): void {
    if (!scene || !renderer) return;

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    if (!doorTex) {
      doorTex = TextureGenerator.createDoorTexture(maxAniso);
    }

    if (worldGroup) {
      scene.remove(worldGroup);
      WorldBuilder.disposeWorldGroup(worldGroup);
    }

    const collectedKeysSet = getCollectedKeysSetFromSim(currSimState);
    const openDoorsSet = getOpenDoorsSetFromSim(currSimState);

    const built = WorldBuilder.buildWorldFromGrid(
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      doorTex,
      maxAniso,
      {
        showCeiling,
        showWireframe,
        spawn,
        collectedKeys: collectedKeysSet,
        openDoors: openDoorsSet,
      }
    );

    worldGroup = built.worldGroup;
    wallMeshes = built.wallMeshes;
    getWallBlockGroup = built.getWallBlockGroup;
    doorMeshes = built.doorMeshes;
    keyMeshes = built.keyMeshes;
    floorLayer = built.floorLayer;
    ceilingLayer = built.ceilingLayer;
    enemyAI = built.enemyAI;
    scene.add(built.worldGroup);
  }

  function teleportToSpawn(): void {
    const levelV3 = RuntimeLevelSerializer.serializeLevelV3({
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
      cellTags: currSimState.cellTags,
      events: currSimState.events,
      regions: currSimState.regions,
      variables: {
        flags: currSimState.flags,
        counters: currSimState.counters,
        timers: Object.keys(currSimState.timers),
      },
    });
    const freshSim = createInitialSimulationState(levelV3, [0]);
    prevSimState = freshSim;
    currSimState = freshSim;
    lastLogCount = freshSim.logs.length;
    lastSoundCount = freshSim.soundsPlayed.length;
    options.onSimStateChange?.(freshSim);

    const { x, z } = CollisionSystem.gridToWorld(
      spawn.row,
      spawn.col,
      grid.length
    );
    if (camera) {
      camera.position.set(x, ENGINE_CONFIG.PLAYER_EYE_HEIGHT, z);
      euler.set(0, spawn.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
    }

    playerTransform = {
      x,
      y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
      z,
      yaw: spawn.yaw,
      pitch: 0,
      gridRow: spawn.row,
      gridCol: spawn.col,
      speed: 0,
    };
    options.onPlayerMove?.(playerTransform);

    combatState = {
      ...combatState,
      health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
      ammo: Math.max(combatState.ammo, ENGINE_CONFIG.PLAYER_START_AMMO),
      isDead: false,
      lastHitEnemyName: null,
      lastHitEnemyHealth: null,
      lastHitEnemyMaxHealth: null,
    };
    syncHud();
  }

  function handleFullRespawn(): void {
    teleportToSpawn();
    rebuild3DWorld();
    emitLog(
      'Engine: Reset level simulation state, restored player health & ammo, and respawned Enemy AI.'
    );
  }

  function runSingleSimTick(tickIdxInFrame: number): boolean {
    prevSimState = currSimState;

    const preSim = currSimState;
    const preP0 = preSim.players[0];
    const healthBeforeStep = isReplayOrDeterministic
      ? preP0?.health ?? ENGINE_CONFIG.PLAYER_MAX_HEALTH
      : Math.round(combatState.health);

    if (!isReplayOrDeterministic) {
      if (preP0) {
        preP0.health = healthBeforeStep;
        preP0.isDead = combatState.isDead;
      }
      if (preSim.entities && enemyAI) {
        const agents = enemyAI.getAgents();
        agents.forEach((agent, entId) => {
          const simEnt = preSim.entities?.[entId];
          if (!simEnt) return;
          simEnt.xUnits = Math.round(
            agent.instance.rootGroup.position.x * METERS_TO_UNITS
          );
          simEnt.zUnits = Math.round(
            agent.instance.rootGroup.position.z * METERS_TO_UNITS
          );
          const cell = worldUnitsToGrid(
            simEnt.xUnits,
            simEnt.zUnits,
            preSim.gridSize
          );
          simEnt.row = cell.row;
          simEnt.col = cell.col;
          simEnt.health = Math.max(0, Math.round(agent.health));
          simEnt.state = agent.state === 'Dead' ? 'dead' : 'idle';
          simEnt.ambush = true;
        });
      }
    }

    let playerInput: PlayerTickInput;

    if (inputReader) {
      const fed = inputReader(currSimState.tick);
      playerInput = fed ?? {
        moveForward: 0,
        moveRight: 0,
        sprint: false,
        yawDeltaBam: 0,
        pitchDeltaBam: 0,
        use: false,
        shoot: false,
        noclip: false,
      };
    } else {
      const isPlayerDead = combatState.isDead;
      const moveForward = (
        Number(Boolean(keysPressed['KeyW'] || keysPressed['ArrowUp'])) -
        Number(Boolean(keysPressed['KeyS'] || keysPressed['ArrowDown']))
      ) as -1 | 0 | 1;
      const moveRight = (
        Number(Boolean(keysPressed['KeyD'])) -
        Number(Boolean(keysPressed['KeyA']))
      ) as -1 | 0 | 1;

      const yawDeltaBam = tickIdxInFrame === 0 ? pendingYawDeltaBam : 0;
      const pitchDeltaBam = tickIdxInFrame === 0 ? pendingPitchDeltaBam : 0;
      const useTriggered = tickIdxInFrame === 0 ? pendingUse : false;
      const shootTriggered = tickIdxInFrame === 0 ? pendingShoot : false;

      if (tickIdxInFrame === 0) {
        pendingYawDeltaBam = 0;
        pendingPitchDeltaBam = 0;
        pendingUse = false;
        pendingShoot = false;
      }

      playerInput = isPlayerDead
        ? {
            moveForward: 0,
            moveRight: 0,
            sprint: false,
            yawDeltaBam: 0,
            pitchDeltaBam: 0,
            use: false,
            shoot: false,
            noclip: !collisionEnabled,
          }
        : {
            moveForward,
            moveRight,
            turnLeft: Boolean(keysPressed['KeyQ'] || keysPressed['ArrowLeft']),
            turnRight: Boolean(keysPressed['ArrowRight']),
            sprint: Boolean(
              keysPressed['ShiftLeft'] || keysPressed['ShiftRight']
            ),
            yawDeltaBam,
            pitchDeltaBam,
            use: useTriggered,
            shoot: shootTriggered,
            noclip: !collisionEnabled,
          };
    }

    if (recordInputs) {
      recordedInputs.push({ ...playerInput });
    }

    const nextSim = step(currSimState, { 0: playerInput });

    const postP0 = nextSim.players[0];
    if (postP0 && postP0.health !== healthBeforeStep) {
      const updatedHealth = Math.max(0, postP0.health);
      const nowDead = updatedHealth <= 0;
      if (updatedHealth < healthBeforeStep && typeof window !== 'undefined') {
        isPlayerHurtFlashing = true;
        window.clearTimeout(hurtFlashTimeout);
        hurtFlashTimeout = window.setTimeout(() => {
          isPlayerHurtFlashing = false;
          syncHud();
        }, 180);
      }
      combatState = {
        ...combatState,
        health: updatedHealth,
        isDead: nowDead,
      };
    }

    if (!isReplayOrDeterministic) {
      if (nextSim.entities && enemyAI) {
        const agents = enemyAI.getAgents();
        for (const [entId, simEnt] of Object.entries(nextSim.entities)) {
          const agent = agents.get(entId);
          if (!agent || agent.state === 'Dead') continue;
          if (simEnt.state === 'dead' || (simEnt.health !== undefined && simEnt.health <= 0)) {
            enemyAI.damageEntity(entId, agent.health + 999);
          } else if (simEnt.state === 'chase') {
            agent.state = 'Chase';
            agent.memoryTimer = Math.max(agent.memoryTimer, 5.0);
          }
        }
      }

      if (enemyAI && collisionEnabled && !combatState.isDead) {
        const p0 = nextSim.players[0];
        if (p0) {
          const worldX = p0.xUnits * UNITS_TO_METERS;
          const worldZ = p0.zUnits * UNITS_TO_METERS;
          const openDoorsForTick = getOpenDoorsSetFromSim(nextSim);
          const entResolved = enemyAI.resolvePlayerEntityCollision(
            worldX,
            worldZ,
            collisionEnabled,
            nextSim.grid,
            openDoorsForTick,
            nextSim.solidFootprint
          );
          const candXUnits = Math.round(entResolved.x * METERS_TO_UNITS);
          const candZUnits = Math.round(entResolved.z * METERS_TO_UNITS);

          if (
            candXUnits !== p0.xUnits &&
            !checkCircleCollisionUnits(
              candXUnits,
              p0.zUnits,
              SIM_CONFIG.PLAYER_RADIUS_UNITS,
              nextSim.grid,
              nextSim.movers,
              nextSim.solidFootprint
            )
          ) {
            p0.xUnits = candXUnits;
          }
          if (
            candZUnits !== p0.zUnits &&
            !checkCircleCollisionUnits(
              p0.xUnits,
              candZUnits,
              SIM_CONFIG.PLAYER_RADIUS_UNITS,
              nextSim.grid,
              nextSim.movers,
              nextSim.solidFootprint
            )
          ) {
            p0.zUnits = candZUnits;
          }
          const nextCell = worldUnitsToGrid(
            p0.xUnits,
            p0.zUnits,
            nextSim.gridSize
          );
          p0.gridRow = nextCell.row;
          p0.gridCol = nextCell.col;
        }
      }
    }

    currSimState = nextSim;
    const tickHash = hashSimulationState(currSimState);
    tickHashes.push(tickHash);
    options.onTickHash?.(currSimState.tick, tickHash, currSimState);

    return true;
  }

  const resolvedHudRoot =
    options.hudRoot !== undefined
      ? options.hudRoot
      : canvasOrContainer &&
        typeof HTMLElement !== 'undefined' &&
        canvasOrContainer instanceof HTMLElement &&
        !(canvasOrContainer instanceof HTMLCanvasElement)
      ? canvasOrContainer
      : null;

  // Mount vanilla HUDs if hudRoot is provided or defaulted to container
  if (resolvedHudRoot) {
    combatHud = new CombatHUDController(resolvedHudRoot, {
      onFireWeapon: handleFireWeapon,
      onReloadAmmo: handleReloadAmmo,
      onUseAction: () => {
        pendingUse = true;
      },
      onRespawnPlayer: handleFullRespawn,
    });
    minimapHud = new MinimapHUDController(resolvedHudRoot, () => {
      if (options.onMinimapToggleRequest) {
        options.onMinimapToggleRequest();
      } else {
        minimapEnabled = false;
        syncHud();
      }
    });
    syncHud();
  }

  let frameId = 0;
  let stopped = false;
  let disposed = false;
  let pointerLockRequested = false;
  let cleanupDomListeners: (() => void) | null = null;

  // PointerLockControls.lock() drops the promise requestPointerLock() returns, so a refusal
  // (e.g. clicking again within ~1 s of pressing Esc) surfaced as an uncaught rejection.
  // Request the lock on the controls' own element instead; the controls still see the change.
  const requestPointerLockSafely = () => {
    const el = controls?.domElement as HTMLElement | undefined;
    if (!el?.requestPointerLock) return;
    pointerLockRequested = true;
    const onRefused = () => {
      // Fall back to drag-look instead of turning on every mouse move
      pointerLockRequested = false;
    };
    try {
      const pending = el.requestPointerLock() as unknown as Promise<void> | undefined;
      pending?.catch?.(onRefused);
    } catch {
      onRefused();
    }
  };

  // Initialize Three.js WebGL scene if a canvas or container element is provided in a browser environment
  if (canvasOrContainer && typeof document !== 'undefined') {
    try {
      const isSoftwareGl = (() => {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      })();

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x090c12);
      scene.fog = new THREE.FogExp2(0x090c12, 0.025);

      const mountEl =
        canvasOrContainer instanceof HTMLCanvasElement
          ? canvasOrContainer.parentElement ?? canvasOrContainer
          : canvasOrContainer;

      const width = mountEl.clientWidth || 800;
      const height = mountEl.clientHeight || 600;
      camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 120);

      renderer = new THREE.WebGLRenderer({
        canvas:
          canvasOrContainer instanceof HTMLCanvasElement
            ? canvasOrContainer
            : undefined,
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.setPixelRatio(
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      );
      renderer.setSize(width, height);
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      if (!(canvasOrContainer instanceof HTMLCanvasElement)) {
        const existingCanvases = canvasOrContainer.querySelectorAll(
          'canvas[data-forgecore-canvas="true"]'
        );
        existingCanvases.forEach((c) => c.remove());
        renderer.domElement.setAttribute('data-forgecore-canvas', 'true');
        canvasOrContainer.insertBefore(
          renderer.domElement,
          canvasOrContainer.firstChild
        );
      }

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(
        new RoomEnvironment(),
        0.04
      ).texture;
      pmremGenerator.dispose();

      hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.65);
      scene.add(hemiLight);

      dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
      dirLight.position.set(14, 28, 12);
      dirLight.castShadow = !isSoftwareGl;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 1;
      dirLight.shadow.camera.far = 65;
      const d = 24;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.bias = -0.0005;
      dirLight.shadow.normalBias = 0.02;
      scene.add(dirLight);

      const playerTorch = new THREE.PointLight(0xf59e0b, 2.2, 16, 1.6);
      camera.add(playerTorch);

      combatSystem = new CombatSystem(camera, scene);
      scene.add(camera);

      controls = new PointerLockControls(camera, renderer.domElement);
      const onLock = () => {
        pointerLockRequested = true;
        options.onPointerLockChange?.(true);
      };
      const onUnlock = () => {
        pointerLockRequested = false;
        options.onPointerLockChange?.(false);
      };
      controls.addEventListener('lock', onLock);
      controls.addEventListener('unlock', onUnlock);

      let isDraggingLook = false;
      let pointerDownX = 0;
      let pointerDownY = 0;
      let prevPointerX = 0;
      let prevPointerY = 0;
      let maxDragDelta = 0;

      const domCanvas = renderer.domElement;

      const onCanvasPointerDown = (e: PointerEvent) => {
        if (inputReader || e.button !== 0) return;
        if (
          document.pointerLockElement === domCanvas ||
          document.pointerLockElement === mountEl
        ) {
          handleFireWeapon();
          return;
        }
        if (options.autoLockPointerOnClick) {
          requestPointerLockSafely();
        }
        isDraggingLook = true;
        pointerDownX = e.clientX;
        pointerDownY = e.clientY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        maxDragDelta = 0;
      };

      const onWindowMouseMove = (e: MouseEvent) => {
        if (inputReader) return;
        const isLocked =
          document.pointerLockElement === domCanvas ||
          document.pointerLockElement === mountEl;
        if (
          isLocked ||
          (pointerLockRequested &&
            !isDraggingLook &&
            Boolean(e.movementX || e.movementY))
        ) {
          const yawRad = -(e.movementX || 0) * 0.0022;
          const pitchRad = -(e.movementY || 0) * 0.0022;
          pendingYawDeltaBam += Math.round((yawRad / (Math.PI * 2)) * 65536);
          pendingPitchDeltaBam += Math.round(
            (pitchRad / (Math.PI * 2)) * 65536
          );
          return;
        }

        if (!isDraggingLook) return;
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;

        const totalDrag = Math.hypot(
          e.clientX - pointerDownX,
          e.clientY - pointerDownY
        );
        if (totalDrag > maxDragDelta) {
          maxDragDelta = totalDrag;
        }

        const yawRad = -dx * 0.0045;
        const pitchRad = -dy * 0.0045;
        pendingYawDeltaBam += Math.round((yawRad / (Math.PI * 2)) * 65536);
        pendingPitchDeltaBam += Math.round((pitchRad / (Math.PI * 2)) * 65536);
      };

      const onWindowPointerUp = (e: PointerEvent) => {
        if (inputReader || !isDraggingLook) return;
        isDraggingLook = false;
        if (
          e.button === 0 &&
          maxDragDelta < 6 &&
          document.pointerLockElement !== domCanvas
        ) {
          handleFireWeapon();
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (inputReader) return;
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLSelectElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) {
          return;
        }
        if (e.code === 'Escape') {
          pointerLockRequested = false;
        }
        keysPressed[e.code] = true;

        if (e.code === 'KeyM') {
          if (options.onMinimapToggleRequest) {
            options.onMinimapToggleRequest();
          } else {
            minimapEnabled = !minimapEnabled;
            syncHud();
          }
        }

        if (e.code === 'KeyF') {
          handleFireWeapon();
        }

        if (e.code === 'KeyR') {
          handleReloadAmmo();
        }

        if (e.code === 'KeyE' || e.code === 'Space') {
          pendingUse = true;
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        keysPressed[e.code] = false;
      };

      domCanvas.addEventListener('pointerdown', onCanvasPointerDown);
      window.addEventListener('mousemove', onWindowMouseMove);
      window.addEventListener('pointerup', onWindowPointerUp);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      const resizeObserver =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver((entries) => {
              for (const entry of entries) {
                const { width: w, height: h } = entry.contentRect;
                if (w > 0 && h > 0 && camera && renderer) {
                  camera.aspect = w / h;
                  camera.updateProjectionMatrix();
                  renderer.setSize(w, h);
                }
              }
            })
          : null;
      resizeObserver?.observe(mountEl);

      camera.position.set(
        initialWorld.x,
        ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
        initialWorld.z
      );
      euler.set(0, spawn.yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);

      updateSkybox();
      rebuild3DWorld();

      let lastFrameTimeMs = performance.now();
      let accumulatorMs = 0;
      let elapsedSec = 0;
      let lastHudSyncTime = 0;
      let hasSyncedHud = false;
      let lastSyncX = initialWorld.x;
      let lastSyncZ = initialWorld.z;
      let lastSyncYaw = spawn.yaw;
      let lastSyncPitch = 0;
      let lastSyncRow = spawn.row;
      let lastSyncCol = spawn.col;
      let lastSyncSpeed = 0;

      const onVisibilityChange = () => {
        if (document.hidden) {
          accumulatorMs = 0;
          for (const k of Object.keys(keysPressed)) {
            keysPressed[k] = false;
          }
        } else {
          lastFrameTimeMs = performance.now();
          accumulatorMs = 0;
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);

      const afterDraw = (cb: () => void) => {
        if (!renderer || stopped) return;
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync
          ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
          : null;
        gl.flush();
        let polls = 0;
        const poll = () => {
          if (stopped) return;
          polls += 1;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED && polls < 20) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 16);
          }
        };
        frameId = window.setTimeout(poll, 5);
      };

      const tick = () => {
        if (stopped || !renderer || !scene || !camera) return;

        const nowMs = performance.now();
        const rawDeltaMs = Math.max(0, nowMs - lastFrameTimeMs);
        lastFrameTimeMs = nowMs;

        if (document.hidden) {
          accumulatorMs = 0;
          frameId = requestAnimationFrame(tick);
          return;
        }

        const dtSec = Math.min(rawDeltaMs / 1000, 0.1);
        elapsedSec += dtSec;
        accumulatorMs += rawDeltaMs;

        let ticksToRun = Math.floor(accumulatorMs / TICK_MS);
        if (ticksToRun > SIM_CONFIG.MAX_TICKS_PER_FRAME) {
          ticksToRun = SIM_CONFIG.MAX_TICKS_PER_FRAME;
          accumulatorMs = accumulatorMs % TICK_MS;
        } else {
          accumulatorMs -= ticksToRun * TICK_MS;
        }

        const frameStartSim = currSimState;
        let stateChangedThisFrame = false;

        for (let tickIdx = 0; tickIdx < ticksToRun; tickIdx++) {
          runSingleSimTick(tickIdx);
          stateChangedThisFrame = true;
        }

        const curSim = currSimState;
        const prevSim = prevSimState;

        if (curSim.logs.length > lastLogCount) {
          const latestLog = curSim.logs[curSim.logs.length - 1];
          lastLogCount = curSim.logs.length;
          emitLog(`Event: ${latestLog.message}`);
        }

        if (curSim.soundsPlayed.length > lastSoundCount) {
          for (
            let sIdx = lastSoundCount;
            sIdx < curSim.soundsPlayed.length;
            sIdx++
          ) {
            const cue = curSim.soundsPlayed[sIdx];
            if (cue) {
              SoundEffects.playById(cue.soundId);
            }
          }
          lastSoundCount = curSim.soundsPlayed.length;
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
          syncHud();
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

          camera.position.x = interpXUnits * UNITS_TO_METERS;
          camera.position.z = interpZUnits * UNITS_TO_METERS;

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
          camera.quaternion.setFromEuler(euler);

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

          if (currP.speedUnitsPerTick > 0 && !combatState.isDead) {
            const isSprinting = Boolean(
              keysPressed['ShiftLeft'] || keysPressed['ShiftRight']
            );
            camera.position.y =
              interpFloorH +
              ENGINE_CONFIG.PLAYER_EYE_HEIGHT +
              Math.sin(elapsedSec * (isSprinting ? 14 : 10)) * 0.055;
          } else {
            camera.position.y = THREE.MathUtils.damp(
              camera.position.y,
              interpFloorH + ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
              10,
              dtSec
            );
          }

          if (curSim.earthquake && curSim.earthquake.remainingTicks > 0) {
            const shakeMag = (curSim.earthquake.intensity / 1000) * 0.25;
            const tremorX =
              Math.sin(curSim.tick * 1.7 + elapsedSec * 25) * shakeMag;
            const tremorY =
              Math.cos(curSim.tick * 2.3 + elapsedSec * 30) * shakeMag * 0.6;
            camera.position.x += tremorX;
            camera.position.y += tremorY;
          }
        }

        combatSystem?.update(dtSec, elapsedSec, currentSpeedMetersPerSec);

        const openDoorsSet = getOpenDoorsSetFromSim(curSim);

        if (enemyAI && !isReplayOrDeterministic) {
          const occluders = [...wallMeshes];
          doorMeshes.forEach((doorGroup, cKey) => {
            if (!openDoorsSet.has(cKey)) {
              occluders.push(doorGroup);
            }
          });

          enemyAI.update(
            dtSec,
            elapsedSec,
            camera.position,
            curSim.grid,
            openDoorsSet,
            occluders,
            combatState.isDead,
            {
              onPlayerDamaged: (damage, attackerName) => {
                if (combatState.isDead) return;
                const nextHealth = Math.max(0, combatState.health - damage);
                const nowDead = nextHealth <= 0;

                isPlayerHurtFlashing = true;
                window.clearTimeout(hurtFlashTimeout);
                hurtFlashTimeout = window.setTimeout(() => {
                  isPlayerHurtFlashing = false;
                  syncHud();
                }, 180);

                combatState = {
                  ...combatState,
                  health: nextHealth,
                  isDead: nowDead,
                };
                syncHud();

                emitLog(
                  nowDead
                    ? `Combat: Player defeated by ${attackerName}!`
                    : `Combat: ${attackerName} melee attack (-${damage} HP).`
                );
              },
              onAmmoCollected: (amount) => {
                combatState = {
                  ...combatState,
                  ammo: Math.min(combatState.maxAmmo, combatState.ammo + amount),
                };
                syncHud();
                emitLog(
                  `Loot: Picked up +${amount} Plasma Cells from defeated enemy.`
                );
              },
            },
            curSim.solidFootprint
          );
        }

        keyMeshes.forEach((keyGroup, cellKey) => {
          const isCollected = curSim.collectedKeys.includes(cellKey);
          keyGroup.visible = !isCollected;
          if (!isCollected) {
            const card = keyGroup.getObjectByName('floatingKeycard');
            if (card) {
              card.rotation.y = elapsedSec * 2.2;
              card.position.y = 1.25 + Math.sin(elapsedSec * 3.5) * 0.14;
            }
          }
        });

        doorMeshes.forEach((doorGroup, dKey) => {
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
          const wallGroup = getWallBlockGroup(cellKey);
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

        const defaultCeilH = SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
        for (let r = 0; r < curSim.gridSize; r++) {
          const prevFloorRow = prevSim.floorHeights?.[r];
          const currFloorRow = curSim.floorHeights?.[r];
          const prevCeilRow = prevSim.ceilingHeights?.[r];
          const currCeilRow = curSim.ceilingHeights?.[r];
          for (let c = 0; c < curSim.gridSize; c++) {
            const prevH = prevFloorRow?.[c] ?? 0;
            const currH = currFloorRow?.[c] ?? 0;
            if (floorLayer && (prevH !== 0 || currH !== 0)) {
              const interpH = prevH + (currH - prevH) * alpha;
              floorLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
            }
            const prevCeilH = prevCeilRow?.[c] ?? defaultCeilH;
            const currCeilH = currCeilRow?.[c] ?? defaultCeilH;
            if (
              ceilingLayer &&
              (prevCeilH !== defaultCeilH || currCeilH !== defaultCeilH)
            ) {
              const interpH = prevCeilH + (currCeilH - prevCeilH) * alpha;
              ceilingLayer.setCellY(`${r},${c}`, interpH * UNITS_TO_METERS);
            }
          }
        }

        if (elapsedSec - lastHudSyncTime > 0.05 && currP) {
          lastHudSyncTime = elapsedSec;
          const nx = camera.position.x;
          const nz = camera.position.z;
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
            playerTransform = {
              x: nx,
              y: camera.position.y,
              z: nz,
              yaw: nyaw,
              pitch: npitch,
              gridRow: currP.gridRow,
              gridCol: currP.gridCol,
              speed: currentSpeedMetersPerSec,
            };
            options.onPlayerMove?.(playerTransform);
          }

          if (enemyAI) {
            const snapshots = enemyAI.getTelemetrySnapshots();
            enemySnapshots = snapshots.enemies;
            ammoDrops = snapshots.ammoDrops;
            if (
              combatState.kills !== snapshots.kills ||
              combatState.totalEnemies !== snapshots.totalEnemies
            ) {
              combatState = {
                ...combatState,
                kills: snapshots.kills,
                totalEnemies: snapshots.totalEnemies,
              };
            }
          }

          syncHud();
        }

        if (dirLight) {
          dirLight.position.set(
            camera.position.x + 14,
            28,
            camera.position.z + 12
          );
          dirLight.target.position.set(camera.position.x, 0, camera.position.z);
          dirLight.target.updateMatrixWorld();
        }

        renderer.render(scene, camera);

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      };

      if (!inputReader && currSimState.tick === 0 && !options.initialSimState) {
        runSingleSimTick(0);
        syncHud();
      }
      renderer.render(scene, camera);

      frameId = requestAnimationFrame(tick);

      cleanupDomListeners = () => {
        resizeObserver?.disconnect();
        document.removeEventListener('visibilitychange', onVisibilityChange);
        controls?.removeEventListener('lock', onLock);
        controls?.removeEventListener('unlock', onUnlock);
        domCanvas.removeEventListener('pointerdown', onCanvasPointerDown);
        window.removeEventListener('mousemove', onWindowMouseMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    } catch {
      // Headless / non-WebGL test environment fallback: simulation and stepTicks still work
    }
  }

  function stop(): void {
    stopped = true;
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(frameId);
    }
    if (typeof clearTimeout !== 'undefined') {
      clearTimeout(frameId);
      clearTimeout(muzzleFlashTimeout);
      clearTimeout(hitMarkerTimeout);
      clearTimeout(hurtFlashTimeout);
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stop();
    cleanupDomListeners?.();
    cleanupDomListeners = null;
    combatHud?.dispose();
    combatHud = null;
    minimapHud?.dispose();
    minimapHud = null;
    skyboxTex?.dispose();
    skyboxTex = null;
    doorTex?.dispose();
    doorTex = null;
    combatSystem?.dispose();
    combatSystem = null;
    WorldBuilder.disposeWorldGroup(worldGroup);
    worldGroup = null;
    renderer?.dispose();
    renderer = null;
  }

  return {
    stop,
    dispose,
    getState: () => currSimState,
    getManifest: () => activeManifest,
    stepTicks: (count: number) => {
      for (let i = 0; i < count; i++) {
        runSingleSimTick(i);
      }
      syncHud();
      return tickHashes;
    },
    getTickHashes: () => [...tickHashes],
    getRecordedInputs: () => [...recordedInputs],
    setShowCeiling: (show: boolean) => {
      if (showCeiling === show) return;
      showCeiling = show;
      rebuild3DWorld();
    },
    setShowWireframe: (wireframe: boolean) => {
      if (showWireframe === wireframe) return;
      showWireframe = wireframe;
      rebuild3DWorld();
    },
    setCollisionEnabled: (enabled: boolean) => {
      collisionEnabled = enabled;
    },
    setMinimapEnabled: (enabled: boolean) => {
      minimapEnabled = enabled;
      syncHud();
    },
    setSkybox: (theme: SkyboxThemeId, seed: number) => {
      if (skyboxTheme === theme && skyboxSeed === seed) return;
      skyboxTheme = theme;
      skyboxSeed = seed;
      updateSkybox();
    },
    syncEditorLevel: (payload: EditorLevelSyncPayload) => {
      customTextures = payload.customTextures;
      wallTextures = payload.wallTextures.map((r) => [...r]);
      floorTextures = payload.floorTextures.map((r) => [...r]);
      ceilingTextures = payload.ceilingTextures.map((r) => [...r]);
      entities = payload.entities.map((e) => ({ ...e }));
      spawn = { ...payload.spawn };
      showCeiling = payload.showCeiling;
      minimapEnabled = payload.minimapEnabled;

      if (
        skyboxTheme !== payload.skyboxTheme ||
        skyboxSeed !== payload.skyboxSeed
      ) {
        skyboxTheme = payload.skyboxTheme;
        skyboxSeed = payload.skyboxSeed;
        updateSkybox();
      }

      if (payload.grid.length !== currSimState.gridSize) {
        grid = payload.grid.map((r) => [...r]);
        rebuild3DWorld();
        teleportToSpawn();
        return;
      }

      grid = payload.grid.map((r) => [...r]);
      currSimState.grid = grid.map((r) => [...r]);
      currSimState.solidFootprint = buildSolidFootprintGrid(
        entities.map((e) => ({
          ...e,
          yawBam: radiansToBam(e.yaw || 0),
        })),
        grid.length
      );

      for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid.length; c++) {
          const mKey = `door:${r},${c}`;
          if (grid[r]?.[c] === 2 && !currSimState.movers[mKey]) {
            currSimState.movers[mKey] = {
              id: mKey,
              kind: 'door',
              row: r,
              col: c,
              tag: currSimState.cellTags[r]?.[c] ?? 0,
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

      const p0 = currSimState.players[0];
      if (
        p0 &&
        collisionEnabled &&
        checkCircleCollisionUnits(
          p0.xUnits,
          p0.zUnits,
          SIM_CONFIG.PLAYER_RADIUS_UNITS,
          currSimState.grid,
          currSimState.movers,
          currSimState.solidFootprint
        )
      ) {
        const unstuck = depenetrateCircleUnits(
          p0.xUnits,
          p0.zUnits,
          SIM_CONFIG.PLAYER_RADIUS_UNITS,
          currSimState.grid,
          currSimState.movers,
          currSimState.solidFootprint
        );
        p0.xUnits = unstuck.xUnits;
        p0.zUnits = unstuck.zUnits;
        const nextCell = worldUnitsToGrid(
          p0.xUnits,
          p0.zUnits,
          currSimState.gridSize
        );
        p0.gridRow = nextCell.row;
        p0.gridCol = nextCell.col;
        if (prevSimState.players[0]) {
          prevSimState.players[0].xUnits = unstuck.xUnits;
          prevSimState.players[0].zUnits = unstuck.zUnits;
          prevSimState.players[0].gridRow = nextCell.row;
          prevSimState.players[0].gridCol = nextCell.col;
        }
      }

      combatState = {
        ...combatState,
        totalEnemies: entities.filter(
          (e) => e.isEnemy !== false && e.blueprintId !== 'supply-crate'
        ).length,
      };

      rebuild3DWorld();
      syncHud();
    },
    setSimState: (nextSim: SimulationState) => {
      currSimState = nextSim;
      prevSimState = nextSim;
      lastLogCount = nextSim.logs.length;
      lastSoundCount = nextSim.soundsPlayed.length;
      syncHud();
    },
    resetToSpawn: teleportToSpawn,
    fullRespawn: handleFullRespawn,
    lockPointer: requestPointerLockSafely,
  };
}
