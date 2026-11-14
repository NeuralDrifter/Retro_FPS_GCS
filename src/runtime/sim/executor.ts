/**
 * ============================================================================
 * PURE DETERMINISTIC EVENT & SIMULATION EXECUTOR (PHASE 0 & 1 + AMENDMENT A)
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 *
 * Guarantees:
 *  - Advances exclusively via `step(state, inputsByPlayer)`.
 *  - Reads only `state.tick` and `state.rngState` (never Date, performance.now, or Math.random).
 *  - Produces 100% integer-only `SimulationState`.
 *  - Enforces recursion depth cap (8), per-tick action cap (64), per-event fire cap (4/tick),
 *    and pending continuation cap (64) with structured log entries.
 */

import {
  ActivatorContext,
  LevelDataV3,
  MoverSimState,
  PendingContinuation,
  PlayerSimState,
  PlayerTickInput,
  SIM_CONFIG,
  SimCellType,
  SimEntityState,
  SimulationState,
} from './types';
import {
  TRIG_SCALE,
  bamCos,
  bamSin,
  isqrt,
  normalizeBam,
} from './trigTable';
import { normalizeRngSeed } from './rng';
import {
  castGridRayDDA,
  gridToWorldUnits,
  layerCellKey,
  worldUnitsToGrid,
} from './raycast';
import { normalizeEventsToIntegerTicks } from './validator';
import {
  buildSolidFootprintGrid,
  getFootprintCenter,
  isStaticFootprintSource,
} from './footprint';
import {
  actorLayer,
  buildVerticalSimState,
  cellOnLayer,
  entitySpawnPointUnits,
  spawnFeetUnits,
} from './vertical';
import { stepVerticalPlayer } from './verticalMovement';

import {
  QueuedTriggerEvent,
  TickExecutionBudget,
  applyFloorMoverAction,
  buildStairsMover,
  closeDoorMoverAtCell,
  openDoorMoverAtCell,
  stopCrusherMover,
  toggleDoorMoverAtCell,
  toggleLiftMover,
  updateMoversForTick,
} from './moverSim';
export {
  applyFloorMoverAction,
  buildStairsMover,
  closeDoorMoverAtCell,
  openDoorMoverAtCell,
  stopCrusherMover,
  toggleDoorMoverAtCell,
  toggleLiftMover,
};
export type { QueuedTriggerEvent, TickExecutionBudget };

import {
  checkAllDeadTriggers,
  damageEntityInSim,
  removeEntityInSim,
  spawnEntityInSim,
  updateEntitiesForTick,
  wakeEntitiesInSim,
} from './entitySim';
export {
  damageEntityInSim,
  removeEntityInSim,
  spawnEntityInSim,
  wakeEntitiesInSim,
};

import {
  drainQueuedTriggers,
  executeEventActionsFromIndex,
  fireEventById,
  recordEntityKilledInSim,
} from './actionExecutor';
export { fireEventById, recordEntityKilledInSim };

/**
 * Deep-clones a `SimulationState` so `step()` is pure and never mutates `prevState`.
 */
export function cloneSimulationState(state: SimulationState): SimulationState {
  const playersCopy: Record<number, PlayerSimState> = {};
  for (const k of Object.keys(state.players)) {
    const pid = Number(k);
    const p = state.players[pid];
    playersCopy[pid] = {
      ...p,
      items: [...p.items],
    };
  }

  const moversCopy: Record<string, MoverSimState> = {};
  for (const k of Object.keys(state.movers)) {
    const m = state.movers[k];
    moversCopy[k] = {
      ...m,
      ...(m.waypoints ? { waypoints: m.waypoints.map((w) => ({ ...w })) } : {}),
    };
  }

  let entitiesCopy: Record<string, SimEntityState> | undefined = undefined;
  if (state.entities) {
    entitiesCopy = {};
    for (const k of Object.keys(state.entities)) {
      entitiesCopy[k] = { ...state.entities[k] };
    }
  }

  return {
    formatVersion: 1,
    tick: state.tick,
    rngState: state.rngState,
    gridSize: state.gridSize,
    nextEntityId: state.nextEntityId,
    nextContinuationId: state.nextContinuationId,
    levelEnded: state.levelEnded,
    secretExitTriggered: state.secretExitTriggered,
    secretsFound: state.secretsFound,
    foundSecretIds: [...state.foundSecretIds],
    grid: state.grid.map((r) => [...r]),
    wallTextures: state.wallTextures.map((r) => [...r]),
    floorTextures: state.floorTextures.map((r) => [...r]),
    ceilingTextures: state.ceilingTextures.map((r) => [...r]),
    cellTags: state.cellTags.map((r) => [...r]),
    floorHeights: state.floorHeights.map((r) => [...r]),
    ceilingHeights: state.ceilingHeights.map((r) => [...r]),
    players: playersCopy,
    movers: moversCopy,
    ...(entitiesCopy ? { entities: entitiesCopy } : {}),
    ...(state.solidFootprint
      ? { solidFootprint: state.solidFootprint.map((r) => [...r]) }
      : {}),
    ...(state.earthquake ? { earthquake: { ...state.earthquake } } : {}),
    ...(state.hazardRegions
      ? {
          hazardRegions: Object.fromEntries(
            Object.entries(state.hazardRegions).map(([rk, rv]) => [
              rk,
              { ...rv },
            ])
          ),
        }
      : {}),
    ...(state.lightEffects
      ? {
          lightEffects: Object.fromEntries(
            Object.entries(state.lightEffects).map(([lk, lv]) => [
              lk,
              { ...lv },
            ])
          ),
        }
      : {}),
    ...(state.regionDwellTicks
      ? {
          regionDwellTicks: Object.fromEntries(
            Object.entries(state.regionDwellTicks).map(([rk, rv]) => [
              rk,
              { ...rv },
            ])
          ),
        }
      : {}),
    collectedKeys: [...state.collectedKeys],
    flags: { ...state.flags },
    counters: { ...state.counters },
    timers: { ...state.timers },
    events: state.events.map((e) => ({
      ...e,
      trigger: { ...e.trigger },
      conditions: e.conditions.map((c) => ({ ...c })),
      actions: e.actions.map((a) => ({ ...a })),
      ...(e.options ? { options: { ...e.options } } : {}),
    })),
    regions: state.regions.map((reg) => ({
      ...reg,
      cells: reg.cells.map((c) => ({ ...c })),
    })),
    firedOnceEvents: [...state.firedOnceEvents],
    eventCooldowns: { ...state.eventCooldowns },
    pendingContinuations: state.pendingContinuations.map((c) => ({
      ...c,
      activator: { ...c.activator },
    })),
    messages: state.messages.map((m) => ({ ...m })),
    soundsPlayed: state.soundsPlayed.map((s) => ({ ...s })),
    logs: state.logs.map((l) => ({ ...l })),
    // Never mutated after the level starts, so ticks share it
    ...(state.vertical ? { vertical: state.vertical } : {}),
  };
}

import { addSimLog } from './simLog';
export { addSimLog };

/**
 * Creates a fresh `SimulationState` from a validated `LevelDataV3`.
 * Supports any list of integer `playerIds` (defaults to `[0]` for single-player).
 */
export function createInitialSimulationState(
  level: LevelDataV3,
  playerIds: number[] = [0]
): SimulationState {
  const gridSize = level.gridSize || SIM_CONFIG.GRID_SIZE;
  const zeroMatrix = () =>
    Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => 0)
    );
  const constMatrix = (val: number) =>
    Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => val)
    );

  const cellTags = level.cellTags
    ? level.cellTags.map((r) => [...r])
    : zeroMatrix();
  const floorHeights = level.floorHeights
    ? level.floorHeights.map((r) => [...r])
    : constMatrix(SIM_CONFIG.DEFAULT_FLOOR_HEIGHT_UNITS);
  const ceilingHeights = level.ceilingHeights
    ? level.ceilingHeights.map((r) => [...r])
    : constMatrix(SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS);

  const spawnWorld = gridToWorldUnits(level.spawn.row, level.spawn.col, gridSize);
  const spawnYawBam = normalizeBam(level.spawn.yawBam);

  // Undefined on flat levels, which must stay on the flat code below (see `isVerticalLevel`)
  const vertical = buildVerticalSimState(level);
  // Read-only view of the starting world for placing the player and enemies on their floors
  const startView = vertical
    ? {
        gridSize,
        grid: level.grid,
        floorHeights,
        ceilingHeights,
        movers: {},
        vertical,
      }
    : null;
  const spawnFeet = startView
    ? spawnFeetUnits(startView, level.spawn.row, level.spawn.col, level.spawn.layer ?? 0)
    : 0;

  const players: Record<number, PlayerSimState> = {};
  const sortedPids = [...playerIds].map((id) => Math.trunc(id)).sort((a, b) => a - b);
  for (const pid of sortedPids) {
    players[pid] = {
      playerId: pid,
      xUnits: spawnWorld.xUnits,
      zUnits: spawnWorld.zUnits,
      yUnits: SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS,
      yawBam: spawnYawBam,
      pitchBam: 0,
      gridRow: Math.trunc(level.spawn.row),
      gridCol: Math.trunc(level.spawn.col),
      speedUnitsPerTick: 0,
      health: 100,
      maxHealth: 100,
      ammo: 32,
      maxAmmo: 99,
      isDead: false,
      items: [],
      controlsLockedTicks: 0,
      ...(startView
        ? {
            yUnits: spawnFeet + SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS,
            feetUnits: spawnFeet,
            velYUnits: 0,
            onGround: true,
            crouching: false,
          }
        : {}),
    };
  }

  // Initialize door movers for all DOOR cells in the grid
  const movers: Record<string, MoverSimState> = {};
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (level.grid[r]?.[c] === SimCellType.DOOR) {
        const id = `door:${r},${c}`;
        movers[id] = {
          id,
          kind: 'door',
          row: r,
          col: c,
          tag: cellTags[r]?.[c] ?? 0,
          state: 'closed',
          progress: 0,
          speedPerTick: SIM_CONFIG.DEFAULT_DOOR_SPEED_PER_TICK,
          waitTicks: 0,
          configuredWaitTicks: 0,
          locked: false,
          blockedBehavior: 'wait',
        };
      }
    }
  }

  // Doors on stacked layers (vertical levels only)
  vertical?.layers.forEach((layerState, i) => {
    const layer = i + 1;
    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        if (layerState.grid[r]?.[c] !== SimCellType.DOOR) continue;
        const id = `door:${layerCellKey(r, c, layer)}`;
        movers[id] = {
          id,
          kind: 'door',
          row: r,
          col: c,
          layer,
          tag: cellTags[r]?.[c] ?? 0,
          state: 'closed',
          progress: 0,
          speedPerTick: SIM_CONFIG.DEFAULT_DOOR_SPEED_PER_TICK,
          waitTicks: 0,
          configuredWaitTicks: 0,
          locked: false,
          blockedBehavior: 'wait',
        };
      }
    }
  });

  const timers: Record<string, number> = {};
  for (const tName of level.variables.timers) {
    timers[tName] = 0;
  }

  const normalizedEvents = normalizeEventsToIntegerTicks(level.events).sort(
    (a, b) => a.id.localeCompare(b.id)
  );

  // Vertical levels block with per-layer solid boxes instead of a whole-column footprint
  const solidFootprint = vertical
    ? undefined
    : buildSolidFootprintGrid(level.entities ?? [], gridSize);

  const entities: Record<string, SimEntityState> = {};
  if (level.entities && level.entities.length > 0) {
    for (const ent of level.entities) {
      // Static models only affect the world through their footprint
      if (isStaticFootprintSource(ent)) continue;
      // Characters wider than one cell stand at their footprint's center
      const center = getFootprintCenter(ent, gridSize);
      const point = startView ? entitySpawnPointUnits(ent, startView) : null;
      entities[ent.id] = {
        id: ent.id,
        blueprintId: ent.blueprintId,
        ...(ent.modelAssetId ? { modelAssetId: ent.modelAssetId } : {}),
        name:
          ent.name ||
          (ent.blueprintId === 'sentinel-bot'
            ? 'Cyber Sentinel Bot'
            : ent.blueprintId === 'turret-guardian'
            ? 'Heavy Mech Stalker'
            : 'Supply Crate'),
        row: center.row,
        col: center.col,
        xUnits: point ? point.xUnits : center.xUnits,
        zUnits: point ? point.zUnits : center.zUnits,
        yUnits: point ? point.yUnits : floorHeights[center.row]?.[center.col] ?? 0,
        yawBam: normalizeBam(ent.yawBam || 0),
        health: Math.max(1, Math.trunc(ent.maxHealth ?? 75)),
        maxHealth: Math.max(1, Math.trunc(ent.maxHealth ?? 75)),
        isEnemy: ent.isEnemy !== false && ent.blueprintId !== 'supply-crate',
        state: ent.ambush ? 'idle' : ent.patrol ? 'patrol' : 'idle',
        tag: Math.trunc(ent.tag || 0),
        ambush: Boolean(ent.ambush),
        attackDamage: Math.max(1, Math.trunc(ent.attackDamage ?? 12)),
        speedUnitsPerTick: Math.max(
          10,
          Math.trunc(ent.moveSpeedUnitsPerTick || 40)
        ),
        attackCooldownTicks: 0,
        hitFlashTicks: 0,
        memoryTicks: 0,
      };
    }
  }

  const state: SimulationState = {
    formatVersion: 1,
    tick: 0,
    rngState: normalizeRngSeed(level.rngSeed),
    gridSize,
    nextEntityId: Math.max(1, Math.trunc(level.nextEntityId)),
    nextContinuationId: 1,
    levelEnded: false,
    secretExitTriggered: false,
    secretsFound: 0,
    foundSecretIds: [],
    grid: level.grid.map((r) => r.map((c) => Math.trunc(c))),
    wallTextures: level.wallTextures.map((r) => [...r]),
    floorTextures: level.floorTextures.map((r) => [...r]),
    ceilingTextures: level.ceilingTextures.map((r) => [...r]),
    cellTags,
    floorHeights,
    ceilingHeights,
    players,
    movers,
    ...(Object.keys(entities).length > 0 ? { entities } : {}),
    ...(solidFootprint ? { solidFootprint } : {}),
    collectedKeys: [],
    flags: { ...level.variables.flags },
    counters: { ...level.variables.counters },
    timers,
    events: normalizedEvents,
    regions: level.regions.map((reg) => ({
      ...reg,
      cells: reg.cells.map((c) => ({
        row: Math.trunc(c.row),
        col: Math.trunc(c.col),
      })),
    })),
    firedOnceEvents: [],
    eventCooldowns: {},
    pendingContinuations: [],
    messages: [],
    soundsPlayed: [],
    logs: [],
    ...(vertical ? { vertical } : {}),
  };

  // Fire any `level_start` triggers at tick 0
  const budget: TickExecutionBudget = {
    actionsExecuted: 0,
    firesPerEvent: new Map(),
    queuedTriggers: [
      {
        type: 'level_start',
        activator: { kind: 'player', playerId: sortedPids[0] ?? 0 },
      },
    ],
  };
  drainQueuedTriggers(state, budget);

  return state;
}

import {
  checkCircleCollisionUnits,
  depenetrateCircleUnits,
} from './collisionUnits';
export {
  checkCircleCollisionUnits,
  depenetrateCircleUnits,
};

function isPlayerInRegion(
  row: number,
  col: number,
  regionId: string,
  state: SimulationState
): boolean {
  const reg = state.regions.find((r) => r.id === regionId);
  if (!reg) return false;
  return reg.cells.some((c) => c.row === row && c.col === col);
}

/**
 * Advances the simulation by 1 tick (`1 / 30 s`) given per-player integer inputs.
 * Returns a brand-new `SimulationState` without mutating `prevState`.
 */
export function step(
  prevState: SimulationState,
  inputsByPlayer: Record<number, PlayerTickInput> = {}
): SimulationState {
  const state = cloneSimulationState(prevState);
  state.tick += 1;

  if (state.levelEnded) {
    return state;
  }

  // Decrement earthquake if active
  if (state.earthquake && state.earthquake.remainingTicks > 0) {
    state.earthquake.remainingTicks -= 1;
    if (state.earthquake.remainingTicks === 0) {
      delete state.earthquake;
    }
  }

  const budget: TickExecutionBudget = {
    actionsExecuted: 0,
    firesPerEvent: new Map(),
    queuedTriggers: [],
  };

  // --------------------------------------------------------------------------
  // 1. PROCESS PLAYER INPUTS & MOVEMENT (IN ASCENDING PLAYER ID ORDER)
  // --------------------------------------------------------------------------
  const playerIds = Object.keys(state.players)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  for (const pid of playerIds) {
    const player = state.players[pid];
    if (!player) continue;

    if (player.controlsLockedTicks > 0) {
      player.controlsLockedTicks -= 1;
    }

    const input = inputsByPlayer[pid];
    if (!input || player.isDead) {
      player.speedUnitsPerTick = 0;
      continue;
    }

    // Apply integer keyboard turn + mouse yaw/pitch deltas
    const turnDir =
      (input.turnLeft ? 1 : 0) - (input.turnRight ? 1 : 0);
    const turnBamDelta =
      turnDir * SIM_CONFIG.TURN_SPEED_BAM_PER_TICK +
      Math.trunc(input.yawDeltaBam || 0);
    player.yawBam = normalizeBam(player.yawBam + turnBamDelta);

    const nextPitch =
      player.pitchBam + Math.trunc(input.pitchDeltaBam || 0);
    player.pitchBam = Math.max(-15000, Math.min(15000, nextPitch));

    const prevRow = player.gridRow;
    const prevCol = player.gridCol;
    const prevX = player.xUnits;
    const prevZ = player.zUnits;

    const moveF = Math.max(-1, Math.min(1, Math.trunc(input.moveForward || 0)));
    const moveR = Math.max(-1, Math.min(1, Math.trunc(input.moveRight || 0)));

    if (state.vertical) {
      // Vertical levels: walking, stepping, slopes, jumping, crouching and falling
      stepVerticalPlayer(state, state.vertical, player, input, moveF, moveR);
    } else if ((moveF !== 0 || moveR !== 0) && player.controlsLockedTicks === 0) {
      const targetSpeed = input.sprint
        ? SIM_CONFIG.SPRINT_SPEED_UNITS_PER_TICK
        : SIM_CONFIG.WALK_SPEED_UNITS_PER_TICK;

      // Forward = (-sin(yaw), -cos(yaw)), Right = (cos(yaw), -sin(yaw))
      const sinYaw = bamSin(player.yawBam);
      const cosYaw = bamCos(player.yawBam);

      const rawDirX = -sinYaw * moveF + cosYaw * moveR;
      const rawDirZ = -cosYaw * moveF - sinYaw * moveR;

      // Integer vector normalization via `isqrt` so diagonal movement is never 41% faster
      const mag = isqrt(rawDirX * rawDirX + rawDirZ * rawDirZ);
      let dxUnits = 0;
      let dzUnits = 0;
      if (mag > 0) {
        dxUnits = Math.trunc((rawDirX * targetSpeed) / mag);
        dzUnits = Math.trunc((rawDirZ * targetSpeed) / mag);
      }

      let nextX = player.xUnits;
      let nextZ = player.zUnits;

      if (input.noclip) {
        nextX += dxUnits;
        nextZ += dzUnits;
      } else {
        // Already overlapping a solid (e.g. a door closed on the player): push out first
        if (
          checkCircleCollisionUnits(
            nextX,
            nextZ,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers,
            state.solidFootprint
          )
        ) {
          const freed = depenetrateCircleUnits(
            nextX,
            nextZ,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers,
            state.solidFootprint
          );
          nextX = freed.xUnits;
          nextZ = freed.zUnits;
        }

        const candX = nextX + dxUnits;
        if (
          !checkCircleCollisionUnits(
            candX,
            nextZ,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers,
            state.solidFootprint
          )
        ) {
          nextX = candX;
        }
        const candZ = nextZ + dzUnits;
        if (
          !checkCircleCollisionUnits(
            nextX,
            candZ,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers,
            state.solidFootprint
          )
        ) {
          nextZ = candZ;
        }

        // Both axis slides blocked: still allow the full diagonal step if it is clear
        if (
          nextX === player.xUnits &&
          nextZ === player.zUnits &&
          dxUnits !== 0 &&
          dzUnits !== 0 &&
          !checkCircleCollisionUnits(
            player.xUnits + dxUnits,
            player.zUnits + dzUnits,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers,
            state.solidFootprint
          )
        ) {
          nextX = player.xUnits + dxUnits;
          nextZ = player.zUnits + dzUnits;
        }
      }

      const movedDx = nextX - prevX;
      const movedDz = nextZ - prevZ;
      player.xUnits = nextX;
      player.zUnits = nextZ;
      player.speedUnitsPerTick = isqrt(movedDx * movedDx + movedDz * movedDz);
    } else {
      player.speedUnitsPerTick = 0;
    }

    const nextCell = worldUnitsToGrid(
      player.xUnits,
      player.zUnits,
      state.gridSize
    );
    player.gridRow = nextCell.row;
    player.gridCol = nextCell.col;

    const activator: ActivatorContext = {
      kind: 'player',
      playerId: pid,
      row: player.gridRow,
      col: player.gridCol,
    };

    // Edge-triggered cell & region transitions
    if (prevRow !== player.gridRow || prevCol !== player.gridCol) {
      budget.queuedTriggers.push({
        type: 'leave_cell',
        activator,
        row: prevRow,
        col: prevCol,
      });
      budget.queuedTriggers.push({
        type: 'enter_cell',
        activator,
        row: player.gridRow,
        col: player.gridCol,
      });

      for (const reg of state.regions) {
        const wasIn = isPlayerInRegion(prevRow, prevCol, reg.id, state);
        const nowIn = isPlayerInRegion(
          player.gridRow,
          player.gridCol,
          reg.id,
          state
        );
        if (wasIn && !nowIn) {
          budget.queuedTriggers.push({
            type: 'leave_region',
            activator,
            region: reg.id,
          });
        } else if (!wasIn && nowIn) {
          budget.queuedTriggers.push({
            type: 'enter_region',
            activator,
            region: reg.id,
          });
        }
      }
    }

    // Keycard pickup check on current cell (of the layer the player stands on)
    const keyLayer = state.vertical ? actorLayer(state, player.feetUnits ?? 0) : 0;
    const cellKey = layerCellKey(player.gridRow, player.gridCol, keyLayer);
    if (
      cellOnLayer(state, keyLayer, player.gridRow, player.gridCol) === SimCellType.KEY &&
      !state.collectedKeys.includes(cellKey)
    ) {
      state.collectedKeys.push(cellKey);
      if (!player.items.includes('keycard')) {
        player.items.push('keycard');
      }
      budget.queuedTriggers.push({
        type: 'pickup_item',
        activator,
        item: 'keycard',
        row: player.gridRow,
        col: player.gridCol,
      });

      // Default keycard behavior: unlock all doors on the map; the player still uses a door to open it
      for (const mKey of Object.keys(state.movers)) {
        const mover = state.movers[mKey];
        if (mover.kind === 'door') {
          mover.locked = false;
        }
      }
      addSimLog(
        state,
        'info',
        'KEY_COLLECTED',
        `Player ${pid} collected keycard at (${player.gridRow}, ${player.gridCol}).`
      );
    }

    // Player `use` action (Space / E)
    if (input.use) {
      handlePlayerUseCommand(state, player, activator, budget);
    }

    // Player `shoot` action
    if (input.shoot) {
      const rayHit = castGridRayDDA({
        originXUnits: player.xUnits,
        originZUnits: player.zUnits,
        yawBam: player.yawBam,
        maxDistanceUnits: state.gridSize * SIM_CONFIG.CELL_UNITS,
        grid: state.grid,
        movers: state.movers,
        solidFootprint: state.solidFootprint,
        eyeHeightUnits: player.yUnits,
        floorHeights: state.floorHeights,
        ceilingHeights: state.ceilingHeights,
      });

      let hitEnemy: SimEntityState | undefined = undefined;
      let minEnemyDist = rayHit.hit
        ? rayHit.distanceUnits
        : state.gridSize * SIM_CONFIG.CELL_UNITS;

      if (state.entities) {
        const pCos = bamCos(player.yawBam);
        const pSin = bamSin(player.yawBam);
        const dirX = -pSin;
        const dirZ = -pCos;

        for (const ent of Object.values(state.entities)) {
          if (!ent.isEnemy || ent.state === 'dead') continue;
          const ex = ent.xUnits - player.xUnits;
          const ez = ent.zUnits - player.zUnits;
          const projDist = Math.trunc(
            (ex * dirX + ez * dirZ) / TRIG_SCALE
          );
          if (projDist > 0 && projDist < minEnemyDist) {
            const perpSq = ex * ex + ez * ez - projDist * projDist;
            if (perpSq >= 0 && perpSq <= 350 * 350) {
              minEnemyDist = projDist;
              hitEnemy = ent;
            }
          }
        }
      }

      if (hitEnemy) {
        hitEnemy.health = Math.max(0, hitEnemy.health - 35);
        hitEnemy.hitFlashTicks = 4;
        if (hitEnemy.health <= 0) {
          hitEnemy.state = 'dead';
          state.soundsPlayed.push({
            tick: state.tick,
            soundId: 'enemy_death',
            row: hitEnemy.row,
            col: hitEnemy.col,
          });
          budget.queuedTriggers.push({
            type: 'entity_killed',
            activator,
            entityId: hitEnemy.id,
            tag: hitEnemy.tag,
            item: hitEnemy.blueprintId,
          });
          checkAllDeadTriggers(state, budget, activator);
        } else {
          if (hitEnemy.state === 'idle') {
            hitEnemy.state = 'chase';
            hitEnemy.ambush = false;
          }
        }
      }

      if (rayHit.hit && (!hitEnemy || rayHit.distanceUnits < minEnemyDist)) {
        budget.queuedTriggers.push({
          type: 'shoot',
          activator,
          row: rayHit.row,
          col: rayHit.col,
          tag: state.cellTags[rayHit.row]?.[rayHit.col] ?? 0,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 1a. REGION DWELL TRACKING (FOR STAND_IN_REGION TRIGGERS)
  // --------------------------------------------------------------------------
  for (const pid of playerIds) {
    const player = state.players[pid];
    if (!player || player.isDead) continue;

    for (const reg of state.regions) {
      const hasDwellEvent = state.events.some(
        (evt) =>
          evt.enabled &&
          evt.trigger.type === 'stand_in_region' &&
          evt.trigger.region === reg.id
      );
      if (!hasDwellEvent) continue;

      const inside = isPlayerInRegion(
        player.gridRow,
        player.gridCol,
        reg.id,
        state
      );
      if (inside) {
        state.regionDwellTicks = state.regionDwellTicks ?? {};
        state.regionDwellTicks[reg.id] = state.regionDwellTicks[reg.id] ?? {};
        const curDwell = (state.regionDwellTicks[reg.id][pid] ?? 0) + 1;
        state.regionDwellTicks[reg.id][pid] = curDwell;

        for (const evt of state.events) {
          if (
            evt.enabled &&
            evt.trigger.type === 'stand_in_region' &&
            evt.trigger.region === reg.id
          ) {
            const reqTicks =
              typeof evt.trigger.dwell_ticks === 'number'
                ? evt.trigger.dwell_ticks
                : typeof evt.trigger.dwell_sec === 'number'
                ? Math.max(
                    1,
                    Math.round(
                      evt.trigger.dwell_sec * SIM_CONFIG.TICKS_PER_SECOND
                    )
                  )
                : 1;
            if (curDwell === reqTicks) {
              budget.queuedTriggers.push({
                type: 'stand_in_region',
                activator: {
                  kind: 'player',
                  playerId: pid,
                  row: player.gridRow,
                  col: player.gridCol,
                },
                region: reg.id,
              });
            }
          }
        }
      } else {
        if (state.regionDwellTicks?.[reg.id]?.[pid]) {
          delete state.regionDwellTicks[reg.id][pid];
          if (Object.keys(state.regionDwellTicks[reg.id]).length === 0) {
            delete state.regionDwellTicks[reg.id];
          }
        }
      }
    }
  }
  if (
    state.regionDwellTicks &&
    Object.keys(state.regionDwellTicks).length === 0
  ) {
    delete state.regionDwellTicks;
  }

  // --------------------------------------------------------------------------
  // 1b. HAZARD REGIONS PERIODIC DAMAGE
  // --------------------------------------------------------------------------
  if (state.hazardRegions) {
    for (const [rId, hazard] of Object.entries(state.hazardRegions)) {
      if (hazard.intervalTicks > 0 && state.tick % hazard.intervalTicks === 0) {
        for (const pid of playerIds) {
          const p = state.players[pid];
          if (!p || p.isDead) continue;
          if (isPlayerInRegion(p.gridRow, p.gridCol, rId, state)) {
            p.health = Math.max(0, p.health - hazard.damagePerInterval);
            if (p.health === 0) {
              p.isDead = true;
            }
            state.soundsPlayed.push({
              tick: state.tick,
              soundId: 'hazard_sizzle',
              row: p.gridRow,
              col: p.gridCol,
            });
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. UPDATE TIMERS
  // --------------------------------------------------------------------------
  const timerNames = Object.keys(state.timers).sort();
  for (const tName of timerNames) {
    const rem = state.timers[tName];
    if (rem > 0) {
      const nextRem = rem - 1;
      state.timers[tName] = nextRem;
      if (nextRem === 0) {
        budget.queuedTriggers.push({
          type: 'timer_fired',
          activator: { kind: 'system', playerId: 0 },
          timer: tName,
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. UPDATE MOVERS (DOORS, PUSH WALLS, LIFTS, CRUSHERS)
  // --------------------------------------------------------------------------
  updateMoversForTick(state, budget);

  // --------------------------------------------------------------------------
  // 4. UPDATE ENTITIES (ENEMY AI, AMBUSH, PATROL, ATTACK)
  // --------------------------------------------------------------------------
  updateEntitiesForTick(state, budget);

  // --------------------------------------------------------------------------
  // 5. PROCESS PENDING DELAYED CONTINUATIONS
  // --------------------------------------------------------------------------
  processPendingContinuationsForTick(state, budget);

  // --------------------------------------------------------------------------
  // 6. EVALUATE & EXECUTE QUEUED TRIGGERS
  // --------------------------------------------------------------------------
  drainQueuedTriggers(state, budget);

  return state;
}

function handlePlayerUseCommand(
  state: SimulationState,
  player: PlayerSimState,
  activator: ActivatorContext,
  budget: TickExecutionBudget
): void {
  // Queue `use` on player's own cell and any adjacent 3x3 cells
  const interactedCells: { row: number; col: number }[] = [];
  for (let r = player.gridRow - 1; r <= player.gridRow + 1; r++) {
    for (let c = player.gridCol - 1; c <= player.gridCol + 1; c++) {
      if (r < 0 || r >= state.gridSize || c < 0 || c >= state.gridSize) {
        continue;
      }
      interactedCells.push({ row: r, col: c });
    }
  }

  // On vertical levels you reach the doors of the layer you stand on
  const useLayer = state.vertical ? actorLayer(state, player.feetUnits ?? 0) : 0;
  for (const cell of interactedCells) {
    const tag = state.cellTags[cell.row]?.[cell.col] ?? 0;
    budget.queuedTriggers.push({
      type: 'use',
      activator,
      row: cell.row,
      col: cell.col,
      tag,
    });

    // Direct bulkhead door interaction (unless locked without key)
    if (cellOnLayer(state, useLayer, cell.row, cell.col) === SimCellType.DOOR) {
      const hasCustomUseEvent = state.events.some(
        (ev) =>
          ev.enabled &&
          ev.trigger.type === 'use' &&
          ((ev.trigger.row === cell.row && ev.trigger.col === cell.col) ||
            (ev.trigger.tag !== undefined &&
              ev.trigger.tag > 0 &&
              ev.trigger.tag === tag))
      );

      if (!hasCustomUseEvent) {
        toggleDoorMoverAtCell(state, cell.row, cell.col, undefined, player, useLayer);
      }
    }
  }
}

function processPendingContinuationsForTick(
  state: SimulationState,
  budget: TickExecutionBudget
): void {
  if (state.pendingContinuations.length === 0) return;

  // Sort by continuation ID ascending for deterministic order
  state.pendingContinuations.sort((a, b) => a.id - b.id);

  const dueContinuations: PendingContinuation[] = [];
  const remainingContinuations: PendingContinuation[] = [];

  for (const cont of state.pendingContinuations) {
    cont.remainingTicks -= 1;
    if (cont.remainingTicks <= 0) {
      dueContinuations.push(cont);
    } else {
      remainingContinuations.push(cont);
    }
  }

  state.pendingContinuations = remainingContinuations;

  for (const due of dueContinuations) {
    const evt = state.events.find((e) => e.id === due.eventId);
    if (!evt) continue;
    executeEventActionsFromIndex(
      state,
      evt,
      due.nextActionIndex,
      due.activator,
      due.depth,
      budget
    );
  }
}


/**
 * Helper to derive a `Set<string>` of open door cell keys (`"row,col"`)
 * from `SimulationState` for legacy 3D renderer / minimap consumers.
 */
export function getOpenDoorsSetFromSim(state: SimulationState): Set<string> {
  const openSet = new Set<string>();
  for (const mover of Object.values(state.movers)) {
    if (
      mover.kind === 'door' &&
      (mover.state === 'open' ||
        mover.state === 'opening' ||
        mover.progress >= 5000)
    ) {
      openSet.add(layerCellKey(mover.row, mover.col, mover.layer ?? 0));
    }
  }
  return openSet;
}

/**
 * Helper to derive a `Set<string>` of collected keycard cell keys (`"row,col"`)
 * from `SimulationState`.
 */
export function getCollectedKeysSetFromSim(
  state: SimulationState
): Set<string> {
  return new Set<string>(state.collectedKeys);
}
