/**
 * The runtime's public types: how a game is started (StartGameOptions) and controlled (GameRuntimeHandle).
 * Moved out of startGame.ts in P1.4; startGame.ts re-exports them.
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
  PlayerTransform,
  TextureAsset,
} from '../types';
import {
  LevelDataV3,
  PlayerTickInput,
  SimulationState,
} from '../../sim';
import {
  RuntimeAppState,
} from '../menu';

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
  resetToSpawn: () => void;
  fullRespawn: () => void;
  lockPointer: () => void;
  getMenuAppState: () => RuntimeAppState;
  openMainMenu: () => void;
  openInGameOverlay: (screenId?: string) => void;
  resumeFromOverlay: () => void;
}
