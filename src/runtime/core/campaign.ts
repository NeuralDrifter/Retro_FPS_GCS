/**
 * Respawn and campaign flow: resets to spawn, loads levels, advances and restarts the campaign.
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
  ENGINE_CONFIG,
} from '../types';
import { verticalFromLevelV3 } from '../verticalLevelData';
import {
  bamToRadians,
  createInitialSimulationState,
  isVerticalLevel,
} from '../../sim';
import {
  RuntimeLevelSerializer,
  placedEntitiesFromLevelV3,
} from '../LevelSerializer';
import { CollisionSystem } from '../CollisionSystem';
import type { RuntimeContext } from './RuntimeState';
import { UNITS_TO_METERS } from './constants';
import { syncHud } from './hud';
import { emitLog } from './combat';
import { updateSkybox, rebuild3DWorld } from './WorldView';
import { runSingleSimTick } from './simTick';

export function teleportToSpawn(ctx: RuntimeContext): void {
  const { rt, options, euler } = ctx;
  const levelV3 = RuntimeLevelSerializer.serializeLevelV3({
    grid: rt.grid,
    wallTextures: rt.wallTextures,
    floorTextures: rt.floorTextures,
    ceilingTextures: rt.ceilingTextures,
    entities: rt.entities,
    spawn: rt.spawn,
    skyboxTheme: rt.skyboxTheme,
    skyboxSeed: rt.skyboxSeed,
    showCeiling: rt.showCeiling,
    minimapEnabled: rt.minimapEnabled,
    cellTags: rt.currSimState.cellTags,
    events: rt.currSimState.events,
    regions: rt.currSimState.regions,
    variables: {
      flags: rt.currSimState.flags,
      counters: rt.currSimState.counters,
      timers: Object.keys(rt.currSimState.timers),
    },
    vertical: rt.vertical,
  });
  const freshSim = createInitialSimulationState(levelV3, [0]);
  const spawnEyeY = freshSim.vertical
    ? (freshSim.players[0]?.yUnits ?? 0) * UNITS_TO_METERS
    : ENGINE_CONFIG.PLAYER_EYE_HEIGHT;
  rt.prevSimState = freshSim;
  rt.currSimState = freshSim;
  rt.lastLogCount = freshSim.logs.length;
  rt.lastSoundCount = freshSim.soundsPlayed.length;
  options.onSimStateChange?.(freshSim);

  const { x, z } = CollisionSystem.gridToWorld(
    rt.spawn.row,
    rt.spawn.col,
    rt.grid.length
  );
  if (rt.camera) {
    rt.camera.position.set(x, spawnEyeY, z);
    euler.set(0, rt.spawn.yaw, 0, 'YXZ');
    rt.camera.quaternion.setFromEuler(euler);
  }

  rt.playerTransform = {
    x,
    y: spawnEyeY,
    z,
    yaw: rt.spawn.yaw,
    pitch: 0,
    gridRow: rt.spawn.row,
    gridCol: rt.spawn.col,
    speed: 0,
  };
  options.onPlayerMove?.(rt.playerTransform);

  rt.combatState = {
    ...rt.combatState,
    health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: Math.max(rt.combatState.ammo, ENGINE_CONFIG.PLAYER_START_AMMO),
    isDead: false,
    lastHitEnemyName: null,
    lastHitEnemyHealth: null,
    lastHitEnemyMaxHealth: null,
  };
  syncHud(ctx);
}

export function handleFullRespawn(ctx: RuntimeContext): void {
  teleportToSpawn(ctx);
  rebuild3DWorld(ctx);
  emitLog(ctx, 
    'Engine: Reset level simulation state, restored player health & ammo, and respawned Enemy AI.'
  );
}

export function loadCampaignLevel(
  ctx: RuntimeContext,
  targetIdx: number,
  entryStats?: { health?: number; ammo?: number }
): void {
  const { rt, options, euler, inputReader, countLevelEnemies } = ctx;
  if (rt.campaignLevels.length === 0) return;
  const clampedIdx = Math.max(
    0,
    Math.min(rt.campaignLevels.length - 1, Math.trunc(targetIdx))
  );
  rt.currentLevelIndex = clampedIdx;
  rt.currentLevelV3 = rt.campaignLevels[clampedIdx];

  rt.grid = rt.currentLevelV3.grid.map((r) => [...r]);
  rt.wallTextures = rt.currentLevelV3.wallTextures.map((r) => [...r]);
  rt.floorTextures = rt.currentLevelV3.floorTextures.map((r) => [...r]);
  rt.ceilingTextures = rt.currentLevelV3.ceilingTextures.map((r) => [...r]);
  rt.entities = placedEntitiesFromLevelV3(rt.currentLevelV3);
  rt.spawn = {
    row: rt.currentLevelV3.spawn.row,
    col: rt.currentLevelV3.spawn.col,
    yaw: bamToRadians(rt.currentLevelV3.spawn.yawBam),
  };
  rt.skyboxTheme = rt.currentLevelV3.skybox.theme;
  rt.skyboxSeed = rt.currentLevelV3.skybox.seed;
  rt.showCeiling = rt.currentLevelV3.skybox.showCeiling ?? rt.showCeiling;
  rt.minimapEnabled = rt.currentLevelV3.minimapEnabled ?? rt.minimapEnabled;
  rt.vertical = isVerticalLevel(rt.currentLevelV3)
    ? verticalFromLevelV3(rt.currentLevelV3)
    : undefined;

  const startHealth =
    entryStats?.health !== undefined
      ? Math.max(
          1,
          Math.min(ENGINE_CONFIG.PLAYER_MAX_HEALTH, Math.round(entryStats.health))
        )
      : ENGINE_CONFIG.PLAYER_MAX_HEALTH;
  const startAmmo =
    entryStats?.ammo !== undefined
      ? Math.max(
          0,
          Math.min(ENGINE_CONFIG.PLAYER_MAX_AMMO, Math.round(entryStats.ammo))
        )
      : ENGINE_CONFIG.PLAYER_START_AMMO;

  rt.levelEntryState = { health: startHealth, ammo: startAmmo };

  const freshSim = createInitialSimulationState(rt.currentLevelV3, [0]);
  if (freshSim.players[0]) {
    freshSim.players[0].health = startHealth;
    freshSim.players[0].ammo = startAmmo;
  }

  rt.prevSimState = freshSim;
  rt.currSimState = freshSim;
  rt.lastLogCount = freshSim.logs.length;
  rt.lastSoundCount = freshSim.soundsPlayed.length;

  rt.enemySnapshots = [];
  rt.ammoDrops = [];
  rt.combatState = {
    health: startHealth,
    maxHealth: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: startAmmo,
    maxAmmo: ENGINE_CONFIG.PLAYER_MAX_AMMO,
    kills: 0,
    totalEnemies: countLevelEnemies(),
    isDead: false,
    lastHitEnemyName: null,
    lastHitEnemyHealth: null,
    lastHitEnemyMaxHealth: null,
  };

  const spawnEyeY = freshSim.vertical
    ? (freshSim.players[0]?.yUnits ?? 0) * UNITS_TO_METERS
    : ENGINE_CONFIG.PLAYER_EYE_HEIGHT;
  const { x, z } = CollisionSystem.gridToWorld(
    rt.spawn.row,
    rt.spawn.col,
    rt.grid.length
  );
  if (rt.camera) {
    rt.camera.position.set(x, spawnEyeY, z);
    euler.set(0, rt.spawn.yaw, 0, 'YXZ');
    rt.camera.quaternion.setFromEuler(euler);
  }

  rt.playerTransform = {
    x,
    y: spawnEyeY,
    z,
    yaw: rt.spawn.yaw,
    pitch: 0,
    gridRow: rt.spawn.row,
    gridCol: rt.spawn.col,
    speed: 0,
  };
  options.onPlayerMove?.(rt.playerTransform);

  updateSkybox(ctx);
  rebuild3DWorld(ctx);

  if (!inputReader && rt.currSimState.tick === 0) {
    runSingleSimTick(ctx, 0);
  }

  options.onSimStateChange?.(rt.currSimState);
  options.onLevelChange?.(
    rt.currentLevelIndex,
    { health: startHealth, ammo: startAmmo },
    rt.currSimState
  );
  syncHud(ctx);
}

export function handleAdvanceToNextLevel(ctx: RuntimeContext): void {
  const { rt } = ctx;
  if (rt.currentLevelIndex + 1 >= rt.campaignLevels.length) {
    return;
  }
  const rawHealth =
    rt.combatState.health !== rt.levelEntryState.health
      ? rt.combatState.health
      : rt.currSimState.players[0]?.health ?? rt.combatState.health;
  const rawAmmo =
    rt.combatState.ammo !== rt.levelEntryState.ammo
      ? rt.combatState.ammo
      : rt.currSimState.players[0]?.ammo ?? rt.combatState.ammo;

  const nextHealth = rt.campaignSettings.carryOverHealth
    ? Math.max(1, Math.min(rt.combatState.maxHealth, Math.round(rawHealth)))
    : ENGINE_CONFIG.PLAYER_MAX_HEALTH;
  const nextAmmo = rt.campaignSettings.carryOverAmmo
    ? Math.max(0, Math.min(rt.combatState.maxAmmo, Math.round(rawAmmo)))
    : ENGINE_CONFIG.PLAYER_START_AMMO;

  const nextIdx = rt.currentLevelIndex + 1;
  const nextTitle =
    rt.campaignLevels[nextIdx]?.metadata?.title || `Level ${nextIdx + 1}`;
  loadCampaignLevel(ctx, nextIdx, { health: nextHealth, ammo: nextAmmo });
  emitLog(ctx, 
    `Campaign: Advanced to Level ${nextIdx + 1}/${rt.campaignLevels.length} ('${nextTitle}') — Health: ${nextHealth} HP (${
      rt.campaignSettings.carryOverHealth ? 'Carried Over' : 'Reset'
    }), Ammo: ${nextAmmo} (${
      rt.campaignSettings.carryOverAmmo ? 'Carried Over' : 'Reset'
    }).`
  );
}

export function handleRestartCampaign(ctx: RuntimeContext): void {
  const { rt } = ctx;
  loadCampaignLevel(ctx, 0, {
    health: ENGINE_CONFIG.PLAYER_MAX_HEALTH,
    ammo: ENGINE_CONFIG.PLAYER_START_AMMO,
  });
  emitLog(ctx, 
    `Campaign: Restarted campaign at Level 1/${rt.campaignLevels.length} with full Health & Ammo.`
  );
}
