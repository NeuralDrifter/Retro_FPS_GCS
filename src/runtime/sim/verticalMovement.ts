/**
 * ============================================================================
 * PURE INTEGER MOVEMENT ON VERTICAL LEVELS
 * ============================================================================
 * Zero React, DOM, or Three.js imports. Runs identically in Node and browsers.
 *
 * Walking with step-up and step-down, slopes, jumping, crouching, gravity,
 * landing (with optional fall damage), ceilings, and sliding off model
 * surfaces that are too steep. Flat levels never reach this code.
 */

import {
  PlayerSimState,
  PlayerTickInput,
  SIM_CONFIG,
  SimEntityState,
  SimulationState,
  VerticalSimState,
} from './types';
import { bamCos, bamSin, isqrt } from './trigTable';
import { worldUnitsToGrid } from './raycast';
import {
  NO_FLOOR_UNITS,
  downhillOnWalkSurface,
  findActorCeilingUnits,
  findActorSupportUnits,
  isBlockedVertical,
  steepWalkSurfaceAt,
} from './vertical';

const ENEMY_RADIUS_UNITS = 300;
const SLIDE_SPEED_UNITS_PER_TICK = 30;

/** Horizontal step for movement input, normalized so diagonals are not faster */
function inputStepUnits(
  yawBam: number,
  moveF: number,
  moveR: number,
  speed: number
): { dx: number; dz: number } {
  // Forward = (-sin(yaw), -cos(yaw)), Right = (cos(yaw), -sin(yaw))
  const sinYaw = bamSin(yawBam);
  const cosYaw = bamCos(yawBam);
  const rawDirX = -sinYaw * moveF + cosYaw * moveR;
  const rawDirZ = -cosYaw * moveF - sinYaw * moveR;
  const mag = isqrt(rawDirX * rawDirX + rawDirZ * rawDirZ);
  if (mag === 0) return { dx: 0, dz: 0 };
  return {
    dx: Math.trunc((rawDirX * speed) / mag),
    dz: Math.trunc((rawDirZ * speed) / mag),
  };
}

/**
 * Moves a circle by (dx, dz), sliding along whatever blocks it one axis at a time,
 * and taking the full diagonal step when both slides are blocked but the diagonal is clear.
 */
function slideMove(
  x: number,
  z: number,
  dx: number,
  dz: number,
  blocked: (x: number, z: number) => boolean
): { x: number; z: number } {
  let nextX = x;
  let nextZ = z;
  if (!blocked(x + dx, nextZ)) nextX = x + dx;
  if (!blocked(nextX, z + dz)) nextZ = z + dz;
  if (nextX === x && nextZ === z && dx !== 0 && dz !== 0 && !blocked(x + dx, z + dz)) {
    nextX = x + dx;
    nextZ = z + dz;
  }
  return { x: nextX, z: nextZ };
}

/** One tick of player movement on a vertical level */
export function stepVerticalPlayer(
  state: SimulationState,
  vertical: VerticalSimState,
  player: PlayerSimState,
  input: PlayerTickInput,
  moveF: number,
  moveR: number
): void {
  const movement = vertical.movement;
  const stepUnits = movement.stepUnits;
  const radius = SIM_CONFIG.PLAYER_RADIUS_UNITS;
  let x = player.xUnits;
  let z = player.zUnits;
  let feet = player.feetUnits ?? player.yUnits - SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS;
  let velY = player.velYUnits ?? 0;
  let onGround = player.onGround ?? true;
  let crouching = player.crouching ?? false;

  // Crouching: stand back up only where there is head room
  if (movement.crouch && input.crouch) {
    crouching = true;
  } else if (crouching) {
    const ceiling = findActorCeilingUnits(state, x, z, radius, feet, 0);
    if (ceiling - feet >= SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS) crouching = false;
  }
  const bodyUnits = crouching
    ? SIM_CONFIG.PLAYER_CROUCH_HEIGHT_UNITS
    : SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS;

  // Horizontal movement
  if ((moveF !== 0 || moveR !== 0) && player.controlsLockedTicks === 0) {
    let speed: number = input.sprint
      ? SIM_CONFIG.SPRINT_SPEED_UNITS_PER_TICK
      : SIM_CONFIG.WALK_SPEED_UNITS_PER_TICK;
    if (crouching) speed = Math.trunc(speed / 2);
    const { dx, dz } = inputStepUnits(player.yawBam, moveF, moveR, speed);
    if (input.noclip) {
      x += dx;
      z += dz;
    } else {
      const moved = slideMove(x, z, dx, dz, (cx, cz) =>
        isBlockedVertical(state, cx, cz, radius, feet, bodyUnits, stepUnits)
      );
      x = moved.x;
      z = moved.z;
    }
  }

  if (!input.noclip) {
    // Model surfaces too steep to stand on slide you downhill
    if (onGround) {
      const steep = steepWalkSurfaceAt(state, x, z, feet);
      if (steep) {
        const slide = downhillOnWalkSurface(steep, x, z, SLIDE_SPEED_UNITS_PER_TICK);
        const moved = slideMove(x, z, slide.dx, slide.dz, (cx, cz) =>
          isBlockedVertical(state, cx, cz, radius, feet, bodyUnits, stepUnits)
        );
        x = moved.x;
        z = moved.z;
      }
    }

    if (movement.jump && input.jump && onGround) {
      velY = SIM_CONFIG.JUMP_VELOCITY_UNITS_PER_TICK;
      onGround = false;
    }

    const support = findActorSupportUnits(state, x, z, radius, feet, stepUnits);
    if (onGround) {
      // Follow stairs and slopes up and down; walking off a ledge starts a fall
      if (support !== NO_FLOOR_UNITS && support >= feet - stepUnits) {
        feet = support;
        velY = 0;
      } else {
        onGround = false;
      }
    }
    if (!onGround) {
      velY = Math.max(
        -SIM_CONFIG.MAX_FALL_SPEED_UNITS_PER_TICK,
        velY - SIM_CONFIG.GRAVITY_UNITS_PER_TICK_SQ
      );
      const nextFeet = feet + velY;
      if (velY <= 0 && support !== NO_FLOOR_UNITS && nextFeet <= support) {
        const landingSpeed = -velY;
        feet = support;
        velY = 0;
        onGround = true;
        if (movement.fallDamage && landingSpeed > SIM_CONFIG.FALL_DAMAGE_SAFE_SPEED) {
          const damage =
            (landingSpeed - SIM_CONFIG.FALL_DAMAGE_SAFE_SPEED) *
            SIM_CONFIG.FALL_DAMAGE_PER_SPEED_UNIT;
          player.health = Math.max(0, player.health - damage);
          if (player.health === 0) player.isDead = true;
        }
      } else {
        feet = nextFeet;
      }
      // Hitting a ceiling stops the rise
      const ceiling = findActorCeilingUnits(state, x, z, radius, feet, stepUnits);
      if (velY > 0 && feet + bodyUnits > ceiling) {
        feet = Math.max(support === NO_FLOOR_UNITS ? feet : support, ceiling - bodyUnits);
        velY = 0;
      }
    }

    if (feet < SIM_CONFIG.KILL_PLANE_UNITS) {
      player.health = 0;
      player.isDead = true;
      feet = SIM_CONFIG.KILL_PLANE_UNITS;
      velY = 0;
    }
  }

  const movedDx = x - player.xUnits;
  const movedDz = z - player.zUnits;
  player.xUnits = x;
  player.zUnits = z;
  player.speedUnitsPerTick = isqrt(movedDx * movedDx + movedDz * movedDz);
  player.feetUnits = feet;
  player.velYUnits = velY;
  player.onGround = onGround;
  player.crouching = crouching;
  player.yUnits =
    feet +
    (crouching ? SIM_CONFIG.PLAYER_CROUCH_EYE_HEIGHT_UNITS : SIM_CONFIG.PLAYER_EYE_HEIGHT_UNITS);
}

/**
 * Moves a chasing enemy one step toward (nextX, nextZ) on a vertical level: it climbs
 * steps and slopes, cannot walk through walls or under low ceilings, and drops off ledges.
 */
export function moveSimEntityVertical(
  state: SimulationState,
  vertical: VerticalSimState,
  ent: SimEntityState,
  nextX: number,
  nextZ: number
): void {
  const stepUnits = vertical.movement.stepUnits;
  const feet = ent.yUnits;
  if (
    isBlockedVertical(
      state,
      nextX,
      nextZ,
      ENEMY_RADIUS_UNITS,
      feet,
      SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS,
      stepUnits
    )
  ) {
    return;
  }
  const support = findActorSupportUnits(state, nextX, nextZ, ENEMY_RADIUS_UNITS, feet, stepUnits);
  if (support === NO_FLOOR_UNITS) return; // Never walk into a bottomless pit
  const cell = worldUnitsToGrid(nextX, nextZ, state.gridSize);
  ent.xUnits = nextX;
  ent.zUnits = nextZ;
  ent.row = cell.row;
  ent.col = cell.col;
  ent.yUnits = support;
}
