/**
 * ============================================================================
 * VANILLA DOM + INLINE SVG COMBAT HUD (`/src/runtime/hud/CombatHUD.ts`)
 * ============================================================================
 * Zero React or Lucide dependencies. Matches the visual layout, colors,
 * typography, and interactive buttons of the original `CombatHUD.tsx` 1:1.
 * Includes self-contained inline styles alongside class names so exported
 * standalone builds render identically without Tailwind.
 */

import { CampaignSettings, DEFAULT_CAMPAIGN_SETTINGS, ENGINE_CONFIG, PlayerCombatState } from '../types';
import { SIM_CONFIG, SimulationState } from '../../sim';
import { defeatedModalHtml, leftPodHtml, levelCompleteModalHtml, rightPodHtml } from './combatHudMarkup';
import { injectCombatHudStyles } from './hudStyles';

export interface CombatHUDStateProps {
  combatState: PlayerCombatState;
  simState: SimulationState;
  isMuzzleFlashing: boolean;
  isHitMarkerActive: boolean;
  isPlayerHurtFlashing: boolean;
  currentLevelIndex?: number;
  totalLevels?: number;
  currentLevelTitle?: string;
  nextLevelTitle?: string;
  campaign?: CampaignSettings;
}

export interface CombatHUDCallbacks {
  onFireWeapon: () => void;
  onReloadAmmo: () => void;
  onUseAction: () => void;
  onRespawnPlayer: () => void;
  onNextLevel?: () => void;
  onRestartCampaign?: () => void;
}

export class CombatHUDController {
  private root: HTMLElement;
  private hurtVignetteEl: HTMLDivElement;
  private levelBadgeEl: HTMLDivElement;
  private levelBadgeTextEl: HTMLSpanElement;
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
  private levelCompleteCarryOverRowEl: HTMLDivElement;
  private levelCompleteCarryOverEl: HTMLSpanElement;
  private nextLevelBtnEl: HTMLButtonElement;
  private nextLevelBtnTextEl: HTMLSpanElement;
  private restartCampaignBtnEl: HTMLButtonElement;
  private respawnCompleteBtnEl: HTMLButtonElement;
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
    injectCombatHudStyles();

    // 1. Screen-Edge Crimson Damage Vignette
    this.hurtVignetteEl = document.createElement('div');
    this.hurtVignetteEl.setAttribute('aria-hidden', 'true');
    this.hurtVignetteEl.className =
      'pointer-events-none absolute inset-0 z-10 border-[4px] border-[#d14d41] bg-[#d14d41]/15';
    this.hurtVignetteEl.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:10;border:4px solid #d14d41;background:rgba(209,77,65,0.15);display:none;';
    this.root.appendChild(this.hurtVignetteEl);

    // 1A. Top-Left Campaign Level Indicator Badge (shown when totalLevels > 1)
    this.levelBadgeEl = document.createElement('div');
    this.levelBadgeEl.className =
      'pointer-events-none absolute top-2.5 left-2.5 z-20 bg-[#252526]/95 border border-[#3e3e42] px-2.5 py-1 text-[10px] font-mono text-[#cccccc] flex items-center gap-1.5';
    this.levelBadgeEl.style.cssText =
      'position:absolute;top:10px;left:10px;pointer-events:none;z-index:20;background:rgba(37,37,38,0.95);border:1px solid #3e3e42;padding:4px 10px;font-size:10px;font-family:"JetBrains Mono",monospace;color:#cccccc;display:none;align-items:center;gap:6px;';
    const levelDot = document.createElement('span');
    levelDot.style.cssText =
      'width:6px;height:6px;background:#4ec9b0;display:inline-block;flex-shrink:0;';
    this.levelBadgeTextEl = document.createElement('span');
    this.levelBadgeEl.append(levelDot, this.levelBadgeTextEl);
    this.root.appendChild(this.levelBadgeEl);

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
    this.defeatedModalEl.innerHTML = defeatedModalHtml();
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
    this.levelCompleteModalEl.innerHTML = levelCompleteModalHtml();
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
    this.levelCompleteCarryOverRowEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-carryover-row"]'
    ) as HTMLDivElement;
    this.levelCompleteCarryOverEl = this.levelCompleteModalEl.querySelector(
      '[data-field="complete-carryover"]'
    ) as HTMLSpanElement;
    this.nextLevelBtnEl = this.levelCompleteModalEl.querySelector(
      '[data-action="next-level"]'
    ) as HTMLButtonElement;
    this.nextLevelBtnTextEl = this.levelCompleteModalEl.querySelector(
      '[data-field="next-level-text"]'
    ) as HTMLSpanElement;
    this.restartCampaignBtnEl = this.levelCompleteModalEl.querySelector(
      '[data-action="restart-campaign"]'
    ) as HTMLButtonElement;
    this.respawnCompleteBtnEl = this.levelCompleteModalEl.querySelector(
      '[data-action="respawn-complete"]'
    ) as HTMLButtonElement;

    this.nextLevelBtnEl.addEventListener('click', () =>
      callbacks.onNextLevel?.()
    );
    this.restartCampaignBtnEl.addEventListener('click', () =>
      callbacks.onRestartCampaign?.()
    );
    this.respawnCompleteBtnEl.addEventListener('click', () =>
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
    leftPod.innerHTML = leftPodHtml();

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
    rightPod.innerHTML = rightPodHtml();

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

  public update(props: CombatHUDStateProps): void {
    const {
      combatState,
      simState,
      isMuzzleFlashing,
      isHitMarkerActive,
      isPlayerHurtFlashing,
      currentLevelIndex = 0,
      totalLevels = 1,
      currentLevelTitle,
      nextLevelTitle,
      campaign = DEFAULT_CAMPAIGN_SETTINGS,
    } = props;

    // 1. Hurt Vignette
    this.hurtVignetteEl.style.display = isPlayerHurtFlashing ? 'block' : 'none';

    // 1A. Campaign Level Indicator Badge
    if (totalLevels > 1) {
      const titleSuffix = currentLevelTitle ? ` — ${currentLevelTitle}` : '';
      this.levelBadgeTextEl.textContent = `LEVEL ${currentLevelIndex + 1}/${totalLevels}${titleSuffix}`;
      this.levelBadgeEl.style.display = 'flex';
    } else {
      this.levelBadgeEl.style.display = 'none';
    }

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
      const hasNextLevel = currentLevelIndex + 1 < totalLevels;
      const isFinalCampaignLevel = totalLevels > 1 && !hasNextLevel;

      this.levelCompleteModalEl.style.display = 'flex';
      if (isFinalCampaignLevel) {
        this.levelCompleteTitleEl.textContent =
          'Campaign Complete — All Levels Cleared!';
      } else if (simState.secretExitTriggered) {
        this.levelCompleteTitleEl.textContent = 'Secret Sector Exit Reached!';
      } else if (totalLevels > 1) {
        this.levelCompleteTitleEl.textContent = `Level ${currentLevelIndex + 1} / ${totalLevels} Complete`;
      } else {
        this.levelCompleteTitleEl.textContent =
          'Sector Cleared — Level Complete';
      }

      this.levelCompleteMsgEl.textContent = latestMessage
        ? latestMessage.text
        : isFinalCampaignLevel
        ? 'Congratulations! You have completed all levels in this game.'
        : 'All mission extraction objectives verified.';
      this.levelCompleteTimeEl.textContent = `${completionSeconds}s (${simState.tick} ticks)`;
      this.levelCompleteSecretsEl.textContent = `${
        simState.secretsFound
      } / ${Math.max(1, totalSecretEvents)}`;
      this.levelCompleteKillsEl.textContent = `${combatState.kills} / ${combatState.totalEnemies}`;

      if (hasNextLevel) {
        const nextHp = campaign.carryOverHealth
          ? `${Math.max(1, Math.round(combatState.health))} HP (Carry)`
          : `${ENGINE_CONFIG.PLAYER_MAX_HEALTH} HP (Reset)`;
        const nextAmmo = campaign.carryOverAmmo
          ? `${Math.round(combatState.ammo)} Ammo (Carry)`
          : `${ENGINE_CONFIG.PLAYER_START_AMMO} Ammo (Reset)`;
        this.levelCompleteCarryOverEl.textContent = `${nextHp} • ${nextAmmo}`;
        this.levelCompleteCarryOverRowEl.style.display = 'flex';

        const nextLabel = nextLevelTitle
          ? `Continue to Level ${currentLevelIndex + 2}: ${nextLevelTitle}`
          : `Continue to Level ${currentLevelIndex + 2}`;
        this.nextLevelBtnTextEl.textContent = nextLabel;
        this.nextLevelBtnEl.style.display = 'inline-flex';
        this.restartCampaignBtnEl.style.display = 'none';
        this.respawnCompleteBtnEl.className = 'ide-btn w-full';
      } else if (isFinalCampaignLevel) {
        this.levelCompleteCarryOverRowEl.style.display = 'none';
        this.nextLevelBtnEl.style.display = 'none';
        this.restartCampaignBtnEl.style.display = 'inline-flex';
        this.respawnCompleteBtnEl.className = 'ide-btn w-full';
      } else {
        this.levelCompleteCarryOverRowEl.style.display = 'none';
        this.nextLevelBtnEl.style.display = 'none';
        this.restartCampaignBtnEl.style.display = 'none';
        this.respawnCompleteBtnEl.className =
          'ide-btn ide-btn--primary w-full';
      }
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

  public setVisible(visible: boolean): void {
    this.root.style.display = visible ? 'block' : 'none';
  }

  public dispose(): void {
    this.root.remove();
  }
}
