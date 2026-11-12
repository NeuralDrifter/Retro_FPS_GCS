/**
 * ============================================================================
 * PURE DETERMINISTIC MOVER SIMULATION (DOORS, PUSHWALLS, LIFTS, CRUSHERS, TRACKS)
 * ============================================================================
 * Handles mover state progression, door opening/closing, lift actions,
 * stairs building, crusher damage, and pushwall motion during each simulation tick.
 */

import {
  ActivatorContext,
  EventDefinition,
  MoverSimState,
  PlayerSimState,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
} from './types';
import { layerCellKey } from './raycast';
import { actorLayer, cellOnLayer } from './vertical';
import { addSimLog } from './simLog';

export interface QueuedTriggerEvent {
  type: EventDefinition['trigger']['type'];
  activator: ActivatorContext;
  row?: number;
  col?: number;
  tag?: number;
  region?: string;
  item?: string;
  timer?: string;
  flagName?: string;
  flagValue?: boolean;
  counterName?: string;
  counterValue?: number;
  moverState?: 'open' | 'closed' | 'done';
  entityId?: string;
}

export interface TickExecutionBudget {
  actionsExecuted: number;
  firesPerEvent: Map<string, number>;
  queuedTriggers: QueuedTriggerEvent[];
}

export function updateMoversForTick(
  state: SimulationState,
  budget: TickExecutionBudget
): void {
  const moverKeys = Object.keys(state.movers).sort();
  for (const key of moverKeys) {
    const mover = state.movers[key];
    if (!mover) continue;

    if (mover.kind === 'door') {
      if (mover.state === 'opening') {
        mover.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          mover.progress + mover.speedPerTick
        );
        if (mover.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
          mover.progress = SIM_CONFIG.MOVER_MAX_PROGRESS;
          mover.state = 'open';
          mover.waitTicks = mover.configuredWaitTicks;
          budget.queuedTriggers.push({
            type: 'mover_finished',
            activator: { kind: 'system', playerId: 0 },
            row: mover.row,
            col: mover.col,
            tag: mover.tag,
            moverState: 'open',
          });
        }
      } else if (mover.state === 'open') {
        if (mover.waitTicks > 0) {
          mover.waitTicks -= 1;
          if (mover.waitTicks === 0) {
            mover.state = 'closing';
          }
        }
      } else if (mover.state === 'closing') {
        const playerOccupying = Object.values(state.players).some(
          (p) =>
            !p.isDead &&
            p.gridRow === mover.row &&
            p.gridCol === mover.col &&
            (!state.vertical || actorLayer(state, p.feetUnits ?? 0) === (mover.layer ?? 0))
        );
        if (playerOccupying && mover.blockedBehavior !== 'ignore') {
          if (mover.blockedBehavior === 'reverse') {
            mover.state = 'opening';
          }
          continue;
        }

        mover.progress = Math.max(0, mover.progress - mover.speedPerTick);
        if (mover.progress <= 0) {
          mover.progress = 0;
          mover.state = 'closed';
          budget.queuedTriggers.push({
            type: 'mover_finished',
            activator: { kind: 'system', playerId: 0 },
            row: mover.row,
            col: mover.col,
            tag: mover.tag,
            moverState: 'closed',
          });
        }
      }
    } else if (mover.kind === 'pushwall') {
      if (mover.state === 'active') {
        const dRow =
          mover.direction === 'N' ? -1 : mover.direction === 'S' ? 1 : 0;
        const dCol =
          mover.direction === 'E' ? 1 : mover.direction === 'W' ? -1 : 0;

        if (mover.blockedBehavior !== 'ignore') {
          const nextStepRow = mover.row + dRow;
          const nextStepCol = mover.col + dCol;
          const destRow = mover.targetRow ?? nextStepRow;
          const destCol = mover.targetCol ?? nextStepCol;
          const playerBlocking = Object.values(state.players).some(
            (p) =>
              !p.isDead &&
              ((p.gridRow === nextStepRow && p.gridCol === nextStepCol) ||
                (p.gridRow === destRow && p.gridCol === destCol))
          );
          if (playerBlocking) {
            continue;
          }
        }

        mover.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          mover.progress + mover.speedPerTick
        );
        if (mover.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
          mover.progress = SIM_CONFIG.MOVER_MAX_PROGRESS;
          mover.state = 'done';
          const originTex =
            state.wallTextures[mover.row]?.[mover.col] || 'default-grid';
          state.grid[mover.row][mover.col] = SimCellType.EMPTY;

          // If targetRow/targetCol was set as a resting wall cell (2+ empty cells along slide path),
          // solidify the pushwall at its destination cell.
          if (
            mover.targetRow !== undefined &&
            mover.targetCol !== undefined &&
            (mover.targetRow !== mover.row || mover.targetCol !== mover.col) &&
            state.grid[mover.targetRow]?.[mover.targetCol] === SimCellType.EMPTY
          ) {
            state.grid[mover.targetRow][mover.targetCol] = SimCellType.WALL;
            if (state.wallTextures[mover.targetRow]) {
              state.wallTextures[mover.targetRow][mover.targetCol] = originTex;
            }
          }

          budget.queuedTriggers.push({
            type: 'mover_finished',
            activator: { kind: 'system', playerId: 0 },
            row: mover.row,
            col: mover.col,
            tag: mover.tag,
            moverState: 'done',
          });
        }
      }
    } else if (
      mover.kind === 'lift' ||
      mover.kind === 'floor' ||
      mover.kind === 'ceiling'
    ) {
      const startH = mover.startHeightUnits ?? 0;
      const targetH = mover.targetHeightUnits ?? 0;
      const totalDelta = targetH - startH;

      if (mover.state === 'opening' || mover.state === 'active') {
        mover.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          mover.progress + mover.speedPerTick
        );
        const curH =
          startH +
          Math.trunc(
            (totalDelta * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
          );
        mover.currentHeightUnits = curH;
        if (state.floorHeights[mover.row]) {
          state.floorHeights[mover.row][mover.col] = curH;
        }

        if (mover.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
          mover.progress = SIM_CONFIG.MOVER_MAX_PROGRESS;
          mover.currentHeightUnits = targetH;
          if (state.floorHeights[mover.row]) {
            state.floorHeights[mover.row][mover.col] = targetH;
          }
          mover.state = 'open';
          mover.waitTicks = mover.configuredWaitTicks;
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'lift_stop',
            row: mover.row,
            col: mover.col,
          });
          budget.queuedTriggers.push({
            type: 'mover_finished',
            activator: { kind: 'system', playerId: 0 },
            row: mover.row,
            col: mover.col,
            tag: mover.tag,
            moverState: 'open',
          });
        }
      } else if (mover.state === 'open') {
        if (mover.waitTicks > 0) {
          mover.waitTicks -= 1;
          if (mover.waitTicks === 0 && mover.returnHeightUnits !== undefined) {
            mover.state = 'closing';
            state.soundsPlayed.push({
              tick: state.tick,
              soundId: 'lift_start',
              row: mover.row,
              col: mover.col,
            });
          }
        }
      } else if (mover.state === 'closing') {
        const retH = mover.returnHeightUnits ?? startH;
        mover.progress = Math.max(0, mover.progress - mover.speedPerTick);
        const curH =
          retH +
          Math.trunc(
            ((targetH - retH) * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
          );
        mover.currentHeightUnits = curH;
        if (state.floorHeights[mover.row]) {
          state.floorHeights[mover.row][mover.col] = curH;
        }

        if (mover.progress <= 0) {
          mover.progress = 0;
          mover.currentHeightUnits = retH;
          if (state.floorHeights[mover.row]) {
            state.floorHeights[mover.row][mover.col] = retH;
          }
          mover.state = 'closed';
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'lift_stop',
            row: mover.row,
            col: mover.col,
          });
          budget.queuedTriggers.push({
            type: 'mover_finished',
            activator: { kind: 'system', playerId: 0 },
            row: mover.row,
            col: mover.col,
            tag: mover.tag,
            moverState: 'closed',
          });
        }
      }
    } else if (mover.kind === 'crusher') {
      const lowerH = mover.targetHeightUnits ?? 0;
      const upperH =
        mover.startHeightUnits ?? SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
      if (mover.state === 'closing' || mover.state === 'active') {
        mover.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          mover.progress + mover.speedPerTick
        );
        const curH =
          upperH -
          Math.trunc(
            ((upperH - lowerH) * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
          );
        mover.currentHeightUnits = curH;
        if (state.ceilingHeights[mover.row]) {
          state.ceilingHeights[mover.row][mover.col] = curH;
        }
        // Check crushing occupants
        if (curH <= (state.floorHeights[mover.row]?.[mover.col] ?? 0) + 300) {
          const dmg = mover.crushDamage ?? 20;
          for (const p of Object.values(state.players)) {
            if (
              !p.isDead &&
              p.gridRow === mover.row &&
              p.gridCol === mover.col
            ) {
              p.health = Math.max(0, p.health - dmg);
              if (p.health === 0) p.isDead = true;
              state.soundsPlayed.push({
                tick: state.tick,
                soundId: 'crusher_hit',
                row: mover.row,
                col: mover.col,
              });
            }
          }
        }
        if (mover.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
          mover.progress = SIM_CONFIG.MOVER_MAX_PROGRESS;
          mover.state = 'opening';
        }
      } else if (mover.state === 'opening') {
        mover.progress = Math.max(0, mover.progress - mover.speedPerTick);
        const curH =
          upperH -
          Math.trunc(
            ((upperH - lowerH) * mover.progress) / SIM_CONFIG.MOVER_MAX_PROGRESS
          );
        mover.currentHeightUnits = curH;
        if (state.ceilingHeights[mover.row]) {
          state.ceilingHeights[mover.row][mover.col] = curH;
        }
        if (mover.progress <= 0) {
          mover.progress = 0;
          mover.state = 'closing';
        }
      }
    } else if (mover.kind === 'track') {
      if (
        mover.state === 'active' &&
        mover.waypoints &&
        mover.waypoints.length >= 2
      ) {
        mover.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          mover.progress + mover.speedPerTick
        );
        if (mover.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
          mover.progress = 0;
          const targetIndex = mover.currentWaypointIndex ?? 1;
          const targetWp = mover.waypoints[targetIndex];
          if (targetWp) {
            mover.row = targetWp.row;
            mover.col = targetWp.col;
          }

          const dir = mover.trackDirection ?? 1;
          if (dir === 1) {
            if (targetIndex + 1 < mover.waypoints.length) {
              mover.currentWaypointIndex = targetIndex + 1;
            } else {
              if (mover.trackLoop) {
                mover.currentWaypointIndex = 0;
              } else if (mover.trackPingPong) {
                mover.trackDirection = -1;
                mover.currentWaypointIndex = Math.max(
                  0,
                  mover.waypoints.length - 2
                );
              } else {
                mover.state = 'done';
                budget.queuedTriggers.push({
                  type: 'mover_finished',
                  activator: { kind: 'system', playerId: 0 },
                  row: mover.row,
                  col: mover.col,
                  tag: mover.tag,
                  moverState: 'done',
                });
              }
            }
          } else {
            if (targetIndex - 1 >= 0) {
              mover.currentWaypointIndex = targetIndex - 1;
            } else {
              if (mover.trackLoop) {
                mover.currentWaypointIndex = mover.waypoints.length - 1;
              } else if (mover.trackPingPong) {
                mover.trackDirection = 1;
                mover.currentWaypointIndex = 1;
              } else {
                mover.state = 'done';
                budget.queuedTriggers.push({
                  type: 'mover_finished',
                  activator: { kind: 'system', playerId: 0 },
                  row: mover.row,
                  col: mover.col,
                  tag: mover.tag,
                  moverState: 'done',
                });
              }
            }
          }
        }
      }
    }
  }
}

export function getTargetDoors(
  state: SimulationState,
  row?: number,
  col?: number,
  tag?: number,
  layer = 0
): MoverSimState[] {
  const results: MoverSimState[] = [];
  if (row !== undefined && col !== undefined) {
    const key = `door:${layerCellKey(row, col, layer)}`;
    if (!state.movers[key] && cellOnLayer(state, layer, row, col) === SimCellType.DOOR) {
      state.movers[key] = {
        id: key,
        kind: 'door',
        row,
        col,
        ...(layer > 0 ? { layer } : {}),
        tag: state.cellTags[row]?.[col] ?? 0,
        state: 'closed',
        progress: 0,
        speedPerTick: SIM_CONFIG.DEFAULT_DOOR_SPEED_PER_TICK,
        waitTicks: 0,
        configuredWaitTicks: 0,
        locked: false,
        blockedBehavior: 'wait',
      };
    }
    if (state.movers[key]) {
      results.push(state.movers[key]);
    }
  } else if (tag !== undefined && tag > 0) {
    const keys = Object.keys(state.movers).sort();
    for (const k of keys) {
      const m = state.movers[k];
      if (m.kind === 'door' && m.tag === tag) {
        results.push(m);
      }
    }
  }
  return results;
}

export function openDoorMoverAtCell(
  state: SimulationState,
  row: number,
  col: number,
  speedPerTick?: number,
  waitTicks?: number,
  layer = 0
): void {
  const doors = getTargetDoors(state, row, col, undefined, layer);
  for (const door of doors) {
    door.locked = false;
    if (speedPerTick !== undefined && speedPerTick > 0) {
      door.speedPerTick = Math.trunc(speedPerTick);
    }
    if (waitTicks !== undefined && waitTicks >= 0) {
      door.configuredWaitTicks = Math.trunc(waitTicks);
      door.waitTicks = Math.trunc(waitTicks);
    }
    door.state = 'opening';
    if (door.progress === 0) {
      door.progress = Math.min(
        SIM_CONFIG.MOVER_MAX_PROGRESS,
        door.speedPerTick
      );
      if (door.progress >= SIM_CONFIG.MOVER_MAX_PROGRESS) {
        door.state = 'open';
      }
    }
  }
}

export function closeDoorMoverAtCell(
  state: SimulationState,
  row: number,
  col: number,
  speedPerTick?: number,
  layer = 0
): void {
  const doors = getTargetDoors(state, row, col, undefined, layer);
  for (const door of doors) {
    if (speedPerTick !== undefined && speedPerTick > 0) {
      door.speedPerTick = Math.trunc(speedPerTick);
    }
    door.state = 'closing';
  }
}

export function toggleDoorMoverAtCell(
  state: SimulationState,
  row: number,
  col: number,
  speedPerTick?: number,
  activatorPlayer?: PlayerSimState,
  layer = 0
): void {
  const doors = getTargetDoors(state, row, col, undefined, layer);
  for (const door of doors) {
    if (door.locked) {
      const reqKey = door.requiredKey || 'keycard';
      const hasKey = activatorPlayer
        ? activatorPlayer.items.includes(reqKey) ||
          activatorPlayer.items.includes('keycard')
        : false;
      if (hasKey) {
        door.locked = false;
        delete door.requiredKey;
        addSimLog(
          state,
          'info',
          'DOOR_UNLOCKED',
          `Door at (${row}, ${col}) unlocked with ${reqKey}.`
        );
      } else {
        addSimLog(
          state,
          'info',
          'DOOR_LOCKED',
          `Door at (${row}, ${col}) is locked (requires ${reqKey}).`
        );
        if (
          !state.soundsPlayed.some(
            (s) => s.tick === state.tick && s.soundId === 'door_locked'
          )
        ) {
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'door_locked',
            row,
            col,
          });
        }
        if (
          activatorPlayer &&
          !state.messages.some(
            (m) =>
              m.tick === state.tick && m.playerId === activatorPlayer.playerId
          )
        ) {
          state.messages.push({
            tick: state.tick,
            playerId: activatorPlayer.playerId,
            text: `Locked! Requires ${reqKey}.`,
          });
        }
        continue;
      }
    }
    if (speedPerTick !== undefined && speedPerTick > 0) {
      door.speedPerTick = Math.trunc(speedPerTick);
    }
    if (door.state === 'open' || door.state === 'opening') {
      door.state = 'closing';
    } else {
      door.state = 'opening';
      if (door.progress === 0) {
        door.progress = Math.min(
          SIM_CONFIG.MOVER_MAX_PROGRESS,
          door.speedPerTick
        );
      }
    }
  }
}

export function applyFloorMoverAction(
  state: SimulationState,
  params: {
    row?: number;
    col?: number;
    tag?: number;
    kind: 'lift' | 'floor' | 'crusher';
    targetHeightUnits: number;
    speedPerTick?: number;
    waitTicks?: number;
    returnHeightUnits?: number;
    damage?: number;
  }
): void {
  const targets: { row: number; col: number }[] = [];
  if (params.row !== undefined && params.col !== undefined) {
    targets.push({ row: params.row, col: params.col });
  } else if (params.tag !== undefined && params.tag > 0) {
    for (let r = 0; r < state.gridSize; r++) {
      for (let c = 0; c < state.gridSize; c++) {
        if (state.cellTags[r]?.[c] === params.tag) {
          targets.push({ row: r, col: c });
        }
      }
    }
  }

  for (const t of targets) {
    const id = `${params.kind}:${t.row},${t.col}`;
    const startH =
      params.kind === 'crusher'
        ? state.ceilingHeights[t.row]?.[t.col] ??
          SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS
        : state.floorHeights[t.row]?.[t.col] ?? 0;
    const speed = params.speedPerTick ?? 200;
    const wait = params.waitTicks ?? 0;

    state.movers[id] = {
      id,
      kind: params.kind,
      row: t.row,
      col: t.col,
      tag: state.cellTags[t.row]?.[t.col] ?? (params.tag ?? 0),
      state: 'active',
      progress: 0,
      speedPerTick: Math.max(10, Math.trunc(speed)),
      waitTicks: wait,
      configuredWaitTicks: wait,
      locked: false,
      blockedBehavior: 'wait',
      startHeightUnits: startH,
      targetHeightUnits: Math.trunc(params.targetHeightUnits),
      currentHeightUnits: startH,
      ...(params.returnHeightUnits !== undefined
        ? { returnHeightUnits: Math.trunc(params.returnHeightUnits) }
        : {}),
      ...(params.damage !== undefined
        ? { crushDamage: Math.trunc(params.damage) }
        : {}),
    };

    state.soundsPlayed.push({
      tick: state.tick,
      soundId: 'lift_start',
      row: t.row,
      col: t.col,
    });
  }
}

export function toggleLiftMover(
  state: SimulationState,
  row?: number,
  col?: number,
  tag?: number,
  lowerHeightUnits = -500,
  upperHeightUnits = 0,
  speedPerTick = 200,
  waitTicks = 90
): void {
  const targets: { row: number; col: number }[] = [];
  if (row !== undefined && col !== undefined) {
    targets.push({ row, col });
  } else if (tag !== undefined && tag > 0) {
    for (let r = 0; r < state.gridSize; r++) {
      for (let c = 0; c < state.gridSize; c++) {
        if (state.cellTags[r]?.[c] === tag) {
          targets.push({ row: r, col: c });
        }
      }
    }
  }

  for (const t of targets) {
    const curH = state.floorHeights[t.row]?.[t.col] ?? 0;
    const isAtUpper =
      Math.abs(curH - upperHeightUnits) <= Math.abs(curH - lowerHeightUnits);
    const targetH = isAtUpper ? lowerHeightUnits : upperHeightUnits;
    const returnH = isAtUpper ? upperHeightUnits : undefined;

    applyFloorMoverAction(state, {
      row: t.row,
      col: t.col,
      kind: 'lift',
      targetHeightUnits: targetH,
      returnHeightUnits: returnH,
      speedPerTick,
      waitTicks: isAtUpper ? waitTicks : 0,
    });
  }
}

export function stopCrusherMover(
  state: SimulationState,
  row?: number,
  col?: number,
  tag?: number
): void {
  for (const k of Object.keys(state.movers)) {
    const m = state.movers[k];
    if (m.kind === 'crusher') {
      if (
        (row !== undefined &&
          col !== undefined &&
          m.row === row &&
          m.col === col) ||
        (tag !== undefined && tag > 0 && m.tag === tag)
      ) {
        delete state.movers[k];
      }
    }
  }
}

export function buildStairsMover(
  state: SimulationState,
  tag?: number,
  stepHeightUnits = 200,
  speedPerTick = 150
): void {
  if (tag === undefined || tag <= 0) return;
  const taggedCells: { row: number; col: number }[] = [];
  for (let r = 0; r < state.gridSize; r++) {
    for (let c = 0; c < state.gridSize; c++) {
      if (state.cellTags[r]?.[c] === tag) {
        taggedCells.push({ row: r, col: c });
      }
    }
  }
  taggedCells.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));
  for (let i = 0; i < taggedCells.length; i++) {
    const cell = taggedCells[i];
    const targetH = (i + 1) * Math.trunc(stepHeightUnits);
    applyFloorMoverAction(state, {
      row: cell.row,
      col: cell.col,
      kind: 'floor',
      targetHeightUnits: targetH,
      speedPerTick,
      waitTicks: 0,
    });
  }
}
