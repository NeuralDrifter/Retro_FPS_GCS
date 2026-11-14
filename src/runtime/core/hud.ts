/**
 * HUD updates: pushes combat, key and enemy state to the HUD controllers.
 * Moved out of startGame.ts in P1.4; every function takes the run's RuntimeContext first.
 */
/**
 * ============================================================================
 * STANDALONE ENGINE RUNTIME ENTRY POINT (`startGame`)
 * ============================================================================
 * Pure Three.js + Vanilla DOM runtime with zero React or editor dependencies.
 * Extracted from Viewport3D.tsx for 1:1 parity between editor preview and
 * standalone exported games.
 */

import {
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
} from '../../sim';
import type { RuntimeContext } from './RuntimeState';

export function hudEnemyTotals(
  ctx: RuntimeContext,
  snapshot: { kills: number; totalEnemies: number }): {
  kills: number;
  totalEnemies: number;
} {
  const { rt } = ctx;
  if (!rt.aiEnemiesLoaded && snapshot.totalEnemies < rt.combatState.totalEnemies) {
    return { kills: snapshot.kills, totalEnemies: rt.combatState.totalEnemies };
  }
  rt.aiEnemiesLoaded = true;
  return { kills: snapshot.kills, totalEnemies: snapshot.totalEnemies };
}

export function syncHud(ctx: RuntimeContext): void {
  const { rt } = ctx;
  const hideHudForMenu = Boolean(rt.menuController?.shouldHideCombatHud());
  if (rt.combatHud) {
    rt.combatHud.setVisible(!hideHudForMenu);
    const currentTitle =
      rt.campaignLevels[rt.currentLevelIndex]?.metadata?.title ||
      `Level ${rt.currentLevelIndex + 1}`;
    const nextTitle =
      rt.currentLevelIndex + 1 < rt.campaignLevels.length
        ? rt.campaignLevels[rt.currentLevelIndex + 1]?.metadata?.title ||
          `Level ${rt.currentLevelIndex + 2}`
        : undefined;
    rt.combatHud.update({
      combatState: rt.combatState,
      simState: rt.currSimState,
      isMuzzleFlashing: rt.isMuzzleFlashing,
      isHitMarkerActive: rt.isHitMarkerActive,
      isPlayerHurtFlashing: rt.isPlayerHurtFlashing,
      currentLevelIndex: rt.currentLevelIndex,
      totalLevels: rt.campaignLevels.length,
      currentLevelTitle: currentTitle,
      nextLevelTitle: nextTitle,
      campaign: rt.campaignSettings,
    });
  }
  if (rt.minimapHud) {
    rt.minimapHud.update({
      visible: rt.minimapEnabled && !hideHudForMenu,
      grid: rt.grid,
      entities: rt.entities,
      enemySnapshots: rt.enemySnapshots,
      ammoDrops: rt.ammoDrops,
      playerTransform: rt.playerTransform,
      collectedKeys: getCollectedKeysSetFromSim(rt.currSimState),
      openDoors: getOpenDoorsSetFromSim(rt.currSimState),
    });
  }
  rt.menuController?.syncView();
}
