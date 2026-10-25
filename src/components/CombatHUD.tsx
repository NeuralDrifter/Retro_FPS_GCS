/**
 * ============================================================================
 * PIE3D PHASE 3: PLAYER STATS, WEAPON & COMBAT HUD OVERLAY (DESKTOP IDE THEME)
 * ============================================================================
 * Renders the crisp retro FPS HUD overlay on top of the Three.js canvas:
 *  - Dynamic Health Bar & Hostile Kill Readout
 *  - Dynamic Plasma Ammo Counter with Fire [LMB/F] and Reload [R] buttons
 *  - Center Tactical Reticle with Hitmarker & Target Enemy HP bar
 */

import React from 'react';
import { PlayerCombatState } from '../types/engine';
import { SIM_CONFIG, SimulationState } from '../engine/sim';
import {
  Crosshair,
  Heart,
  Zap,
  Skull,
  RotateCcw,
  RefreshCw,
  Key,
  Sparkles,
  Trophy,
  Hand,
} from 'lucide-react';

interface CombatHUDProps {
  combatState: PlayerCombatState;
  simState: SimulationState;
  isMuzzleFlashing: boolean;
  isHitMarkerActive: boolean;
  isPlayerHurtFlashing: boolean;
  onFireWeapon: () => void;
  onReloadAmmo: () => void;
  onUseAction: () => void;
  onRespawnPlayer: () => void;
}

export const CombatHUD: React.FC<CombatHUDProps> = ({
  combatState,
  simState,
  isMuzzleFlashing,
  isHitMarkerActive,
  isPlayerHurtFlashing,
  onFireWeapon,
  onReloadAmmo,
  onUseAction,
  onRespawnPlayer,
}) => {
  const healthPct = Math.max(
    0,
    Math.min(100, (combatState.health / combatState.maxHealth) * 100)
  );

  const healthBarColor =
    healthPct > 60
      ? 'bg-[#4ec9b0]'
      : healthPct > 30
      ? 'bg-[#ce9178]'
      : 'bg-[#d14d41]';

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

  const player0 = simState.players[0];
  const playerItems = player0?.items || [];
  const latestMessage =
    simState.messages.length > 0
      ? simState.messages[simState.messages.length - 1]
      : null;
  const isMessageRecent =
    latestMessage !== null &&
    simState.tick - latestMessage.tick <= SIM_CONFIG.TICKS_PER_SECOND * 6;
  const totalSecretEvents = simState.events.filter((ev) =>
    ev.actions.some((a) => a.type === 'mark_secret_found')
  ).length;
  const completionSeconds = Math.floor(
    simState.tick / SIM_CONFIG.TICKS_PER_SECOND
  );

  return (
    <>
      {/* 1. Screen-Edge Crimson Damage Vignette when Enemy Attacks Player */}
      {isPlayerHurtFlashing && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 border-[4px] border-[#d14d41] bg-[#d14d41]/15"
        />
      )}

      {/* 1B. Top Event Message Banner (Safe Plain-Text Rendering) */}
      {isMessageRecent && latestMessage && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute top-2.5 left-1/2 -translate-x-1/2 z-20 max-w-[85%] bg-[#1e1e1e]/95 border border-[#4ec9b0] px-3 py-1.5 text-[11px] font-mono text-[#e5e5e5] shadow-md"
        >
          <span>{latestMessage.text}</span>
        </div>
      )}

      {/* 2. Center First-Person Reticle, Hitmarker & Target Enemy Health Readout */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center z-10">
        <div className="relative flex items-center justify-center w-8 h-8">
          <div
            className={`w-4 h-4 border transition-transform duration-75 ${
              isMuzzleFlashing
                ? 'scale-125 border-white'
                : isHitMarkerActive
                ? 'scale-110 border-[#d14d41]'
                : 'scale-100 border-[#478cbf]/80'
            }`}
          />
          <div
            className={`absolute w-1 h-1 ${
              isHitMarkerActive ? 'bg-[#d14d41]' : 'bg-[#4ec9b0]'
            }`}
          />

          {isHitMarkerActive && (
            <svg
              viewBox="0 0 24 24"
              className="absolute inset-0 w-full h-full text-[#d14d41]"
            >
              <line
                x1="4"
                y1="4"
                x2="9"
                y2="9"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="20"
                y1="4"
                x2="15"
                y2="9"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="4"
                y1="20"
                x2="9"
                y2="15"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="20"
                y1="20"
                x2="15"
                y2="15"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          )}
        </div>

        {/* Target Enemy Health Readout under Crosshair */}
        {combatState.lastHitEnemyName && targetEnemyPct !== null && (
          <div className="mt-2 px-2 py-1 bg-[#252526]/95 border border-[#3e3e42] flex flex-col items-center gap-1 min-w-[140px]">
            <div className="flex items-center justify-between w-full gap-2 text-[10px] font-mono">
              <span className="text-[#cccccc] truncate max-w-[95px]">
                {combatState.lastHitEnemyName}
              </span>
              <span className="text-[#d14d41] font-semibold tabular-nums">
                {combatState.lastHitEnemyHealth ?? 0} HP
              </span>
            </div>
            <div className="w-full h-1 bg-[#181818] border border-[#333333]">
              <div
                className="h-full bg-[#d14d41] transition-all duration-100"
                style={{ width: `${targetEnemyPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 3. Player Defeated Overlay (When Health reaches 0) */}
      {combatState.isDead && (
        <div className="pointer-events-auto absolute inset-0 z-30 bg-[#141414]/85 flex items-center justify-center p-4">
          <div className="bg-[#252526] border border-[#d14d41] p-4 max-w-xs w-full text-center space-y-3">
            <div className="w-8 h-8 bg-[#d14d41]/20 border border-[#d14d41] text-[#d14d41] flex items-center justify-center mx-auto">
              <Skull className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Player Defeated — Hull Failure
              </h3>
              <p className="text-[11px] text-[#858585] mt-1">
                Hostile units depleted your health. Click Respawn to restore
                health, plasma ammo, and level state.
              </p>
            </div>
            <button
              type="button"
              onClick={onRespawnPlayer}
              className="ide-btn ide-btn--primary w-full"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Respawn at Start Pad</span>
            </button>
          </div>
        </div>
      )}

      {/* 3B. Wolf3D Level Complete Summary Overlay (When exit_level fires) */}
      {simState.levelEnded && (
        <div className="pointer-events-auto absolute inset-0 z-30 bg-[#141414]/90 flex items-center justify-center p-4">
          <div className="bg-[#252526] border border-[#4ec9b0] p-4 max-w-sm w-full text-center space-y-3 shadow-lg">
            <div className="w-9 h-9 bg-[#4ec9b0]/20 border border-[#4ec9b0] text-[#4ec9b0] flex items-center justify-center mx-auto">
              <Trophy className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                {simState.secretExitTriggered
                  ? 'Secret Sector Exit Reached!'
                  : 'Sector Cleared — Level Complete'}
              </h3>
              <p className="text-[11px] text-[#cccccc] mt-1">
                {latestMessage
                  ? latestMessage.text
                  : 'All mission extraction objectives verified.'}
              </p>
            </div>

            <div className="bg-[#1b1b1c] border border-[#333333] p-2.5 text-[11px] font-mono space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-[#858585]">Completion Time:</span>
                <span className="text-white font-semibold tabular-nums">
                  {completionSeconds}s ({simState.tick} ticks)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#858585]">Secrets Discovered:</span>
                <span className="text-[#4ec9b0] font-semibold tabular-nums">
                  {simState.secretsFound} / {Math.max(1, totalSecretEvents)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#858585]">Hostiles Eliminated:</span>
                <span className="text-[#cccccc] font-semibold tabular-nums">
                  {combatState.kills} / {combatState.totalEnemies}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onRespawnPlayer}
              className="ide-btn ide-btn--primary w-full"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Replay Level from Start</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Bottom Tactical Player Status HUD Deck */}
      <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 z-10 flex flex-wrap items-end justify-between gap-2">
        {/* Left Pod: Dynamic Player Health Bar & Hostile Kill Tracker */}
        <div className="pointer-events-auto bg-[#252526]/95 border border-[#3e3e42] p-2 min-w-[200px]">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-1">
              <Heart className="w-3.5 h-3.5 text-[#d14d41]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc]">
                Health
              </span>
            </div>
            <span className="text-xs font-mono font-semibold tabular-nums text-white">
              {combatState.health} / {combatState.maxHealth}
            </span>
          </div>

          <div className="w-full h-2 bg-[#181818] border border-[#333333]">
            <div
              className={`h-full transition-all duration-150 ${healthBarColor}`}
              style={{ width: `${healthPct}%` }}
            />
          </div>

          <div className="mt-1.5 pt-1 border-t border-[#333333] flex items-center justify-between text-[10px] font-mono text-[#858585]">
            <span className="flex items-center gap-1">
              <Skull className="w-3 h-3 text-[#d14d41]" />
              <span>Hostiles Cleared:</span>
            </span>
            <span className="text-[#cccccc] font-semibold tabular-nums">
              {combatState.kills} / {combatState.totalEnemies}
            </span>
          </div>

          <div className="mt-1 pt-1 border-t border-[#333333] flex items-center justify-between gap-2 text-[10px] font-mono text-[#858585]">
            <span className="flex items-center gap-1">
              <Key className="w-3 h-3 text-[#f59e0b]" />
              <span>Keys:</span>
              <span className="text-[#f59e0b] font-semibold">
                {playerItems.length > 0 ? playerItems.join(', ') : 'None'}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#4ec9b0]" />
              <span>Secrets:</span>
              <span className="text-[#4ec9b0] font-semibold tabular-nums">
                {simState.secretsFound}/{Math.max(1, totalSecretEvents)}
              </span>
            </span>
          </div>
        </div>

        {/* Right Pod: Dynamic Ammo Counter & Fire/Reload Controls */}
        <div className="pointer-events-auto bg-[#252526]/95 border border-[#3e3e42] p-2 min-w-[215px]">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-[#478cbf]" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#cccccc]">
                Plasma Ammo
              </span>
            </div>
            <span className="text-xs font-mono font-semibold tabular-nums text-white">
              {combatState.ammo} / {combatState.maxAmmo}
            </span>
          </div>

          <div className="w-full h-2 bg-[#181818] border border-[#333333] mb-2">
            <div
              className={`h-full transition-all duration-100 ${
                combatState.ammo > 8 ? 'bg-[#478cbf]' : 'bg-[#d14d41]'
              }`}
              style={{
                width: `${Math.min(
                  100,
                  (combatState.ammo / combatState.maxAmmo) * 100
                )}%`,
              }}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onFireWeapon}
              disabled={combatState.ammo <= 0 || combatState.isDead}
              className="ide-btn ide-btn--primary flex-1"
              title="Fire Plasma Rifle (Click 3D Viewport or Press F)"
            >
              <Crosshair className="w-3 h-3" />
              <span>Fire [LMB/F]</span>
            </button>

            <button
              type="button"
              onClick={onReloadAmmo}
              className="ide-btn"
              title="Reload Plasma Cells (Shortcut: R)"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reload [R]</span>
            </button>

            <button
              type="button"
              onClick={onUseAction}
              disabled={combatState.isDead || simState.levelEnded}
              className="ide-btn"
              title="Use Door / Push Secret Wall / Activate Switch (Shortcut: E or Space)"
            >
              <Hand className="w-3 h-3" />
              <span>Use [E]</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
