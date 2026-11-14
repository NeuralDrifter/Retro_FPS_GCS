import type { MenuButtonShape, MenuScreenSpec, MenuThemeTokens, MenuWidgetVisualStyle } from './types';

/** What every built-in screen builder needs from its preset */
export interface ScreenKit {
  theme: MenuThemeTokens;
  options: {
    gameTitle: string;
    subtitle: string;
    buttonShape: MenuButtonShape;
    mainBg: MenuScreenSpec['backgroundConfig'];
    scanlines: boolean;
  };
  btnStyle: (primary?: boolean, danger?: boolean) => MenuWidgetVisualStyle;
  panelStyle: MenuWidgetVisualStyle;
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
