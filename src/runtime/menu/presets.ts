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
import { createBaseWidgetStyle, type ScreenKit } from './presetScreenKit';
export { createBaseWidgetStyle } from './presetScreenKit';
import { buildMainMenuScreen, buildOptionsScreen, buildSaveSlotsScreen } from './presetScreens.outOfGame';
import { buildInventoryOverlayScreen, buildPauseOverlayScreen } from './presetScreens.inGame';

export interface MenuPresetDefinition {
  id: string;
  name: string;
  description: string;
  buildPack: (gameTitle?: string) => MenuPackSpec;
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

  const kit: ScreenKit = { theme, options, btnStyle, panelStyle };
  const mainMenuScreen = buildMainMenuScreen(kit);

  const optionsScreen = buildOptionsScreen(kit);

  const saveSlotsScreen = buildSaveSlotsScreen(kit);

  const pauseOverlayScreen = buildPauseOverlayScreen(kit);

  const inventoryOverlayScreen = buildInventoryOverlayScreen(kit);

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
