/**
 * ============================================================================
 * PURE VANILLA DOM MENU RENDERER (`/src/runtime/menu/MenuDOMRenderer.ts`)
 * ============================================================================
 * Zero React or Lucide dependencies. Renders any `MenuScreenSpec` (Out-of-Game
 * Main Menu, Sub-Menu, or In-Game Overlay) inside a normalized stage container.
 * Shared 1:1 between the Menu Studio WYSIWYG canvas, Test Play, and exported
 * standalone HTML / ZIP games.
 */

import { AssetRegistry } from '../AssetRegistry';
import { TextureGenerator } from '../TextureGenerator';
import { PlayerCombatState, TextureAsset } from '../types';
import { SimulationState } from '../sim';
import {
  DEFAULT_MENU_RUNTIME_SETTINGS,
  MenuAction,
  MenuIconId,
  MenuRuntimeSettings,
  MenuSaveSlotSummary,
  MenuScreenSpec,
  MenuSettingTarget,
  MenuWidgetSpec,
  MenuWidgetVisualStyle,
  resolveMenuFontFamilyCss,
} from './types';

export interface MenuRenderRuntimeContext {
  combatState?: PlayerCombatState;
  simState?: SimulationState;
  currentLevelIndex?: number;
  totalLevels?: number;
  currentLevelTitle?: string;
  elapsedSeconds?: number;
  settings?: MenuRuntimeSettings;
  saveSlots?: MenuSaveSlotSummary[];
  customTextures?: TextureAsset[];
  statusToast?: string | null;
}

export interface MenuDOMRendererCallbacks {
  onTriggerAction?: (action: MenuAction, widget: MenuWidgetSpec) => void;
  onChangeSetting?: (target: MenuSettingTarget, value: number | boolean) => void;
  onSaveSlot?: (slotIndex: number) => void;
  onLoadSlot?: (slotIndex: number) => void;
  onPlaySound?: (soundId: string) => void;
  /** Editor-only hook when clicking a widget in Menu Studio */
  onSelectWidgetInEditor?: (widgetId: string, e: MouseEvent) => void;
}

const MENU_SVG_ICONS: Record<MenuIconId, string> = {
  none: '',
  play: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  resume: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  settings: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  save: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  load: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  restart: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  quit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  skull: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  exit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  back: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  key: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  shield: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  crosshair: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  backpack: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>',
};

let cachedBuiltInPreviewMap: Map<string, string> | null = null;

export function resolveMenuTexturePreviewUrl(
  textureId: string | undefined,
  customTextures?: TextureAsset[]
): string | null {
  if (!textureId) return null;
  if (customTextures) {
    const found = customTextures.find((t) => t.id === textureId);
    if (found?.previewUrl) return found.previewUrl;
  }
  const reg = AssetRegistry.getTexture(textureId);
  if (reg?.previewUrl) return reg.previewUrl;

  if (typeof document !== 'undefined') {
    if (!cachedBuiltInPreviewMap) {
      cachedBuiltInPreviewMap = new Map();
      try {
        const builtIns = TextureGenerator.getBuiltInTextureAssets();
        for (const b of builtIns) {
          if (b.previewUrl) cachedBuiltInPreviewMap.set(b.id, b.previewUrl);
        }
      } catch {
        // Ignore in headless environments without 2D canvas
      }
    }
    const builtInUrl = cachedBuiltInPreviewMap.get(textureId);
    if (builtInUrl) return builtInUrl;
  }
  return null;
}

export function formatStatReadoutText(
  widget: MenuWidgetSpec,
  ctx: MenuRenderRuntimeContext
): string {
  const health = Math.round(ctx.combatState?.health ?? 100);
  const maxHealth = Math.round(ctx.combatState?.maxHealth ?? 100);
  const ammo = Math.round(ctx.combatState?.ammo ?? 32);
  const kills = Math.round(ctx.combatState?.kills ?? 0);
  const totalEnemies = Math.round(ctx.combatState?.totalEnemies ?? 0);
  const secrets = Math.round(ctx.simState?.secretsFound ?? 0);
  const levelTitle =
    ctx.currentLevelTitle ||
    `Level ${(ctx.currentLevelIndex ?? 0) + 1}`;
  const secs = Math.floor(
    ctx.elapsedSeconds ??
      (ctx.simState ? ctx.simState.tick / 35 : 0)
  );
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const timeStr = `${mm}:${ss}`;

  const binding = widget.statBinding;
  if (!binding) return widget.text || '';

  let rawValue = '';
  switch (binding.source) {
    case 'health':
      rawValue = `${health}/${maxHealth}`;
      break;
    case 'ammo':
      rawValue = `${ammo}`;
      break;
    case 'kills':
      rawValue = `${kills}/${totalEnemies}`;
      break;
    case 'secrets':
      rawValue = `${secrets}`;
      break;
    case 'level-title':
      rawValue = levelTitle;
      break;
    case 'time':
      rawValue = timeStr;
      break;
    case 'sim-flag': {
      const k = binding.variableKey || '';
      const flagVal = ctx.simState?.flags?.[k] ?? false;
      rawValue = flagVal ? 'ACTIVE' : 'INACTIVE';
      break;
    }
    case 'sim-counter': {
      const k = binding.variableKey || '';
      const countVal = ctx.simState?.counters?.[k] ?? 0;
      rawValue = String(countVal);
      break;
    }
  }

  if (binding.formatTemplate && binding.formatTemplate.trim()) {
    return binding.formatTemplate
      .replace(/\{value\}/gi, rawValue)
      .replace(/\{health\}/gi, String(health))
      .replace(/\{maxHealth\}/gi, String(maxHealth))
      .replace(/\{ammo\}/gi, String(ammo))
      .replace(/\{kills\}/gi, `${kills}/${totalEnemies}`)
      .replace(/\{secrets\}/gi, String(secrets))
      .replace(/\{level\}/gi, levelTitle)
      .replace(/\{time\}/gi, timeStr);
  }

  return `${widget.text ? `${widget.text}: ` : ''}${rawValue}`;
}

export class MenuDOMRenderer {
  private mountRoot: HTMLElement;
  private rootEl: HTMLDivElement;
  private backdropEl: HTMLDivElement;
  private scanlineEl: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private callbacks: MenuDOMRendererCallbacks;
  private editorMode = false;

  constructor(
    mountRoot: HTMLElement,
    callbacks: MenuDOMRendererCallbacks = {},
    options?: { editorMode?: boolean }
  ) {
    this.mountRoot = mountRoot;
    this.callbacks = callbacks;
    this.editorMode = Boolean(options?.editorMode);

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'forgecore-menu-root';
    this.rootEl.setAttribute('data-forgecore-menu', 'true');
    this.rootEl.style.cssText =
      'position:absolute;inset:0;z-index:35;display:none;overflow:hidden;user-select:none;pointer-events:auto;';

    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'forgecore-menu-backdrop';
    this.backdropEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;transition:opacity 150ms ease;';

    this.scanlineEl = document.createElement('div');
    this.scanlineEl.className = 'forgecore-menu-scanlines';
    this.scanlineEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:none;background:repeating-linear-gradient(to bottom, rgba(255,255,255,0) 0px, rgba(255,255,255,0) 2px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 4px);z-index:2;';

    this.stageEl = document.createElement('div');
    this.stageEl.className = 'forgecore-menu-stage';
    this.stageEl.style.cssText =
      'position:relative;width:100%;height:100%;z-index:3;overflow:hidden;';

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'forgecore-menu-toast';
    this.toastEl.style.cssText =
      'position:absolute;bottom:18px;left:50%;transform:translateX(-50%);z-index:20;padding:6px 14px;background:rgba(15,23,42,0.95);border:1px solid #4ec9b0;color:#e2e8f0;font-family:"JetBrains Mono",monospace;font-size:11px;border-radius:4px;display:none;pointer-events:none;box-shadow:0 8px 20px rgba(0,0,0,0.5);';

    this.rootEl.append(
      this.backdropEl,
      this.scanlineEl,
      this.stageEl,
      this.toastEl
    );
    this.mountRoot.appendChild(this.rootEl);
  }

  public setVisible(visible: boolean): void {
    this.rootEl.style.display = visible ? 'block' : 'none';
  }

  public isVisible(): boolean {
    return this.rootEl.style.display !== 'none';
  }

  public getRootElement(): HTMLDivElement {
    return this.rootEl;
  }

  public getStageElement(): HTMLDivElement {
    return this.stageEl;
  }

  public render(
    screen: MenuScreenSpec | null,
    context: MenuRenderRuntimeContext = {}
  ): void {

    if (!screen) {
      this.setVisible(false);
      return;
    }

    this.setVisible(true);
    this.applyScreenBackdrop(screen, context);
    this.renderWidgets(screen, context);

    if (context.statusToast) {
      this.toastEl.textContent = context.statusToast;
      this.toastEl.style.display = 'block';
    } else {
      this.toastEl.style.display = 'none';
    }
  }

  private applyScreenBackdrop(
    screen: MenuScreenSpec,
    context: MenuRenderRuntimeContext
  ): void {
    const isOverlay = screen.category === 'in-game-overlay';
    if (isOverlay && screen.overlayConfig) {
      const cfg = screen.overlayConfig;
      const hex = cfg.dimColorHex || '#070a10';
      const opacity = Math.max(0, Math.min(1, cfg.dimOpacity ?? 0.7));
      const blur = Math.max(0, Math.min(24, cfg.backdropBlurPx ?? 4));
      this.backdropEl.style.background = hex;
      this.backdropEl.style.opacity = String(opacity);
      this.rootEl.style.backdropFilter = blur > 0 ? `blur(${blur}px)` : 'none';
      this.scanlineEl.style.display = cfg.scanlineEffect ? 'block' : 'none';
      return;
    }

    this.rootEl.style.backdropFilter = 'none';
    this.scanlineEl.style.display = 'none';
    const bg = screen.backgroundConfig;

    if (bg.type === 'solid') {
      this.backdropEl.style.opacity = '1';
      if (bg.showCyberGrid) {
        const baseColor = bg.colorHex || '#090d16';
        const endColor = bg.gradientEndHex || '#0f172a';
        this.backdropEl.style.background = `
          linear-gradient(rgba(56, 189, 248, 0.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(56, 189, 248, 0.07) 1px, transparent 1px),
          radial-gradient(circle at 50% 35%, ${endColor}, ${baseColor})
        `;
        this.backdropEl.style.backgroundSize = '36px 36px, 36px 36px, 100% 100%';
      } else if (bg.gradientEndHex) {
        this.backdropEl.style.background = `linear-gradient(135deg, ${bg.colorHex} 0%, ${bg.gradientEndHex} 100%)`;
      } else {
        this.backdropEl.style.background = bg.colorHex || '#090d16';
      }
      return;
    }

    if (bg.type === 'image') {
      this.backdropEl.style.opacity = '1';
      const texUrl = resolveMenuTexturePreviewUrl(
        bg.textureId,
        context.customTextures
      );
      const vignetteAlpha = Math.max(0, Math.min(0.95, bg.vignetteStrength ?? 0.6));
      if (texUrl) {
        const sizeRule =
          bg.fitMode === 'tile'
            ? '128px 128px'
            : bg.fitMode === 'contain'
            ? 'contain'
            : 'cover';
        const repeatRule = bg.fitMode === 'tile' ? 'repeat' : 'no-repeat';
        this.backdropEl.style.background = `
          radial-gradient(circle at center, rgba(0,0,0,${vignetteAlpha * 0.35}) 0%, rgba(0,0,0,${vignetteAlpha}) 100%),
          url("${texUrl}") center center / ${sizeRule} ${repeatRule}
        `;
        this.backdropEl.style.backgroundColor = bg.tintHex || '#090d16';
      } else {
        this.backdropEl.style.background = bg.tintHex || '#090d16';
      }
      return;
    }

    if (bg.type === '3d-scene') {
      // In runtime mode, the live Three.js canvas renders underneath this menu root.
      // In editor preview mode (when no 3D canvas is mounted behind), show a subtle tint.
      this.backdropEl.style.opacity = '1';
      this.backdropEl.style.background =
        bg.tintOverlayRgba || 'rgba(8, 12, 20, 0.36)';
    }
  }

  private applyWidgetVisualStyle(
    el: HTMLElement,
    style: MenuWidgetVisualStyle,
    state: 'default' | 'hover' | 'active',
    context: MenuRenderRuntimeContext
  ): void {
    const override =
      state === 'hover'
        ? style.hoverStyle
        : state === 'active'
        ? style.activeStyle
        : undefined;

    const bgColor = override?.bgColorRgba ?? style.bgColorRgba;
    const borderColor = override?.borderColorHex ?? style.borderColorHex;
    const textColor = override?.textColorHex ?? style.textColorHex;
    const texId = override?.backgroundTextureId ?? style.backgroundTextureId;
    const scale = override?.scaleMultiplier ?? 1;

    el.style.backgroundColor = bgColor;
    el.style.color = textColor;
    el.style.fontFamily = resolveMenuFontFamilyCss(style.fontFamily);
    el.style.fontSize = `${style.fontSizePx}px`;
    el.style.fontWeight = String(style.fontWeight);
    el.style.letterSpacing = `${style.letterSpacingEm}em`;
    el.style.textTransform = style.textTransform;
    el.style.textAlign = style.textAlign;

    if (style.textShadowHex) {
      el.style.textShadow = `0 0 16px ${style.textShadowHex}`;
    } else {
      el.style.textShadow = 'none';
    }

    // Shape & Borders
    el.style.clipPath = 'none';
    el.style.borderRadius = '0px';
    el.style.border =
      style.borderWidthPx > 0
        ? `${style.borderWidthPx}px solid ${borderColor}`
        : 'none';

    if (style.shape === 'rounded') {
      el.style.borderRadius = `${style.borderRadiusPx}px`;
    } else if (style.shape === 'pill') {
      el.style.borderRadius = '9999px';
    } else if (style.shape === 'underline') {
      el.style.border = 'none';
      el.style.borderBottom = `${Math.max(2, style.borderWidthPx)}px solid ${borderColor}`;
    } else if (style.shape === 'chamfered') {
      const c = Math.max(4, style.chamferSizePx || 10);
      el.style.clipPath = `polygon(${c}px 0%, 100% 0%, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, 0% 100%, 0% ${c}px)`;
    }

    // Optional Texture Skin
    const texUrl = resolveMenuTexturePreviewUrl(texId, context.customTextures);
    if (texUrl) {
      const fit = style.textureFit || 'stretch';
      el.style.backgroundImage = `linear-gradient(${bgColor}, ${bgColor}), url("${texUrl}")`;
      el.style.backgroundSize =
        fit === 'tile' ? '64px 64px' : '100% 100%';
      el.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
    } else {
      el.style.backgroundImage = 'none';
    }

    if (scale !== 1 && !this.editorMode) {
      el.style.transform = `scale(${scale})`;
    } else {
      el.style.transform = 'none';
    }
  }

  private renderWidgets(
    screen: MenuScreenSpec,
    context: MenuRenderRuntimeContext
  ): void {
    this.stageEl.innerHTML = '';

    const sortedWidgets = [...screen.widgets]
      .filter((w) => w.visible !== false)
      .sort((a, b) => (a.rect.zIndex ?? 1) - (b.rect.zIndex ?? 1));

    for (const widget of sortedWidgets) {
      const node = this.buildWidgetElement(widget, context);
      this.stageEl.appendChild(node);
    }
  }

  private buildWidgetElement(
    widget: MenuWidgetSpec,
    context: MenuRenderRuntimeContext
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-menu-widget-id', widget.id);
    wrapper.setAttribute('data-menu-widget-type', widget.type);
    wrapper.style.cssText = `
      position: absolute;
      left: ${widget.rect.xPct}%;
      top: ${widget.rect.yPct}%;
      width: ${widget.rect.widthPct}%;
      height: ${widget.rect.heightPct}%;
      z-index: ${widget.rect.zIndex ?? 1};
      box-sizing: border-box;
      display: flex;
      transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
    `;

    this.applyWidgetVisualStyle(wrapper, widget.style, 'default', context);

    if (this.editorMode && this.callbacks.onSelectWidgetInEditor) {
      wrapper.addEventListener('mousedown', (e) => {
        this.callbacks.onSelectWidgetInEditor?.(widget.id, e);
      });
    }

    switch (widget.type) {
      case 'panel': {
        wrapper.style.pointerEvents = this.editorMode ? 'auto' : 'none';
        break;
      }

      case 'title-text': {
        wrapper.style.flexDirection = 'column';
        wrapper.style.justifyContent = 'center';
        wrapper.style.padding = '4px 8px';
        wrapper.style.pointerEvents = this.editorMode ? 'auto' : 'none';

        const heading = document.createElement('div');
        heading.style.cssText = 'line-height: 1.15; word-break: break-word;';
        heading.textContent = widget.text || '';
        wrapper.appendChild(heading);

        if (widget.subtitleText) {
          const sub = document.createElement('div');
          sub.style.cssText = `
            margin-top: 4px;
            font-size: ${Math.max(10, Math.round(widget.style.fontSizePx * 0.48))}px;
            font-weight: 500;
            opacity: 0.78;
            letter-spacing: 0.04em;
            text-Shadow: none;
          `;
          sub.textContent = widget.subtitleText;
          wrapper.appendChild(sub);
        }
        break;
      }

      case 'image': {
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'center';
        wrapper.style.overflow = 'hidden';
        const imgUrl = resolveMenuTexturePreviewUrl(
          widget.imageTextureId,
          context.customTextures
        );
        if (imgUrl) {
          const img = document.createElement('img');
          img.src = imgUrl;
          img.alt = widget.text || widget.name;
          img.style.cssText =
            'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
          wrapper.appendChild(img);
        } else {
          const fallback = document.createElement('span');
          fallback.textContent = widget.text || widget.name;
          fallback.style.cssText = 'font-size:11px;opacity:0.75;';
          wrapper.appendChild(fallback);
        }
        break;
      }

      case 'button': {
        wrapper.setAttribute('role', 'button');
        wrapper.tabIndex = 0;
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent =
          widget.style.textAlign === 'left'
            ? 'flex-start'
            : widget.style.textAlign === 'right'
            ? 'flex-end'
            : 'center';
        wrapper.style.gap = '8px';
        wrapper.style.padding = '0 16px';
        wrapper.style.cursor = 'pointer';

        if (widget.iconId && widget.iconId !== 'none') {
          const iconSpan = document.createElement('span');
          iconSpan.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
          iconSpan.innerHTML = MENU_SVG_ICONS[widget.iconId] || '';
          wrapper.appendChild(iconSpan);
        }

        const labelSpan = document.createElement('span');
        labelSpan.style.cssText =
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        labelSpan.textContent = widget.text || widget.name;
        wrapper.appendChild(labelSpan);

        wrapper.addEventListener('mouseenter', () => {
          this.applyWidgetVisualStyle(wrapper, widget.style, 'hover', context);
          if (!this.editorMode && widget.hoverSoundId) {
            this.callbacks.onPlaySound?.(widget.hoverSoundId);
          }
        });
        wrapper.addEventListener('mouseleave', () => {
          this.applyWidgetVisualStyle(
            wrapper,
            widget.style,
            'default',
            context
          );
        });
        wrapper.addEventListener('mousedown', () => {
          if (!this.editorMode) {
            this.applyWidgetVisualStyle(
              wrapper,
              widget.style,
              'active',
              context
            );
          }
        });
        wrapper.addEventListener('click', (e) => {
          if (this.editorMode) return;
          e.stopPropagation();
          if (widget.clickSoundId) {
            this.callbacks.onPlaySound?.(widget.clickSoundId);
          }
          if (widget.onClickAction) {
            this.callbacks.onTriggerAction?.(widget.onClickAction, widget);
          }
        });
        break;
      }

      case 'stat-readout': {
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent =
          widget.style.textAlign === 'left'
            ? 'flex-start'
            : widget.style.textAlign === 'right'
            ? 'flex-end'
            : 'center';
        wrapper.style.padding = '0 14px';
        wrapper.style.fontVariantNumeric = 'tabular-nums';
        wrapper.textContent = formatStatReadoutText(widget, context);
        break;
      }

      case 'inventory-grid': {
        wrapper.style.flexDirection = 'column';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.padding = '12px 14px';

        const header = document.createElement('div');
        header.style.cssText =
          'font-size:11px;opacity:0.8;text-align:left;letter-spacing:0.06em;';
        header.textContent = widget.text || 'TACTICAL LOADOUT & CLEARANCE';
        wrapper.appendChild(header);

        const gridRow = document.createElement('div');
        gridRow.style.cssText =
          'display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;flex:1;margin-top:8px;';

        const collectedKeys = context.simState?.collectedKeys ?? [];
        const hasKeycard = collectedKeys.length > 0;
        const ammoCount = Math.round(context.combatState?.ammo ?? 32);
        const hpCount = Math.round(context.combatState?.health ?? 100);

        const slots = [
          {
            title: 'Plasma Repeater',
            sub: `${ammoCount} Cells Loaded`,
            active: true,
            icon: MENU_SVG_ICONS.crosshair,
            accent: '#38bdf8',
          },
          {
            title: 'Security Keycard',
            sub: hasKeycard
              ? `Clearance Active (${collectedKeys.length})`
              : 'Not Acquired',
            active: hasKeycard,
            icon: MENU_SVG_ICONS.key,
            accent: hasKeycard ? '#facc15' : '#64748b',
          },
          {
            title: 'Exo-Armor Suit',
            sub: `Integrity ${hpCount}%`,
            active: hpCount > 0,
            icon: MENU_SVG_ICONS.shield,
            accent: '#4ec9b0',
          },
        ];

        for (const item of slots) {
          const card = document.createElement('div');
          card.style.cssText = `
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            padding:8px;
            background:rgba(15,23,42,0.75);
            border:1px solid ${item.active ? item.accent : '#334155'};
            border-radius:4px;
            opacity:${item.active ? '1' : '0.55'};
            gap:4px;
          `;
          const iconWrap = document.createElement('div');
          iconWrap.style.cssText = `color:${item.accent};display:flex;align-items:center;`;
          iconWrap.innerHTML = item.icon;

          const nameEl = document.createElement('div');
          nameEl.style.cssText =
            'font-size:11px;font-weight:700;color:#f8fafc;text-align:center;';
          nameEl.textContent = item.title;

          const subEl = document.createElement('div');
          subEl.style.cssText =
            'font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums;text-align:center;';
          subEl.textContent = item.sub;

          card.append(iconWrap, nameEl, subEl);
          gridRow.appendChild(card);
        }

        wrapper.appendChild(gridRow);
        break;
      }

      case 'slider-setting': {
        wrapper.style.flexDirection = 'row';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.padding = '0 16px';
        wrapper.style.gap = '12px';

        const target: MenuSettingTarget =
          widget.settingBinding?.target || 'masterVolume';
        const min = widget.settingBinding?.min ?? 0;
        const max = widget.settingBinding?.max ?? 100;
        const step = widget.settingBinding?.step ?? 5;
        const settings = context.settings || DEFAULT_MENU_RUNTIME_SETTINGS;
        const currentVal = Number(
          settings[target] ?? DEFAULT_MENU_RUNTIME_SETTINGS[target]
        );

        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px;white-space:nowrap;';
        label.textContent = widget.text || target;

        const rightBox = document.createElement('div');
        rightBox.style.cssText =
          'display:flex;align-items:center;gap:10px;width:52%;';

        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(currentVal);
        input.style.cssText = 'flex:1;cursor:pointer;accent-color:#4ec9b0;';

        const valReadout = document.createElement('span');
        valReadout.style.cssText =
          'font-size:12px;font-variant-numeric:tabular-nums;min-width:42px;text-align:right;';
        valReadout.textContent =
          target === 'fov' ? `${currentVal}°` : `${currentVal}%`;

        input.addEventListener('input', (e) => {
          if (this.editorMode) return;
          e.stopPropagation();
          const nextNum = Number(input.value);
          valReadout.textContent =
            target === 'fov' ? `${nextNum}°` : `${nextNum}%`;
          this.callbacks.onChangeSetting?.(target, nextNum);
        });

        rightBox.append(input, valReadout);
        wrapper.append(label, rightBox);
        break;
      }

      case 'toggle-setting': {
        wrapper.style.flexDirection = 'row';
        wrapper.style.alignItems = 'center';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.padding = '0 16px';
        wrapper.style.cursor = 'pointer';

        const target: MenuSettingTarget =
          widget.settingBinding?.target || 'minimapEnabled';
        const settings = context.settings || DEFAULT_MENU_RUNTIME_SETTINGS;
        const isOn = Boolean(settings[target]);

        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px;';
        label.textContent = widget.text || target;

        const statusText = document.createElement('span');
        statusText.style.cssText = `
          font-size:11px;
          font-weight:700;
          color:${isOn ? '#4ec9b0' : '#94a3b8'};
          font-variant-numeric:tabular-nums;
        `;
        statusText.textContent = isOn ? '[ ENABLED ]' : '[ DISABLED ]';

        wrapper.addEventListener('click', (e) => {
          if (this.editorMode) return;
          e.stopPropagation();
          this.callbacks.onChangeSetting?.(target, !isOn);
        });

        wrapper.append(label, statusText);
        break;
      }

      case 'save-slot-list': {
        wrapper.style.flexDirection = 'column';
        wrapper.style.justifyContent = 'space-between';
        wrapper.style.padding = '10px 12px';
        wrapper.style.gap = '8px';

        const slots: MenuSaveSlotSummary[] = context.saveSlots || [
          { slotIndex: 1, occupied: false },
          { slotIndex: 2, occupied: false },
          { slotIndex: 3, occupied: false },
        ];

        for (const slot of slots) {
          const row = document.createElement('div');
          row.style.cssText = `
            display:flex;
            align-items:center;
            justify-content:space-between;
            padding:8px 12px;
            background:rgba(15,23,42,0.82);
            border:1px solid ${slot.occupied ? '#38bdf8' : '#334155'};
            border-radius:4px;
            flex:1;
          `;

          const info = document.createElement('div');
          info.style.cssText =
            'display:flex;flex-direction:column;align-items:flex-start;gap:2px;';

          const titleLine = document.createElement('div');
          titleLine.style.cssText =
            'font-size:12px;font-weight:700;color:#f8fafc;';
          titleLine.textContent = slot.occupied
            ? `Slot ${slot.slotIndex}: ${slot.levelTitle || `Sector ${(slot.levelIndex ?? 0) + 1}`}`
            : `Slot ${slot.slotIndex}: Empty Checkpoint`;

          const metaLine = document.createElement('div');
          metaLine.style.cssText =
            'font-size:10px;color:#94a3b8;font-variant-numeric:tabular-nums;';
          metaLine.textContent = slot.occupied
            ? `HP ${slot.health ?? 100} · Ammo ${slot.ammo ?? 32} · Saved ${slot.savedAt || 'Recently'}`
            : 'No saved data in this slot';

          info.append(titleLine, metaLine);

          const actions = document.createElement('div');
          actions.style.cssText = 'display:flex;align-items:center;gap:6px;';

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.textContent = 'Save';
          saveBtn.style.cssText =
            'padding:4px 10px;font-size:11px;font-weight:700;background:#1e293b;border:1px solid #4ec9b0;color:#4ec9b0;border-radius:3px;cursor:pointer;';
          saveBtn.addEventListener('click', (e) => {
            if (this.editorMode) return;
            e.stopPropagation();
            this.callbacks.onSaveSlot?.(slot.slotIndex);
          });

          const loadBtn = document.createElement('button');
          loadBtn.type = 'button';
          loadBtn.textContent = 'Load';
          loadBtn.disabled = !slot.occupied;
          loadBtn.style.cssText = `
            padding:4px 10px;
            font-size:11px;
            font-weight:700;
            background:${slot.occupied ? '#0284c7' : '#1e293b'};
            border:1px solid ${slot.occupied ? '#38bdf8' : '#334155'};
            color:${slot.occupied ? '#ffffff' : '#64748b'};
            border-radius:3px;
            cursor:${slot.occupied ? 'pointer' : 'not-allowed'};
          `;
          loadBtn.addEventListener('click', (e) => {
            if (this.editorMode || !slot.occupied) return;
            e.stopPropagation();
            this.callbacks.onLoadSlot?.(slot.slotIndex);
          });

          actions.append(saveBtn, loadBtn);
          row.append(info, actions);
          wrapper.appendChild(row);
        }
        break;
      }
    }

    return wrapper;
  }

  public dispose(): void {
    this.rootEl.remove();
  }
}
