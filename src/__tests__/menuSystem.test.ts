import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createDefaultMenuPack,
  createMenuPackFromPreset,
  collectMenuTextureIds,
  MenuRuntimeController,
  createGameManifest,
  migrateGameManifest,
  validateGameManifest,
  collectAllReferencedAssets,
  createInitialSimulationState,
} from '../runtime';
import { createMinimalArenaTestLevel } from './determinismFixtures';

describe('UI Menu System: Main Menu Studio & In-Game Overlay Builder', () => {
  it('creates default and preset MenuPackSpecs with Out-of-Game Main Menu and In-Game Overlay screens', () => {
    const pack = createDefaultMenuPack('CYBER SECTOR 7');
    assert.equal(pack.schemaVersion, 1);
    assert.equal(pack.enableMainMenuOnBoot, true);
    assert.equal(pack.enablePauseOverlay, true);
    assert.ok(pack.screens.length >= 5);

    const mainScreen = pack.screens.find((s) => s.id === pack.entryMainMenuScreenId);
    assert.ok(mainScreen, 'Entry main menu screen should exist');
    assert.equal(mainScreen!.category, 'main-menu');
    assert.equal(mainScreen!.backgroundConfig.type, '3d-scene');

    const pauseOverlay = pack.screens.find((s) => s.id === pack.pauseOverlayScreenId);
    assert.ok(pauseOverlay, 'Pause overlay screen should exist');
    assert.equal(pauseOverlay!.category, 'in-game-overlay');
    assert.equal(pauseOverlay!.overlayConfig?.pauseSimulation, true);
    assert.equal(pauseOverlay!.overlayConfig?.triggerHotkey, 'Escape');

    // Test switching presets
    const retroPack = createMenuPackFromPreset('retro-shareware', 'IRONFORGE');
    assert.equal(retroPack.presetId, 'retro-shareware');
    const minimalPack = createMenuPackFromPreset('minimal-cyber', 'NEON GRID');
    assert.equal(minimalPack.presetId, 'minimal-cyber');
  });

  it('collects custom UI texture IDs referenced in MenuPackSpec for standalone bundling', () => {
    const pack = createDefaultMenuPack('TEXTURE TEST');
    pack.screens[0].backgroundConfig = {
      type: 'image',
      textureId: 'custom-hero-bg',
      fitMode: 'cover',
      tintHex: '#000000',
      vignetteStrength: 0.5,
    };
    pack.screens[0].widgets[0].style.backgroundTextureId = 'custom-btn-skin';
    pack.screens[0].widgets.push({
      id: 'logo-img',
      type: 'image',
      name: 'Logo',
      imageTextureId: 'custom-crest-emblem',
      rect: { xPct: 10, yPct: 10, widthPct: 20, heightPct: 10, zIndex: 5 },
      style: { ...pack.screens[0].widgets[0].style },
    });

    const texIds = collectMenuTextureIds(pack);
    assert.ok(texIds.includes('custom-hero-bg'));
    assert.ok(texIds.includes('custom-btn-skin'));
    assert.ok(texIds.includes('custom-crest-emblem'));

    const level = createMinimalArenaTestLevel();
    const allRefs = collectAllReferencedAssets({
      ...level,
      campaign: {
        carryOverHealth: true,
        carryOverAmmo: true,
        menus: pack,
      },
    } as any);
    assert.ok(allRefs.textureIds.includes('custom-hero-bg'));
    assert.ok(allRefs.textureIds.includes('custom-btn-skin'));
    assert.ok(allRefs.textureIds.includes('custom-crest-emblem'));
  });

  it('preserves campaign.menus across GameManifest creation, migration, and validation', () => {
    const level = createMinimalArenaTestLevel();
    const menus = createMenuPackFromPreset('tactical-gridforge', 'MANIFEST MENU GAME');

    const manifest = createGameManifest(
      {
        ...level,
        campaign: {
          carryOverHealth: true,
          carryOverAmmo: true,
          menus,
        },
      } as any,
      { title: 'MANIFEST MENU GAME' }
    );

    assert.ok(manifest.campaign?.menus);
    assert.equal(manifest.campaign?.menus?.presetId, 'tactical-gridforge');
    assert.equal(manifest.campaign?.menus?.screens.length, menus.screens.length);

    const validation = validateGameManifest(manifest);
    assert.equal(validation.valid, true, validation.errors.join(', '));

    const roundTripped = migrateGameManifest(JSON.parse(JSON.stringify(manifest)));
    assert.ok(roundTripped.campaign?.menus);
    assert.equal(roundTripped.campaign?.menus?.entryMainMenuScreenId, 'screen-main-menu');
  });

  it('transitions cleanly through MAIN_MENU -> ACTIVE_GAMEPLAY -> IN_GAME_OVERLAY -> RESUME_GAME in MenuRuntimeController', () => {
    const level = createMinimalArenaTestLevel();
    const simState = createInitialSimulationState(level, [0]);
    const menus = createDefaultMenuPack('FSM TEST');
    const eventsLog: string[] = [];

    const controller = new MenuRuntimeController(
      null,
      menus,
      {
        getGameTitle: () => 'FSM TEST',
        getCombatState: () => ({
          health: 100,
          maxHealth: 100,
          ammo: 32,
          maxAmmo: 100,
          kills: 0,
          totalEnemies: 1,
          isDead: false,
          lastHitEnemyName: null,
          lastHitEnemyHealth: null,
          lastHitEnemyMaxHealth: null,
        }),
        getSimState: () => simState,
        getCurrentLevelIndex: () => 0,
        getTotalLevels: () => 1,
        getCurrentLevelTitle: () => 'Sector Alpha',
        getElapsedSeconds: () => 12,
        getCustomTextures: () => [],
        onStartNewGame: (lvl) => {
          eventsLog.push(`START_LEVEL:${lvl}`);
        },
        onResumeGame: () => {
          eventsLog.push('RESUME');
        },
        onRestartCurrentLevel: () => {
          eventsLog.push('RESTART');
        },
        onRestoreCheckpoint: () => {
          eventsLog.push('RESTORE');
        },
        onFireSimEvent: (action) => {
          eventsLog.push(`SIM_EVENT:${action.flagName}`);
        },
        onQuitToMainMenu: () => {
          eventsLog.push('QUIT_MAIN');
        },
        onApplySettings: () => {},
        onAppStateChange: (state, screen) => {
          eventsLog.push(`STATE:${state}:${screen?.id ?? 'none'}`);
        },
      },
      { startInMainMenu: true }
    );

    assert.equal(controller.getAppState(), 'MAIN_MENU');
    assert.equal(controller.isSimulationPaused(), true);
    assert.equal(controller.getActiveScreen()?.id, 'screen-main-menu');

    // Navigate to Options sub-menu from Main Menu
    controller.executeAction({ type: 'OPEN_MENU_SCREEN', screenId: 'screen-options' });
    assert.equal(controller.getActiveScreen()?.id, 'screen-options');
    assert.equal(controller.getAppState(), 'MAIN_MENU');

    // Return back to Main Menu
    controller.executeAction({ type: 'BACK_MENU_SCREEN' });
    assert.equal(controller.getActiveScreen()?.id, 'screen-main-menu');

    // Start New Game -> transitions to ACTIVE_GAMEPLAY and unpauses simulation
    controller.executeAction({ type: 'START_NEW_GAME', startLevelIndex: 0 });
    assert.equal(controller.getAppState(), 'ACTIVE_GAMEPLAY');
    assert.equal(controller.isSimulationPaused(), false);
    assert.ok(eventsLog.includes('START_LEVEL:0'));

    // Trigger ESC hotkey during gameplay -> opens Pause Overlay and pauses simulation
    const handledEsc = controller.handleKeyDown('Escape');
    assert.equal(handledEsc, true);
    assert.equal(controller.getAppState(), 'IN_GAME_OVERLAY');
    assert.equal(controller.getActiveScreen()?.id, 'screen-pause-overlay');
    assert.equal(controller.isSimulationPaused(), true);

    // Dispatch FIRE_SIM_EVENT from an overlay button
    controller.executeAction({
      type: 'FIRE_SIM_EVENT',
      flagName: 'armory_unlocked',
      flagValue: true,
    });
    assert.ok(eventsLog.includes('SIM_EVENT:armory_unlocked'));

    // Resume Game -> closes overlay and unpauses simulation
    controller.executeAction({ type: 'RESUME_GAME' });
    assert.equal(controller.getAppState(), 'ACTIVE_GAMEPLAY');
    assert.equal(controller.isSimulationPaused(), false);

    // Trigger KeyI hotkey during gameplay -> opens Inventory Hub Overlay
    const handledInv = controller.handleKeyDown('KeyI');
    assert.equal(handledInv, true);
    assert.equal(controller.getAppState(), 'IN_GAME_OVERLAY');
    assert.equal(controller.getActiveScreen()?.id, 'screen-inventory-overlay');

    controller.dispose();
  });
});
