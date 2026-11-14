/**
 * ============================================================================
 * FORGECORE UI MENU SYSTEM — STARTER PRESETS & TEMPLATES (`/src/runtime/menu/presets.ts`)
 * ============================================================================
 * Built-in Main Menu and In-Game Overlay presets for instant out-of-the-box
 * menu authoring, customization, and runtime execution.
 */

import {
  MenuButtonShape,
  MenuPackSpec,
  MenuScreenSpec,
  MenuThemeTokens,
  MenuWidgetSpec,
  MenuWidgetVisualStyle,
  cloneMenuPackSpec,
} from './types';

export interface MenuPresetDefinition {
  id: string;
  name: string;
  description: string;
  buildPack: (gameTitle?: string) => MenuPackSpec;
}

export function createBaseWidgetStyle(
  theme: MenuThemeTokens,
  overrides: Partial<MenuWidgetVisualStyle> = {}
): MenuWidgetVisualStyle {
  const shape: MenuButtonShape = overrides.shape ?? 'chamfered';
  return {
    shape,
    borderRadiusPx: overrides.borderRadiusPx ?? 4,
    chamferSizePx: overrides.chamferSizePx ?? 10,
    bgColorRgba: overrides.bgColorRgba ?? theme.surfaceBgRgba,
    borderColorHex: overrides.borderColorHex ?? theme.surfaceBorderHex,
    borderWidthPx: overrides.borderWidthPx ?? 1,
    fontFamily: overrides.fontFamily ?? theme.defaultFontFamily,
    fontSizePx: overrides.fontSizePx ?? 15,
    fontWeight: overrides.fontWeight ?? 700,
    letterSpacingEm: overrides.letterSpacingEm ?? 0.06,
    textTransform: overrides.textTransform ?? 'uppercase',
    textAlign: overrides.textAlign ?? 'center',
    textColorHex: overrides.textColorHex ?? theme.textPrimaryHex,
    textShadowHex: overrides.textShadowHex,
    backgroundTextureId: overrides.backgroundTextureId,
    textureFit: overrides.textureFit ?? 'stretch',
    nineSliceInsetPx: overrides.nineSliceInsetPx ?? 8,
    hoverStyle: overrides.hoverStyle ?? {
      bgColorRgba: 'rgba(56, 189, 248, 0.22)',
      borderColorHex: theme.primaryAccentHex,
      textColorHex: '#ffffff',
      scaleMultiplier: 1.02,
    },
    activeStyle: overrides.activeStyle ?? {
      bgColorRgba: 'rgba(56, 189, 248, 0.36)',
      borderColorHex: '#ffffff',
      textColorHex: '#ffffff',
    },
  };
}

function buildScreensForTheme(
  theme: MenuThemeTokens,
  options: {
    gameTitle: string;
    subtitle: string;
    buttonShape: MenuButtonShape;
    mainBg: MenuScreenSpec['backgroundConfig'];
    scanlines: boolean;
  }
): MenuScreenSpec[] {
  const btnStyle = (
    primary = false,
    danger = false
  ): MenuWidgetVisualStyle =>
    createBaseWidgetStyle(theme, {
      shape: options.buttonShape,
      bgColorRgba: danger
        ? 'rgba(209, 77, 65, 0.22)'
        : primary
        ? 'rgba(78, 201, 176, 0.2)'
        : theme.surfaceBgRgba,
      borderColorHex: danger
        ? theme.dangerAccentHex
        : primary
        ? theme.primaryAccentHex
        : theme.surfaceBorderHex,
      borderWidthPx: primary ? 2 : 1,
      textColorHex: danger ? '#fca5a5' : theme.textPrimaryHex,
      hoverStyle: {
        bgColorRgba: danger
          ? 'rgba(209, 77, 65, 0.38)'
          : 'rgba(78, 201, 176, 0.32)',
        borderColorHex: danger ? '#f87171' : theme.primaryAccentHex,
        textColorHex: '#ffffff',
        scaleMultiplier: 1.02,
      },
    });

  const panelStyle = createBaseWidgetStyle(theme, {
    shape: options.buttonShape === 'chamfered' ? 'chamfered' : 'rounded',
    chamferSizePx: 14,
    borderRadiusPx: 6,
    bgColorRgba: 'rgba(15, 19, 26, 0.86)',
    borderColorHex: theme.surfaceBorderHex,
    borderWidthPx: 1,
  });

  // 1. Out-of-Game Main Menu Screen
  const mainMenuScreen: MenuScreenSpec = {
    id: 'screen-main-menu',
    name: 'Main Menu (Title Screen)',
    category: 'main-menu',
    backgroundConfig: options.mainBg,
    widgets: [
      {
        id: 'w-main-backdrop-panel',
        name: 'Command Frame Panel',
        type: 'panel',
        visible: true,
        rect: {
          xPct: 8,
          yPct: 12,
          widthPct: 38,
          heightPct: 76,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: panelStyle,
      },
      {
        id: 'w-main-title',
        name: 'Game Title Header',
        type: 'title-text',
        visible: true,
        text: options.gameTitle,
        subtitleText: options.subtitle,
        rect: {
          xPct: 11,
          yPct: 17,
          widthPct: 32,
          heightPct: 14,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 30,
          fontWeight: 800,
          textAlign: 'left',
          textColorHex: '#ffffff',
          textShadowHex: theme.primaryAccentHex,
          letterSpacingEm: 0.08,
        }),
      },
      {
        id: 'w-main-btn-start',
        name: 'Start Campaign Button',
        type: 'button',
        visible: true,
        text: 'Deploy Mission',
        iconId: 'play',
        rect: {
          xPct: 11,
          yPct: 36,
          widthPct: 32,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(true, false),
        onClickAction: { type: 'START_NEW_GAME', startLevelIndex: 0 },
        clickSoundId: 'level_exit',
      },
      {
        id: 'w-main-btn-load',
        name: 'Load Saved Game Button',
        type: 'button',
        visible: true,
        text: 'Load Checkpoints',
        iconId: 'load',
        rect: {
          xPct: 11,
          yPct: 47,
          widthPct: 32,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: {
          type: 'OPEN_MENU_SCREEN',
          screenId: 'screen-save-slots',
          pushHistory: true,
        },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-main-btn-options',
        name: 'Options Button',
        type: 'button',
        visible: true,
        text: 'System Settings',
        iconId: 'settings',
        rect: {
          xPct: 11,
          yPct: 58,
          widthPct: 32,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: {
          type: 'OPEN_MENU_SCREEN',
          screenId: 'screen-options',
          pushHistory: true,
        },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-main-controls-note',
        name: 'Controls Hint Footer',
        type: 'title-text',
        visible: true,
        text: 'WASD Move · Mouse Aim · LMB/F Fire · E Interact · ESC Pause',
        rect: {
          xPct: 11,
          yPct: 75,
          widthPct: 32,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 11,
          fontWeight: 400,
          textTransform: 'none',
          textAlign: 'left',
          textColorHex: theme.textMutedHex,
          letterSpacingEm: 0.02,
        }),
      },
    ],
  };

  // 2. Shared Options Sub-Menu Screen
  const optionsScreen: MenuScreenSpec = {
    id: 'screen-options',
    name: 'Options & Controls Sub-Menu',
    category: 'sub-menu',
    backgroundConfig: options.mainBg,
    widgets: [
      {
        id: 'w-opt-panel',
        name: 'Settings Container Panel',
        type: 'panel',
        visible: true,
        rect: {
          xPct: 22,
          yPct: 12,
          widthPct: 56,
          heightPct: 76,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: panelStyle,
      },
      {
        id: 'w-opt-title',
        name: 'Settings Header',
        type: 'title-text',
        visible: true,
        text: 'SYSTEM CONFIGURATION',
        subtitleText: 'Audio, Mouse Look & Field of View',
        rect: {
          xPct: 26,
          yPct: 16,
          widthPct: 48,
          heightPct: 11,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 22,
          fontWeight: 800,
          textAlign: 'left',
          textColorHex: '#ffffff',
        }),
      },
      {
        id: 'w-opt-volume',
        name: 'Master Volume Slider',
        type: 'slider-setting',
        visible: true,
        text: 'Master Audio Gain',
        rect: {
          xPct: 26,
          yPct: 30,
          widthPct: 48,
          heightPct: 9,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        settingBinding: {
          target: 'masterVolume',
          min: 0,
          max: 100,
          step: 5,
        },
      },
      {
        id: 'w-opt-sens',
        name: 'Mouse Sensitivity Slider',
        type: 'slider-setting',
        visible: true,
        text: 'Mouse Look Sensitivity',
        rect: {
          xPct: 26,
          yPct: 41,
          widthPct: 48,
          heightPct: 9,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        settingBinding: {
          target: 'mouseSensitivity',
          min: 25,
          max: 250,
          step: 5,
        },
      },
      {
        id: 'w-opt-fov',
        name: 'Camera FOV Slider',
        type: 'slider-setting',
        visible: true,
        text: 'Camera Field of View (FOV)',
        rect: {
          xPct: 26,
          yPct: 52,
          widthPct: 48,
          heightPct: 9,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        settingBinding: {
          target: 'fov',
          min: 60,
          max: 110,
          step: 5,
        },
      },
      {
        id: 'w-opt-minimap',
        name: 'Minimap Radar Toggle',
        type: 'toggle-setting',
        visible: true,
        text: 'Show Tactical Minimap Radar',
        rect: {
          xPct: 26,
          yPct: 63,
          widthPct: 48,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        settingBinding: {
          target: 'minimapEnabled',
        },
      },
      {
        id: 'w-opt-back',
        name: 'Return Button',
        type: 'button',
        visible: true,
        text: 'Back to Previous Menu',
        iconId: 'back',
        rect: {
          xPct: 26,
          yPct: 75,
          widthPct: 48,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(true, false),
        onClickAction: { type: 'BACK_MENU_SCREEN' },
        clickSoundId: 'switch_use',
      },
    ],
  };

  // 3. Save / Load Checkpoints Sub-Menu
  const saveSlotsScreen: MenuScreenSpec = {
    id: 'screen-save-slots',
    name: 'Save / Load Checkpoints',
    category: 'sub-menu',
    backgroundConfig: options.mainBg,
    widgets: [
      {
        id: 'w-save-panel',
        name: 'Save Slots Panel',
        type: 'panel',
        visible: true,
        rect: {
          xPct: 20,
          yPct: 12,
          widthPct: 60,
          heightPct: 76,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: panelStyle,
      },
      {
        id: 'w-save-title',
        name: 'Save Slots Title',
        type: 'title-text',
        visible: true,
        text: 'MISSION CHECKPOINTS',
        subtitleText: 'Save current progress or restore a saved sector state',
        rect: {
          xPct: 24,
          yPct: 16,
          widthPct: 52,
          heightPct: 11,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 22,
          fontWeight: 800,
          textAlign: 'left',
          textColorHex: '#ffffff',
        }),
      },
      {
        id: 'w-save-list',
        name: 'Interactive Save Slot Manager',
        type: 'save-slot-list',
        visible: true,
        text: 'Campaign Save Slots',
        rect: {
          xPct: 24,
          yPct: 29,
          widthPct: 52,
          heightPct: 42,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
      },
      {
        id: 'w-save-back',
        name: 'Return Button',
        type: 'button',
        visible: true,
        text: 'Return',
        iconId: 'back',
        rect: {
          xPct: 24,
          yPct: 75,
          widthPct: 52,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(true, false),
        onClickAction: { type: 'BACK_MENU_SCREEN' },
        clickSoundId: 'switch_use',
      },
    ],
  };

  // 4. In-Game Pause Overlay (Triggered on ESC / Pointer Unlock)
  const pauseOverlayScreen: MenuScreenSpec = {
    id: 'screen-pause-overlay',
    name: 'In-Game Pause Menu (ESC)',
    category: 'in-game-overlay',
    overlayConfig: {
      triggerHotkey: 'Escape',
      pauseSimulation: true,
      hideCombatHud: false,
      dimOpacity: 0.72,
      dimColorHex: '#070a10',
      backdropBlurPx: 6,
      scanlineEffect: options.scanlines,
    },
    backgroundConfig: {
      type: 'solid',
      colorHex: '#070a10',
      showCyberGrid: false,
    },
    widgets: [
      {
        id: 'w-pause-panel',
        name: 'Pause Modal Frame',
        type: 'panel',
        visible: true,
        rect: {
          xPct: 30,
          yPct: 12,
          widthPct: 40,
          heightPct: 76,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: panelStyle,
      },
      {
        id: 'w-pause-title',
        name: 'Pause Header',
        type: 'title-text',
        visible: true,
        text: 'SIMULATION PAUSED',
        subtitleText: '3D world frozen at deterministic tick boundary',
        rect: {
          xPct: 33,
          yPct: 16,
          widthPct: 34,
          heightPct: 10,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 22,
          fontWeight: 800,
          textAlign: 'center',
          textColorHex: '#ffffff',
        }),
      },
      {
        id: 'w-pause-stat-hp',
        name: 'Live Health & Ammo Readout',
        type: 'stat-readout',
        visible: true,
        text: 'Operative Vital Telemetry',
        rect: {
          xPct: 33,
          yPct: 27,
          widthPct: 34,
          heightPct: 7,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          bgColorRgba: 'rgba(30, 41, 59, 0.65)',
          borderColorHex: theme.surfaceBorderHex,
          borderWidthPx: 1,
          fontSizePx: 12,
          fontWeight: 600,
        }),
        statBinding: {
          source: 'health',
          formatTemplate: 'Vitals: {health} HP  ·  Ammo: {ammo}  ·  Kills: {kills}',
        },
      },
      {
        id: 'w-pause-btn-resume',
        name: 'Resume Mission Button',
        type: 'button',
        visible: true,
        text: 'Resume Game',
        iconId: 'resume',
        rect: {
          xPct: 33,
          yPct: 36,
          widthPct: 34,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(true, false),
        onClickAction: { type: 'RESUME_GAME' },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-pause-btn-inventory',
        name: 'Open Tactical Inventory Button',
        type: 'button',
        visible: true,
        text: 'Inventory & Status [I]',
        iconId: 'backpack',
        rect: {
          xPct: 33,
          yPct: 46,
          widthPct: 34,
          heightPct: 7.5,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: {
          type: 'OPEN_MENU_SCREEN',
          screenId: 'screen-inventory-overlay',
          pushHistory: true,
        },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-pause-btn-save',
        name: 'Save / Load Checkpoints Button',
        type: 'button',
        visible: true,
        text: 'Save / Load Game',
        iconId: 'save',
        rect: {
          xPct: 33,
          yPct: 55.5,
          widthPct: 34,
          heightPct: 7.5,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: {
          type: 'OPEN_MENU_SCREEN',
          screenId: 'screen-save-slots',
          pushHistory: true,
        },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-pause-btn-settings',
        name: 'Settings Button',
        type: 'button',
        visible: true,
        text: 'Options & Controls',
        iconId: 'settings',
        rect: {
          xPct: 33,
          yPct: 65,
          widthPct: 34,
          heightPct: 7.5,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: {
          type: 'OPEN_MENU_SCREEN',
          screenId: 'screen-options',
          pushHistory: true,
        },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-pause-btn-restart',
        name: 'Restart Sector Button',
        type: 'button',
        visible: true,
        text: 'Restart Sector',
        iconId: 'restart',
        rect: {
          xPct: 33,
          yPct: 74.5,
          widthPct: 16.5,
          heightPct: 7.5,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
        onClickAction: { type: 'RESTART_CURRENT_LEVEL' },
        clickSoundId: 'switch_use',
      },
      {
        id: 'w-pause-btn-quit',
        name: 'Quit to Title Button',
        type: 'button',
        visible: true,
        text: 'Title Screen',
        iconId: 'quit',
        rect: {
          xPct: 50.5,
          yPct: 74.5,
          widthPct: 16.5,
          heightPct: 7.5,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, true),
        onClickAction: { type: 'QUIT_TO_MAIN_MENU' },
        clickSoundId: 'switch_use',
      },
    ],
  };

  // 5. In-Game Inventory & Mission Hub Overlay (Triggered on [I] or [Tab])
  const inventoryOverlayScreen: MenuScreenSpec = {
    id: 'screen-inventory-overlay',
    name: 'Inventory & Mission Hub [I]',
    category: 'in-game-overlay',
    overlayConfig: {
      triggerHotkey: 'KeyI',
      pauseSimulation: true,
      hideCombatHud: false,
      dimOpacity: 0.65,
      dimColorHex: '#090d16',
      backdropBlurPx: 4,
      scanlineEffect: options.scanlines,
    },
    backgroundConfig: {
      type: 'solid',
      colorHex: '#090d16',
      showCyberGrid: false,
    },
    widgets: [
      {
        id: 'w-inv-panel',
        name: 'Inventory Hub Panel',
        type: 'panel',
        visible: true,
        rect: {
          xPct: 18,
          yPct: 14,
          widthPct: 64,
          heightPct: 72,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: panelStyle,
      },
      {
        id: 'w-inv-title',
        name: 'Inventory Hub Header',
        type: 'title-text',
        visible: true,
        text: 'TACTICAL INVENTORY & SECTOR STATUS',
        subtitleText: 'Collected Security Keycards, Weapons & Mission Telemetry',
        rect: {
          xPct: 22,
          yPct: 18,
          widthPct: 56,
          heightPct: 10,
          anchor: 'top-left',
          zIndex: 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 20,
          fontWeight: 800,
          textAlign: 'left',
          textColorHex: '#ffffff',
        }),
      },
      {
        id: 'w-inv-grid',
        name: 'Keycards & Loadout Grid',
        type: 'inventory-grid',
        visible: true,
        text: 'Equipped Loadout & Security Clearance',
        rect: {
          xPct: 22,
          yPct: 30,
          widthPct: 56,
          heightPct: 32,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(false, false),
      },
      {
        id: 'w-inv-secrets-stat',
        name: 'Sector Progress Readout',
        type: 'stat-readout',
        visible: true,
        text: 'Sector Telemetry',
        rect: {
          xPct: 22,
          yPct: 64,
          widthPct: 56,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          bgColorRgba: 'rgba(15, 23, 42, 0.8)',
          borderColorHex: theme.surfaceBorderHex,
          borderWidthPx: 1,
          fontSizePx: 13,
          fontWeight: 600,
        }),
        statBinding: {
          source: 'secrets',
          formatTemplate:
            'Sector: {level}  ·  Hostiles Eliminated: {kills}  ·  Secrets Discovered: {secrets}',
        },
      },
      {
        id: 'w-inv-close-btn',
        name: 'Close Inventory Button',
        type: 'button',
        visible: true,
        text: 'Resume Combat',
        iconId: 'resume',
        rect: {
          xPct: 22,
          yPct: 74,
          widthPct: 56,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: 3,
        },
        style: btnStyle(true, false),
        onClickAction: { type: 'RESUME_GAME' },
        clickSoundId: 'switch_use',
      },
    ],
  };

  return [
    mainMenuScreen,
    optionsScreen,
    saveSlotsScreen,
    pauseOverlayScreen,
    inventoryOverlayScreen,
  ];
}

export const MENU_STUDIO_PRESETS: MenuPresetDefinition[] = [
  {
    id: 'tactical-gridforge',
    name: 'GridForge Tactical Command (3D Diorama)',
    description:
      'Orbiting 3D level diorama backdrop with chamfered sci-fi command buttons, pause overlay, and tactical inventory hub.',
    buildPack: (gameTitle = 'GRIDFORGE 3D') => {
      const theme: MenuThemeTokens = {
        primaryAccentHex: '#4ec9b0',
        dangerAccentHex: '#d14d41',
        surfaceBgRgba: 'rgba(30, 34, 42, 0.90)',
        surfaceBorderHex: '#3e3e42',
        textPrimaryHex: '#e5e5e5',
        textMutedHex: '#94a3b8',
        defaultFontFamily: 'mono',
      };
      return {
        schemaVersion: 1,
        presetId: 'tactical-gridforge',
        enableMainMenuOnBoot: true,
        enablePauseOverlay: true,
        entryMainMenuScreenId: 'screen-main-menu',
        pauseOverlayScreenId: 'screen-pause-overlay',
        theme,
        screens: buildScreensForTheme(theme, {
          gameTitle: gameTitle.toUpperCase(),
          subtitle: 'Tactical First-Person Combat Simulation',
          buttonShape: 'chamfered',
          mainBg: {
            type: '3d-scene',
            levelIndex: 0,
            cameraMode: 'orbit',
            cameraTarget: { row: 4, col: 4, elevationMeters: 1.8 },
            orbitRadiusMeters: 12,
            orbitSpeedRadPerSec: 0.22,
            fov: 70,
            tintOverlayRgba: 'rgba(8, 12, 20, 0.38)',
          },
          scanlines: true,
        }),
      };
    },
  },
  {
    id: 'retro-shareware',
    name: '90s Shareware Techbase (Tiled Texture BG)',
    description:
      'Classic early-90s shareware shooter aesthetic with riveted steel texture background, amber/crimson accents, and pixel-mono typography.',
    buildPack: (gameTitle = 'TECHBASE') => {
      const theme: MenuThemeTokens = {
        primaryAccentHex: '#f59e0b',
        dangerAccentHex: '#ef4444',
        surfaceBgRgba: 'rgba(24, 20, 18, 0.92)',
        surfaceBorderHex: '#78350f',
        textPrimaryHex: '#fef3c7',
        textMutedHex: '#d97706',
        defaultFontFamily: 'pixel',
      };
      return {
        schemaVersion: 1,
        presetId: 'retro-shareware',
        enableMainMenuOnBoot: true,
        enablePauseOverlay: true,
        entryMainMenuScreenId: 'screen-main-menu',
        pauseOverlayScreenId: 'screen-pause-overlay',
        theme,
        screens: buildScreensForTheme(theme, {
          gameTitle: gameTitle.toUpperCase(),
          subtitle: 'Episode 1: Knee-Deep in the Grid',
          buttonShape: 'rectangle',
          mainBg: {
            type: 'image',
            textureId: 'techbase-panel',
            fitMode: 'tile',
            tintHex: '#1c1917',
            vignetteStrength: 0.75,
          },
          scanlines: true,
        }),
      };
    },
  },
  {
    id: 'minimal-cyber',
    name: 'Minimalist Obsidian Slate (Clean UI)',
    description:
      'High-contrast geometric layout over an animated cyber grid backdrop with rounded controls and crisp sans-serif typography.',
    buildPack: (gameTitle = 'SECTOR ZERO') => {
      const theme: MenuThemeTokens = {
        primaryAccentHex: '#38bdf8',
        dangerAccentHex: '#f43f5e',
        surfaceBgRgba: 'rgba(15, 23, 42, 0.88)',
        surfaceBorderHex: '#334155',
        textPrimaryHex: '#f8fafc',
        textMutedHex: '#94a3b8',
        defaultFontFamily: 'sans',
      };
      return {
        schemaVersion: 1,
        presetId: 'minimal-cyber',
        enableMainMenuOnBoot: true,
        enablePauseOverlay: true,
        entryMainMenuScreenId: 'screen-main-menu',
        pauseOverlayScreenId: 'screen-pause-overlay',
        theme,
        screens: buildScreensForTheme(theme, {
          gameTitle: gameTitle.toUpperCase(),
          subtitle: 'Autonomous Extraction Protocol',
          buttonShape: 'rounded',
          mainBg: {
            type: 'solid',
            colorHex: '#090d16',
            gradientEndHex: '#0f172a',
            showCyberGrid: true,
          },
          scanlines: false,
        }),
      };
    },
  },
];

export function createMenuPackFromPreset(
  presetId: string,
  gameTitle?: string
): MenuPackSpec {
  const found =
    MENU_STUDIO_PRESETS.find((p) => p.id === presetId) || MENU_STUDIO_PRESETS[0];
  return cloneMenuPackSpec(found.buildPack(gameTitle));
}

export function createDefaultMenuPack(gameTitle?: string): MenuPackSpec {
  return cloneMenuPackSpec(MENU_STUDIO_PRESETS[0].buildPack(gameTitle));
}

export function createNewMenuWidget(
  type: MenuWidgetSpec['type'],
  theme: MenuThemeTokens,
  existingCount: number,
  dropPosition?: { xPct: number; yPct: number }
): MenuWidgetSpec {
  const id = `widget-${type}-${Date.now().toString(36)}-${existingCount + 1}`;
  const staggerPct = Math.min(20, (existingCount % 6) * 3);
  const applyDrop = (defaultRect: MenuWidgetSpec['rect']): MenuWidgetSpec['rect'] => {
    if (!dropPosition) return defaultRect;
    return {
      ...defaultRect,
      xPct: Math.max(0, Math.min(100 - defaultRect.widthPct, Math.round((dropPosition.xPct - defaultRect.widthPct / 2) * 10) / 10)),
      yPct: Math.max(0, Math.min(100 - defaultRect.heightPct, Math.round((dropPosition.yPct - defaultRect.heightPct / 2) * 10) / 10)),
    };
  };

  switch (type) {
    case 'title-text':
      return {
        id,
        name: `Title Text ${existingCount + 1}`,
        type: 'title-text',
        visible: true,
        text: 'SECTOR BRIEFING',
        subtitleText: 'Optional subtitle or directive text',
        rect: {
          xPct: 25 + staggerPct,
          yPct: 20 + staggerPct,
          widthPct: 40,
          heightPct: 10,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rectangle',
          bgColorRgba: 'rgba(0,0,0,0)',
          borderWidthPx: 0,
          fontSizePx: 24,
          fontWeight: 800,
          textAlign: 'center',
        }),
      };
    case 'panel':
      return {
        id,
        name: `Frame Panel ${existingCount + 1}`,
        type: 'panel',
        visible: true,
        rect: {
          xPct: 20 + staggerPct,
          yPct: 18 + staggerPct,
          widthPct: 45,
          heightPct: 50,
          anchor: 'top-left',
          zIndex: 1,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'chamfered',
          bgColorRgba: 'rgba(15, 19, 26, 0.85)',
          borderColorHex: theme.surfaceBorderHex,
          borderWidthPx: 1,
        }),
      };
    case 'image':
      return {
        id,
        name: `Banner / Logo ${existingCount + 1}`,
        type: 'image',
        visible: true,
        text: 'SECTOR INSIGNIA',
        imageTextureId: 'default-grid',
        rect: {
          xPct: 35 + staggerPct,
          yPct: 22 + staggerPct,
          widthPct: 24,
          heightPct: 20,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          borderRadiusPx: 6,
          borderColorHex: theme.primaryAccentHex,
          borderWidthPx: 1,
        }),
      };
    case 'stat-readout':
      return {
        id,
        name: `Telemetry Readout ${existingCount + 1}`,
        type: 'stat-readout',
        visible: true,
        text: 'Player Status',
        rect: {
          xPct: 28 + staggerPct,
          yPct: 30 + staggerPct,
          widthPct: 38,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          bgColorRgba: 'rgba(15, 23, 42, 0.85)',
          fontSizePx: 13,
          fontWeight: 600,
        }),
        statBinding: {
          source: 'health',
          formatTemplate: 'Health: {health} HP  ·  Ammo: {ammo}',
        },
      };
    case 'inventory-grid':
      return {
        id,
        name: `Inventory Grid ${existingCount + 1}`,
        type: 'inventory-grid',
        visible: true,
        text: 'Collected Keycards & Gear',
        rect: {
          xPct: 24 + staggerPct,
          yPct: 28 + staggerPct,
          widthPct: 48,
          heightPct: 28,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          fontSizePx: 13,
        }),
      };
    case 'slider-setting':
      return {
        id,
        name: `Setting Slider ${existingCount + 1}`,
        type: 'slider-setting',
        visible: true,
        text: 'Master Audio Gain',
        rect: {
          xPct: 28 + staggerPct,
          yPct: 35 + staggerPct,
          widthPct: 40,
          heightPct: 9,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          fontSizePx: 13,
        }),
        settingBinding: {
          target: 'masterVolume',
          min: 0,
          max: 100,
          step: 5,
        },
      };
    case 'toggle-setting':
      return {
        id,
        name: `Setting Toggle ${existingCount + 1}`,
        type: 'toggle-setting',
        visible: true,
        text: 'Show Tactical Minimap',
        rect: {
          xPct: 28 + staggerPct,
          yPct: 45 + staggerPct,
          widthPct: 40,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          fontSizePx: 13,
        }),
        settingBinding: {
          target: 'minimapEnabled',
        },
      };
    case 'save-slot-list':
      return {
        id,
        name: `Save Slots ${existingCount + 1}`,
        type: 'save-slot-list',
        visible: true,
        text: 'Checkpoint Slots',
        rect: {
          xPct: 24 + staggerPct,
          yPct: 26 + staggerPct,
          widthPct: 48,
          heightPct: 38,
          anchor: 'top-left',
          zIndex: existingCount + 2,
        },
        style: createBaseWidgetStyle(theme, {
          shape: 'rounded',
          fontSizePx: 13,
        }),
      };
    case 'button':
    default:
      return {
        id,
        name: `Action Button ${existingCount + 1}`,
        type: 'button',
        visible: true,
        text: 'Action Button',
        iconId: 'play',
        rect: applyDrop({
          xPct: 32 + staggerPct,
          yPct: 40 + staggerPct,
          widthPct: 32,
          heightPct: 8,
          anchor: 'top-left',
          zIndex: existingCount + 3,
        }),
        style: createBaseWidgetStyle(theme, {
          shape: 'chamfered',
        }),
        onClickAction: { type: 'RESUME_GAME' },
        clickSoundId: 'switch_use',
      };
  }
}
