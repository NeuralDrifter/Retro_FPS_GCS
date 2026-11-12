/**
 * ============================================================================
 * FORGECORE MENU RUNTIME STATE MACHINE & CONTROLLER (`/src/runtime/menu/MenuRuntimeController.ts`)
 * ============================================================================
 * Governs the RuntimeAppState ('MAIN_MENU' | 'ACTIVE_GAMEPLAY' | 'IN_GAME_OVERLAY'),
 * screen navigation stack, localStorage Save/Load checkpoints, and settings.
 */

import { PlayerCombatState, TextureAsset } from '../types';
import { SimulationState } from '../sim';
import { SoundEffects } from '../SoundEffects';
import {
  MenuDOMRenderer,
  MenuRenderRuntimeContext,
} from './MenuDOMRenderer';
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
  MenuAction,
  MenuPackSpec,
  MenuRuntimeSettings,
  MenuSaveSlotSummary,
  MenuScreenSpec,
  MenuSettingTarget,
} from './types';

export type RuntimeAppState =
  | 'MAIN_MENU'
  | 'ACTIVE_GAMEPLAY'
  | 'IN_GAME_OVERLAY';

export interface SavedCheckpointPayload {
  version: 1;
  savedAt: string;
  levelIndex: number;
  levelTitle: string;
  combatState: PlayerCombatState;
  simState: SimulationState;
}

export interface MenuRuntimeHostHooks {
  getGameTitle: () => string;
  getCombatState: () => PlayerCombatState;
  getSimState: () => SimulationState;
  getCurrentLevelIndex: () => number;
  getTotalLevels: () => number;
  getCurrentLevelTitle: () => string;
  getElapsedSeconds: () => number;
  getCustomTextures: () => TextureAsset[];
  onStartNewGame: (startLevelIndex: number) => void;
  onResumeGame: () => void;
  onRestartCurrentLevel: () => void;
  onRestoreCheckpoint: (payload: SavedCheckpointPayload) => void;
  onFireSimEvent: (action: Extract<MenuAction, { type: 'FIRE_SIM_EVENT' }>) => void;
  onQuitToMainMenu: () => void;
  onApplySettings: (settings: MenuRuntimeSettings) => void;
  onAppStateChange?: (state: RuntimeAppState, activeScreen: MenuScreenSpec | null) => void;
  onEngineLog?: (msg: string) => void;
}

export class MenuRuntimeController {
  private menuPack: MenuPackSpec | null;
  private renderer: MenuDOMRenderer | null = null;
  private hooks: MenuRuntimeHostHooks;
  private appState: RuntimeAppState = 'ACTIVE_GAMEPLAY';
  private activeScreenId: string | null = null;
  private screenHistory: string[] = [];
  private settings: MenuRuntimeSettings = { ...DEFAULT_MENU_RUNTIME_SETTINGS };
  private statusToast: string | null = null;
  private toastTimeoutId = 0;

  constructor(
    mountRoot: HTMLElement | null,
    menuPack: MenuPackSpec | null | undefined,
    hooks: MenuRuntimeHostHooks,
    options?: { startInMainMenu?: boolean }
  ) {
    this.menuPack = menuPack ?? null;
    this.hooks = hooks;
    this.loadPersistedSettings();

    if (mountRoot && typeof document !== 'undefined') {
      this.renderer = new MenuDOMRenderer(mountRoot, {
        onTriggerAction: (action) => this.executeAction(action),
        onChangeSetting: (target, val) => this.handleSettingChange(target, val),
        onSaveSlot: (slotIndex) => this.saveToSlot(slotIndex),
        onLoadSlot: (slotIndex) => this.loadFromSlot(slotIndex),
        onPlaySound: (soundId) => SoundEffects.playById(soundId),
      });
    }

    if (options?.startInMainMenu && this.menuPack && this.menuPack.screens.length > 0) {
      this.enterMainMenu();
    } else {
      this.appState = 'ACTIVE_GAMEPLAY';
      this.activeScreenId = null;
      this.renderer?.setVisible(false);
    }
  }

  public getAppState(): RuntimeAppState {
    return this.appState;
  }

  public getActiveScreen(): MenuScreenSpec | null {
    if (!this.menuPack || !this.activeScreenId) return null;
    return (
      this.menuPack.screens.find((s) => s.id === this.activeScreenId) ?? null
    );
  }

  public isSimulationPaused(): boolean {
    if (this.appState === 'MAIN_MENU') return true;
    if (this.appState === 'IN_GAME_OVERLAY') {
      const scr = this.getActiveScreen();
      return scr?.overlayConfig?.pauseSimulation !== false;
    }
    return false;
  }

  public shouldHideCombatHud(): boolean {
    if (this.appState === 'MAIN_MENU') return true;
    if (this.appState === 'IN_GAME_OVERLAY') {
      const scr = this.getActiveScreen();
      return Boolean(scr?.overlayConfig?.hideCombatHud);
    }
    return false;
  }

  public getSettings(): MenuRuntimeSettings {
    return this.settings;
  }

  public setMenuPack(
    nextPack: MenuPackSpec | null | undefined,
    options?: { previewScreenId?: string | null }
  ): void {
    this.menuPack = nextPack ?? null;
    if (options?.previewScreenId) {
      const scr = this.menuPack?.screens.find(
        (s) => s.id === options.previewScreenId
      );
      if (scr) {
        this.activeScreenId = scr.id;
        this.appState =
          scr.category === 'in-game-overlay'
            ? 'IN_GAME_OVERLAY'
            : 'MAIN_MENU';
        this.syncView();
        this.hooks.onAppStateChange?.(this.appState, scr);
        return;
      }
    }
    this.syncView();
  }

  public enterMainMenu(): void {
    if (!this.menuPack || this.menuPack.screens.length === 0) return;
    const entryId =
      this.menuPack.entryMainMenuScreenId || this.menuPack.screens[0].id;
    const entryScreen =
      this.menuPack.screens.find((s) => s.id === entryId) ||
      this.menuPack.screens[0];

    this.appState = 'MAIN_MENU';
    this.activeScreenId = entryScreen.id;
    this.screenHistory = [];
    this.syncView();
    this.hooks.onAppStateChange?.(this.appState, entryScreen);
  }

  public openInGameOverlay(screenId?: string): boolean {
    if (!this.menuPack || !this.menuPack.enablePauseOverlay) return false;
    const targetId = screenId || this.menuPack.pauseOverlayScreenId;
    const targetScreen =
      this.menuPack.screens.find((s) => s.id === targetId) ||
      this.menuPack.screens.find((s) => s.category === 'in-game-overlay');

    if (!targetScreen) return false;

    this.appState = 'IN_GAME_OVERLAY';
    this.activeScreenId = targetScreen.id;
    this.screenHistory = [];
    this.syncView();
    this.hooks.onAppStateChange?.(this.appState, targetScreen);
    return true;
  }

  public closeMenuAndResume(): void {
    this.appState = 'ACTIVE_GAMEPLAY';
    this.activeScreenId = null;
    this.screenHistory = [];
    this.renderer?.setVisible(false);
    this.hooks.onAppStateChange?.('ACTIVE_GAMEPLAY', null);
    this.hooks.onResumeGame();
  }

  /**
   * Handles keyboard shortcuts for opening/closing In-Game Overlays.
   * Returns true if the key event was consumed by the menu system.
   */
  public handleKeyDown(code: string): boolean {
    if (!this.menuPack) return false;

    if (this.appState === 'MAIN_MENU') {
      if (code === 'Escape' && this.screenHistory.length > 0) {
        this.executeAction({ type: 'BACK_MENU_SCREEN' });
        return true;
      }
      return true;
    }

    if (this.appState === 'IN_GAME_OVERLAY') {
      const current = this.getActiveScreen();
      if (
        code === 'Escape' ||
        (current?.overlayConfig?.triggerHotkey &&
          current.overlayConfig.triggerHotkey === code)
      ) {
        if (this.screenHistory.length > 0) {
          this.executeAction({ type: 'BACK_MENU_SCREEN' });
        } else {
          this.closeMenuAndResume();
        }
        return true;
      }
      return true;
    }

    // In ACTIVE_GAMEPLAY: check if any in-game overlay matches this hotkey
    if (!this.menuPack.enablePauseOverlay) return false;
    const matchingOverlay = this.menuPack.screens.find(
      (s) =>
        s.category === 'in-game-overlay' &&
        s.overlayConfig?.triggerHotkey === code
    );
    if (matchingOverlay) {
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        try {
          document.exitPointerLock?.();
        } catch {
          // Ignore
        }
      }
      this.openInGameOverlay(matchingOverlay.id);
      return true;
    }

    return false;
  }

  public executeAction(action: MenuAction): void {
    switch (action.type) {
      case 'START_NEW_GAME': {
        const startIdx = action.startLevelIndex ?? 0;
        this.appState = 'ACTIVE_GAMEPLAY';
        this.activeScreenId = null;
        this.screenHistory = [];
        this.renderer?.setVisible(false);
        this.hooks.onAppStateChange?.('ACTIVE_GAMEPLAY', null);
        this.hooks.onStartNewGame(startIdx);
        break;
      }

      case 'RESUME_GAME': {
        this.closeMenuAndResume();
        break;
      }

      case 'OPEN_MENU_SCREEN': {
        if (!this.menuPack) return;
        const target = this.menuPack.screens.find(
          (s) => s.id === action.screenId
        );
        if (!target) return;
        if (action.pushHistory !== false && this.activeScreenId) {
          this.screenHistory.push(this.activeScreenId);
        }
        this.activeScreenId = target.id;
        this.syncView();
        this.hooks.onAppStateChange?.(this.appState, target);
        break;
      }

      case 'BACK_MENU_SCREEN': {
        if (this.screenHistory.length > 0) {
          const prevId = this.screenHistory.pop()!;
          this.activeScreenId = prevId;
          this.syncView();
          this.hooks.onAppStateChange?.(this.appState, this.getActiveScreen());
        } else if (this.appState === 'IN_GAME_OVERLAY') {
          this.closeMenuAndResume();
        }
        break;
      }

      case 'RESTART_CURRENT_LEVEL': {
        this.appState = 'ACTIVE_GAMEPLAY';
        this.activeScreenId = null;
        this.screenHistory = [];
        this.renderer?.setVisible(false);
        this.hooks.onAppStateChange?.('ACTIVE_GAMEPLAY', null);
        this.hooks.onRestartCurrentLevel();
        break;
      }

      case 'SAVE_GAME_SLOT': {
        this.saveToSlot(action.slotIndex);
        break;
      }

      case 'LOAD_GAME_SLOT': {
        this.loadFromSlot(action.slotIndex);
        break;
      }

      case 'FIRE_SIM_EVENT': {
        this.hooks.onFireSimEvent(action);
        this.showToast('Executed simulation trigger event.');
        this.syncView();
        break;
      }

      case 'QUIT_TO_MAIN_MENU': {
        this.hooks.onQuitToMainMenu();
        this.enterMainMenu();
        break;
      }
    }
  }

  private handleSettingChange(
    target: MenuSettingTarget,
    value: number | boolean
  ): void {
    this.settings = {
      ...this.settings,
      [target]: value,
    };
    this.savePersistedSettings();
    this.hooks.onApplySettings(this.settings);
    this.syncView();
  }

  private getStoragePrefix(): string {
    const slug = (this.hooks.getGameTitle() || 'gridforge-game')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `gridforge_menu_${slug || 'game'}`;
  }

  private loadPersistedSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem('gridforge_runtime_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.settings = {
            ...DEFAULT_MENU_RUNTIME_SETTINGS,
            ...parsed,
          };
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private savePersistedSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(
        'gridforge_runtime_settings',
        JSON.stringify(this.settings)
      );
    } catch {
      // Ignore
    }
  }

  public getSaveSlotsSummary(): MenuSaveSlotSummary[] {
    const summaries: MenuSaveSlotSummary[] = [];
    const prefix = this.getStoragePrefix();
    for (let slot = 1; slot <= 3; slot++) {
      let occupied = false;
      let savedAt: string | undefined;
      let levelIndex: number | undefined;
      let levelTitle: string | undefined;
      let health: number | undefined;
      let ammo: number | undefined;
      let kills: number | undefined;

      if (typeof localStorage !== 'undefined') {
        try {
          const raw = localStorage.getItem(`${prefix}_slot_${slot}`);
          if (raw) {
            const parsed = JSON.parse(raw) as SavedCheckpointPayload;
            if (parsed && parsed.version === 1) {
              occupied = true;
              savedAt = parsed.savedAt;
              levelIndex = parsed.levelIndex;
              levelTitle = parsed.levelTitle;
              health = Math.round(parsed.combatState?.health ?? 100);
              ammo = Math.round(parsed.combatState?.ammo ?? 32);
              kills = Math.round(parsed.combatState?.kills ?? 0);
            }
          }
        } catch {
          // Ignore corrupt slot
        }
      }
      summaries.push({
        slotIndex: slot,
        occupied,
        savedAt,
        levelIndex,
        levelTitle,
        health,
        ammo,
        kills,
      });
    }
    return summaries;
  }

  public saveToSlot(slotIndex: number): void {
    if (typeof localStorage === 'undefined') return;
    const prefix = this.getStoragePrefix();
    const nowStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const payload: SavedCheckpointPayload = {
      version: 1,
      savedAt: nowStr,
      levelIndex: this.hooks.getCurrentLevelIndex(),
      levelTitle: this.hooks.getCurrentLevelTitle(),
      combatState: JSON.parse(JSON.stringify(this.hooks.getCombatState())),
      simState: JSON.parse(JSON.stringify(this.hooks.getSimState())),
    };
    try {
      localStorage.setItem(
        `${prefix}_slot_${slotIndex}`,
        JSON.stringify(payload)
      );
      SoundEffects.playById('key_pickup');
      this.showToast(`Checkpoint saved to Slot ${slotIndex}.`);
      this.hooks.onEngineLog?.(
        `Menu System: Saved checkpoint to Slot ${slotIndex} ('${payload.levelTitle}').`
      );
      this.syncView();
    } catch {
      this.showToast('Unable to save checkpoint in browser storage.');
    }
  }

  public loadFromSlot(slotIndex: number): void {
    if (typeof localStorage === 'undefined') return;
    const prefix = this.getStoragePrefix();
    try {
      const raw = localStorage.getItem(`${prefix}_slot_${slotIndex}`);
      if (!raw) return;
      const payload = JSON.parse(raw) as SavedCheckpointPayload;
      if (!payload || payload.version !== 1) return;

      SoundEffects.playById('level_exit');
      this.appState = 'ACTIVE_GAMEPLAY';
      this.activeScreenId = null;
      this.screenHistory = [];
      this.renderer?.setVisible(false);
      this.hooks.onAppStateChange?.('ACTIVE_GAMEPLAY', null);
      this.hooks.onRestoreCheckpoint(payload);
      this.hooks.onEngineLog?.(
        `Menu System: Restored checkpoint from Slot ${slotIndex} ('${payload.levelTitle}').`
      );
    } catch {
      this.showToast('Failed to load checkpoint.');
    }
  }

  private showToast(msg: string): void {
    this.statusToast = msg;
    if (typeof window !== 'undefined') {
      window.clearTimeout(this.toastTimeoutId);
      this.toastTimeoutId = window.setTimeout(() => {
        this.statusToast = null;
        this.syncView();
      }, 2400);
    }
  }

  public syncView(): void {
    if (!this.renderer) return;
    const activeScreen = this.getActiveScreen();
    if (!activeScreen || this.appState === 'ACTIVE_GAMEPLAY') {
      this.renderer.setVisible(false);
      return;
    }

    const ctx: MenuRenderRuntimeContext = {
      combatState: this.hooks.getCombatState(),
      simState: this.hooks.getSimState(),
      currentLevelIndex: this.hooks.getCurrentLevelIndex(),
      totalLevels: this.hooks.getTotalLevels(),
      currentLevelTitle: this.hooks.getCurrentLevelTitle(),
      elapsedSeconds: this.hooks.getElapsedSeconds(),
      settings: this.settings,
      saveSlots: this.getSaveSlotsSummary(),
      customTextures: this.hooks.getCustomTextures(),
      statusToast: this.statusToast,
    };

    this.renderer.render(activeScreen, ctx);
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.clearTimeout(this.toastTimeoutId);
    }
    this.renderer?.dispose();
  }
}
