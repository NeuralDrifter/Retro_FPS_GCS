/**
 * ============================================================================
 * DETERMINISTIC EVENT & ACTION EXECUTOR
 * ============================================================================
 * Pure event evaluation, condition matching, trigger drainage, and action dispatch.
 * Runs identically in Node, browsers, and single-HTML export bundle.
 */

import {
  ActionSpec,
  ActivatorContext,
  ConditionSpec,
  EventDefinition,
  PlayerSimState,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
} from './types';
import { normalizeBam } from './trigTable';
import { nextUint32, rollPercentChance } from './rng';
import { gridToWorldUnits } from './raycast';
import { addSimLog } from './simLog';
import { cloneSimulationState } from './executor';
import {
  QueuedTriggerEvent,
  TickExecutionBudget,
  applyFloorMoverAction,
  buildStairsMover,
  closeDoorMoverAtCell,
  getTargetDoors,
  openDoorMoverAtCell,
  stopCrusherMover,
  toggleDoorMoverAtCell,
  toggleLiftMover,
} from './moverSim';
import {
  checkAllDeadTriggers,
  damageEntityInSim,
  removeEntityInSim,
  spawnEntityInSim,
  wakeEntitiesInSim,
} from './entitySim';

export function drainQueuedTriggers(
  state: SimulationState,
  budget: TickExecutionBudget
): void {
  // Process triggers in FIFO order; for each trigger, evaluate events in ascending ID order
  while (budget.queuedTriggers.length > 0) {
    const trig = budget.queuedTriggers.shift()!;
    const sortedEvents = [...state.events].sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    for (const evt of sortedEvents) {
      if (!evt.enabled) continue;
      if (!doesTriggerMatch(evt.trigger, trig)) continue;

      fireEventInstance(state, evt, trig.activator, 0, budget);
    }
  }
}

export function doesTriggerMatch(
  spec: EventDefinition['trigger'],
  fired: QueuedTriggerEvent
): boolean {
  if (spec.type !== fired.type) return false;

  switch (spec.type) {
    case 'enter_cell':
    case 'leave_cell':
      return spec.row === fired.row && spec.col === fired.col;

    case 'enter_region':
    case 'leave_region':
      return spec.region === fired.region;

    case 'use':
    case 'shoot': {
      if (spec.row !== undefined && spec.col !== undefined) {
        return spec.row === fired.row && spec.col === fired.col;
      }
      if (spec.tag !== undefined && spec.tag > 0) {
        return spec.tag === fired.tag;
      }
      return true;
    }

    case 'pickup_item': {
      if (spec.item && spec.item !== fired.item) return false;
      if (
        spec.row !== undefined &&
        spec.col !== undefined &&
        (spec.row !== fired.row || spec.col !== fired.col)
      ) {
        return false;
      }
      return true;
    }

    case 'level_start':
      return true;

    case 'mover_finished': {
      if (
        spec.row !== undefined &&
        spec.col !== undefined &&
        (spec.row !== fired.row || spec.col !== fired.col)
      ) {
        return false;
      }
      if (spec.tag !== undefined && spec.tag > 0 && spec.tag !== fired.tag) {
        return false;
      }
      if (spec.state !== undefined && spec.state !== fired.moverState) {
        return false;
      }
      return true;
    }

    case 'timer_fired':
      return spec.timer === fired.timer;

    case 'flag_changed': {
      if (spec.name !== fired.flagName) return false;
      if (spec.is !== undefined && spec.is !== fired.flagValue) return false;
      return true;
    }

    case 'counter_reached': {
      if (spec.name !== fired.counterName) return false;
      const val = fired.counterValue ?? 0;
      return compareIntegers(val, spec.op, spec.value);
    }

    case 'all_dead': {
      if (spec.tag !== undefined && spec.tag > 0 && spec.tag !== fired.tag)
        return false;
      if (spec.region && spec.region !== fired.region) return false;
      return true;
    }

    case 'entity_killed': {
      if (spec.entityId && spec.entityId !== fired.entityId) return false;
      if (spec.tag !== undefined && spec.tag > 0 && spec.tag !== fired.tag)
        return false;
      if (spec.blueprintId && spec.blueprintId !== fired.item) return false;
      return true;
    }

    case 'entity_alerted': {
      if (spec.entityId && spec.entityId !== fired.entityId) return false;
      if (spec.tag !== undefined && spec.tag > 0 && spec.tag !== fired.tag)
        return false;
      return true;
    }

    case 'stand_in_region': {
      return spec.region === fired.region;
    }
  }
}

export function compareIntegers(
  left: number,
  op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte',
  right: number
): boolean {
  switch (op) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
  }
}

/**
 * Attempts to fire `evt` at recursion depth `depth`.
 * Checks `enabled`, `once`, `cooldown_ticks`, `MAX_EVENT_DEPTH`, `MAX_FIRES_PER_EVENT_PER_TICK`,
 * and all `conditions`.
 */
export function fireEventById(
  state: SimulationState,
  eventId: string,
  activator: ActivatorContext = { kind: 'player', playerId: 0 }
): void {
  const evt = state.events.find((e) => e.id === eventId);
  if (!evt) {
    addSimLog(
      state,
      'error',
      'UNKNOWN_EVENT_ID',
      `Attempted to fire unknown event '${eventId}'.`,
      eventId
    );
    return;
  }
  const budget: TickExecutionBudget = {
    actionsExecuted: 0,
    firesPerEvent: new Map(),
    queuedTriggers: [],
  };
  fireEventInstance(state, evt, activator, 0, budget);
  drainQueuedTriggers(state, budget);
}

export function fireEventInstance(
  state: SimulationState,
  evt: EventDefinition,
  activator: ActivatorContext,
  depth: number,
  budget: TickExecutionBudget
): void {
  if (!evt.enabled) return;

  // 1. Check recursion depth cap (MAX_EVENT_DEPTH = 8)
  if (depth >= SIM_CONFIG.MAX_EVENT_DEPTH) {
    addSimLog(
      state,
      'error',
      'DEPTH_CAP_EXCEEDED',
      `Event '${evt.id}' halted: recursion depth cap (${SIM_CONFIG.MAX_EVENT_DEPTH}) reached.`,
      evt.id
    );
    return;
  }

  // 2. Check `once` guard
  const isOnce =
    evt.options?.once === true || evt.options?.fire === 'once';
  if (isOnce && state.firedOnceEvents.includes(evt.id)) {
    return;
  }

  // 3. Check cooldown
  const cooldownExpiry = state.eventCooldowns[evt.id];
  if (cooldownExpiry !== undefined && state.tick < cooldownExpiry) {
    return;
  }

  // 4. Check per-event fire rate cap per tick (MAX_FIRES_PER_EVENT_PER_TICK = 4)
  const firesSoFar = budget.firesPerEvent.get(evt.id) ?? 0;
  if (firesSoFar >= SIM_CONFIG.MAX_FIRES_PER_EVENT_PER_TICK) {
    addSimLog(
      state,
      'warn',
      'EVENT_FIRE_RATE_EXCEEDED',
      `Event '${evt.id}' dropped: exceeded MAX_FIRES_PER_EVENT_PER_TICK (${SIM_CONFIG.MAX_FIRES_PER_EVENT_PER_TICK}) on tick ${state.tick}.`,
      evt.id
    );
    return;
  }

  // 5. Evaluate all conditions (AND)
  if (!evaluateConditions(state, evt.conditions, activator)) {
    return;
  }

  // Mark fired
  budget.firesPerEvent.set(evt.id, firesSoFar + 1);

  if (isOnce && !state.firedOnceEvents.includes(evt.id)) {
    state.firedOnceEvents.push(evt.id);
  }

  const cooldownTicks = evt.options?.cooldown_ticks ?? 0;
  if (cooldownTicks > 0) {
    state.eventCooldowns[evt.id] = state.tick + Math.trunc(cooldownTicks);
  }

  addSimLog(
    state,
    'info',
    'EVENT_FIRED',
    `Event '${evt.id}' (${evt.name}) fired at tick ${state.tick} (depth=${depth}).`,
    evt.id
  );

  executeEventActionsFromIndex(state, evt, 0, activator, depth, budget);
}

export function evaluateConditions(
  state: SimulationState,
  conditions: ConditionSpec[],
  activator: ActivatorContext
): boolean {
  const player =
    state.players[activator.playerId] ?? state.players[0];

  for (const cond of conditions) {
    switch (cond.type) {
      case 'flag': {
        const current = Boolean(state.flags[cond.name]);
        if (current !== cond.is) return false;
        break;
      }
      case 'counter': {
        const current = state.counters[cond.name] ?? 0;
        if (!compareIntegers(current, cond.op, cond.value)) return false;
        break;
      }
      case 'has_item': {
        if (!player || !player.items.includes(cond.item)) return false;
        break;
      }
      case 'player_health': {
        if (!player || !compareIntegers(player.health, cond.op, cond.value)) {
          return false;
        }
        break;
      }
      case 'player_ammo': {
        if (!player || !compareIntegers(player.ammo, cond.op, cond.value)) {
          return false;
        }
        break;
      }
      case 'mover_state': {
        if (cond.row !== undefined && cond.col !== undefined) {
          const doorMover = state.movers[`door:${cond.row},${cond.col}`];
          const pushMover = state.movers[`pushwall:${cond.row},${cond.col}`];
          const mover = doorMover || pushMover;
          if (!mover || mover.state !== cond.state) return false;
        } else if (cond.tag !== undefined) {
          const matching = Object.values(state.movers).filter(
            (m) => m.tag === cond.tag
          );
          if (
            matching.length === 0 ||
            !matching.every((m) => m.state === cond.state)
          ) {
            return false;
          }
        }
        break;
      }
      case 'all_dead': {
        const ents = Object.values(state.entities ?? {});
        let targetEnts = ents.filter((e) => e.isEnemy);
        if (cond.tag !== undefined && cond.tag > 0) {
          targetEnts = targetEnts.filter((e) => e.tag === cond.tag);
        }
        if (cond.region) {
          const reg = state.regions.find((r) => r.id === cond.region);
          if (reg) {
            targetEnts = targetEnts.filter((e) =>
              reg.cells.some((c) => c.row === e.row && c.col === e.col)
            );
          }
        }
        if (
          targetEnts.length > 0 &&
          targetEnts.some((e) => e.state !== 'dead')
        ) {
          return false;
        }
        break;
      }
      case 'entities_alive': {
        const ents = Object.values(state.entities ?? {});
        let targetEnts = ents.filter((e) => e.isEnemy && e.state !== 'dead');
        if (cond.tag !== undefined && cond.tag > 0) {
          targetEnts = targetEnts.filter((e) => e.tag === cond.tag);
        }
        if (cond.region) {
          const reg = state.regions.find((r) => r.id === cond.region);
          if (reg) {
            targetEnts = targetEnts.filter((e) =>
              reg.cells.some((c) => c.row === e.row && c.col === e.col)
            );
          }
        }
        if (!compareIntegers(targetEnts.length, cond.op, cond.value)) {
          return false;
        }
        break;
      }
      case 'chance': {
        const rolled = rollPercentChance(state.rngState, cond.percent);
        state.rngState = rolled.nextState;
        if (!rolled.passed) return false;
        break;
      }
    }
  }
  return true;
}

export function executeEventActionsFromIndex(
  state: SimulationState,
  evt: EventDefinition,
  startIndex: number,
  activator: ActivatorContext,
  depth: number,
  budget: TickExecutionBudget
): void {
  for (let i = startIndex; i < evt.actions.length; i++) {
    if (budget.actionsExecuted >= SIM_CONFIG.MAX_ACTIONS_PER_TICK) {
      addSimLog(
        state,
        'warn',
        'ACTION_BUDGET_EXCEEDED',
        `Tick ${state.tick} action budget (${SIM_CONFIG.MAX_ACTIONS_PER_TICK}) reached while running '${evt.id}'; remaining actions dropped.`,
        evt.id
      );
      return;
    }

    const act = evt.actions[i];

    // Handle `delay` by scheduling a continuation for `i + 1` and pausing current execution
    if (act.type === 'delay') {
      const delayTicks =
        typeof act.delay_ticks === 'number'
          ? Math.max(1, Math.trunc(act.delay_ticks))
          : typeof act.delay_sec === 'number'
          ? Math.max(
              1,
              Math.round(act.delay_sec * SIM_CONFIG.TICKS_PER_SECOND)
            )
          : 1;

      const nextIndex = i + 1;
      if (nextIndex >= evt.actions.length) {
        return; // Delay at the very end of an action list has no subsequent actions
      }

      if (
        state.pendingContinuations.length >=
        SIM_CONFIG.MAX_PENDING_CONTINUATIONS
      ) {
        addSimLog(
          state,
          'warn',
          'CONTINUATION_CAP_EXCEEDED',
          `Dropped continuation for event '${evt.id}': MAX_PENDING_CONTINUATIONS (${SIM_CONFIG.MAX_PENDING_CONTINUATIONS}) reached.`,
          evt.id
        );
        return;
      }

      state.pendingContinuations.push({
        id: state.nextContinuationId++,
        eventId: evt.id,
        nextActionIndex: nextIndex,
        remainingTicks: delayTicks,
        activator: { ...activator },
        depth,
      });
      return;
    }

    budget.actionsExecuted += 1;
    executeSingleAction(state, evt, act, activator, depth, budget);
  }
}

/**
 * Marks an entity dead after a kill resolved outside the sim (the render-side hitscan),
 * then fires its `entity_killed` and any `all_dead` triggers.
 * Returns a new state; the input state is not mutated unless the entity is unknown.
 */
export function recordEntityKilledInSim(
  state: SimulationState,
  entityId: string,
  killerPlayerId: number = 0
): SimulationState {
  if (!state.entities?.[entityId]) return state;

  const next = cloneSimulationState(state);
  const ent = next.entities?.[entityId];
  if (!ent || ent.state === 'dead') return next;

  ent.health = 0;
  ent.state = 'dead';

  const killer = next.players[killerPlayerId];
  const activator: ActivatorContext = {
    kind: 'player',
    playerId: killerPlayerId,
    ...(killer ? { row: killer.gridRow, col: killer.gridCol } : {}),
  };
  const budget: TickExecutionBudget = {
    actionsExecuted: 0,
    firesPerEvent: new Map(),
    queuedTriggers: [
      {
        type: 'entity_killed',
        activator,
        entityId: ent.id,
        tag: ent.tag,
        item: ent.blueprintId,
      },
    ],
  };
  checkAllDeadTriggers(next, budget, activator);
  drainQueuedTriggers(next, budget);
  return next;
}

export function getTargetPlayers(
  state: SimulationState,
  activator: ActivatorContext,
  targetSpec?: 'activator' | 'all'
): PlayerSimState[] {
  if (targetSpec === 'all') {
    return Object.keys(state.players)
      .map((k) => Number(k))
      .sort((a, b) => a - b)
      .map((pid) => state.players[pid]);
  }
  const p = state.players[activator.playerId] ?? state.players[0];
  return p ? [p] : [];
}

export function executeSingleAction(
  state: SimulationState,
  evt: EventDefinition,
  act: ActionSpec,
  activator: ActivatorContext,
  depth: number,
  budget: TickExecutionBudget
): void {
  switch (act.type) {
    case 'open_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      for (const door of doors) {
        openDoorMoverAtCell(
          state,
          door.row,
          door.col,
          act.speed_per_tick,
          act.wait_ticks,
          door.layer
        );
      }
      break;
    }

    case 'close_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      for (const door of doors) {
        closeDoorMoverAtCell(state, door.row, door.col, act.speed_per_tick, door.layer);
      }
      break;
    }

    case 'toggle_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      const actPlayer = state.players[activator.playerId] ?? state.players[0];
      for (const door of doors) {
        toggleDoorMoverAtCell(
          state,
          door.row,
          door.col,
          act.speed_per_tick,
          actPlayer,
          door.layer
        );
      }
      break;
    }

    case 'lock_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      for (const door of doors) {
        door.locked = true;
        if (act.required_key) {
          door.requiredKey = act.required_key;
        }
      }
      break;
    }

    case 'unlock_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      for (const door of doors) {
        door.locked = false;
        delete door.requiredKey;
      }
      break;
    }

    case 'slide_wall': {
      const id = `pushwall:${act.row},${act.col}`;
      const existing = state.movers[id];
      if (
        existing &&
        (existing.state === 'active' || existing.state === 'done')
      ) {
        break;
      }

      const dRow =
        act.direction === 'N' ? -1 : act.direction === 'S' ? 1 : 0;
      const dCol =
        act.direction === 'E' ? 1 : act.direction === 'W' ? -1 : 0;
      const requestedCells = Math.max(
        1,
        Math.min(8, Math.trunc(act.distance_cells ?? 2))
      );

      let emptyCellsAvailable = 0;
      for (let s = 1; s <= requestedCells; s++) {
        const nr = act.row + dRow * s;
        const nc = act.col + dCol * s;
        if (
          nr >= 0 &&
          nr < state.gridSize &&
          nc >= 0 &&
          nc < state.gridSize &&
          state.grid[nr]?.[nc] === SimCellType.EMPTY
        ) {
          emptyCellsAvailable = s;
        } else {
          break;
        }
      }

      // If all requested cells (>= 2) are empty, the push wall comes to rest at
      // (targetRow, targetCol), leaving the intermediate cells as the walkable secret room.
      const settlesAsWall =
        requestedCells >= 2 && emptyCellsAvailable === requestedCells;
      const effectiveDistance =
        emptyCellsAvailable > 0 ? emptyCellsAvailable : requestedCells;

      state.movers[id] = {
        id,
        kind: 'pushwall',
        row: act.row,
        col: act.col,
        tag: state.cellTags[act.row]?.[act.col] ?? 0,
        state: 'active',
        progress: 0,
        speedPerTick:
          act.speed_per_tick ?? SIM_CONFIG.DEFAULT_PUSHWALL_SPEED_PER_TICK,
        waitTicks: 0,
        configuredWaitTicks: 0,
        locked: false,
        blockedBehavior: 'wait',
        direction: act.direction,
        distanceCells: effectiveDistance,
        ...(settlesAsWall
          ? {
              targetRow: act.row + dRow * requestedCells,
              targetCol: act.col + dCol * requestedCells,
            }
          : {}),
      };
      break;
    }

    case 'lower_floor': {
      applyFloorMoverAction(state, {
        row: act.row,
        col: act.col,
        tag: act.tag,
        kind: 'floor',
        targetHeightUnits: act.target_height_units,
        speedPerTick: act.speed_per_tick,
        waitTicks: act.wait_ticks,
        returnHeightUnits: act.return_height_units,
      });
      break;
    }

    case 'raise_floor': {
      applyFloorMoverAction(state, {
        row: act.row,
        col: act.col,
        tag: act.tag,
        kind: 'floor',
        targetHeightUnits: act.target_height_units,
        speedPerTick: act.speed_per_tick,
        waitTicks: act.wait_ticks,
        returnHeightUnits: act.return_height_units,
      });
      break;
    }

    case 'toggle_lift': {
      toggleLiftMover(
        state,
        act.row,
        act.col,
        act.tag,
        act.lower_height_units,
        act.upper_height_units,
        act.speed_per_tick,
        act.wait_ticks
      );
      break;
    }

    case 'start_crusher': {
      applyFloorMoverAction(state, {
        row: act.row,
        col: act.col,
        tag: act.tag,
        kind: 'crusher',
        targetHeightUnits: act.lower_height_units ?? 0,
        speedPerTick: act.speed_per_tick ?? 150,
        damage: act.damage ?? 20,
      });
      break;
    }

    case 'stop_crusher': {
      stopCrusherMover(state, act.row, act.col, act.tag);
      break;
    }

    case 'build_stairs': {
      buildStairsMover(
        state,
        act.tag,
        act.step_height_units,
        act.speed_per_tick
      );
      break;
    }

    case 'wake_entities': {
      wakeEntitiesInSim(state, act.tag, act.region);
      break;
    }

    case 'spawn_entity': {
      spawnEntityInSim(state, act);
      break;
    }

    case 'remove_entity': {
      removeEntityInSim(state, act.entityId, act.tag);
      break;
    }

    case 'damage_entity': {
      damageEntityInSim(
        state,
        act.entityId,
        act.tag,
        act.amount,
        budget,
        activator
      );
      break;
    }

    case 'set_cell': {
      if (state.grid[act.row]?.[act.col] !== undefined) {
        state.grid[act.row][act.col] = act.cell_type;
      }
      break;
    }

    case 'set_wall_texture': {
      if (state.wallTextures[act.row]?.[act.col] !== undefined) {
        state.wallTextures[act.row][act.col] = act.texture_id;
      }
      break;
    }

    case 'set_floor_texture': {
      if (state.floorTextures[act.row]?.[act.col] !== undefined) {
        state.floorTextures[act.row][act.col] = act.texture_id;
      }
      break;
    }

    case 'set_ceiling_texture': {
      if (state.ceilingTextures[act.row]?.[act.col] !== undefined) {
        state.ceilingTextures[act.row][act.col] = act.texture_id;
      }
      break;
    }

    case 'mark_secret_found': {
      const secretKey = act.secret_id || `secret:${evt.id}`;
      if (!state.foundSecretIds.includes(secretKey)) {
        state.foundSecretIds.push(secretKey);
        state.secretsFound += 1;
      }
      break;
    }

    case 'give_item': {
      const targets = getTargetPlayers(state, activator, act.target);
      for (const p of targets) {
        if (!p.items.includes(act.item)) {
          p.items.push(act.item);
        }
      }
      break;
    }

    case 'take_item': {
      const targets = getTargetPlayers(state, activator, act.target);
      for (const p of targets) {
        p.items = p.items.filter((it) => it !== act.item);
      }
      break;
    }

    case 'heal_player': {
      const targets = getTargetPlayers(state, activator, act.target);
      for (const p of targets) {
        if (!p.isDead) {
          p.health = Math.min(p.maxHealth, p.health + Math.trunc(act.amount));
        }
      }
      break;
    }

    case 'damage_player': {
      const targets = getTargetPlayers(state, activator, act.target);
      for (const p of targets) {
        if (!p.isDead) {
          p.health = Math.max(0, p.health - Math.trunc(act.amount));
          if (p.health === 0) {
            p.isDead = true;
          }
        }
      }
      break;
    }

    case 'teleport_player': {
      const targets = getTargetPlayers(state, activator, act.target);
      const dest = gridToWorldUnits(act.row, act.col, state.gridSize);
      for (const p of targets) {
        p.xUnits = dest.xUnits;
        p.zUnits = dest.zUnits;
        p.gridRow = Math.trunc(act.row);
        p.gridCol = Math.trunc(act.col);
        if (act.yaw_bam !== undefined) {
          p.yawBam = normalizeBam(act.yaw_bam);
        }
      }
      state.soundsPlayed.push({
        tick: state.tick,
        soundId: 'teleport',
        row: act.row,
        col: act.col,
      });
      break;
    }

    case 'set_flag': {
      const prev = state.flags[act.name];
      state.flags[act.name] = act.value;
      if (prev !== act.value) {
        budget.queuedTriggers.push({
          type: 'flag_changed',
          activator,
          flagName: act.name,
          flagValue: act.value,
        });
      }
      break;
    }

    case 'toggle_flag': {
      const next = !state.flags[act.name];
      state.flags[act.name] = next;
      budget.queuedTriggers.push({
        type: 'flag_changed',
        activator,
        flagName: act.name,
        flagValue: next,
      });
      break;
    }

    case 'set_counter': {
      const clamped = Math.max(
        SIM_CONFIG.COUNTER_MIN,
        Math.min(SIM_CONFIG.COUNTER_MAX, Math.trunc(act.value))
      );
      state.counters[act.name] = clamped;
      budget.queuedTriggers.push({
        type: 'counter_reached',
        activator,
        counterName: act.name,
        counterValue: clamped,
      });
      break;
    }

    case 'add_counter': {
      const cur = state.counters[act.name] ?? 0;
      const clamped = Math.max(
        SIM_CONFIG.COUNTER_MIN,
        Math.min(SIM_CONFIG.COUNTER_MAX, cur + Math.trunc(act.delta))
      );
      state.counters[act.name] = clamped;
      budget.queuedTriggers.push({
        type: 'counter_reached',
        activator,
        counterName: act.name,
        counterValue: clamped,
      });
      break;
    }

    case 'start_timer': {
      const ticks =
        typeof act.duration_ticks === 'number'
          ? Math.max(1, Math.trunc(act.duration_ticks))
          : typeof act.duration_sec === 'number'
          ? Math.max(
              1,
              Math.round(act.duration_sec * SIM_CONFIG.TICKS_PER_SECOND)
            )
          : SIM_CONFIG.TICKS_PER_SECOND;
      state.timers[act.timer] = ticks;
      break;
    }

    case 'stop_timer': {
      state.timers[act.timer] = 0;
      break;
    }

    case 'fire_event':
    case 'trigger_event': {
      const targetEvt = state.events.find((e) => e.id === act.event_id);
      if (targetEvt) {
        fireEventInstance(state, targetEvt, activator, depth + 1, budget);
      }
      break;
    }

    case 'enable_event': {
      const targetEvt = state.events.find((e) => e.id === act.event_id);
      if (targetEvt) {
        targetEvt.enabled = true;
      }
      break;
    }

    case 'disable_event': {
      const targetEvt = state.events.find((e) => e.id === act.event_id);
      if (targetEvt) {
        targetEvt.enabled = false;
      }
      break;
    }

    case 'reset_event_once': {
      state.firedOnceEvents = state.firedOnceEvents.filter(
        (id) => id !== act.event_id
      );
      break;
    }

    case 'show_message': {
      const safeText = act.text.slice(0, SIM_CONFIG.MAX_MESSAGE_LENGTH);
      const targets = getTargetPlayers(state, activator, act.target);
      for (const p of targets) {
        state.messages.push({
          tick: state.tick,
          playerId: p.playerId,
          text: safeText,
        });
      }
      addSimLog(state, 'info', 'SHOW_MESSAGE', safeText, evt.id);
      break;
    }

    case 'play_sound': {
      state.soundsPlayed.push({
        tick: state.tick,
        soundId: act.sound_id,
        ...(act.row !== undefined ? { row: act.row } : {}),
        ...(act.col !== undefined ? { col: act.col } : {}),
      });
      break;
    }

    case 'exit_level': {
      state.levelEnded = true;
      if (act.secret) {
        state.secretExitTriggered = true;
      }
      addSimLog(
        state,
        'info',
        'LEVEL_EXITED',
        act.secret ? 'Exited to secret level.' : 'Exited level.',
        evt.id
      );
      break;
    }

    case 'earthquake': {
      const ticks =
        typeof act.duration_ticks === 'number'
          ? Math.max(1, Math.trunc(act.duration_ticks))
          : typeof act.duration_sec === 'number'
          ? Math.max(
              1,
              Math.round(act.duration_sec * SIM_CONFIG.TICKS_PER_SECOND)
            )
          : SIM_CONFIG.TICKS_PER_SECOND;
      state.earthquake = {
        remainingTicks: ticks,
        intensity: act.intensity ?? 30,
      };
      state.soundsPlayed.push({
        tick: state.tick,
        soundId: 'earthquake_rumble',
      });
      addSimLog(
        state,
        'info',
        'EARTHQUAKE_STARTED',
        `Earthquake started for ${ticks} ticks (intensity ${state.earthquake.intensity}).`,
        evt.id
      );
      break;
    }

    case 'set_light_effect': {
      state.lightEffects = state.lightEffects ?? {};
      const key = act.region ? `region:${act.region}` : `tag:${act.tag}`;
      state.lightEffects[key] = {
        effect: act.effect,
        speedTicks: act.speed_ticks ?? 15,
      };
      addSimLog(
        state,
        'info',
        'LIGHT_EFFECT_SET',
        `Light effect '${act.effect}' set for ${key}.`,
        evt.id
      );
      break;
    }

    case 'stop_light_effect': {
      if (state.lightEffects) {
        const key = act.region ? `region:${act.region}` : `tag:${act.tag}`;
        delete state.lightEffects[key];
        if (Object.keys(state.lightEffects).length === 0) {
          delete state.lightEffects;
        }
      }
      addSimLog(
        state,
        'info',
        'LIGHT_EFFECT_STOPPED',
        `Light effect stopped.`,
        evt.id
      );
      break;
    }

    case 'set_hazard_region': {
      state.hazardRegions = state.hazardRegions ?? {};
      const interval = Math.max(1, Math.trunc(act.interval_ticks ?? SIM_CONFIG.TICKS_PER_SECOND));
      state.hazardRegions[act.region] = {
        damagePerInterval: act.damage_per_interval,
        intervalTicks: interval,
      };
      addSimLog(
        state,
        'info',
        'HAZARD_REGION_SET',
        `Hazard region set on '${act.region}' (${act.damage_per_interval} dmg / ${interval} ticks).`,
        evt.id
      );
      break;
    }

    case 'clear_hazard_region': {
      if (state.hazardRegions) {
        delete state.hazardRegions[act.region];
        if (Object.keys(state.hazardRegions).length === 0) {
          delete state.hazardRegions;
        }
      }
      addSimLog(
        state,
        'info',
        'HAZARD_REGION_CLEARED',
        `Hazard region cleared on '${act.region}'.`,
        evt.id
      );
      break;
    }

    case 'if_then_else': {
      const conditionPassed = evaluateConditions(
        state,
        [act.condition],
        activator
      );
      const chosenActions = conditionPassed
        ? act.then_actions
        : act.else_actions ?? [];
      for (const subAct of chosenActions) {
        if (budget.actionsExecuted >= SIM_CONFIG.MAX_ACTIONS_PER_TICK) {
          addSimLog(
            state,
            'warn',
            'ACTION_BUDGET_EXCEEDED',
            `Tick ${state.tick} action budget (${SIM_CONFIG.MAX_ACTIONS_PER_TICK}) reached in if_then_else; remaining actions dropped.`,
            evt.id
          );
          return;
        }
        budget.actionsExecuted += 1;
        executeSingleAction(state, evt, subAct, activator, depth, budget);
      }
      break;
    }

    case 'random_branch': {
      if (!act.branches || act.branches.length === 0) break;
      let totalWeight = 0;
      for (const b of act.branches) {
        totalWeight += Math.max(1, Math.trunc(b.weight));
      }
      const rngResult = nextUint32(state.rngState);
      state.rngState = rngResult.nextState;
      let roll = rngResult.value % totalWeight;
      let selectedBranch = act.branches[0];
      for (const b of act.branches) {
        const w = Math.max(1, Math.trunc(b.weight));
        if (roll < w) {
          selectedBranch = b;
          break;
        }
        roll -= w;
      }
      for (const subAct of selectedBranch.actions) {
        if (budget.actionsExecuted >= SIM_CONFIG.MAX_ACTIONS_PER_TICK) {
          addSimLog(
            state,
            'warn',
            'ACTION_BUDGET_EXCEEDED',
            `Tick ${state.tick} action budget reached in random_branch; remaining dropped.`,
            evt.id
          );
          return;
        }
        budget.actionsExecuted += 1;
        executeSingleAction(state, evt, subAct, activator, depth, budget);
      }
      break;
    }

    case 'move_along_track': {
      const moverKey = `track:${act.tag}`;
      state.movers[moverKey] = {
        id: moverKey,
        kind: 'track',
        row: act.waypoints[0].row,
        col: act.waypoints[0].col,
        tag: act.tag,
        state: 'active',
        progress: 0,
        speedPerTick: act.speed_per_tick ?? 250,
        waitTicks: 0,
        configuredWaitTicks: 0,
        locked: false,
        blockedBehavior: 'wait',
        waypoints: act.waypoints.map((w) => ({ row: w.row, col: w.col })),
        currentWaypointIndex: 1,
        trackDirection: 1,
        trackLoop: act.loop ?? false,
        trackPingPong: act.ping_pong ?? false,
      };
      addSimLog(
        state,
        'info',
        'TRACK_MOVER_STARTED',
        `Track mover started for tag ${act.tag}.`,
        evt.id
      );
      break;
    }

    case 'delay':
      break;
  }
}
