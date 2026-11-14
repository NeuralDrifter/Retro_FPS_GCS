/**
 * State and context shared by the runtime's subsystems (P1.4). startGame creates one RuntimeState
 * and one RuntimeContext per running game and passes the context to the functions in ./core.
 */
import type * as THREE from 'three';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type {
  AmmoLootSnapshot,
  CampaignSettings,
  EnemyTelemetrySnapshot,
  PlacedEntity,
  PlayerCombatState,
  PlayerTransform,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
} from '../types';
import type { LevelDataV3, PlayerTickInput, SimulationState } from '../../sim';
import type { InstancedCellLayer } from '../WorldBuilder';
import type { EnemyAISystem } from '../EnemyAISystem';
import type { CombatSystem } from '../CombatSystem';
import type { CombatHUDController } from '../hud/CombatHUD';
import type { MinimapHUDController } from '../hud/MinimapHUD';
import type { MenuRuntimeController, MenuRuntimeSettings } from '../menu';
import type { InputState } from './InputController';
import type { RenderSystem } from './RenderSystem';
import type { StartGameOptions, createInputReader } from '../startGame';

/** Mutable state of one running game (see startGame). */
export interface RuntimeState {
  campaignLevels: LevelDataV3[];
  currentLevelIndex: number;
  campaignSettings: CampaignSettings;
  currentLevelV3: LevelDataV3;
  customTextures: TextureAsset[];
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  entities: PlacedEntity[];
  spawn: { row: number; col: number; yaw: number };
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  showWireframe: boolean;
  collisionEnabled: boolean;
  minimapEnabled: boolean;
  vertical: VerticalLevelData | undefined;
  updateLayeredHeights: ((floors: number[][], ceilings: number[][]) => void) | null;
  prevSimState: SimulationState;
  currSimState: SimulationState;
  lastLogCount: number;
  lastSoundCount: number;
  aiEnemiesLoaded: boolean;
  levelEntryState: { health: number; ammo: number };
  combatState: PlayerCombatState;
  isMuzzleFlashing: boolean;
  isHitMarkerActive: boolean;
  isPlayerHurtFlashing: boolean;
  enemySnapshots: EnemyTelemetrySnapshot[];
  ammoDrops: AmmoLootSnapshot[];
  muzzleFlashTimeout: number;
  hitMarkerTimeout: number;
  hurtFlashTimeout: number;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  renderer: THREE.WebGLRenderer | null;
  controls: PointerLockControls | null;
  hemiLight: THREE.HemisphereLight | null;
  dirLight: THREE.DirectionalLight | null;
  worldGroup: THREE.Group | null;
  wallMeshes: THREE.Object3D[];
  getWallBlockGroup: (cellKey: string) => THREE.Group | undefined;
  doorMeshes: Map<string, THREE.Group>;
  keyMeshes: Map<string, THREE.Group>;
  floorLayer: InstancedCellLayer | null;
  ceilingLayer: InstancedCellLayer | null;
  enemyAI: EnemyAISystem | null;
  combatSystem: CombatSystem | null;
  doorTex: THREE.Texture | null;
  skyboxTex: THREE.CanvasTexture | null;
  renderSystem: RenderSystem | null;
  removeRendererProbe: () => void;
  removeWorldBuildProbe: () => void;
  worldBuildCount: number;
  playerTransform: PlayerTransform;
  combatHud: CombatHUDController | null;
  minimapHud: MinimapHUDController | null;
  menuController: MenuRuntimeController | null;
  runtimeSettings: MenuRuntimeSettings;
  elapsedSec: number;
  frameId: number;
  stopped: boolean;
  disposed: boolean;
  cleanupDomListeners: (() => void) | null;
}

/** What the core subsystems receive: the state plus the run's fixed settings and recorders */
export interface RuntimeContext {
  rt: RuntimeState;
  options: StartGameOptions;
  input: InputState;
  euler: THREE.Euler;
  inputReader: ReturnType<typeof createInputReader>;
  isReplayOrDeterministic: boolean;
  recordInputs: boolean;
  hashEveryTick: boolean;
  recordedInputs: PlayerTickInput[];
  tickHashes: string[];
  countLevelEnemies: () => number;
}

/** Key under which startGame attaches its RuntimeContext to the handle (read by startPlaytest only) */
export const RUNTIME_CONTEXT: unique symbol = Symbol('gcs.runtimeContext');
