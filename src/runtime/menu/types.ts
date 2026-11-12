/**
 * ============================================================================
 * FORGECORE UI MENU SYSTEM — DATA CONTRACTS & VALIDATION (`/src/runtime/menu/types.ts`)
 * ============================================================================
 * Pure runtime types for Out-of-Game Main Menus and In-Game Overlays.
 * Zero React or editor-only imports so standalone exports share 1:1 parity.
 */

export type MenuThemePresetId =
  | 'tactical-gridforge'
  | 'retro-shareware'
  | 'minimal-cyber';

export type MenuScreenCategory = 'main-menu' | 'sub-menu' | 'in-game-overlay';

export type MenuTriggerHotkey =
  | 'Escape'
  | 'Tab'
  | 'KeyI'
  | 'KeyP'
  | 'KeyO'
  | 'None';

export type MenuOverlayHotkey = MenuTriggerHotkey;

export type MenuFontFamilyId =
  | 'mono'
  | 'sans'
  | 'pixel'
  | 'industrial'
  | 'display'
  | 'serif';

export type MenuFontFamily = MenuFontFamilyId;

export type MenuButtonShape =
  | 'rectangle'
  | 'rounded'
  | 'chamfered'
  | 'pill'
  | 'underline';

export type MenuWidgetAnchor =
  | 'top-left'
  | 'top-center'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type MenuWidgetType =
  | 'title-text'
  | 'button'
  | 'panel'
  | 'image'
  | 'stat-readout'
  | 'inventory-grid'
  | 'slider-setting'
  | 'toggle-setting'
  | 'save-slot-list';

export type MenuIconId =
  | 'none'
  | 'play'
  | 'resume'
  | 'settings'
  | 'save'
  | 'load'
  | 'restart'
  | 'quit'
  | 'skull'
  | 'exit'
  | 'back'
  | 'key'
  | 'shield'
  | 'crosshair'
  | 'backpack';

export interface MenuThemeTokens {
  primaryAccentHex: string;
  dangerAccentHex: string;
  surfaceBgRgba: string;
  surfaceBorderHex: string;
  textPrimaryHex: string;
  textMutedHex: string;
  defaultFontFamily: MenuFontFamilyId;
}

export interface MenuOverlayConfig {
  triggerHotkey: MenuTriggerHotkey;
  pauseSimulation: boolean;
  hideCombatHud: boolean;
  dimOpacity: number;
  dimColorHex: string;
  backdropBlurPx: number;
  scanlineEffect: boolean;
}

export type MenuBackgroundSpec =
  | {
      type: 'solid';
      colorHex: string;
      gradientEndHex?: string;
      showCyberGrid: boolean;
    }
  | {
      type: 'image';
      textureId: string;
      fitMode: 'cover' | 'contain' | 'tile' | 'scroll';
      scrollSpeedX?: number;
      scrollSpeedY?: number;
      tintHex?: string;
      vignetteStrength: number;
    }
  | {
      type: '3d-scene';
      levelIndex: number;
      cameraMode: 'orbit' | 'fixed';
      cameraTarget: { row: number; col: number; elevationMeters: number };
      orbitRadiusMeters: number;
      orbitSpeedRadPerSec: number;
      fixedYawRad?: number;
      fixedPitchRad?: number;
      fov: number;
      tintOverlayRgba?: string;
    };

export interface MenuWidgetRect {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  anchor?: MenuWidgetAnchor;
  rotationDeg?: number;
  zIndex: number;
}

export interface MenuWidgetStateOverride {
  bgColorRgba?: string;
  borderColorHex?: string;
  textColorHex?: string;
  backgroundTextureId?: string;
  scaleMultiplier?: number;
}

export interface MenuWidgetVisualStyle {
  shape: MenuButtonShape;
  borderRadiusPx: number;
  chamferSizePx: number;
  bgColorRgba: string;
  borderColorHex: string;
  borderWidthPx: number;
  backgroundTextureId?: string;
  textureFit?: 'stretch' | 'tile' | '9-slice';
  nineSliceInsetPx?: number;
  fontFamily: MenuFontFamilyId;
  fontSizePx: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  letterSpacingEm: number;
  textTransform: 'none' | 'uppercase';
  textAlign: 'left' | 'center' | 'right';
  textColorHex: string;
  textShadowHex?: string;
  hoverStyle?: MenuWidgetStateOverride;
  activeStyle?: MenuWidgetStateOverride;
}

export type MenuStatSource =
  | 'health'
  | 'ammo'
  | 'kills'
  | 'secrets'
  | 'level-title'
  | 'time'
  | 'sim-flag'
  | 'sim-counter';

export type MenuStatBindingSource = MenuStatSource;

export interface MenuStatBinding {
  source: MenuStatSource;
  variableKey?: string;
  formatTemplate?: string;
}

export type MenuSettingTarget =
  | 'masterVolume'
  | 'mouseSensitivity'
  | 'fov'
  | 'minimapEnabled'
  | 'invertY';

export interface MenuSettingBinding {
  target: MenuSettingTarget;
  min?: number;
  max?: number;
  step?: number;
}

export type MenuAction =
  | { type: 'START_NEW_GAME'; startLevelIndex?: number }
  | { type: 'RESUME_GAME' }
  | { type: 'OPEN_MENU_SCREEN'; screenId: string; pushHistory?: boolean }
  | { type: 'BACK_MENU_SCREEN' }
  | { type: 'RESTART_CURRENT_LEVEL' }
  | { type: 'SAVE_GAME_SLOT'; slotIndex: number }
  | { type: 'LOAD_GAME_SLOT'; slotIndex: number }
  | {
      type: 'FIRE_SIM_EVENT';
      flagName?: string;
      flagValue?: boolean;
      counterName?: string;
      counterDelta?: number;
    }
  | { type: 'QUIT_TO_MAIN_MENU' };

export type MenuActionType = MenuAction['type'];

export interface MenuWidgetSpec {
  id: string;
  name: string;
  type: MenuWidgetType;
  visible?: boolean;
  locked?: boolean;
  rect: MenuWidgetRect;
  style: MenuWidgetVisualStyle;
  text?: string;
  subtitleText?: string;
  iconId?: MenuIconId;
  imageTextureId?: string;
  statBinding?: MenuStatBinding;
  settingBinding?: MenuSettingBinding;
  onClickAction?: MenuAction;
  hoverSoundId?: string;
  clickSoundId?: string;
}

export interface MenuScreenSpec {
  id: string;
  name: string;
  category: MenuScreenCategory;
  overlayConfig?: MenuOverlayConfig;
  backgroundConfig: MenuBackgroundSpec;
  widgets: MenuWidgetSpec[];
}

export interface MenuPackSpec {
  schemaVersion: 1;
  presetId?: string;
  enableMainMenuOnBoot: boolean;
  enablePauseOverlay: boolean;
  entryMainMenuScreenId: string;
  pauseOverlayScreenId: string;
  screens: MenuScreenSpec[];
  theme: MenuThemeTokens;
}

export interface MenuRuntimeSettings {
  masterVolume: number;      // 0..100
  mouseSensitivity: number;  // 20..250 (100 = 1.0x)
  fov: number;               // 60..110 (default 75)
  minimapEnabled: boolean;
  invertY: boolean;
}

export const DEFAULT_MENU_RUNTIME_SETTINGS: MenuRuntimeSettings = {
  masterVolume: 80,
  mouseSensitivity: 100,
  fov: 75,
  minimapEnabled: true,
  invertY: false,
};

export interface MenuSaveSlotSummary {
  slotIndex: number;
  occupied: boolean;
  savedAt?: string;
  levelIndex?: number;
  levelTitle?: string;
  health?: number;
  ammo?: number;
  kills?: number;
}

/**
 * Deep-clones a MenuPackSpec safely.
 */
export function cloneMenuPackSpec(pack: MenuPackSpec): MenuPackSpec {
  return JSON.parse(JSON.stringify(pack)) as MenuPackSpec;
}

/**
 * Collects all texture IDs referenced across all screens and widgets in a MenuPackSpec.
 */
export function collectMenuTextureIds(pack?: MenuPackSpec | null): string[] {
  if (!pack || !Array.isArray(pack.screens)) return [];
  const ids = new Set<string>();
  for (const screen of pack.screens) {
    if (!screen || typeof screen !== 'object') continue;
    if (
      screen.backgroundConfig &&
      screen.backgroundConfig.type === 'image' &&
      typeof screen.backgroundConfig.textureId === 'string' &&
      screen.backgroundConfig.textureId.trim()
    ) {
      ids.add(screen.backgroundConfig.textureId.trim());
    }
    if (Array.isArray(screen.widgets)) {
      for (const widget of screen.widgets) {
        if (!widget || typeof widget !== 'object') continue;
        if (
          typeof widget.imageTextureId === 'string' &&
          widget.imageTextureId.trim()
        ) {
          ids.add(widget.imageTextureId.trim());
        }
        if (
          widget.style &&
          typeof widget.style.backgroundTextureId === 'string' &&
          widget.style.backgroundTextureId.trim()
        ) {
          ids.add(widget.style.backgroundTextureId.trim());
        }
        if (
          widget.style?.hoverStyle &&
          typeof widget.style.hoverStyle.backgroundTextureId === 'string' &&
          widget.style.hoverStyle.backgroundTextureId.trim()
        ) {
          ids.add(widget.style.hoverStyle.backgroundTextureId.trim());
        }
      }
    }
  }
  return Array.from(ids);
}

/**
 * Resolves the CSS font-family stack for a given MenuFontFamilyId.
 */
export function resolveMenuFontFamilyCss(fontId: MenuFontFamilyId): string {
  switch (fontId) {
    case 'mono':
      return '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace';
    case 'pixel':
      return '"Courier New", "Lucida Console", "JetBrains Mono", monospace';
    case 'industrial':
      return '"Chakra Petch", "Orbitron", "Arial Black", Impact, sans-serif';
    case 'serif':
      return '"Cinzel", Georgia, "Times New Roman", serif';
    case 'sans':
    default:
      return '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }
}
