/**
 * Mounts the combat HUD, the minimap and the menu controller over the game (moved out of
 * startGame.ts in P1.4). Without a HUD root (headless runs) nothing is mounted.
 */
import type { GameManifest } from '../types';
/**
 * ============================================================================
 * STANDALONE ENGINE RUNTIME ENTRY POINT (`startGame`)
 * ============================================================================
 * Pure Three.js + Vanilla DOM runtime with zero React or editor dependencies.
 * Extracted from Viewport3D.tsx for 1:1 parity between editor preview and
 * standalone exported games.
 */

import {
  ENGINE_CONFIG,
} from '../types';
import type { RuntimeContext } from './RuntimeState';
import { syncHud } from './hud';
import { emitLog, handleFireWeapon, handleReloadAmmo } from './combat';
import { rebuild3DWorld } from './WorldView';
import { handleFullRespawn, loadCampaignLevel, handleAdvanceToNextLevel, handleRestartCampaign } from './campaign';
import { SoundEffects } from '../SoundEffects';
import { CombatHUDController } from '../hud/CombatHUD';
import { MinimapHUDController } from '../hud/MinimapHUD';
import {
  MenuRuntimeController,
} from '../menu';

export function mountHudAndMenus(
  ctx: RuntimeContext,
  resolvedHudRoot: HTMLElement | null,
  requestPointerLockSafely: () => void,
  activeManifest: GameManifest
): void {
  const { rt, options, input, isReplayOrDeterministic } = ctx;
  // Mount vanilla HUDs if hudRoot is provided or defaulted to container
  if (resolvedHudRoot) {
    rt.combatHud = new CombatHUDController(resolvedHudRoot, {
      onFireWeapon: () => handleFireWeapon(ctx),
      onReloadAmmo: () => handleReloadAmmo(ctx),
      onUseAction: () => {
        input.pendingUse = true;
      },
      onRespawnPlayer: () => handleFullRespawn(ctx),
      onNextLevel: () => handleAdvanceToNextLevel(ctx),
      onRestartCampaign: () => handleRestartCampaign(ctx),
    });
    rt.minimapHud = new MinimapHUDController(resolvedHudRoot, () => {
      if (options.onMinimapToggleRequest) {
        options.onMinimapToggleRequest();
      } else {
        rt.minimapEnabled = false;
        syncHud(ctx);
      }
    });

    if (!isReplayOrDeterministic) {
      const bootInMainMenu =
        options.startInMainMenu !== undefined
          ? options.startInMainMenu
          : Boolean(
              rt.campaignSettings.menus?.enableMainMenuOnBoot &&
                !options.initialSimState
            );

      rt.menuController = new MenuRuntimeController(
        resolvedHudRoot,
        rt.campaignSettings.menus,
        {
          getGameTitle: () =>
            activeManifest.meta?.title ||
            rt.campaignLevels[0]?.metadata?.title ||
            'GridForge Game',
          getCombatState: () => rt.combatState,
          getSimState: () => rt.currSimState,
          getCurrentLevelIndex: () => rt.currentLevelIndex,
          getTotalLevels: () => rt.campaignLevels.length,
          getCurrentLevelTitle: () =>
            rt.campaignLevels[rt.currentLevelIndex]?.metadata?.title ||
            `Level ${rt.currentLevelIndex + 1}`,
          getElapsedSeconds: () => rt.elapsedSec,
          getCustomTextures: () => rt.customTextures,
          onStartNewGame: (startIdx) => {
            loadCampaignLevel(ctx, startIdx, {
              health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
              ammo: ENGINE_CONFIG.PLAYER_START_AMMO,
            });
            syncHud(ctx);
            requestPointerLockSafely();
            emitLog(ctx, 
              `Menu System: Launched campaign at Level ${startIdx + 1}/${rt.campaignLevels.length}.`
            );
          },
          onResumeGame: () => {
            syncHud(ctx);
            requestPointerLockSafely();
          },
          onRestartCurrentLevel: () => {
            handleFullRespawn(ctx);
            requestPointerLockSafely();
          },
          onRestoreCheckpoint: (payload) => {
            loadCampaignLevel(ctx, payload.levelIndex, {
              health: payload.combatState.health,
              ammo: payload.combatState.ammo,
            });
            rt.currSimState = payload.simState;
            rt.prevSimState = payload.simState;
            rt.combatState = { ...payload.combatState };
            rebuild3DWorld(ctx);
            syncHud(ctx);
            requestPointerLockSafely();
          },
          onFireSimEvent: (action) => {
            if (action.flagName) {
              rt.currSimState = {
                ...rt.currSimState,
                flags: {
                  ...rt.currSimState.flags,
                  [action.flagName]: action.flagValue ?? true,
                },
              };
            }
            if (action.counterName) {
              const prevVal = rt.currSimState.counters[action.counterName] ?? 0;
              rt.currSimState = {
                ...rt.currSimState,
                counters: {
                  ...rt.currSimState.counters,
                  [action.counterName]: prevVal + (action.counterDelta ?? 1),
                },
              };
            }
            options.onSimStateChange?.(rt.currSimState);
            syncHud(ctx);
          },
          onQuitToMainMenu: () => {
            if (typeof document !== 'undefined' && document.pointerLockElement) {
              try {
                document.exitPointerLock?.();
              } catch {
                // Ignore
              }
            }
            syncHud(ctx);
          },
          onApplySettings: (nextSettings) => {
            rt.runtimeSettings = { ...nextSettings };
            SoundEffects.setMasterVolume(nextSettings.masterVolume);
            rt.minimapEnabled = nextSettings.minimapEnabled;
            if (rt.camera) {
              rt.camera.fov = nextSettings.fov;
              rt.camera.updateProjectionMatrix();
            }
            syncHud(ctx);
          },
          onAppStateChange: (state, activeScreen) => {
            syncHud(ctx);
            options.onMenuStateChange?.(state, activeScreen?.id ?? null);
          },
          onEngineLog: (msg) => emitLog(ctx, msg),
        },
        { startInMainMenu: bootInMainMenu }
      );
      rt.runtimeSettings = { ...rt.menuController.getSettings() };
      SoundEffects.setMasterVolume(rt.runtimeSettings.masterVolume);
    }

    syncHud(ctx);
  }
}
