/** Static markup of the combat HUD's pods and modals (moved out of CombatHUD.ts in P1.4) */
import { HUD_ICONS } from './icons';

/** The "defeated" modal: respawn button */
export function defeatedModalHtml(): string {
  return `
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
}

/** The level-complete modal: next level and restart buttons */
export function levelCompleteModalHtml(): string {
  return `
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
          <div data-field="complete-carryover-row" class="pt-1.5 mt-1.5 border-t border-[#333333] flex items-center justify-between" style="display:none;padding-top:6px;margin-top:6px;border-top:1px solid #333333;align-items:center;justify-content:space-between;">
            <span class="text-[#858585]" style="color:#858585;">Next Level Status:</span>
            <span data-field="complete-carryover" class="text-[#38bdf8] font-semibold" style="color:#38bdf8;font-weight:600;">HP & Ammo Carry Over</span>
          </div>
        </div>
        <div class="space-y-1.5" style="display:flex;flex-direction:column;gap:6px;">
          <button type="button" data-action="next-level" class="ide-btn ide-btn--primary w-full" style="width:100%;display:none;">
            <span data-field="next-level-text">Continue to Next Level</span>
            ${HUD_ICONS.arrowRight(14)}
          </button>
          <button type="button" data-action="restart-campaign" class="ide-btn ide-btn--primary w-full" style="width:100%;display:none;">
            ${HUD_ICONS.rotateCcw(14)}
            <span>Restart Campaign (Level 1)</span>
          </button>
          <button type="button" data-action="respawn-complete" class="ide-btn ide-btn--primary w-full" style="width:100%;">
            ${HUD_ICONS.rotateCcw(14)}
            <span>Replay Level from Start</span>
          </button>
        </div>
      </div>
    `;
}

/** Left HUD pod: health, keys, kills and secrets */
export function leftPodHtml(): string {
  return `
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
}

/** Right HUD pod: ammo and the fire, use and reload buttons */
export function rightPodHtml(): string {
  return `
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
}
