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
  ActionSpec,
  ActivatorContext,
  ConditionSpec,
  EventDefinition,
  LevelDataV3,
  MoverSimState,
  PendingContinuation,
  PlayerSimState,
  PlayerTickInput,
  SIM_CONFIG,
  SimCellType,
  SimulationState,
} from './types';
import {
  BAM_MASK,
  TRIG_SCALE,
  bamCos,
  bamSin,
  isqrt,
  normalizeBam,
} from './trigTable';
import { normalizeRngSeed, rollPercentChance } from './rng';
import {
  castGridRayDDA,
  gridToWorldUnits,
  isDoorPassable,
  worldUnitsToGrid,
} from './raycast';
import { normalizeEventsToIntegerTicks } from './validator';

interface QueuedTriggerEvent {
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
}

interface TickExecutionBudget {
  actionsExecuted: number;
  firesPerEvent: Map<string, number>;
  queuedTriggers: QueuedTriggerEvent[];
}

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
    moversCopy[k] = { ...state.movers[k] };
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
  };
}

function addSimLog(
  state: SimulationState,
  level: 'info' | 'warn' | 'error',
  code: string,
  message: string,
  eventId?: string
): void {
  state.logs.push({
    tick: state.tick,
    level,
    code,
    message,
    ...(eventId ? { eventId } : {}),
  });
}

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

  const spawnWorld = gridToWorldUnits(level.spawn.row, level.spawn.col);
  const spawnYawBam = normalizeBam(level.spawn.yawBam);

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

  const timers: Record<string, number> = {};
  for (const tName of level.variables.timers) {
    timers[tName] = 0;
  }

  const normalizedEvents = normalizeEventsToIntegerTicks(level.events).sort(
    (a, b) => a.id.localeCompare(b.id)
  );

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

/**
 * Pure integer Circle-vs-Cell AABB collision check in millicells.
 */
export function checkCircleCollisionUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, MoverSimState>
): boolean {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);

  // World boundary check
  if (
    xUnits - radiusUnits < -halfWorld ||
    xUnits + radiusUnits > halfWorld ||
    zUnits - radiusUnits < -halfWorld ||
    zUnits + radiusUnits > halfWorld
  ) {
    return true;
  }

  const center = worldUnitsToGrid(xUnits, zUnits, gridSize);
  const rSq = radiusUnits * radiusUnits;

  for (let r = center.row - 1; r <= center.row + 1; r++) {
    for (let c = center.col - 1; c <= center.col + 1; c++) {
      if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue;
      const cell = grid[r][c];
      const activePushwallAtCell = movers[`pushwall:${r},${c}`];
      const isBlockingWall =
        cell === SimCellType.WALL &&
        !(activePushwallAtCell && activePushwallAtCell.state === 'active');
      const isBlockingDoor =
        cell === SimCellType.DOOR && !isDoorPassable(r, c, movers);

      if (!isBlockingWall && !isBlockingDoor) continue;

      const minX = -halfWorld + c * SIM_CONFIG.CELL_UNITS;
      const maxX = minX + SIM_CONFIG.CELL_UNITS;
      const minZ = -halfWorld + r * SIM_CONFIG.CELL_UNITS;
      const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

      const closestX = Math.max(minX, Math.min(xUnits, maxX));
      const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));

      const dx = xUnits - closestX;
      const dz = zUnits - closestZ;
      if (dx * dx + dz * dz < rSq) {
        return true;
      }
    }
  }

  // Check active sliding pushwalls along their integer trajectory
  for (const mKey of Object.keys(movers)) {
    const mover = movers[mKey];
    if (!mover || mover.kind !== 'pushwall' || mover.state !== 'active') {
      continue;
    }
    const dRow =
      mover.direction === 'N' ? -1 : mover.direction === 'S' ? 1 : 0;
    const dCol =
      mover.direction === 'E' ? 1 : mover.direction === 'W' ? -1 : 0;
    const distCells = mover.distanceCells ?? 2;
    const offsetUnits = Math.trunc(
      (distCells * SIM_CONFIG.CELL_UNITS * mover.progress) /
        SIM_CONFIG.MOVER_MAX_PROGRESS
    );

    const minX =
      -halfWorld + mover.col * SIM_CONFIG.CELL_UNITS + dCol * offsetUnits;
    const maxX = minX + SIM_CONFIG.CELL_UNITS;
    const minZ =
      -halfWorld + mover.row * SIM_CONFIG.CELL_UNITS + dRow * offsetUnits;
    const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

    const closestX = Math.max(minX, Math.min(xUnits, maxX));
    const closestZ = Math.max(minZ, Math.min(zUnits, maxZ));
    const dx = xUnits - closestX;
    const dz = zUnits - closestZ;
    if (dx * dx + dz * dz < rSq) {
      return true;
    }
  }

  return false;
}

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

    if ((moveF !== 0 || moveR !== 0) && player.controlsLockedTicks === 0) {
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
        const candX = nextX + dxUnits;
        if (
          !checkCircleCollisionUnits(
            candX,
            nextZ,
            SIM_CONFIG.PLAYER_RADIUS_UNITS,
            state.grid,
            state.movers
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
            state.movers
          )
        ) {
          nextZ = candZ;
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

    // Keycard pickup check on current cell
    const cellKey = `${player.gridRow},${player.gridCol}`;
    if (
      state.grid[player.gridRow]?.[player.gridCol] === SimCellType.KEY &&
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

      // Default keycard behavior: open all unlocked/default doors on the map
      for (const mKey of Object.keys(state.movers)) {
        const mover = state.movers[mKey];
        if (mover.kind === 'door') {
          mover.locked = false;
          if (mover.state === 'closed' || mover.state === 'closing') {
            mover.state = 'opening';
          }
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
        eyeHeightUnits: player.yUnits,
        floorHeights: state.floorHeights,
        ceilingHeights: state.ceilingHeights,
      });
      if (rayHit.hit) {
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
  // 3. UPDATE MOVERS (DOORS & PUSH WALLS)
  // --------------------------------------------------------------------------
  updateMoversForTick(state, budget);

  // --------------------------------------------------------------------------
  // 4. PROCESS PENDING DELAYED CONTINUATIONS
  // --------------------------------------------------------------------------
  processPendingContinuationsForTick(state, budget);

  // --------------------------------------------------------------------------
  // 5. EVALUATE & EXECUTE QUEUED TRIGGERS
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
    if (state.grid[cell.row]?.[cell.col] === SimCellType.DOOR) {
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
        toggleDoorMoverAtCell(state, cell.row, cell.col, undefined, player);
      }
    }
  }
}

function updateMoversForTick(
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
          (p) => !p.isDead && p.gridRow === mover.row && p.gridCol === mover.col
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

function drainQueuedTriggers(
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

function doesTriggerMatch(
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
  }
}

function compareIntegers(
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

function fireEventInstance(
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

function evaluateConditions(
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

function executeEventActionsFromIndex(
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

function getTargetDoors(
  state: SimulationState,
  row?: number,
  col?: number,
  tag?: number
): MoverSimState[] {
  const results: MoverSimState[] = [];
  if (row !== undefined && col !== undefined) {
    const key = `door:${row},${col}`;
    if (!state.movers[key] && state.grid[row]?.[col] === SimCellType.DOOR) {
      state.movers[key] = {
        id: key,
        kind: 'door',
        row,
        col,
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
  waitTicks?: number
): void {
  const doors = getTargetDoors(state, row, col, undefined);
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
  speedPerTick?: number
): void {
  const doors = getTargetDoors(state, row, col, undefined);
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
  activatorPlayer?: PlayerSimState
): void {
  const doors = getTargetDoors(state, row, col, undefined);
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

function getTargetPlayers(
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

function executeSingleAction(
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
          act.wait_ticks
        );
      }
      break;
    }

    case 'close_door': {
      const doors = getTargetDoors(state, act.row, act.col, act.tag);
      for (const door of doors) {
        closeDoorMoverAtCell(state, door.row, door.col, act.speed_per_tick);
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
          actPlayer
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
      const dest = gridToWorldUnits(act.row, act.col);
      for (const p of targets) {
        p.xUnits = dest.xUnits;
        p.zUnits = dest.zUnits;
        p.gridRow = Math.trunc(act.row);
        p.gridCol = Math.trunc(act.col);
        if (act.yaw_bam !== undefined) {
          p.yawBam = normalizeBam(act.yaw_bam);
        }
      }
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

    case 'delay':
      break;
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
      openSet.add(`${mover.row},${mover.col}`);
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
