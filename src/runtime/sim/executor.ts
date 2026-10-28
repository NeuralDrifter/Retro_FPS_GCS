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
  SimEntityState,
  SimulationState,
} from './types';
import {
  BAM_MASK,
  TRIG_SCALE,
  bamAtan2,
  bamCos,
  bamSin,
  isqrt,
  normalizeBam,
  shortestBamDelta,
} from './trigTable';
import { nextUint32, normalizeRngSeed, rollPercentChance } from './rng';
import {
  castGridRayDDA,
  gridToWorldUnits,
  isDoorPassable,
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
import { moveSimEntityVertical, stepVerticalPlayer } from './verticalMovement';

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
  entityId?: string;
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

  const spawnWorld = gridToWorldUnits(level.spawn.row, level.spawn.col, gridSize);
  const spawnYawBam = normalizeBam(level.spawn.yawBam);

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

/**
 * Pure integer Circle-vs-Cell AABB collision check in millicells.
 */
export function checkCircleCollisionUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, MoverSimState>,
  solidFootprint?: number[][]
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
      const isBlockingModel = (solidFootprint?.[r]?.[c] ?? 0) > 0;

      if (!isBlockingWall && !isBlockingDoor && !isBlockingModel) continue;

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

/**
 * Pushes a circle out of any blocking wall, door or model footprint cell it overlaps.
 * Runs up to 3 integer passes so a push out of one cell into a neighbour is resolved too.
 */
export function depenetrateCircleUnits(
  xUnits: number,
  zUnits: number,
  radiusUnits: number,
  grid: number[][],
  movers: Record<string, MoverSimState> = {},
  solidFootprint?: number[][]
): { xUnits: number; zUnits: number } {
  const gridSize = grid.length || SIM_CONFIG.GRID_SIZE;
  const halfWorld = Math.trunc((gridSize * SIM_CONFIG.CELL_UNITS) / 2);

  // Clamp inside the world boundary first
  let x = Math.max(
    -halfWorld + radiusUnits,
    Math.min(halfWorld - radiusUnits, Math.trunc(xUnits))
  );
  let z = Math.max(
    -halfWorld + radiusUnits,
    Math.min(halfWorld - radiusUnits, Math.trunc(zUnits))
  );
  const rSq = radiusUnits * radiusUnits;

  for (let pass = 0; pass < 3; pass++) {
    let pushed = false;
    const center = worldUnitsToGrid(x, z, gridSize);

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
        const isBlockingModel = (solidFootprint?.[r]?.[c] ?? 0) > 0;

        if (!isBlockingWall && !isBlockingDoor && !isBlockingModel) continue;

        const minX = -halfWorld + c * SIM_CONFIG.CELL_UNITS;
        const maxX = minX + SIM_CONFIG.CELL_UNITS;
        const minZ = -halfWorld + r * SIM_CONFIG.CELL_UNITS;
        const maxZ = minZ + SIM_CONFIG.CELL_UNITS;

        const closestX = Math.max(minX, Math.min(x, maxX));
        const closestZ = Math.max(minZ, Math.min(z, maxZ));
        const dx = x - closestX;
        const dz = z - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= rSq) continue;

        pushed = true;
        if (distSq > 0) {
          // Push straight away from the closest point, plus a 2-unit margin
          const dist = Math.max(1, isqrt(distSq));
          const overlap = radiusUnits - dist + 2;
          x += Math.trunc((dx * overlap) / dist);
          z += Math.trunc((dz * overlap) / dist);
        } else {
          // Center is inside the cell: exit through the nearest edge
          const toLeft = x - minX;
          const toRight = maxX - x;
          const toTop = z - minZ;
          const toBottom = maxZ - z;
          const nearest = Math.min(toLeft, toRight, toTop, toBottom);
          if (nearest === toLeft) x = minX - radiusUnits - 2;
          else if (nearest === toRight) x = maxX + radiusUnits + 2;
          else if (nearest === toTop) z = minZ - radiusUnits - 2;
          else z = maxZ + radiusUnits + 2;
        }
      }
    }

    if (!pushed) break;
  }

  return { xUnits: Math.trunc(x), zUnits: Math.trunc(z) };
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

function checkAllDeadTriggers(
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

function updateEntitiesForTick(
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
