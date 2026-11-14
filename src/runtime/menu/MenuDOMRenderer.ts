/**
 * ============================================================================
 * PURE VANILLA DOM MENU RENDERER (`/src/runtime/menu/MenuDOMRenderer.ts`)
 * ============================================================================
 * Zero React or Lucide dependencies. Renders any `MenuScreenSpec` (Out-of-Game
 * Main Menu, Sub-Menu, or In-Game Overlay) inside a normalized stage container.
 * Shared 1:1 between the Menu Studio WYSIWYG canvas, Test Play, and exported
 * standalone HTML / ZIP games.
 */

import {
  MenuScreenSpec,
} from './types';
import {
  resolveMenuTexturePreviewUrl,
  type MenuDOMRendererCallbacks,
  type MenuRenderRuntimeContext,
} from './menuDomShared';
import { buildWidgetElement } from './menuWidgets';

export { formatStatReadoutText, resolveMenuTexturePreviewUrl } from './menuDomShared';
export type { MenuDOMRendererCallbacks, MenuRenderRuntimeContext } from './menuDomShared';

export class MenuDOMRenderer {
  private mountRoot: HTMLElement;
  private rootEl: HTMLDivElement;
  private backdropEl: HTMLDivElement;
  private scanlineEl: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private toastEl: HTMLDivElement;
  /** Read by the widget builders in menuWidgets.ts */
  public readonly callbacks: MenuDOMRendererCallbacks;
  public readonly editorMode: boolean = false;

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

  private renderWidgets(
    screen: MenuScreenSpec,
    context: MenuRenderRuntimeContext
  ): void {
    this.stageEl.innerHTML = '';

    const sortedWidgets = [...screen.widgets]
      .filter((w) => w.visible !== false)
      .sort((a, b) => (a.rect.zIndex ?? 1) - (b.rect.zIndex ?? 1));

    for (const widget of sortedWidgets) {
      const node = buildWidgetElement(this, widget, context);
      this.stageEl.appendChild(node);
    }
  }

  public dispose(): void {
    this.rootEl.remove();
  }
}
