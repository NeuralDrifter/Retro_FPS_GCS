/**
 * ============================================================================
 * GRIDFORGE 3D DESKTOP IDE — 3D PERSPECTIVE VIEWPORT & DETERMINISTIC SIM VIEW
 * ============================================================================
 * Injected into `#viewport-3d-container` in the middle split workspace.
 *  - Advances the pure integer simulation (`step(state, inputsByPlayer)`) at a
 *    fixed 30 Hz tick rate (`TICK_MS = 1000 / 30`) with a 5-tick frame clamp
 *    (`MAX_TICKS_PER_FRAME = 5`) and `document.hidden` pause.
 *  - Converts mouse look and keyboard actions into integer BAM/command inputs
 *    at the input boundary, consuming mouse look and edge-triggered commands
 *    (`use`, `shoot`) strictly once per frame (on `tickIndex === 0`).
 *  - Interpolates camera position, shortest-arc BAM yaw, and door mover progress
 *    between `prevSimState` and `currSimState` by `alpha = accumulator / TICK_MS`.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AmmoLootSnapshot,
  ENGINE_CONFIG,
  EnemyTelemetrySnapshot,
  PlacedEntity,
  PlayerCombatState,
  PlayerTransform,
  SkyboxThemeId,
  TextureAsset,
} from '../types/engine';
import {
  PlayerTickInput,
  SIM_CONFIG,
  SimulationState,
  createInitialSimulationState,
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
  lerpBamToRadians,
  radiansToBam,
  step,
} from '../engine/sim';
import { LevelSerializer } from '../engine/LevelSerializer';
import { TextureGenerator } from '../engine/TextureGenerator';
import { CollisionSystem } from '../engine/CollisionSystem';
import { InstancedCellLayer, WorldBuilder } from '../engine/WorldBuilder';
import { EnemyAISystem } from '../engine/EnemyAISystem';
import { CombatSystem } from '../engine/CombatSystem';
import { SoundEffects } from '../engine/SoundEffects';
import { MinimapHUD } from './MinimapHUD';
import { CombatHUD } from './CombatHUD';
import {
  Crosshair,
  RotateCcw,
  ShieldCheck,
  Box,
  Layers,
  Map as MapIcon,
  Maximize2,
  Minimize2,
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
  playerTransform: PlayerTransform;
  onPlayerMove: (transform: PlayerTransform) => void;
  simState: SimulationState;
  onSimStateChange: (nextState: SimulationState) => void;
  resetSignal: number;
  onEngineLog: (message: string) => void;
}

const TICK_MS = 1000 / SIM_CONFIG.TICKS_PER_SECOND;
const UNITS_TO_METERS = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS; // 4.0 / 1000 = 0.004
const METERS_TO_UNITS = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE; // 250

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
  playerTransform,
  onPlayerMove,
  simState,
  onSimStateChange,
  resetSignal,
  onEngineLog,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [collisionEnabled, setCollisionEnabled] = useState(true);

  const [combatState, setCombatState] = useState<PlayerCombatState>(() => ({
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
  }));
  const [isMuzzleFlashing, setIsMuzzleFlashing] = useState(false);
  const [isHitMarkerActive, setIsHitMarkerActive] = useState(false);
  const [isPlayerHurtFlashing, setIsPlayerHurtFlashing] = useState(false);
  const [enemySnapshots, setEnemySnapshots] = useState<
    EnemyTelemetrySnapshot[]
  >([]);
  const [ammoDrops, setAmmoDrops] = useState<AmmoLootSnapshot[]>([]);

  const combatStateRef = useRef(combatState);
  combatStateRef.current = combatState;

  const gridRef = useRef(grid);
  gridRef.current = grid;

  const collisionEnabledRef = useRef(collisionEnabled);
  collisionEnabledRef.current = collisionEnabled;

  // Dual simulation snapshots for smooth 30Hz -> display refresh rate interpolation
  const prevSimStateRef = useRef<SimulationState>(simState);
  const currSimStateRef = useRef<SimulationState>(simState);

  const onSimStateChangeRef = useRef(onSimStateChange);
  onSimStateChangeRef.current = onSimStateChange;

  const onPlayerMoveRef = useRef(onPlayerMove);
  onPlayerMoveRef.current = onPlayerMove;

  const onToggleMinimapRef = useRef(onToggleMinimap);
  onToggleMinimapRef.current = onToggleMinimap;

  const onEngineLogRef = useRef(onEngineLog);
  onEngineLogRef.current = onEngineLog;

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const worldGroupRef = useRef<THREE.Group | null>(null);
  const wallMeshesRef = useRef<THREE.Object3D[]>([]);
  const getWallBlockGroupRef = useRef<
    (cellKey: string) => THREE.Group | undefined
  >(() => undefined);
  const doorMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const keyMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const floorLayerRef = useRef<InstancedCellLayer | null>(null);
  const ceilingLayerRef = useRef<InstancedCellLayer | null>(null);
  const enemyAIRef = useRef<EnemyAISystem | null>(null);
  const combatSystemRef = useRef<CombatSystem | null>(null);

  const doorTexRef = useRef<THREE.Texture | null>(null);
  const skyboxTexRef = useRef<THREE.CanvasTexture | null>(null);

  const keysPressedRef = useRef<Record<string, boolean>>({});
  const eulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));

  // Per-frame input boundary accumulators (consumed strictly ONCE on tickIndex === 0)
  const pendingYawDeltaBamRef = useRef<number>(0);
  const pendingPitchDeltaBamRef = useRef<number>(0);
  const pendingUseRef = useRef<boolean>(false);
  const pendingShootRef = useRef<boolean>(false);
  const lastLogCountRef = useRef<number>(simState.logs.length);
  const lastSoundCountRef = useRef<number>(simState.soundsPlayed.length);

  // Sync external simState resets/edits into refs
  useEffect(() => {
    currSimStateRef.current = simState;
    prevSimStateRef.current = simState;
    lastLogCountRef.current = simState.logs.length;
    lastSoundCountRef.current = simState.soundsPlayed.length;
  }, [simState]);

  const getActiveOccluderMeshes = useCallback((): THREE.Object3D[] => {
    const occluders = [...wallMeshesRef.current];
    const openDoors = getOpenDoorsSetFromSim(currSimStateRef.current);
    doorMeshesRef.current.forEach((doorGroup, cellKey) => {
      if (!openDoors.has(cellKey)) {
        occluders.push(doorGroup);
      }
    });
    return occluders;
  }, []);

  const handleFireWeapon = useCallback(() => {
    const cam = cameraRef.current;
    const combatSys = combatSystemRef.current;
    const enemyAI = enemyAIRef.current;
    const curState = combatStateRef.current;

    if (!cam || !combatSys || !enemyAI || curState.isDead) return;

    // Also queue a deterministic `shoot` command for the simulation step
    pendingShootRef.current = true;

    if (curState.ammo <= 0) {
      onEngineLogRef.current(
        'Combat: Out of Plasma Ammo — Press [R] to Reload or collect dropped Ammo Crates.'
      );
      return;
    }

    const occluders = getActiveOccluderMeshes();
    const shot = combatSys.fireWeapon(
      cam,
      curState.ammo,
      curState.isDead,
      enemyAI,
      occluders
    );

    if (!shot.fired) return;

    setIsMuzzleFlashing(true);
    window.setTimeout(() => setIsMuzzleFlashing(false), 90);

    if (shot.hitEnemy) {
      setIsHitMarkerActive(true);
      window.setTimeout(() => setIsHitMarkerActive(false), 150);
    }

    const snapshots = enemyAI.getTelemetrySnapshots();
    setEnemySnapshots(snapshots.enemies);
    setAmmoDrops(snapshots.ammoDrops);

    setCombatState((prev) => ({
      ...prev,
      ammo: Math.max(0, prev.ammo - 1),
      kills: snapshots.kills,
      totalEnemies: snapshots.totalEnemies,
      lastHitEnemyName: shot.hitEnemy ? shot.enemyName : prev.lastHitEnemyName,
      lastHitEnemyHealth: shot.hitEnemy
        ? shot.enemyRemainingHealth
        : prev.lastHitEnemyHealth,
      lastHitEnemyMaxHealth: shot.hitEnemy
        ? shot.enemyMaxHealth
        : prev.lastHitEnemyMaxHealth,
    }));

    if (shot.killedEnemy && shot.enemyName) {
      onEngineLogRef.current(
        `Combat: Eliminated ${shot.enemyName} — Spawned +${ENGINE_CONFIG.AMMO_DROP_AMOUNT} Plasma Ammo Pickup.`
      );
    } else if (shot.hitEnemy && shot.enemyName) {
      onEngineLogRef.current(
        `Combat: Hit ${shot.enemyName} (-${ENGINE_CONFIG.WEAPON_DAMAGE} HP, ${shot.enemyRemainingHealth} HP remaining).`
      );
    }
  }, [getActiveOccluderMeshes]);

  const handleFireWeaponRef = useRef(handleFireWeapon);
  handleFireWeaponRef.current = handleFireWeapon;

  const handleReloadAmmo = useCallback(() => {
    setCombatState((prev) => {
      if (prev.isDead) return prev;
      const nextAmmo = Math.min(
        prev.maxAmmo,
        Math.max(prev.ammo + 24, ENGINE_CONFIG.PLAYER_START_AMMO)
      );
      return {
        ...prev,
        ammo: nextAmmo,
      };
    });
    onEngineLogRef.current('Combat: Reloaded Plasma Repeater (+24 Cells).');
  }, []);

  const handleReloadAmmoRef = useRef(handleReloadAmmo);
  handleReloadAmmoRef.current = handleReloadAmmo;

  const rebuild3DWorld = useCallback(() => {
    const scene = sceneRef.current;
    const renderer = rendererRef.current;
    if (!scene || !renderer) return;

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    if (!doorTexRef.current) {
      doorTexRef.current = TextureGenerator.createDoorTexture(maxAniso);
    }

    if (worldGroupRef.current) {
      scene.remove(worldGroupRef.current);
      WorldBuilder.disposeWorldGroup(worldGroupRef.current);
    }

    const collectedKeysSet = getCollectedKeysSetFromSim(currSimStateRef.current);
    const openDoorsSet = getOpenDoorsSetFromSim(currSimStateRef.current);

    const built = WorldBuilder.buildWorldFromGrid(
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      doorTexRef.current,
      maxAniso,
      {
        showCeiling,
        showWireframe,
        spawn,
        collectedKeys: collectedKeysSet,
        openDoors: openDoorsSet,
        onAsyncAssetReady: () => {
          rebuild3DWorld();
        },
      }
    );

    worldGroupRef.current = built.worldGroup;
    wallMeshesRef.current = built.wallMeshes;
    getWallBlockGroupRef.current = built.getWallBlockGroup;
    doorMeshesRef.current = built.doorMeshes;
    keyMeshesRef.current = built.keyMeshes;
    floorLayerRef.current = built.floorLayer;
    ceilingLayerRef.current = built.ceilingLayer;
    enemyAIRef.current = built.enemyAI;
    scene.add(built.worldGroup);
  }, [
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    customTextures,
    entities,
    showCeiling,
    showWireframe,
    spawn,
  ]);

  const teleportToSpawn = useCallback(() => {
    const existingSim = currSimStateRef.current;
    const levelV3 = LevelSerializer.serializeLevelV3({
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
      cellTags: existingSim.cellTags,
      events: existingSim.events,
      regions: existingSim.regions,
      variables: {
        flags: existingSim.flags,
        counters: existingSim.counters,
        timers: Object.keys(existingSim.timers),
      },
    });
    const freshSim = createInitialSimulationState(levelV3, [0]);
    prevSimStateRef.current = freshSim;
    currSimStateRef.current = freshSim;
    lastLogCountRef.current = freshSim.logs.length;
    lastSoundCountRef.current = freshSim.soundsPlayed.length;
    onSimStateChangeRef.current(freshSim);

    const cam = cameraRef.current;
    if (cam) {
      const { x, z } = CollisionSystem.gridToWorld(
        spawn.row,
        spawn.col,
        grid.length
      );
      cam.position.set(x, ENGINE_CONFIG.PLAYER_EYE_HEIGHT, z);
      eulerRef.current.set(0, spawn.yaw, 0, 'YXZ');
      cam.quaternion.setFromEuler(eulerRef.current);

      onPlayerMoveRef.current({
        x,
        y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
        z,
        yaw: spawn.yaw,
        pitch: 0,
        gridRow: spawn.row,
        gridCol: spawn.col,
        speed: 0,
      });
    }

    setCombatState((prev) => ({
      ...prev,
      health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
      ammo: Math.max(prev.ammo, ENGINE_CONFIG.PLAYER_START_AMMO),
      isDead: false,
      lastHitEnemyName: null,
      lastHitEnemyHealth: null,
      lastHitEnemyMaxHealth: null,
    }));
  }, [
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
  ]);

  const teleportToSpawnRef = useRef(teleportToSpawn);
  teleportToSpawnRef.current = teleportToSpawn;

  const handleFullRespawn = useCallback(() => {
    teleportToSpawn();
    rebuild3DWorld();
    onEngineLogRef.current(
      'Engine: Reset level simulation state, restored player health & ammo, and respawned Enemy AI.'
    );
  }, [rebuild3DWorld, teleportToSpawn]);

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090c12);
    scene.fog = new THREE.FogExp2(0x090c12, 0.025);
    sceneRef.current = scene;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 120);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.65);
    hemiLightRef.current = hemiLight;
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.35);
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

    const combatSystem = new CombatSystem(camera, scene);
    combatSystemRef.current = combatSystem;

    scene.add(camera);

    const controls = new PointerLockControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const onLock = () => setIsPointerLocked(true);
    const onUnlock = () => setIsPointerLocked(false);
    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);

    let isDraggingLook = false;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let prevPointerX = 0;
    let prevPointerY = 0;
    let maxDragDelta = 0;

    const onCanvasPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement === renderer.domElement) {
        handleFireWeaponRef.current();
        return;
      }
      isDraggingLook = true;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
      maxDragDelta = 0;
    };

    const onWindowPointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement === renderer.domElement) {
        // Convert pointer-lock mouse movement into integer BAM deltas at input boundary
        const yawRad = -(e.movementX || 0) * 0.0022;
        const pitchRad = -(e.movementY || 0) * 0.0022;
        pendingYawDeltaBamRef.current += Math.round(
          (yawRad / (Math.PI * 2)) * 65536
        );
        pendingPitchDeltaBamRef.current += Math.round(
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

      // Convert drag look movement into integer BAM deltas at input boundary
      const yawRad = -dx * 0.0045;
      const pitchRad = -dy * 0.0045;
      pendingYawDeltaBamRef.current += Math.round(
        (yawRad / (Math.PI * 2)) * 65536
      );
      pendingPitchDeltaBamRef.current += Math.round(
        (pitchRad / (Math.PI * 2)) * 65536
      );
    };

    const onWindowPointerUp = (e: PointerEvent) => {
      if (!isDraggingLook) return;
      isDraggingLook = false;
      if (
        e.button === 0 &&
        maxDragDelta < 6 &&
        document.pointerLockElement !== renderer.domElement
      ) {
        handleFireWeaponRef.current();
      }
    };

    renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }
      keysPressedRef.current[e.code] = true;

      if (e.code === 'KeyM') {
        onToggleMinimapRef.current();
      }

      if (e.code === 'KeyF') {
        handleFireWeaponRef.current();
      }

      if (e.code === 'KeyR') {
        handleReloadAmmoRef.current();
      }

      if (e.code === 'KeyE' || e.code === 'Space') {
        pendingUseRef.current = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysPressedRef.current[e.code] = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
      }
    });
    resizeObserver.observe(container);

    const initialWorld = CollisionSystem.gridToWorld(
      spawn.row,
      spawn.col,
      grid.length
    );
    camera.position.set(
      initialWorld.x,
      ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
      initialWorld.z
    );
    eulerRef.current.set(0, spawn.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(eulerRef.current);

    let lastFrameTimeMs = performance.now();
    let accumulatorMs = 0;
    let elapsedSec = 0;
    let frameId = 0;
    let lastHudSyncTime = 0;

    // Pause and clear fixed-tick accumulator when document tab is hidden
    const onVisibilityChange = () => {
      if (document.hidden) {
        accumulatorMs = 0;
        keysPressedRef.current = {};
      } else {
        lastFrameTimeMs = performance.now();
        accumulatorMs = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
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

      // Fixed 30Hz timestep with MAX_TICKS_PER_FRAME = 5 clamp
      let ticksToRun = Math.floor(accumulatorMs / TICK_MS);
      if (ticksToRun > SIM_CONFIG.MAX_TICKS_PER_FRAME) {
        ticksToRun = SIM_CONFIG.MAX_TICKS_PER_FRAME;
        accumulatorMs = accumulatorMs % TICK_MS; // Drop excess remainder after stall
      } else {
        accumulatorMs -= ticksToRun * TICK_MS;
      }

      const keys = keysPressedRef.current;
      const isPlayerDead = combatStateRef.current.isDead;
      let stateChangedThisFrame = false;

      for (let tickIdx = 0; tickIdx < ticksToRun; tickIdx++) {
        prevSimStateRef.current = currSimStateRef.current;

        const moveForward = (
          Number(Boolean(keys['KeyW'] || keys['ArrowUp'])) -
          Number(Boolean(keys['KeyS'] || keys['ArrowDown']))
        ) as -1 | 0 | 1;
        const moveRight = (
          Number(Boolean(keys['KeyD'])) - Number(Boolean(keys['KeyA']))
        ) as -1 | 0 | 1;

        // Consume mouse-look delta and one-shot `use`/`shoot` strictly on tickIdx === 0
        const yawDeltaBam =
          tickIdx === 0 ? pendingYawDeltaBamRef.current : 0;
        const pitchDeltaBam =
          tickIdx === 0 ? pendingPitchDeltaBamRef.current : 0;
        const useTriggered = tickIdx === 0 ? pendingUseRef.current : false;
        const shootTriggered = tickIdx === 0 ? pendingShootRef.current : false;

        if (tickIdx === 0) {
          pendingYawDeltaBamRef.current = 0;
          pendingPitchDeltaBamRef.current = 0;
          pendingUseRef.current = false;
          pendingShootRef.current = false;
        }

        const playerInput: PlayerTickInput = isPlayerDead
          ? {
              moveForward: 0,
              moveRight: 0,
              sprint: false,
              yawDeltaBam: 0,
              pitchDeltaBam: 0,
              use: false,
              shoot: false,
              noclip: !collisionEnabledRef.current,
            }
          : {
              moveForward,
              moveRight,
              turnLeft: Boolean(keys['KeyQ'] || keys['ArrowLeft']),
              turnRight: Boolean(keys['ArrowRight']),
              sprint: Boolean(keys['ShiftLeft'] || keys['ShiftRight']),
              yawDeltaBam,
              pitchDeltaBam,
              use: useTriggered,
              shoot: shootTriggered,
              noclip: !collisionEnabledRef.current,
            };

        let nextSim = step(currSimStateRef.current, { 0: playerInput });

        // Phase 2 bridge: also resolve player-vs-enemy-entity circle collision in millicells
        if (enemyAIRef.current && collisionEnabledRef.current && !isPlayerDead) {
          const p0 = nextSim.players[0];
          if (p0) {
            const worldX = p0.xUnits * UNITS_TO_METERS;
            const worldZ = p0.zUnits * UNITS_TO_METERS;
            const entResolved = enemyAIRef.current.resolvePlayerEntityCollision(
              worldX,
              worldZ,
              collisionEnabledRef.current
            );
            p0.xUnits = Math.round(entResolved.x * METERS_TO_UNITS);
            p0.zUnits = Math.round(entResolved.z * METERS_TO_UNITS);
          }
        }

        currSimStateRef.current = nextSim;
        stateChangedThisFrame = true;
      }

      // Emit any new simulation log lines to the IDE bottom status bar
      const curSim = currSimStateRef.current;
      const prevSim = prevSimStateRef.current;
      if (curSim.logs.length > lastLogCountRef.current) {
        const latestLog = curSim.logs[curSim.logs.length - 1];
        lastLogCountRef.current = curSim.logs.length;
        onEngineLogRef.current(`Event: ${latestLog.message}`);
      }

      // Play any new sound cues queued in `curSim.soundsPlayed`
      if (curSim.soundsPlayed.length > lastSoundCountRef.current) {
        for (
          let sIdx = lastSoundCountRef.current;
          sIdx < curSim.soundsPlayed.length;
          sIdx++
        ) {
          const cue = curSim.soundsPlayed[sIdx];
          if (cue) {
            SoundEffects.playById(cue.soundId);
          }
        }
        lastSoundCountRef.current = curSim.soundsPlayed.length;
      }

      if (
        stateChangedThisFrame &&
        (curSim.collectedKeys.length !== prevSim.collectedKeys.length ||
          curSim.messages.length !== prevSim.messages.length ||
          curSim.secretsFound !== prevSim.secretsFound ||
          curSim.levelEnded !== prevSim.levelEnded ||
          Object.keys(curSim.movers).length !==
            Object.keys(prevSim.movers).length ||
          Object.keys(curSim.movers).some(
            (k) => curSim.movers[k]?.state !== prevSim.movers[k]?.state
          ))
      ) {
        onSimStateChangeRef.current(curSim);
      }

      // ----------------------------------------------------------------------
      // VIEW LAYER INTERPOLATION (alpha = accumulatorMs / TICK_MS in [0, 1])
      // ----------------------------------------------------------------------
      const alpha = Math.max(0, Math.min(1, accumulatorMs / TICK_MS));
      const prevP = prevSim.players[0];
      const currP = curSim.players[0];

      let currentSpeedMetersPerSec = 0;

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

        eulerRef.current.set(interpPitchRad, interpYawRad, 0, 'YXZ');
        camera.quaternion.setFromEuler(eulerRef.current);

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

        if (currP.speedUnitsPerTick > 0 && !isPlayerDead) {
          const isSprinting = Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
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

        // Earthquake screen tremor
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

      combatSystem.update(dtSec, elapsedSec, currentSpeedMetersPerSec);

      const openDoorsSet = getOpenDoorsSetFromSim(curSim);

      if (enemyAIRef.current) {
        const occluders = [...wallMeshesRef.current];
        doorMeshesRef.current.forEach((doorGroup, cKey) => {
          if (!openDoorsSet.has(cKey)) {
            occluders.push(doorGroup);
          }
        });

        enemyAIRef.current.update(
          dtSec,
          elapsedSec,
          camera.position,
          curSim.grid,
          openDoorsSet,
          occluders,
          isPlayerDead,
          {
            onPlayerDamaged: (damage, attackerName) => {
              if (combatStateRef.current.isDead) return;
              const nextHealth = Math.max(
                0,
                combatStateRef.current.health - damage
              );
              const nowDead = nextHealth <= 0;

              setIsPlayerHurtFlashing(true);
              window.setTimeout(() => setIsPlayerHurtFlashing(false), 180);

              setCombatState((prev) => {
                if (prev.isDead) return prev;
                const updatedHealth = Math.max(0, prev.health - damage);
                return {
                  ...prev,
                  health: updatedHealth,
                  isDead: updatedHealth <= 0,
                };
              });

              onEngineLogRef.current(
                nowDead
                  ? `Combat: Player defeated by ${attackerName}!`
                  : `Combat: ${attackerName} melee attack (-${damage} HP).`
              );
            },
            onAmmoCollected: (amount) => {
              setCombatState((prev) => ({
                ...prev,
                ammo: Math.min(prev.maxAmmo, prev.ammo + amount),
              }));
              onEngineLogRef.current(
                `Loot: Picked up +${amount} Plasma Cells from defeated enemy.`
              );
            },
          },
          curSim.solidFootprint
        );
      }

      // Sync keycard meshes visibility and bobbing from simulation state
      keyMeshesRef.current.forEach((keyGroup, cellKey) => {
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

      // Interpolate door meshes directly from simulation mover progress (0..10000 basis points)
      doorMeshesRef.current.forEach((doorGroup, dKey) => {
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

      // Interpolate Wolf3D secret pushwall meshes from simulation mover progress (0..10000 basis points)
      for (const mKey of Object.keys(curSim.movers)) {
        const currMover = curSim.movers[mKey];
        if (!currMover || currMover.kind !== 'pushwall') continue;

        const cellKey = `${currMover.row},${currMover.col}`;
        const wallGroup = getWallBlockGroupRef.current(cellKey);
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
          baseWorld.x + dCol * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;
        wallGroup.position.z =
          baseWorld.z + dRow * distCells * ENGINE_CONFIG.CELL_SIZE * interpProg;

        // If the pushwall slid into a recessed boundary wall (no targetRow/targetCol),
        // hide the mesh once it finishes sliding into the recess.
        if (
          currMover.state === 'done' &&
          currMover.targetRow === undefined
        ) {
          wallGroup.visible = false;
        }
      }

      // Interpolate moving floor platform and ceiling/crusher heights from simulation state
      const floorLayer = floorLayerRef.current;
      const ceilingLayer = ceilingLayerRef.current;
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
        eulerRef.current.setFromQuaternion(camera.quaternion);
        onPlayerMoveRef.current({
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
          yaw: eulerRef.current.y,
          pitch: eulerRef.current.x,
          gridRow: currP.gridRow,
          gridCol: currP.gridCol,
          speed: currentSpeedMetersPerSec,
        });

        if (enemyAIRef.current) {
          const snapshots = enemyAIRef.current.getTelemetrySnapshots();
          setEnemySnapshots(snapshots.enemies);
          setAmmoDrops(snapshots.ammoDrops);
          setCombatState((prev) =>
            prev.kills !== snapshots.kills ||
            prev.totalEnemies !== snapshots.totalEnemies
              ? {
                  ...prev,
                  kills: snapshots.kills,
                  totalEnemies: snapshots.totalEnemies,
                }
              : prev
          );
        }
      }

      // Keep the shadow camera's fixed-size box centered on the player so large maps get shadows everywhere
      dirLight.position.set(camera.position.x + 14, 28, camera.position.z + 12);
      dirLight.target.position.set(camera.position.x, 0, camera.position.z);
      dirLight.target.updateMatrixWorld();

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      skyboxTexRef.current?.dispose();
      combatSystem.dispose();
      WorldBuilder.disposeWorldGroup(worldGroupRef.current);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    skyboxTexRef.current?.dispose();
    const generated = TextureGenerator.createSkyboxTexture(
      skyboxTheme,
      skyboxSeed
    );
    skyboxTexRef.current = generated.texture;

    scene.background = generated.texture;
    scene.fog = new THREE.FogExp2(generated.fogColor, 0.025);

    if (hemiLightRef.current) {
      hemiLightRef.current.color.setHex(generated.hemiSkyColor);
      hemiLightRef.current.groundColor.setHex(generated.hemiGroundColor);
    }
  }, [skyboxTheme, skyboxSeed]);

  // Keep simulation grid/movers synced when editor sculpts cells
  useEffect(() => {
    const cur = currSimStateRef.current;
    if (grid.length !== cur.gridSize) {
      // Map was resized (or a resize was undone): rebuild the simulation at the new size
      rebuild3DWorld();
      teleportToSpawnRef.current();
      return;
    }
    cur.grid = grid.map((r) => [...r]);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid.length; c++) {
        const mKey = `door:${r},${c}`;
        if (grid[r]?.[c] === 2 && !cur.movers[mKey]) {
          cur.movers[mKey] = {
            id: mKey,
            kind: 'door',
            row: r,
            col: c,
            tag: cur.cellTags[r]?.[c] ?? 0,
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
    rebuild3DWorld();
  }, [rebuild3DWorld, grid]);

  useEffect(() => {
    teleportToSpawn();
  }, [spawn, resetSignal, teleportToSpawn]);

  const collectedKeysSet = getCollectedKeysSetFromSim(simState);
  const openDoorsSet = getOpenDoorsSetFromSim(simState);

  return (
    <section
      id="viewport-3d-container"
      aria-label="3D First-Person Viewport"
      className="flex flex-col w-full h-full bg-[#141414] select-none overflow-hidden"
    >
      {/* Compact 24px Desktop IDE Viewport Header Bar */}
      <div className="ide-panel-header">
        <div className="flex items-center gap-2">
          <span>3D Perspective Viewport</span>
          <span className="font-mono text-[#858585]">
            {isPointerLocked ? '[Mouse Locked - ESC]' : '[WASD + LMB/F Fire]'}
          </span>
        </div>

        <div className="flex items-center gap-1">
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
            onClick={() => {
              try {
                controlsRef.current?.lock();
              } catch {
                // Fallback if sandbox blocks pointer lock
              }
            }}
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
            onClick={handleFullRespawn}
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

      {/* WebGL Canvas + In-Game Combat & Minimap Overlays */}
      <div className="relative flex-1 w-full min-h-0 overflow-hidden">
        <div ref={canvasMountRef} className="w-full h-full cursor-crosshair" />

        <CombatHUD
          combatState={combatState}
          simState={simState}
          isMuzzleFlashing={isMuzzleFlashing}
          isHitMarkerActive={isHitMarkerActive}
          isPlayerHurtFlashing={isPlayerHurtFlashing}
          onFireWeapon={handleFireWeapon}
          onReloadAmmo={handleReloadAmmo}
          onUseAction={() => {
            pendingUseRef.current = true;
          }}
          onRespawnPlayer={handleFullRespawn}
        />

        {minimapEnabled && (
          <MinimapHUD
            grid={grid}
            entities={entities}
            enemySnapshots={enemySnapshots}
            ammoDrops={ammoDrops}
            playerTransform={playerTransform}
            collectedKeys={collectedKeysSet}
            openDoors={openDoorsSet}
            onCloseMinimap={onToggleMinimap}
          />
        )}
      </div>
    </section>
  );
};
