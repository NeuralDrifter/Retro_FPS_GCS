/**
 * ============================================================================
 * VANILLA DOM + INLINE SVG COMBAT HUD (`/src/runtime/hud/CombatHUD.ts`)
 * ============================================================================
 * Zero React or Lucide dependencies. Matches the visual layout, colors,
 * typography, and interactive buttons of the original `CombatHUD.tsx` 1:1.
 * Includes self-contained inline styles alongside class names so exported
 * standalone builds render identically without Tailwind.
 */

import { PlayerCombatState } from '../types';
import { SIM_CONFIG, SimulationState } from '../sim';
import { HUD_ICONS } from './icons';

export interface CombatHUDStateProps {
  combatState: PlayerCombatState;
  simState: SimulationState;
  isMuzzleFlashing: boolean;
  isHitMarkerActive: boolean;
  isPlayerHurtFlashing: boolean;
}

export interface CombatHUDCallbacks {
  onFireWeapon: () => void;
  onReloadAmmo: () => void;
  onUseAction: () => void;
  onRespawnPlayer: () => void;
}

export class CombatHUDController {
  private root: HTMLElement;
  private hurtVignetteEl: HTMLDivElement;
  private messageBannerEl: HTMLDivElement;
  private messageTextEl: HTMLSpanElement;
  private reticleBoxEl: HTMLDivElement;
  private reticleDotEl: HTMLDivElement;
  private hitMarkerSvgEl: SVGSVGElement;
  private targetEnemyCardEl: HTMLDivElement;
  private targetEnemyNameEl: HTMLSpanElement;
  private targetEnemyHpTextEl: HTMLSpanElement;
  private targetEnemyBarEl: HTMLDivElement;
  private defeatedModalEl: HTMLDivElement;
  private levelCompleteModalEl: HTMLDivElement;
  private levelCompleteTitleEl: HTMLHeadingElement;
  private levelCompleteMsgEl: HTMLParagraphElement;
  private levelCompleteTimeEl: HTMLSpanElement;
  private levelCompleteSecretsEl: HTMLSpanElement;
  private levelCompleteKillsEl: HTMLSpanElement;
  private healthValueEl: HTMLSpanElement;
  private healthBarFillEl: HTMLDivElement;
  private killsValueEl: HTMLSpanElement;
  private keysValueEl: HTMLSpanElement;
  private secretsValueEl: HTMLSpanElement;
  private ammoValueEl: HTMLSpanElement;
  private ammoBarFillEl: HTMLDivElement;
  private fireBtnEl: HTMLButtonElement;
  private reloadBtnEl: HTMLButtonElement;
  private useBtnEl: HTMLButtonElement;

  constructor(mountRoot: HTMLElement, callbacks: CombatHUDCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'forgecore-combat-hud-root';
    this.root.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:10;font-family:Inter,system-ui,-apple-system,sans-serif;user-select:none;';

    // Ensure `.ide-btn` fallback styles exist when running in standalone exports without index.css
    this.injectStandaloneStyles();

    // 1. Screen-Edge Crimson Damage Vignette
    this.hurtVignetteEl = document.createElement('div');
    this.hurtVignetteEl.setAttribute('aria-hidden', 'true');
    this.hurtVignetteEl.className =
      'pointer-events-none absolute inset-0 z-10 border-[4px] border-[#d14d41] bg-[#d14d41]/15';
    this.hurtVignetteEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:10;border:4px solid #d14d41;background:rgba(209,77,65,0.15);display:none;';
    this.root.appendChild(this.hurtVignetteEl);

    // 1B. Top Event Message Banner
    this.messageBannerEl = document.createElement('div');
    this.messageBannerEl.setAttribute('role', 'status');
    this.messageBannerEl.setAttribute('aria-live', 'polite');
    this.messageBannerEl.className =
      'pointer-events-none absolute top-2.5 left-1/2 -translate-x-1/2 z-20 max-w-[85%] bg-[#1e1e1e]/95 border border-[#4ec9b0] px-3 py-1.5 text-[11px] font-mono text-[#e5e5e5] shadow-md';
    this.messageBannerEl.style.cssText =
      'position:absolute;top:10px;left:50%;transform:translateX(-50%);pointer-events:none;z-index:20;max-width:85%;background:rgba(30,30,30,0.95);border:1px solid #4ec9b0;padding:6px 12px;font-size:11px;font-family:"JetBrains Mono",monospace;color:#e5e5e5;box-shadow:0 4px 6px rgba(0,0,0,0.35);display:none;';
    this.messageTextEl = document.createElement('span');
    this.messageBannerEl.appendChild(this.messageTextEl);
    this.root.appendChild(this.messageBannerEl);

    // 2. Center First-Person Reticle, Hitmarker & Target Enemy Health Readout
    const centerWrap = document.createElement('div');
    centerWrap.className =
      'pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-10';
    centerWrap.style.cssText =
      'position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;';

    const reticleOuter = document.createElement('div');
    reticleOuter.className =
      'relative flex items-center justify-center w-8 h-8';
    reticleOuter.style.cssText =
      'position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;';

    this.reticleBoxEl = document.createElement('div');
    this.reticleBoxEl.className =
      'w-4 h-4 border transition-transform duration-75 scale-100 border-[#478cbf]/80';
    this.reticleBoxEl.style.cssText =
      'width:16px;height:16px;border:1px solid rgba(71,140,191,0.8);transition:transform 75ms ease;';
    reticleOuter.appendChild(this.reticleBoxEl);

    this.reticleDotEl = document.createElement('div');
    this.reticleDotEl.className = 'absolute w-1 h-1 bg-[#4ec9b0]';
    this.reticleDotEl.style.cssText =
      'position:absolute;width:4px;height:4px;background:#4ec9b0;';
    reticleOuter.appendChild(this.reticleDotEl);

    const svgNs = 'http://www.w3.org/2000/svg';
    this.hitMarkerSvgEl = document.createElementNS(svgNs, 'svg');
    this.hitMarkerSvgEl.setAttribute('viewBox', '0 0 24 24');
    this.hitMarkerSvgEl.setAttribute(
      'class',
      'absolute inset-0 w-full h-full text-[#d14d41]'
    );
    this.hitMarkerSvgEl.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;color:#d14d41;display:none;';
    this.hitMarkerSvgEl.innerHTML = `
      <line x1="4" y1="4" x2="9" y2="9" stroke="currentColor" stroke-width="2" />
      <line x1="20" y1="4" x2="15" y2="9" stroke="currentColor" stroke-width="2" />
      <line x1="4" y1="20" x2="9" y2="15" stroke="currentColor" stroke-width="2" />
      <line x1="20" y1="20" x2="15" y2="15" stroke="currentColor" stroke-width="2" />
    `;
    reticleOuter.appendChild(this.hitMarkerSvgEl);
    centerWrap.appendChild(reticleOuter);

    // Target Enemy Health Readout under Crosshair
    this.targetEnemyCardEl = document.createElement('div');
    this.targetEnemyCardEl.className =
      'mt-2 px-2 py-1 bg-[#252526]/95 border border-[#3e3e42] flex flex-col items-center gap-1 min-w-[140px]';
    this.targetEnemyCardEl.style.cssText =
      'margin-top:8px;padding:4px 8px;background:rgba(37,37,38,0.95);border:1px solid #3e3e42;display:none;flex-direction:column;align-items:center;gap:4px;min-width:140px;';

    const targetRow = document.createElement('div');
    targetRow.className =
      'flex items-center justify-between w-full gap-2 text-[10px] font-mono';
    targetRow.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;font-size:10px;font-family:"JetBrains Mono",monospace;';

    this.targetEnemyNameEl = document.createElement('span');
    this.targetEnemyNameEl.className = 'text-[#cccccc] truncate max-w-[95px]';
    this.targetEnemyNameEl.style.cssText =
      'color:#cccccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:95px;';

    this.targetEnemyHpTextEl = document.createElement('span');
    this.targetEnemyHpTextEl.className =
      'text-[#d14d41] font-semibold tabular-nums';
    this.targetEnemyHpTextEl.style.cssText =
      'color:#d14d41;font-weight:600;font-variant-numeric:tabular-nums;';

    targetRow.append(this.targetEnemyNameEl, this.targetEnemyHpTextEl);

    const targetBarBg = document.createElement('div');
    targetBarBg.className = 'w-full h-1 bg-[#181818] border border-[#333333]';
    targetBarBg.style.cssText =
      'width:100%;height:4px;background:#181818;border:1px solid #333333;';

    this.targetEnemyBarEl = document.createElement('div');
    this.targetEnemyBarEl.className =
      'h-full bg-[#d14d41] transition-all duration-100';
    this.targetEnemyBarEl.style.cssText =
      'height:100%;background:#d14d41;width:100%;transition:width 100ms ease;';
    targetBarBg.appendChild(this.targetEnemyBarEl);

    this.targetEnemyCardEl.append(targetRow, targetBarBg);
    centerWrap.appendChild(this.targetEnemyCardEl);
    this.root.appendChild(centerWrap);

    // 3. Player Defeated Overlay
    this.defeatedModalEl = document.createElement('div');
    this.defeatedModalEl.className =
      'pointer-events-auto absolute inset-0 z-30 bg-[#141414]/85 flex items-center justify-center p-4';
    this.defeatedModalEl.style.cssText =
      'position:absolute;inset:0;pointer-events:auto;z-index:30;background:rgba(20,20,20,0.85);display:none;align-items:center;justify-content:center;padding:16px;';
    this.defeatedModalEl.innerHTML = `
      <div class="bg-[#252526] border border-[#d14d41] p-4 max-w-xs w-full text-center space-y-3" style="background:#252526;border:1px solid #d14d41;padding:16px;max-width:320px;width:100%;text-align:center;">
        <div class="w-8 h-8 bg-[#d14d41]/20 border border-[#d14d41] text-[#d14d41] flex items-center justify-center mx-auto" style="width:32px;height:32px;background:rgba(209,77,65,0.2);border:1px solid #d14d41;color:#d14d41;display:flex;align-items:center;justify-content:center;margin:0 auto 12px auto;">
          ${HUD_ICONS.skull(16, '#d14d41')}
        </div>
        <div style="margin-bottom:12px;">
          <h3 class="text-xs font-bold uppercase tracking-wider text-white" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#ffffff;margin:0;">
            Player Defeated — Hull Failure
          </h3>
          <p class="text-[11px] text-[#858585] mt-1" style="font-size:11px;color:#858585;margin:4px 0 0 0;">
            Hostile units depleted your health. Click Respawn to restore health, plasma ammo, and level state.
          </p>
        </div>
        <button type="button" data-action="respawn-dead" class="ide-btn ide-btn--primary w-full" style="width:100%;">
          ${HUD_ICONS.rotateCcw(14)}
          <span>Respawn at Start Pad</span>
        </button>
      </div>
    `;
    const respawnDeadBtn = this.defeatedModalEl.querySelector(
      '[data-action="respawn-dead"]'
    ) as HTMLButtonElement;
    respawnDeadBtn.addEventListener('click', () => callbacks.onRespawnPlayer());
    this.root.appendChild(this.defeatedModalEl);

    // 3B. Level Complete Summary Overlay
    this.levelCompleteModalEl = document.createElement('div');
    this.levelCompleteModalEl.className =
      'pointer-events-auto absolute inset-0 z-30 bg-[#141414]/90 flex items-center justify-center p-4';
    this.levelCompleteModalEl.style.cssText =
      'position:absolute;inset:0;pointer-events:auto;z-index:30;background:rgba(20,20,20,0.9);display:none;align-items:center;justify-content:center;padding:16px;';
    this.levelCompleteModalEl.innerHTML = `
      <div class="bg-[#252526] border border-[#4ec9b0] p-4 max-w-sm w-full text-center space-y-3 shadow-lg" style="background:#252526;border:1px solid #4ec9b0;padding:16px;max-width:384px;width:100%;text-align:center;box-shadow:0 10px 15px rgba(0,0,0,0.5);">
        <div class="w-9 h-9 bg-[#4ec9b0]/20 border border-[#4ec9b0] text-[#4ec9b0] flex items-center justify-center mx-auto" style="width:36px;height:36px;background:rgba(78,201,176,0.2);border:1px solid #4ec9b0;color:#4ec9b0;display:flex;align-items:center;justify-content:center;margin:0 auto 12px auto;">
          ${HUD_ICONS.trophy(16, '#4ec9b0')}
        </div>
        <div style="margin-bottom:12px;">
          <h3 data-field="complete-title" class="text-xs font-bold uppercase tracking-wider text-white" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#ffffff;margin:0;">
            Sector Cleared — Level Complete
          </h3>
          <p data-field="complete-msg" class="text-[11px] text-[#cccccc] mt-1" style="font-size:11px;color:#cccccc;margin:4px 0 0 0;">
            All mission extraction objectives verified.
          </p>
        </div>
        <div class="bg-[#1b1b1c] border border-[#333333] p-2.5 text-[11px] font-mono space-y-1.5 text-left" style="background:#1b1b1c;border:1px solid #333333;padding:10px;font-size:11px;font-family:'JetBrains Mono',monospace;text-align:left;margin-bottom:12px;">
          <div class="flex items-center justify-between" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span class="text-[#858585]" style="color:#858585;">Completion Time:</span>
            <span data-field="complete-time" class="text-white font-semibold tabular-nums" style="color:#ffffff;font-weight:600;">0s (0 ticks)</span>
          </div>
          <div class="flex items-center justify-between" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span class="text-[#858585]" style="color:#858585;">Secrets Discovered:</span>
            <span data-field="complete-secrets" class="text-[#4ec9b0] font-semibold tabular-nums" style="color:#4ec9b0;font-weight:600;">0 / 1</span>
          </div>
          <div class="flex items-center justify-between" style="display:flex;align-items:center;justify-content:space-between;">
            <span class="text-[#858585]" style="color:#858585;">Hostiles Eliminated:</span>
            <span data-field="complete-kills" class="text-[#cccccc] font-semibold tabular-nums" style="color:#cccccc;font-weight:600;">0 / 0</span>
          </div>
        </div>
        <button type="button" data-action="respawn-complete" class="ide-btn ide-btn--primary w-full" style="width:100%;">
          ${HUD_ICONS.rotateCcw(14)}
          <span>Replay Level from Start</span>
        </button>
      </div>
    `;
    this.levelCompleteTitleEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-title"]'
    ) as HTMLHeadingElement;
    this.levelCompleteMsgEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-msg"]'
    ) as HTMLParagraphElement;
    this.levelCompleteTimeEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-time"]'
    ) as HTMLSpanElement;
    this.levelCompleteSecretsEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-secrets"]'
    ) as HTMLSpanElement;
    this.levelCompleteKillsEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-kills"]'
    ) as HTMLSpanElement;
    const respawnCompleteBtn = this.levelCompleteModalEl.querySelector(
      '[data-action="respawn-complete"]'
    ) as HTMLButtonElement;
    respawnCompleteBtn.addEventListener('click', () =>
      callbacks.onRespawnPlayer()
    );
    this.root.appendChild(this.levelCompleteModalEl);

    // 4. Bottom Tactical Player Status HUD Deck
    const bottomDeck = document.createElement('div');
    bottomDeck.className =
      'pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 z-10 flex flex-wrap items-end justify-between gap-2';
    bottomDeck.style.cssText =
      'position:absolute;bottom:10px;left:10px;right:10px;z-index:10;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:8px;pointer-events:none;';

    // Left Pod: Health, Kills, Keys, Secrets
    const leftPod = document.createElement('div');
    leftPod.className =
      'pointer-events-auto bg-[#252526]/95 border border-[#3e3e42] p-2 min-w-[200px]';
    leftPod.style.cssText =
      'pointer-events:auto;background:rgba(37,37,38,0.95);border:1px solid #3e3e42;padding:8px;min-width:200px;';
    leftPod.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-1" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;">
        <div class="flex items-center gap-1" style="display:flex;align-items:center;gap:4px;">
          ${HUD_ICONS.heart(14, '#d14d41')}
          <span class="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc]" style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#cccccc;">
            Health
          </span>
        </div>
        <span data-field="health-value" class="text-xs font-mono font-semibold tabular-nums text-white" style="font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:600;color:#ffffff;">
          100 / 100
        </span>
      </div>
      <div class="w-full h-2 bg-[#181818] border border-[#333333]" style="width:100%;height:8px;background:#181818;border:1px solid #333333;">
        <div data-field="health-bar" class="h-full transition-all duration-150 bg-[#4ec9b0]" style="height:100%;width:100%;background:#4ec9b0;transition:width 150ms ease;"></div>
      </div>
      <div class="mt-1.5 pt-1 border-t border-[#333333] flex items-center justify-between text-[10px] font-mono text-[#858585]" style="margin-top:6px;padding-top:4px;border-top:1px solid #333333;display:flex;align-items:center;justify-content:space-between;font-size:10px;font-family:'JetBrains Mono',monospace;color:#858585;">
        <span class="flex items-center gap-1" style="display:flex;align-items:center;gap:4px;">
          ${HUD_ICONS.skull(12, '#d14d41')}
          <span>Hostiles Cleared:</span>
        </span>
        <span data-field="kills-value" class="text-[#cccccc] font-semibold tabular-nums" style="color:#cccccc;font-weight:600;">
          0 / 0
        </span>
      </div>
      <div class="mt-1 pt-1 border-t border-[#333333] flex items-center justify-between gap-2 text-[10px] font-mono text-[#858585]" style="margin-top:4px;padding-top:4px;border-top:1px solid #333333;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;font-family:'JetBrains Mono',monospace;color:#858585;">
        <span class="flex items-center gap-1" style="display:flex;align-items:center;gap:4px;">
          ${HUD_ICONS.key(12, '#f59e0b')}
          <span>Keys:</span>
          <span data-field="keys-value" class="text-[#f59e0b] font-semibold" style="color:#f59e0b;font-weight:600;">None</span>
        </span>
        <span class="flex items-center gap-1" style="display:flex;align-items:center;gap:4px;">
          ${HUD_ICONS.sparkles(12, '#4ec9b0')}
          <span>Secrets:</span>
          <span data-field="secrets-value" class="text-[#4ec9b0] font-semibold tabular-nums" style="color:#4ec9b0;font-weight:600;">0/1</span>
        </span>
      </div>
    `;

    this.healthValueEl = leftPod.querySelector(
      '[data-field="health-value"]'
    ) as HTMLSpanElement;
    this.healthBarFillEl = leftPod.querySelector(
      '[data-field="health-bar"]'
    ) as HTMLDivElement;
    this.killsValueEl = leftPod.querySelector(
      '[data-field="kills-value"]'
    ) as HTMLSpanElement;
    this.keysValueEl = leftPod.querySelector(
      '[data-field="keys-value"]'
    ) as HTMLSpanElement;
    this.secretsValueEl = leftPod.querySelector(
      '[data-field="secrets-value"]'
    ) as HTMLSpanElement;

    // Right Pod: Plasma Ammo & Controls
    const rightPod = document.createElement('div');
    rightPod.className =
      'pointer-events-auto bg-[#252526]/95 border border-[#3e3e42] p-2 min-w-[215px]';
    rightPod.style.cssText =
      'pointer-events:auto;background:rgba(37,37,38,0.95);border:1px solid #3e3e42;padding:8px;min-width:215px;';
    rightPod.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-1" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;">
        <div class="flex items-center gap-1" style="display:flex;align-items:center;gap:4px;">
          ${HUD_ICONS.zap(14, '#478cbf')}
          <span class="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc]" style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#cccccc;">
            Plasma Ammo
          </span>
        </div>
        <span data-field="ammo-value" class="text-xs font-mono font-semibold tabular-nums text-white" style="font-size:12px;font-family:'JetBrains Mono',monospace;font-weight:600;color:#ffffff;">
          32 / 99
        </span>
      </div>
      <div class="w-full h-2 bg-[#181818] border border-[#333333] mb-2" style="width:100%;height:8px;background:#181818;border:1px solid #333333;margin-bottom:8px;">
        <div data-field="ammo-bar" class="h-full transition-all duration-100 bg-[#478cbf]" style="height:100%;width:32%;background:#478cbf;transition:width 100ms ease;"></div>
      </div>
      <div class="flex items-center gap-1.5" style="display:flex;align-items:center;gap:6px;">
        <button type="button" data-action="fire" class="ide-btn ide-btn--primary flex-1" style="flex:1;" title="Fire Plasma Rifle (Click 3D Viewport or Press F)">
          ${HUD_ICONS.crosshair(12)}
          <span>Fire [LMB/F]</span>
        </button>
        <button type="button" data-action="reload" class="ide-btn" title="Reload Plasma Cells (Shortcut: R)">
          ${HUD_ICONS.refreshCw(12)}
          <span>Reload [R]</span>
        </button>
        <button type="button" data-action="use" class="ide-btn" title="Use Door / Push Secret Wall / Activate Switch (Shortcut: E or Space)">
          ${HUD_ICONS.hand(12)}
          <span>Use [E]</span>
        </button>
      </div>
    `;

    this.ammoValueEl = rightPod.querySelector(
      '[data-field="ammo-value"]'
    ) as HTMLSpanElement;
    this.ammoBarFillEl = rightPod.querySelector(
      '[data-field="ammo-bar"]'
    ) as HTMLDivElement;
    this.fireBtnEl = rightPod.querySelector(
      '[data-action="fire"]'
    ) as HTMLButtonElement;
    this.reloadBtnEl = rightPod.querySelector(
      '[data-action="reload"]'
    ) as HTMLButtonElement;
    this.useBtnEl = rightPod.querySelector(
      '[data-action="use"]'
    ) as HTMLButtonElement;

    this.fireBtnEl.addEventListener('click', () => callbacks.onFireWeapon());
    this.reloadBtnEl.addEventListener('click', () => callbacks.onReloadAmmo());
    this.useBtnEl.addEventListener('click', () => callbacks.onUseAction());

    bottomDeck.append(leftPod, rightPod);
    this.root.appendChild(bottomDeck);
    mountRoot.appendChild(this.root);
  }

  private injectStandaloneStyles(): void {
    if (
      typeof document === 'undefined' ||
      document.getElementById('forgecore-runtime-hud-styles')
    ) {
      return;
    }
    const styleEl = document.createElement('style');
    styleEl.id = 'forgecore-runtime-hud-styles';
    styleEl.textContent = `
      .forgecore-combat-hud-root .ide-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        color: #cccccc;
        background-color: #2d2d30;
        border: 1px solid #3e3e42;
        border-radius: 2px;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .forgecore-combat-hud-root .ide-btn:hover:not(:disabled) {
        background-color: #3e3e42;
        color: #ffffff;
      }
      .forgecore-combat-hud-root .ide-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .forgecore-combat-hud-root .ide-btn--primary {
        background-color: #0e639c;
        border-color: #1177bb;
        color: #ffffff;
      }
      .forgecore-combat-hud-root .ide-btn--primary:hover:not(:disabled) {
        background-color: #1177bb;
      }
    `;
    document.head.appendChild(styleEl);
  }

  public update(props: CombatHUDStateProps): void {
    const {
      combatState,
      simState,
      isMuzzleFlashing,
      isHitMarkerActive,
      isPlayerHurtFlashing,
    } = props;

    // 1. Hurt Vignette
    this.hurtVignetteEl.style.display = isPlayerHurtFlashing ? 'block' : 'none';

    // 1B. Top Event Message Banner
    const latestMessage =
      simState.messages.length > 0
        ? simState.messages[simState.messages.length - 1]
        : null;
    const maxMessageAgeTicks =
      simState.messages.length === 1 &&
      latestMessage !== null &&
      latestMessage.tick <= 2
        ? SIM_CONFIG.TICKS_PER_SECOND * 20
        : SIM_CONFIG.TICKS_PER_SECOND * 6;
    const isMessageRecent =
      latestMessage !== null &&
      simState.tick - latestMessage.tick <= maxMessageAgeTicks;
    if (isMessageRecent && latestMessage) {
      this.messageTextEl.textContent = latestMessage.text;
      this.messageBannerEl.style.display = 'block';
    } else {
      this.messageBannerEl.style.display = 'none';
    }

    // 2. Reticle & Hitmarker
    if (isMuzzleFlashing) {
      this.reticleBoxEl.style.transform = 'scale(1.25)';
      this.reticleBoxEl.style.borderColor = '#ffffff';
    } else if (isHitMarkerActive) {
      this.reticleBoxEl.style.transform = 'scale(1.1)';
      this.reticleBoxEl.style.borderColor = '#d14d41';
    } else {
      this.reticleBoxEl.style.transform = 'scale(1)';
      this.reticleBoxEl.style.borderColor = 'rgba(71, 140, 191, 0.8)';
    }
    this.reticleDotEl.style.background = isHitMarkerActive
      ? '#d14d41'
      : '#4ec9b0';
    this.hitMarkerSvgEl.style.display = isHitMarkerActive ? 'block' : 'none';

    // Target Enemy Health Readout
    const targetEnemyPct =
      combatState.lastHitEnemyHealth !== null &&
      combatState.lastHitEnemyMaxHealth
        ? Math.max(
            0,
            Math.min(
              100,
              (combatState.lastHitEnemyHealth /
                combatState.lastHitEnemyMaxHealth) *
                100
            )
          )
        : null;

    if (combatState.lastHitEnemyName && targetEnemyPct !== null) {
      this.targetEnemyCardEl.style.display = 'flex';
      this.targetEnemyNameEl.textContent = combatState.lastHitEnemyName;
      this.targetEnemyHpTextEl.textContent = `${
        combatState.lastHitEnemyHealth ?? 0
      } HP`;
      this.targetEnemyBarEl.style.width = `${targetEnemyPct}%`;
    } else {
      this.targetEnemyCardEl.style.display = 'none';
    }

    // 3. Defeated Modal
    this.defeatedModalEl.style.display = combatState.isDead ? 'flex' : 'none';

    // 3B. Level Complete Modal
    const totalSecretEvents = simState.events.filter((ev) =>
      ev.actions.some((a) => a.type === 'mark_secret_found')
    ).length;
    const completionSeconds = Math.floor(
      simState.tick / SIM_CONFIG.TICKS_PER_SECOND
    );

    if (simState.levelEnded) {
      this.levelCompleteModalEl.style.display = 'flex';
      this.levelCompleteTitleEl.textContent = simState.secretExitTriggered
        ? 'Secret Sector Exit Reached!'
        : 'Sector Cleared — Level Complete';
      this.levelCompleteMsgEl.textContent = latestMessage
        ? latestMessage.text
        : 'All mission extraction objectives verified.';
      this.levelCompleteTimeEl.textContent = `${completionSeconds}s (${simState.tick} ticks)`;
      this.levelCompleteSecretsEl.textContent = `${
        simState.secretsFound
      } / ${Math.max(1, totalSecretEvents)}`;
      this.levelCompleteKillsEl.textContent = `${combatState.kills} / ${combatState.totalEnemies}`;
    } else {
      this.levelCompleteModalEl.style.display = 'none';
    }

    // 4. Bottom HUD Pods
    const healthPct = Math.max(
      0,
      Math.min(100, (combatState.health / combatState.maxHealth) * 100)
    );
    const healthColorHex =
      healthPct > 60 ? '#4ec9b0' : healthPct > 30 ? '#ce9178' : '#d14d41';

    this.healthValueEl.textContent = `${combatState.health} / ${combatState.maxHealth}`;
    this.healthBarFillEl.style.width = `${healthPct}%`;
    this.healthBarFillEl.style.background = healthColorHex;

    this.killsValueEl.textContent = `${combatState.kills} / ${combatState.totalEnemies}`;

    const player0 = simState.players[0];
    const playerItems = player0?.items || [];
    this.keysValueEl.textContent =
      playerItems.length > 0 ? playerItems.join(', ') : 'None';
    this.secretsValueEl.textContent = `${simState.secretsFound}/${Math.max(
      1,
      totalSecretEvents
    )}`;

    const ammoPct = Math.min(
      100,
      (combatState.ammo / combatState.maxAmmo) * 100
    );
    this.ammoValueEl.textContent = `${combatState.ammo} / ${combatState.maxAmmo}`;
    this.ammoBarFillEl.style.width = `${ammoPct}%`;
    this.ammoBarFillEl.style.background =
      combatState.ammo > 8 ? '#478cbf' : '#d14d41';

    this.fireBtnEl.disabled = combatState.ammo <= 0 || combatState.isDead;
    this.useBtnEl.disabled = combatState.isDead || simState.levelEnded;
  }

  public dispose(): void {
    this.root.remove();
  }
}
