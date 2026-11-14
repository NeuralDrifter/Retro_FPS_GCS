/**
 * Player weapon actions: firing (hit tests, sim kill records, HUD flashes) and reloading.
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

import * as THREE from 'three';
import {
  ENGINE_CONFIG,
} from '../types';
import {
  getOpenDoorsSetFromSim,
  recordEntityKilledInSim,
} from '../../sim';
import type { RuntimeContext } from './RuntimeState';
import { hudEnemyTotals, syncHud } from './hud';
import type { EnemyAISystem } from '../EnemyAISystem';

/** Horizontal half-angle (radians) within which auto-aim picks an enemy */
const AUTO_AIM_CONE = 0.14;
const autoAimRay = new THREE.Raycaster();

/**
 * Doom-style vertical auto-aim: when a visible enemy is roughly in front of the camera,
 * pitches the camera toward it (the caller restores the view after the shot).
 */
function applyAutoAim(
  camera: THREE.PerspectiveCamera,
  enemyAI: EnemyAISystem,
  occluders: THREE.Object3D[]
): void {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const yaw = Math.atan2(forward.x, forward.z);
  let best: { target: THREE.Vector3; offset: number } | null = null;
  enemyAI.getAgents().forEach((agent) => {
    if (agent.state === 'Dead' || !agent.instance.isEnemy) return;
    const target = new THREE.Vector3();
    agent.instance.hitboxMesh.getWorldPosition(target);
    const dx = target.x - camera.position.x;
    const dz = target.z - camera.position.z;
    let offset = Math.abs(Math.atan2(dx, dz) - yaw);
    if (offset > Math.PI) offset = 2 * Math.PI - offset;
    if (offset > AUTO_AIM_CONE || (best && offset >= best.offset)) return;
    const toTarget = target.clone().sub(camera.position);
    const dist = toTarget.length();
    autoAimRay.set(camera.position, toTarget.normalize());
    autoAimRay.far = dist;
    if (autoAimRay.intersectObjects(occluders, true).length > 0) return;
    best = { target, offset };
  });
  if (!best) return;
  const { target } = best as { target: THREE.Vector3; offset: number };
  const horizontal = Math.hypot(target.x - camera.position.x, target.z - camera.position.z);
  const pitch = Math.atan2(target.y - camera.position.y, horizontal);
  camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw + Math.PI, 0, 'YXZ'));
}

export function emitLog(
  ctx: RuntimeContext,
  message: string): void {
  const { options } = ctx;
  options.onEngineLog?.(message);
}

export function getActiveOccluderMeshes(ctx: RuntimeContext): THREE.Object3D[] {
  const { rt } = ctx;
  const occluders = [...rt.wallMeshes];
  const openDoors = getOpenDoorsSetFromSim(rt.currSimState);
  rt.doorMeshes.forEach((doorGroup, cellKey) => {
    if (!openDoors.has(cellKey)) {
      occluders.push(doorGroup);
    }
  });
  return occluders;
}

export function handleFireWeapon(ctx: RuntimeContext): void {
  const { rt, input, isReplayOrDeterministic } = ctx;
  if (!rt.camera || !rt.combatSystem || !rt.enemyAI || rt.combatState.isDead) return;

  if (rt.combatState.ammo <= 0) {
    input.pendingShoot = true;
    emitLog(ctx, 
      'Combat: Out of Plasma Ammo — Press [R] to Reload or collect dropped Ammo Crates.'
    );
    return;
  }

  const occluders = getActiveOccluderMeshes(ctx);
  // Auto-aim (a per-game setting): tilt the shot up or down toward an enemy in front
  const savedAim = rt.camera.quaternion.clone();
  if (rt.currSimState.vertical?.movement.aim === 'auto') {
    applyAutoAim(rt.camera, rt.enemyAI, occluders);
  }
  const shot = rt.combatSystem.fireWeapon(
    rt.camera,
    rt.combatState.ammo,
    rt.combatState.isDead,
    rt.enemyAI,
    occluders
  );
  rt.camera.quaternion.copy(savedAim);

  if (!shot.fired) return;

  if (!shot.hitEnemy) {
    input.pendingShoot = true;
  } else if (shot.killedEnemy && shot.hitEntityId && !isReplayOrDeterministic) {
    rt.currSimState = recordEntityKilledInSim(
      rt.currSimState,
      shot.hitEntityId,
      0
    );
  }

  rt.isMuzzleFlashing = true;
  if (typeof window !== 'undefined') {
    window.clearTimeout(rt.muzzleFlashTimeout);
    rt.muzzleFlashTimeout = window.setTimeout(() => {
      rt.isMuzzleFlashing = false;
      syncHud(ctx);
    }, 90);
  }

  if (shot.hitEnemy) {
    rt.isHitMarkerActive = true;
    if (typeof window !== 'undefined') {
      window.clearTimeout(rt.hitMarkerTimeout);
      rt.hitMarkerTimeout = window.setTimeout(() => {
        rt.isHitMarkerActive = false;
        syncHud(ctx);
      }, 150);
    }
  }

  const snapshots = rt.enemyAI.getTelemetrySnapshots();
  rt.enemySnapshots = snapshots.enemies;
  rt.ammoDrops = snapshots.ammoDrops;

  rt.combatState = {
    ...rt.combatState,
    ammo: Math.max(0, rt.combatState.ammo - 1),
    ...hudEnemyTotals(ctx, snapshots),
    lastHitEnemyName: shot.hitEnemy
      ? shot.enemyName
      : rt.combatState.lastHitEnemyName,
    lastHitEnemyHealth: shot.hitEnemy
      ? shot.enemyRemainingHealth
      : rt.combatState.lastHitEnemyHealth,
    lastHitEnemyMaxHealth: shot.hitEnemy
      ? shot.enemyMaxHealth
      : rt.combatState.lastHitEnemyMaxHealth,
  };

  syncHud(ctx);

  if (shot.killedEnemy && shot.enemyName) {
    emitLog(ctx, 
      `Combat: Eliminated ${shot.enemyName} — Spawned +${ENGINE_CONFIG.AMMO_DROP_AMOUNT} Plasma Ammo Pickup.`
    );
  } else if (shot.hitEnemy && shot.enemyName) {
    emitLog(ctx, 
      `Combat: Hit ${shot.enemyName} (-${ENGINE_CONFIG.WEAPON_DAMAGE} HP, ${shot.enemyRemainingHealth} HP remaining).`
    );
  }
}

export function handleReloadAmmo(ctx: RuntimeContext): void {
  const { rt } = ctx;
  if (rt.combatState.isDead) return;
  const nextAmmo = Math.min(
    rt.combatState.maxAmmo,
    Math.max(rt.combatState.ammo + 24, ENGINE_CONFIG.PLAYER_START_AMMO)
  );
  rt.combatState = {
    ...rt.combatState,
    ammo: nextAmmo,
  };
  syncHud(ctx);
  emitLog(ctx, 'Combat: Reloaded Plasma Repeater (+24 Cells).');
}
