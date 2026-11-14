/**
 * ============================================================================
 * PURE DETERMINISTIC SIMULATION ENTITY SYSTEM
 * ============================================================================
 * Handles entity spawning, waking, damage, death, all-dead triggers, and
 * per-tick AI updates (chasing, turning, attacking, vertical movement).
 */

import {
  ActivatorContext,
  SIM_CONFIG,
  SimCellType,
  SimEntityState,
  SimulationState,
} from './types';
import { gridToWorldUnits, worldUnitsToGrid } from './raycast';
import {
  TRIG_SCALE,
  bamAtan2,
  bamCos,
  bamSin,
  normalizeBam,
  shortestBamDelta,
} from './trigTable';
import { moveSimEntityVertical } from './verticalMovement';
import { TickExecutionBudget } from './moverSim';

export function wakeEntitiesInSim(
  state: SimulationState,
  tag?: number,
  regionId?: string
): void {
  if (!state.entities) return;

  let alertedAny = false;
  const reg = regionId
    ? state.regions.find((r) => r.id === regionId)
    : undefined;

  for (const ent of Object.values(state.entities)) {
    if (!ent.isEnemy || ent.state === 'dead') continue;

    let matches = false;
    if (tag !== undefined && tag > 0 && ent.tag === tag) {
      matches = true;
    }
    if (reg && reg.cells.some((c) => c.row === ent.row && c.col === ent.col)) {
      matches = true;
    }
    if (!tag && !regionId) {
      matches = true;
    }

    if (matches) {
      ent.ambush = false;
      ent.state = 'chase';
      alertedAny = true;
    }
  }

  if (alertedAny) {
    state.soundsPlayed.push({
      tick: state.tick,
      soundId: 'enemy_alert',
    });
  }
}

export function spawnEntityInSim(
  state: SimulationState,
  act: {
    blueprintId:
      | 'sentinel-bot'
      | 'turret-guardian'
      | 'supply-crate'
      | 'custom-glb';
    row: number;
    col: number;
    yaw_bam?: number;
    tag?: number;
    ambush?: boolean;
    isEnemy?: boolean;
    maxHealth?: number;
  }
): SimEntityState {
  if (!state.entities) {
    state.entities = {};
  }
  const newId = `ent-${state.nextEntityId}`;
  state.nextEntityId += 1;

  const world = gridToWorldUnits(act.row, act.col, state.gridSize);
  const ent: SimEntityState = {
    id: newId,
    blueprintId: act.blueprintId,
    name:
      act.blueprintId === 'sentinel-bot'
        ? 'Cyber Sentinel Bot'
        : act.blueprintId === 'turret-guardian'
        ? 'Heavy Mech Stalker'
        : 'Supply Crate',
    row: Math.trunc(act.row),
    col: Math.trunc(act.col),
    xUnits: world.xUnits,
    zUnits: world.zUnits,
    yUnits: state.floorHeights[act.row]?.[act.col] ?? 0,
    yawBam: normalizeBam(act.yaw_bam ?? 0),
    health: Math.max(1, Math.trunc(act.maxHealth ?? 75)),
    maxHealth: Math.max(1, Math.trunc(act.maxHealth ?? 75)),
    isEnemy: act.isEnemy !== false && act.blueprintId !== 'supply-crate',
    state: act.ambush ? 'idle' : 'chase',
    tag: Math.trunc(act.tag ?? 0),
    ambush: Boolean(act.ambush),
    attackDamage: 12,
    speedUnitsPerTick: 40,
    attackCooldownTicks: 0,
    hitFlashTicks: 0,
    memoryTicks: 0,
  };

  state.entities[newId] = ent;
  state.soundsPlayed.push({
    tick: state.tick,
    soundId: 'enemy_alert',
    row: act.row,
    col: act.col,
  });
  return ent;
}

export function removeEntityInSim(
  state: SimulationState,
  entityId?: string,
  tag?: number
): void {
  if (!state.entities) return;
  for (const k of Object.keys(state.entities)) {
    const e = state.entities[k];
    if (
      (entityId && e.id === entityId) ||
      (tag !== undefined && tag > 0 && e.tag === tag)
    ) {
      e.state = 'dead';
      e.health = 0;
    }
  }
}

export function damageEntityInSim(
  state: SimulationState,
  entityId: string | undefined,
  tag: number | undefined,
  amount: number,
  budget: TickExecutionBudget,
  activator: ActivatorContext
): void {
  if (!state.entities) return;
  for (const k of Object.keys(state.entities)) {
    const ent = state.entities[k];
    if (
      ent.state !== 'dead' &&
      ((entityId && ent.id === entityId) ||
        (tag !== undefined && tag > 0 && ent.tag === tag))
    ) {
      ent.health = Math.max(0, ent.health - Math.trunc(amount));
      ent.hitFlashTicks = 4;
      if (ent.health <= 0) {
        ent.state = 'dead';
        state.soundsPlayed.push({
          tick: state.tick,
          soundId: 'enemy_death',
          row: ent.row,
          col: ent.col,
        });
        budget.queuedTriggers.push({
          type: 'entity_killed',
          activator,
          entityId: ent.id,
          tag: ent.tag,
          item: ent.blueprintId,
        });
        checkAllDeadTriggers(state, budget, activator);
      }
    }
  }
}

export function checkAllDeadTriggers(
  state: SimulationState,
  budget: TickExecutionBudget,
  activator: ActivatorContext
): void {
  const ents = Object.values(state.entities ?? {});
  const livingEnemies = ents.filter((e) => e.isEnemy && e.state !== 'dead');

  if (ents.some((e) => e.isEnemy) && livingEnemies.length === 0) {
    budget.queuedTriggers.push({
      type: 'all_dead',
      activator,
    });
  }

  for (const reg of state.regions) {
    const regEnts = ents.filter(
      (e) =>
        e.isEnemy && reg.cells.some((c) => c.row === e.row && c.col === e.col)
    );
    if (regEnts.length > 0 && regEnts.every((e) => e.state === 'dead')) {
      budget.queuedTriggers.push({
        type: 'all_dead',
        activator,
        region: reg.id,
      });
    }
  }

  const tagsChecked = new Set<number>();
  for (const ent of ents) {
    if (ent.tag > 0 && !tagsChecked.has(ent.tag)) {
      tagsChecked.add(ent.tag);
      const tagged = ents.filter((e) => e.isEnemy && e.tag === ent.tag);
      if (tagged.length > 0 && tagged.every((e) => e.state === 'dead')) {
        budget.queuedTriggers.push({
          type: 'all_dead',
          activator,
          tag: ent.tag,
        });
      }
    }
  }
}

export function updateEntitiesForTick(
  state: SimulationState,
  budget: TickExecutionBudget
): void {
  if (!state.entities) return;

  const entKeys = Object.keys(state.entities).sort();
  const player = state.players[0];
  if (!player || player.isDead) return;

  for (const k of entKeys) {
    const ent = state.entities[k];
    if (!ent || !ent.isEnemy || ent.state === 'dead') continue;

    if (ent.hitFlashTicks > 0) ent.hitFlashTicks -= 1;
    if (ent.attackCooldownTicks > 0) ent.attackCooldownTicks -= 1;

    const dx = player.xUnits - ent.xUnits;
    const dz = player.zUnits - ent.zUnits;
    const distSq = dx * dx + dz * dz;

    if (ent.state === 'idle') {
      if (!ent.ambush) {
        if (distSq < 36_000_000) {
          ent.state = 'chase';
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'enemy_alert',
            row: ent.row,
            col: ent.col,
          });
          budget.queuedTriggers.push({
            type: 'entity_alerted',
            activator: { kind: 'entity', playerId: 0, entityId: ent.id },
            entityId: ent.id,
            tag: ent.tag,
          });
        }
      }
      continue;
    }

    if (ent.state === 'chase' || ent.state === 'attack') {
      const targetYaw = bamAtan2(dx, dz);
      const deltaYaw = shortestBamDelta(ent.yawBam, targetYaw);
      const maxTurn = 1024;
      const turnStep = Math.max(-maxTurn, Math.min(maxTurn, deltaYaw));
      ent.yawBam = normalizeBam(ent.yawBam + turnStep);

      // On vertical levels the attack also needs the player at about the same height
      const sameHeight =
        !state.vertical ||
        Math.abs((player.feetUnits ?? 0) - ent.yUnits) <= SIM_CONFIG.LAYER_HEIGHT_UNITS / 2;
      if (distSq <= 600 * 600 && sameHeight) {
        ent.state = 'attack';
        if (ent.attackCooldownTicks === 0) {
          ent.attackCooldownTicks = 20;
          player.health = Math.max(0, player.health - ent.attackDamage);
          if (player.health === 0) {
            player.isDead = true;
          }
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'enemy_alert',
            row: ent.row,
            col: ent.col,
          });
        }
      } else {
        ent.state = 'chase';
        const sinYaw = bamSin(ent.yawBam);
        const cosYaw = bamCos(ent.yawBam);
        const stepX = Math.trunc(
          (-sinYaw * ent.speedUnitsPerTick) / TRIG_SCALE
        );
        const stepZ = Math.trunc(
          (-cosYaw * ent.speedUnitsPerTick) / TRIG_SCALE
        );

        const nextX = ent.xUnits + stepX;
        const nextZ = ent.zUnits + stepZ;
        const nextCell = worldUnitsToGrid(nextX, nextZ, state.gridSize);

        if (state.vertical) {
          moveSimEntityVertical(state, state.vertical, ent, nextX, nextZ);
          continue;
        }

        const isWall =
          state.grid[nextCell.row]?.[nextCell.col] === SimCellType.WALL ||
          (state.solidFootprint?.[nextCell.row]?.[nextCell.col] ?? 0) > 0;
        const doorMover =
          state.movers[`door:${nextCell.row},${nextCell.col}`];
        const isClosedDoor = doorMover && doorMover.state !== 'open';

        if (
          !isWall &&
          !isClosedDoor &&
          nextCell.row >= 0 &&
          nextCell.row < state.gridSize &&
          nextCell.col >= 0 &&
          nextCell.col < state.gridSize
        ) {
          ent.xUnits = nextX;
          ent.zUnits = nextZ;
          ent.row = nextCell.row;
          ent.col = nextCell.col;
          ent.yUnits = state.floorHeights[nextCell.row]?.[nextCell.col] ?? 0;
        }
      }
    }
  }
}
