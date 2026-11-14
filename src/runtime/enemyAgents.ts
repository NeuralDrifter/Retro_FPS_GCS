/** Enemy agent types, constants and the AI helpers that need no system state (moved out of EnemyAISystem.ts in P1.4) */
import * as THREE from 'three';
import {
  ENGINE_CONFIG,
  EnemyAIState,
} from './types';
import { SpawnedEntityInstance } from './EntityLoader';
import { CollisionSystem } from './CollisionSystem';
import {
  SIM_CONFIG,
  VerticalWorldView,
} from '../sim';
import { VerticalNavigator } from './verticalNav';

export const UNITS_PER_METER = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE;
/** Enemies are about player height and need the same head room */
export const ENEMY_BODY_UNITS = SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS;
/** Height difference (meters) within which an enemy can strike or walk straight at the player */
export const SAME_LEVEL_METERS = 1.2;
export const GRAVITY_METERS_PER_SEC_SQ = 25;

export interface RuntimeEnemyAgent {
  instance: SpawnedEntityInstance;
  health: number;
  maxHealth: number;
  state: EnemyAIState;
  hitFlashTimer: number;     // > 0 while flashing crimson red (0.12s on hit)
  attackCooldownTimer: number;
  memoryTimer: number;       // Remembers player briefly around corners
  losCheckTimer: number;     // Staggered timer for LOS raycast checks (~10 Hz)
  hasLineOfSight: boolean;
  deathTiltProgress: number; // 0..1 smooth fall-flat animation progress
  isCollidable: boolean;
  /** Vertical levels: falling speed (m/s, negative is down) and route-finding state */
  velY?: number;
  waypoint?: { x: number; z: number } | null;
  repathTimer?: number;
}

export interface RuntimeAmmoDrop {
  id: string;
  x: number;
  y: number;
  z: number;
  amount: number;
  collected: boolean;
  meshGroup: THREE.Group;
}

/**
 * Shortest-arc angle damping helper for smooth enemy rotation.
 */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  dt: number
): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

/**
 * Toggles bright crimson red hit flash (`0xff1133`) across all materials of an enemy.
 */
export function applyMaterialHitFlash(
  agent: RuntimeEnemyAgent,
  flashActive: boolean
): void {
  for (let i = 0; i < agent.instance.materials.length; i++) {
    const entry = agent.instance.materials[i];
    if (flashActive) {
      entry.material.color.setHex(0xff1133);
      entry.material.emissive.setHex(0xff0022);
      entry.material.emissiveIntensity = 1.4;
    } else {
      entry.material.color.setHex(entry.originalColorHex);
      entry.material.emissive.setHex(entry.originalEmissiveHex);
      entry.material.emissiveIntensity = entry.originalEmissiveIntensity;
    }
  }
}

/**
 * Dims an enemy's materials once its death flash completes.
 */
export function dimDeadEnemyMaterials(
agent: RuntimeEnemyAgent): void {
  for (let i = 0; i < agent.instance.materials.length; i++) {
    const entry = agent.instance.materials[i];
    entry.material.color.setHex(0x334155);
    entry.material.emissive.setHex(0x000000);
    entry.material.emissiveIntensity = 0;
  }
}

/**
 * Spawns a 3D glowing Ammo Pickup Crate at a defeated enemy's coordinates.
 */
export function spawnAmmoDrop(
  ammoDrops: RuntimeAmmoDrop[],
  lootContainer: THREE.Group,
  id: string,
  x: number,
  y: number,
  z: number,
  amount: number
): void {
  const group = new THREE.Group();
  group.name = `AmmoPickup_${id}`;
  group.position.set(x, y + 0.32, z);

  // Emerald/Cyan Plasma Cell Ammo Pack Mesh
  const packBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.42, 0.44),
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.7,
    })
  );
  group.add(packBody);

  const energyCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.16, 0.48),
    new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.95,
      roughness: 0.2,
    })
  );
  group.add(energyCore);

  const floorRing = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.55, 16),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
    })
  );
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = -0.28;
  group.add(floorRing);

  lootContainer.add(group);
  ammoDrops.push({
    id,
    x,
    y,
    z,
    amount,
    collected: false,
    meshGroup: group,
  });
}

/** Direction (normalized, XZ) a chasing enemy should walk on a vertical level */
export function chaseDirectionVertical(
  navigator: VerticalNavigator | null,
  agent: RuntimeEnemyAgent,
  playerPos: THREE.Vector3,
  playerFeetY: number,
  dt: number
): { x: number; z: number } | null {
  const pos = agent.instance.rootGroup.position;
  const sameLevel = Math.abs(playerFeetY - pos.y) < SAME_LEVEL_METERS;
  let tx = playerPos.x;
  let tz = playerPos.z;
  if (!(sameLevel && agent.hasLineOfSight) && navigator) {
    agent.repathTimer = (agent.repathTimer ?? 0) - dt;
    if (agent.repathTimer <= 0 || agent.waypoint === undefined) {
      agent.repathTimer = 0.4;
      const from = navigator.nodeAt(
        Math.round(pos.x * UNITS_PER_METER),
        Math.round(pos.z * UNITS_PER_METER),
        Math.round(pos.y * UNITS_PER_METER)
      );
      const to = navigator.nodeAt(
        Math.round(playerPos.x * UNITS_PER_METER),
        Math.round(playerPos.z * UNITS_PER_METER),
        Math.round(playerFeetY * UNITS_PER_METER)
      );
      const next = from && to ? navigator.nextWaypoint(from, to) : null;
      agent.waypoint = next
        ? { x: next.xUnits / UNITS_PER_METER, z: next.zUnits / UNITS_PER_METER }
        : null;
    }
    if (agent.waypoint) {
      tx = agent.waypoint.x;
      tz = agent.waypoint.z;
    } else if (!sameLevel) {
      return null; // No route to the player's level: hold position
    }
  }
  const dx = tx - pos.x;
  const dz = tz - pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return null;
  return { x: dx / len, z: dz / len };
}

/**
 * Resolves player Circle-vs-Circle collision against living, collidable entities
 * so the player cannot walk straight through living enemies or supply crates,
 * while dead enemies (`isCollidable = false`) have their collision disabled.
 */
export function resolvePlayerEntityCollision(
  agents: Map<string, RuntimeEnemyAgent>,
  verticalView: VerticalWorldView | null,
  playerX: number,
  playerZ: number,
  collisionEnabled: boolean,
  grid?: number[][],
  openDoors?: Set<string>,
  solidFootprint?: number[][],
  playerFeetY?: number
): { x: number; z: number } {
  if (!collisionEnabled) return { x: playerX, z: playerZ };

  let rx = playerX;
  let rz = playerZ;
  const minDist = ENGINE_CONFIG.PLAYER_RADIUS + ENGINE_CONFIG.ENTITY_RADIUS * 0.55;

  const vertical = verticalView;
  agents.forEach((agent) => {
    if (!agent.isCollidable || agent.state === 'Dead') return;
    if (
      vertical &&
      playerFeetY !== undefined &&
      Math.abs(agent.instance.rootGroup.position.y - playerFeetY) > SAME_LEVEL_METERS
    ) {
      return;
    }
    const ex = agent.instance.rootGroup.position.x;
    const ez = agent.instance.rootGroup.position.z;
    const dx = rx - ex;
    const dz = rz - ez;
    const dist = Math.hypot(dx, dz);
    if (dist < minDist && dist > 0.0001) {
      const push = minDist - dist;
      const nx = dx / dist;
      const nz = dz / dist;

      if (agent.instance.isEnemy && agent.instance.moveSpeed > 0 && grid && openDoors && !vertical) {
        // Split push between player and mobile enemy so an enemy cannot pin the player in a 1-cell hallway
        const playerPush = push * 0.5;
        const enemyPush = push * 0.5;
        rx += nx * playerPush;
        rz += nz * playerPush;
        const enemyResolved = CollisionSystem.resolveMovement(
          ex,
          ez,
          -nx * enemyPush,
          -nz * enemyPush,
          grid,
          openDoors,
          true,
          solidFootprint,
          ENGINE_CONFIG.ENTITY_RADIUS * 0.8
        );
        agent.instance.rootGroup.position.x = enemyResolved.x;
        agent.instance.rootGroup.position.z = enemyResolved.z;
      } else {
        rx += nx * push;
        rz += nz * push;
      }
    }
  });

  return { x: rx, z: rz };
}
