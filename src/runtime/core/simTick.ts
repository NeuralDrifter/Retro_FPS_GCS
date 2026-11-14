/**
 * One fixed simulation tick: builds player input, steps the sim, records and hashes ticks.
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
import { NO_FRAME_INPUT } from '../core/InputController';
import {
  PlayerTickInput,
  SIM_CONFIG,
  checkCircleCollisionUnits,
  getOpenDoorsSetFromSim,
  hashSimulationState,
  isBlockedVertical,
  step,
  worldUnitsToGrid,
} from '../../sim';
import type { RuntimeContext } from './RuntimeState';
import { METERS_TO_UNITS, UNITS_TO_METERS } from './constants';
import { syncHud } from './hud';

export function runSingleSimTick(
  ctx: RuntimeContext,
  tickIdxInFrame: number): boolean {
  const { rt, options, input, inputReader, isReplayOrDeterministic, recordInputs, hashEveryTick, recordedInputs, tickHashes } = ctx;
  rt.prevSimState = rt.currSimState;

  const preSim = rt.currSimState;
  const preP0 = preSim.players[0];
  const healthBeforeStep = isReplayOrDeterministic
    ? preP0?.health ?? ENGINE_CONFIG.PLAYER_MAX_HEALTH
    : Math.round(rt.combatState.health);

  if (!isReplayOrDeterministic) {
    if (preP0) {
      preP0.health = healthBeforeStep;
      preP0.isDead = rt.combatState.isDead;
    }
    if (preSim.entities && rt.enemyAI) {
      const agents = rt.enemyAI.getAgents();
      agents.forEach((agent, entId) => {
        const simEnt = preSim.entities?.[entId];
        if (!simEnt) return;
        simEnt.xUnits = Math.round(
          agent.instance.rootGroup.position.x * METERS_TO_UNITS
        );
        simEnt.zUnits = Math.round(
          agent.instance.rootGroup.position.z * METERS_TO_UNITS
        );
        const cell = worldUnitsToGrid(
          simEnt.xUnits,
          simEnt.zUnits,
          preSim.gridSize
        );
        simEnt.row = cell.row;
        simEnt.col = cell.col;
        if (preSim.vertical) {
          simEnt.yUnits = Math.round(agent.instance.rootGroup.position.y * METERS_TO_UNITS);
        }
        simEnt.health = Math.max(0, Math.round(agent.health));
        simEnt.state = agent.state === 'Dead' ? 'dead' : 'idle';
        simEnt.ambush = true;
      });
    }
  }

  let playerInput: PlayerTickInput;

  if (inputReader) {
    const fed = inputReader(rt.currSimState.tick);
    playerInput = fed ?? {
      moveForward: 0,
      moveRight: 0,
      sprint: false,
      yawDeltaBam: 0,
      pitchDeltaBam: 0,
      use: false,
      shoot: false,
      noclip: false,
    };
  } else {
    const isPlayerDead = rt.combatState.isDead;
    const moveForward = (
      Number(Boolean(input.keys['KeyW'] || input.keys['ArrowUp'])) -
      Number(Boolean(input.keys['KeyS'] || input.keys['ArrowDown']))
    ) as -1 | 0 | 1;
    const moveRight = (
      Number(Boolean(input.keys['KeyD'])) -
      Number(Boolean(input.keys['KeyA']))
    ) as -1 | 0 | 1;

    // Look, use and shoot gathered since the last frame apply to the frame's first tick only
    const frameInput = tickIdxInFrame === 0 ? input.takeFrameInput() : NO_FRAME_INPUT;
    const yawDeltaBam = frameInput.yawDeltaBam;
    const pitchDeltaBam = frameInput.pitchDeltaBam;
    const useTriggered = frameInput.use;
    const shootTriggered = frameInput.shoot;

    playerInput = isPlayerDead
      ? {
          moveForward: 0,
          moveRight: 0,
          sprint: false,
          yawDeltaBam: 0,
          pitchDeltaBam: 0,
          use: false,
          shoot: false,
          noclip: !rt.collisionEnabled,
        }
      : {
          moveForward,
          moveRight,
          turnLeft: Boolean(input.keys['KeyQ'] || input.keys['ArrowLeft']),
          turnRight: Boolean(input.keys['ArrowRight']),
          sprint: Boolean(
            input.keys['ShiftLeft'] || input.keys['ShiftRight']
          ),
          yawDeltaBam,
          pitchDeltaBam,
          use: useTriggered,
          shoot: shootTriggered,
          noclip: !rt.collisionEnabled,
          ...(rt.currSimState.vertical?.movement.jump
            ? { jump: Boolean(input.keys['Space']) }
            : {}),
          ...(rt.currSimState.vertical?.movement.crouch
            ? {
                crouch: Boolean(
                  input.keys['KeyC'] || input.keys['ControlLeft'] || input.keys['ControlRight']
                ),
              }
            : {}),
        };
  }

  if (recordInputs) {
    recordedInputs.push({ ...playerInput });
  }

  const nextSim = step(rt.currSimState, { 0: playerInput });

  const postP0 = nextSim.players[0];
  if (postP0 && postP0.health !== healthBeforeStep) {
    const updatedHealth = Math.max(0, postP0.health);
    const nowDead = updatedHealth <= 0;
    if (updatedHealth < healthBeforeStep && typeof window !== 'undefined') {
      rt.isPlayerHurtFlashing = true;
      window.clearTimeout(rt.hurtFlashTimeout);
      rt.hurtFlashTimeout = window.setTimeout(() => {
        rt.isPlayerHurtFlashing = false;
        syncHud(ctx);
      }, 180);
    }
    rt.combatState = {
      ...rt.combatState,
      health: updatedHealth,
      isDead: nowDead,
    };
  }

  if (!isReplayOrDeterministic) {
    if (nextSim.entities && rt.enemyAI) {
      const agents = rt.enemyAI.getAgents();
      for (const [entId, simEnt] of Object.entries(nextSim.entities)) {
        const agent = agents.get(entId);
        if (!agent || agent.state === 'Dead') continue;
        if (simEnt.state === 'dead' || (simEnt.health !== undefined && simEnt.health <= 0)) {
          rt.enemyAI.damageEntity(entId, agent.health + 999);
        } else if (simEnt.state === 'chase') {
          agent.state = 'Chase';
          agent.memoryTimer = Math.max(agent.memoryTimer, 5.0);
        }
      }
    }

    if (rt.enemyAI && rt.collisionEnabled && !rt.combatState.isDead) {
      const p0 = nextSim.players[0];
      if (p0) {
        const worldX = p0.xUnits * UNITS_TO_METERS;
        const worldZ = p0.zUnits * UNITS_TO_METERS;
        const openDoorsForTick = getOpenDoorsSetFromSim(nextSim);
        const feetUnits = p0.feetUnits ?? 0;
        const entResolved = rt.enemyAI.resolvePlayerEntityCollision(
          worldX,
          worldZ,
          rt.collisionEnabled,
          nextSim.grid,
          openDoorsForTick,
          nextSim.solidFootprint,
          feetUnits * UNITS_TO_METERS
        );
        const candXUnits = Math.round(entResolved.x * METERS_TO_UNITS);
        const candZUnits = Math.round(entResolved.z * METERS_TO_UNITS);
        const blockedAt = (x: number, z: number) =>
          nextSim.vertical
            ? isBlockedVertical(
                nextSim,
                x,
                z,
                SIM_CONFIG.PLAYER_RADIUS_UNITS,
                feetUnits,
                p0.crouching
                  ? SIM_CONFIG.PLAYER_CROUCH_HEIGHT_UNITS
                  : SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS,
                nextSim.vertical.movement.stepUnits
              )
            : checkCircleCollisionUnits(
                x,
                z,
                SIM_CONFIG.PLAYER_RADIUS_UNITS,
                nextSim.grid,
                nextSim.movers,
                nextSim.solidFootprint
              );

        if (candXUnits !== p0.xUnits && !blockedAt(candXUnits, p0.zUnits)) {
          p0.xUnits = candXUnits;
        }
        if (candZUnits !== p0.zUnits && !blockedAt(p0.xUnits, candZUnits)) {
          p0.zUnits = candZUnits;
        }
        const nextCell = worldUnitsToGrid(
          p0.xUnits,
          p0.zUnits,
          nextSim.gridSize
        );
        p0.gridRow = nextCell.row;
        p0.gridCol = nextCell.col;
      }
    }
  }

  rt.currSimState = nextSim;
  if (hashEveryTick) {
    const tickHash = hashSimulationState(rt.currSimState);
    tickHashes.push(tickHash);
    options.onTickHash?.(rt.currSimState.tick, tickHash, rt.currSimState);
  }

  return true;
}
