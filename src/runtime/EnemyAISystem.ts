/**
 * ============================================================================
 * FORGECORE PHASE 3: ENEMY AI FINITE STATE MACHINE & LOOT DROP SYSTEM (ai.ts)
 * ============================================================================
 * Manages all spawned `.glb` entities in the 3D viewport, classifying hostile
 * models as 'Enemies' and running a delta-time (`dt`) synchronized State Machine:
 *
 *  - `Idle`  : Standing guard. Performs a Line-of-Sight (LOS) `THREE.Raycaster`
 *              check toward the player. Transitions to `Chase` when unobstructed.
 *  - `Chase` : Moves 3D coordinates smoothly toward the player using `dt` and
 *              wall-sliding collision detection so movement speed is identical
 *              across 60Hz, 120Hz, and 240Hz monitors.
 *  - `Attack`: Within melee range (`2.35m`), strikes the player on a cooldown
 *              and decrements the player's health.
 *  - `Dead`  : When health reaches `0`, halts AI & AnimationMixer, disables
 *              collision/raycast hitboxes, lays the `.glb` model flat on the
 *              floor, and spawns a collectible 3D `Ammo` pickup at death coords.
 */

import * as THREE from 'three';
import {
  AmmoLootSnapshot,
  ENGINE_CONFIG,
  EnemyAIState,
  EnemyTelemetrySnapshot,
} from './types';
import { SpawnedEntityInstance } from './EntityLoader';
import { CollisionSystem } from './CollisionSystem';
import {
  NO_FLOOR_UNITS,
  SIM_CONFIG,
  VerticalWorldView,
  findActorSupportUnits,
  isBlockedVertical,
} from './sim';
import { VerticalNavigator } from './verticalNav';

const UNITS_PER_METER = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE;
/** Enemies are about player height and need the same head room */
const ENEMY_BODY_UNITS = SIM_CONFIG.PLAYER_BODY_HEIGHT_UNITS;
/** Height difference (meters) within which an enemy can strike or walk straight at the player */
const SAME_LEVEL_METERS = 1.2;
const GRAVITY_METERS_PER_SEC_SQ = 25;

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

export class EnemyAISystem {
  private agents = new Map<string, RuntimeEnemyAgent>();
  private ammoDrops: RuntimeAmmoDrop[] = [];
  private lootContainer: THREE.Group;

  // Pre-allocated Raycaster & math vectors for Zero-GC 60fps AI updates
  private losRaycaster = new THREE.Raycaster();
  private enemyEyePos = new THREE.Vector3();
  private playerEyePos = new THREE.Vector3();
  private rayDir = new THREE.Vector3();

  /** Vertical levels: the current world, and a route finder rebuilt as doors and lifts move */
  private verticalView: VerticalWorldView | null = null;
  private navigator: VerticalNavigator | null = null;
  private navAgeSec = 0;

  constructor(lootContainer: THREE.Group) {
    this.lootContainer = lootContainer;
  }

  /**
   * Gives the AI the current vertical world (the latest simulation state), or null on
   * flat levels. Enemies then stand on floors, fall, climb steps, and find routes
   * between layers.
   */
  public setVerticalWorld(view: VerticalWorldView | null): void {
    this.verticalView = view && view.vertical ? view : null;
    if (!this.verticalView) this.navigator = null;
  }

  private moveAgentVertical(rootPos: THREE.Vector3, stepX: number, stepZ: number): void {
    const view = this.verticalView!;
    const stepUnits = view.vertical!.movement.stepUnits;
    const radius = Math.round(ENGINE_CONFIG.ENTITY_RADIUS * 0.8 * UNITS_PER_METER);
    const feet = Math.round(rootPos.y * UNITS_PER_METER);
    const canStand = (x: number, z: number) => {
      const xu = Math.round(x * UNITS_PER_METER);
      const zu = Math.round(z * UNITS_PER_METER);
      if (isBlockedVertical(view, xu, zu, radius, feet, ENEMY_BODY_UNITS, stepUnits)) return false;
      // Never walk into a bottomless pit
      return findActorSupportUnits(view, xu, zu, radius, feet, stepUnits) !== NO_FLOOR_UNITS;
    };
    if (canStand(rootPos.x + stepX, rootPos.z)) rootPos.x += stepX;
    if (canStand(rootPos.x, rootPos.z + stepZ)) rootPos.z += stepZ;
  }

  /** Keeps an enemy on the floor under it: steps up and down, and falls off ledges */
  private applyAgentGravity(agent: RuntimeEnemyAgent, dt: number): void {
    const view = this.verticalView!;
    const pos = agent.instance.rootGroup.position;
    const stepUnits = view.vertical!.movement.stepUnits;
    const radius = Math.round(ENGINE_CONFIG.ENTITY_RADIUS * 0.8 * UNITS_PER_METER);
    const support = findActorSupportUnits(
      view,
      Math.round(pos.x * UNITS_PER_METER),
      Math.round(pos.z * UNITS_PER_METER),
      radius,
      Math.round(pos.y * UNITS_PER_METER),
      stepUnits
    );
    if (support === NO_FLOOR_UNITS) return;
    const floorY = support / UNITS_PER_METER;
    const stepMeters = stepUnits / UNITS_PER_METER;
    if (pos.y - floorY > stepMeters || (agent.velY ?? 0) < 0) {
      agent.velY = (agent.velY ?? 0) - GRAVITY_METERS_PER_SEC_SQ * dt;
      pos.y = Math.max(floorY, pos.y + agent.velY * dt);
      if (pos.y === floorY) agent.velY = 0;
    } else {
      pos.y = floorY;
      agent.velY = 0;
    }
  }

  /** Direction (normalized, XZ) a chasing enemy should walk on a vertical level */
  private chaseDirectionVertical(
    agent: RuntimeEnemyAgent,
    playerPos: THREE.Vector3,
    playerFeetY: number,
    dt: number
  ): { x: number; z: number } | null {
    const pos = agent.instance.rootGroup.position;
    const sameLevel = Math.abs(playerFeetY - pos.y) < SAME_LEVEL_METERS;
    let tx = playerPos.x;
    let tz = playerPos.z;
    if (!(sameLevel && agent.hasLineOfSight) && this.navigator) {
      agent.repathTimer = (agent.repathTimer ?? 0) - dt;
      if (agent.repathTimer <= 0 || agent.waypoint === undefined) {
        agent.repathTimer = 0.4;
        const from = this.navigator.nodeAt(
          Math.round(pos.x * UNITS_PER_METER),
          Math.round(pos.z * UNITS_PER_METER),
          Math.round(pos.y * UNITS_PER_METER)
        );
        const to = this.navigator.nodeAt(
          Math.round(playerPos.x * UNITS_PER_METER),
          Math.round(playerPos.z * UNITS_PER_METER),
          Math.round(playerFeetY * UNITS_PER_METER)
        );
        const next = from && to ? this.navigator.nextWaypoint(from, to) : null;
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
   * Registers a loaded `.glb` entity instance with the AI & Combat runtime.
   */
  public registerEntity(spawned: SpawnedEntityInstance): void {
    const stagger = (this.agents.size % 6) * 0.02;
    this.agents.set(spawned.entityId, {
      instance: spawned,
      health: spawned.maxHealth,
      maxHealth: spawned.maxHealth,
      state: 'Idle',
      hitFlashTimer: 0,
      attackCooldownTimer: 0.4,
      memoryTimer: 0,
      losCheckTimer: stagger,
      hasLineOfSight: false,
      deathTiltProgress: 0,
      isCollidable: true,
    });
  }

  /**
   * Returns all registered runtime agents.
   */
  public getAgents(): Map<string, RuntimeEnemyAgent> {
    return this.agents;
  }

  /**
   * Returns lightweight 12-triangle bounding-box hitbox meshes for living
   * enemies/destructibles so weapon `Raycaster` checks never stall on CPU SkinnedMesh triangles.
   */
  public getHittableObjects(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    this.agents.forEach((agent) => {
      if (agent.state !== 'Dead') {
        list.push(agent.instance.hitboxMesh);
      }
    });
    return list;
  }

  /**
   * Applies weapon damage to an entity struck by the player's Raycaster.
   * Triggers a 0.12-second crimson material hit flash (`0xff1133`), reduces
   * health, and transitions the enemy to `Dead` + spawns Ammo loot at 0 HP.
   */
  public damageEntity(
    entityId: string,
    damage: number
  ): {
    hit: boolean;
    killed: boolean;
    enemyName: string;
    remainingHealth: number;
    maxHealth: number;
    droppedAmmo: boolean;
  } | null {
    const agent = this.agents.get(entityId);
    if (!agent || agent.state === 'Dead') return null;

    agent.health = Math.max(0, agent.health - damage);
    agent.hitFlashTimer = ENGINE_CONFIG.HIT_FLASH_DURATION;

    // Provoke idle enemy immediately when shot from afar
    if (agent.instance.isEnemy && agent.state === 'Idle') {
      agent.state = 'Chase';
      agent.memoryTimer = 4.0;
    }

    // Apply immediate crimson red hit-flash to all cloned materials on this model
    this.applyMaterialHitFlash(agent, true);

    // Update 3D floating health bar width
    if (agent.instance.healthBarFill) {
      const ratio = Math.max(0.001, agent.health / agent.maxHealth);
      agent.instance.healthBarFill.scale.x = ratio;
      agent.instance.healthBarFill.position.x = -(1 - ratio) * 0.64;
    }

    let killed = false;
    let droppedAmmo = false;

    if (agent.health <= 0) {
      killed = true;
      agent.state = 'Dead';
      agent.isCollidable = false;

      // Stop skeletal/keyframe AnimationMixer
      if (agent.instance.mixer) {
        agent.instance.mixer.stopAllAction();
      }

      // Hide floating health bar
      if (agent.instance.healthBarGroup) {
        agent.instance.healthBarGroup.visible = false;
      }

      // Dim tactical floor ring to dark slate
      const ringMat = agent.instance.baseRing
        .material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(0x334155);

      // Spawn a collectible 3D 'Ammo' pickup at the defeated enemy's coordinates
      const pos = agent.instance.rootGroup.position;
      this.spawnAmmoDrop(
        `ammo-${entityId}-${Date.now()}`,
        pos.x,
        pos.y,
        pos.z,
        ENGINE_CONFIG.AMMO_DROP_AMOUNT
      );
      droppedAmmo = true;
    }

    return {
      hit: true,
      killed,
      enemyName: agent.instance.placedEntity.name,
      remainingHealth: agent.health,
      maxHealth: agent.maxHealth,
      droppedAmmo,
    };
  }

  /**
   * Main per-frame update loop for all Enemy AI State Machines & Ammo Pickups.
   * Tied strictly to `requestAnimationFrame` delta time (`dt`) so movement speed
   * and cooldown timers are 100% independent of monitor refresh rate.
   */
  public update(
    dt: number,
    elapsed: number,
    playerPos: THREE.Vector3,
    grid: number[][],
    openDoors: Set<string>,
    occluderMeshes: THREE.Object3D[],
    isPlayerDead: boolean,
    callbacks: {
      onPlayerDamaged: (damage: number, attackerName: string) => void;
      onAmmoCollected: (amount: number) => void;
    },
    solidFootprint?: number[][]
  ): void {
    const vertical = this.verticalView;
    // The camera is at the player's eye; their feet are one eye height lower
    const playerFeetY = playerPos.y - ENGINE_CONFIG.PLAYER_EYE_HEIGHT;
    this.playerEyePos.set(
      playerPos.x,
      vertical ? playerPos.y - 0.25 : ENGINE_CONFIG.PLAYER_EYE_HEIGHT * 0.85,
      playerPos.z
    );
    if (vertical) {
      this.navAgeSec += dt;
      if (!this.navigator || this.navAgeSec > 1) {
        this.navigator = new VerticalNavigator(vertical);
        this.navAgeSec = 0;
      }
    }

    // ------------------------------------------------------------------------
    // 1. UPDATE EACH ENEMY AGENT'S STATE MACHINE & HIT-FLASH TIMERS
    // ------------------------------------------------------------------------
    this.agents.forEach((agent) => {
      const { instance } = agent;
      const rootPos = instance.rootGroup.position;

      // A. Update 0.12s Crimson Red Hit-Flash Timer
      if (agent.hitFlashTimer > 0) {
        agent.hitFlashTimer = Math.max(0, agent.hitFlashTimer - dt);
        if (agent.hitFlashTimer === 0) {
          this.applyMaterialHitFlash(agent, false);
          if (agent.state === 'Dead') {
            this.dimDeadEnemyMaterials(agent);
          }
        }
      }

      // B. Handle 'Dead' State: Smoothly topple model flat onto the floor
      if (agent.state === 'Dead') {
        if (agent.deathTiltProgress < 1) {
          agent.deathTiltProgress = Math.min(
            1,
            agent.deathTiltProgress + dt * 4.5
          );
          // Lay the model flat (-90 degrees around X) and settle onto the floor
          instance.modelGroup.rotation.x = THREE.MathUtils.lerp(
            0,
            -Math.PI / 2,
            agent.deathTiltProgress
          );
          instance.modelGroup.position.y = THREE.MathUtils.lerp(
            0,
            0.32,
            agent.deathTiltProgress
          );
        }
        return;
      }

      // Update keyframe AnimationMixer for living entities
      if (instance.mixer) {
        const timeScale = agent.state === 'Chase' ? 1.65 : 1.0;
        instance.mixer.update(dt * timeScale);
      }

      // Make floating 3D health bar billboard toward the player camera
      if (instance.healthBarGroup) {
        instance.healthBarGroup.lookAt(
          playerPos.x,
          instance.healthBarGroup.getWorldPosition(this.enemyEyePos).y,
          playerPos.z
        );
      }

      if (vertical && instance.isEnemy) this.applyAgentGravity(agent, dt);

      // Static non-enemy objects (like Supply Crates) stay in Idle unless broken
      if (!instance.isEnemy || isPlayerDead) {
        return;
      }

      // Compute planar distance & angle to player
      const dxToPlayer = playerPos.x - rootPos.x;
      const dzToPlayer = playerPos.z - rootPos.z;
      const distToPlayer = Math.hypot(dxToPlayer, dzToPlayer);
      const sameLevel = !vertical || Math.abs(playerFeetY - rootPos.y) < SAME_LEVEL_METERS;

      // Line-of-Sight (LOS) Raycaster check from Enemy Eye to Player Eye (throttled to ~10 Hz per agent)
      if (distToPlayer > ENGINE_CONFIG.ENEMY_LOS_RANGE) {
        agent.hasLineOfSight = false;
      } else {
        agent.losCheckTimer -= dt;
        if (agent.losCheckTimer <= 0) {
          agent.losCheckTimer = 0.1;
          this.enemyEyePos.set(rootPos.x, (vertical ? rootPos.y : 0) + 1.5, rootPos.z);
          this.rayDir.subVectors(this.playerEyePos, this.enemyEyePos);
          const sightDistance = this.rayDir.length();
          this.rayDir.normalize();

          this.losRaycaster.set(this.enemyEyePos, this.rayDir);
          this.losRaycaster.near = 0.2;
          this.losRaycaster.far = vertical ? sightDistance : distToPlayer;

          const wallHits = this.losRaycaster.intersectObjects(
            occluderMeshes,
            true
          );
          agent.hasLineOfSight = wallHits.length === 0;
        }
      }
      const hasLineOfSight = agent.hasLineOfSight;

      if (hasLineOfSight) {
        agent.memoryTimer = 2.8; // Keep chasing for 2.8s if player ducks behind a pillar
      } else {
        agent.memoryTimer = Math.max(0, agent.memoryTimer - dt);
      }

      // ----------------------------------------------------------------------
      // FINITE STATE MACHINE TRANSITIONS (Idle <-> Chase <-> Attack)
      // ----------------------------------------------------------------------
      if (distToPlayer <= ENGINE_CONFIG.ENEMY_ATTACK_RANGE && hasLineOfSight && sameLevel) {
        agent.state = 'Attack';
      } else if (hasLineOfSight || agent.memoryTimer > 0) {
        agent.state = 'Chase';
      } else {
        agent.state = 'Idle';
      }

      // Update tactical floor ring color to reflect AI State
      const ringMat = instance.baseRing.material as THREE.MeshBasicMaterial;
      if (agent.state === 'Attack') {
        ringMat.color.setHex(0xff1133);
      } else if (agent.state === 'Chase') {
        ringMat.color.setHex(0xf59e0b);
      } else {
        ringMat.color.setHex(0xf43f5e);
      }

      // ----------------------------------------------------------------------
      // EXECUTE ACTIVE AI STATE BEHAVIOR
      // ----------------------------------------------------------------------
      if (agent.state === 'Idle') {
        // Gentle idle scan rotation
        instance.modelGroup.position.z = THREE.MathUtils.damp(
          instance.modelGroup.position.z,
          0,
          8,
          dt
        );
      } else if (agent.state === 'Chase') {
        // Rotate enemy smoothly to face player
        const targetYaw = Math.atan2(dxToPlayer, dzToPlayer);
        instance.rootGroup.rotation.y = this.dampAngle(
          instance.rootGroup.rotation.y,
          targetYaw,
          8.0,
          dt
        );

        // Move toward player tied to delta time (dt) with wall-sliding collision
        const routeDir = vertical
          ? this.chaseDirectionVertical(agent, playerPos, playerFeetY, dt)
          : null;
        if (
          (distToPlayer > ENGINE_CONFIG.ENEMY_ATTACK_RANGE * 0.88 || !sameLevel) &&
          (!vertical || routeDir)
        ) {
          const dirX = routeDir ? routeDir.x : dxToPlayer / Math.max(distToPlayer, 0.001);
          const dirZ = routeDir ? routeDir.z : dzToPlayer / Math.max(distToPlayer, 0.001);

          // Apply soft repulsion from other living enemies so they don't overlap
          let sepX = 0;
          let sepZ = 0;
          this.agents.forEach((other) => {
            if (other === agent || other.state === 'Dead') return;
            const ox = rootPos.x - other.instance.rootGroup.position.x;
            const oz = rootPos.z - other.instance.rootGroup.position.z;
            const oDist = Math.hypot(ox, oz);
            if (oDist > 0.001 && oDist < 1.65) {
              sepX += (ox / oDist) * (1.65 - oDist) * 1.5;
              sepZ += (oz / oDist) * (1.65 - oDist) * 1.5;
            }
          });

          const stepX = (dirX * instance.moveSpeed + sepX) * dt;
          const stepZ = (dirZ * instance.moveSpeed + sepZ) * dt;

          if (vertical) {
            this.moveAgentVertical(rootPos, stepX, stepZ);
          } else {
            const resolved = CollisionSystem.resolveMovement(
              rootPos.x,
              rootPos.z,
              stepX,
              stepZ,
              grid,
              openDoors,
              true,
              solidFootprint,
              ENGINE_CONFIG.ENTITY_RADIUS * 0.8
            );

            rootPos.x = resolved.x;
            rootPos.z = resolved.z;
          }
        }

        instance.modelGroup.position.z = THREE.MathUtils.damp(
          instance.modelGroup.position.z,
          0,
          8,
          dt
        );
      } else if (agent.state === 'Attack') {
        // Face player and execute melee strike on cooldown
        const targetYaw = Math.atan2(dxToPlayer, dzToPlayer);
        instance.rootGroup.rotation.y = this.dampAngle(
          instance.rootGroup.rotation.y,
          targetYaw,
          10.0,
          dt
        );

        agent.attackCooldownTimer -= dt;
        if (agent.attackCooldownTimer <= 0) {
          agent.attackCooldownTimer = ENGINE_CONFIG.ENEMY_ATTACK_COOLDOWN;
          // Lunge model forward visually on strike
          instance.modelGroup.position.z = 0.42;
          callbacks.onPlayerDamaged(
            instance.attackDamage,
            instance.placedEntity.name
          );
        } else {
          instance.modelGroup.position.z = THREE.MathUtils.damp(
            instance.modelGroup.position.z,
            0,
            10,
            dt
          );
        }
      }
    });

    // ------------------------------------------------------------------------
    // 2. UPDATE SPAWNED AMMO LOOT PICKUPS (ROTATION + PLAYER COLLECTION)
    // ------------------------------------------------------------------------
    for (let i = 0; i < this.ammoDrops.length; i++) {
      const drop = this.ammoDrops[i];
      if (drop.collected) continue;

      // Bob and spin the 3D Ammo crate
      drop.meshGroup.rotation.y = elapsed * 2.6;
      drop.meshGroup.position.y = drop.y + 0.32 + Math.sin(elapsed * 4.2 + i) * 0.1;

      const distToPlayer = Math.hypot(
        playerPos.x - drop.x,
        playerPos.z - drop.z
      );
      const reachable = !vertical || Math.abs(playerFeetY - drop.y) < SAME_LEVEL_METERS;
      if (distToPlayer <= ENGINE_CONFIG.AMMO_PICKUP_RADIUS && reachable) {
        drop.collected = true;
        drop.meshGroup.visible = false;
        callbacks.onAmmoCollected(drop.amount);
      }
    }
  }

  /**
   * Resolves player Circle-vs-Circle collision against living, collidable entities
   * so the player cannot walk straight through living enemies or supply crates,
   * while dead enemies (`isCollidable = false`) have their collision disabled.
   */
  public resolvePlayerEntityCollision(
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

    const vertical = this.verticalView;
    this.agents.forEach((agent) => {
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

  /**
   * Spawns a 3D glowing Ammo Pickup Crate at a defeated enemy's coordinates.
   */
  private spawnAmmoDrop(
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

    this.lootContainer.add(group);
    this.ammoDrops.push({
      id,
      x,
      y,
      z,
      amount,
      collected: false,
      meshGroup: group,
    });
  }

  /**
   * Toggles bright crimson red hit flash (`0xff1133`) across all materials of an enemy.
   */
  private applyMaterialHitFlash(
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
  private dimDeadEnemyMaterials(agent: RuntimeEnemyAgent): void {
    for (let i = 0; i < agent.instance.materials.length; i++) {
      const entry = agent.instance.materials[i];
      entry.material.color.setHex(0x334155);
      entry.material.emissive.setHex(0x000000);
      entry.material.emissiveIntensity = 0;
    }
  }

  /**
   * Shortest-arc angle damping helper for smooth enemy rotation.
   */
  private dampAngle(
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
   * Exports a lightweight array of enemy telemetry snapshots for the Minimap & HUD.
   */
  public getTelemetrySnapshots(): {
    enemies: EnemyTelemetrySnapshot[];
    ammoDrops: AmmoLootSnapshot[];
    kills: number;
    totalEnemies: number;
  } {
    const enemies: EnemyTelemetrySnapshot[] = [];
    let kills = 0;
    let totalEnemies = 0;

    this.agents.forEach((agent) => {
      if (agent.instance.isEnemy) {
        totalEnemies++;
        if (agent.state === 'Dead') kills++;
      }
      enemies.push({
        id: agent.instance.entityId,
        name: agent.instance.placedEntity.name,
        x: agent.instance.rootGroup.position.x,
        z: agent.instance.rootGroup.position.z,
        yaw: agent.instance.rootGroup.rotation.y,
        health: agent.health,
        maxHealth: agent.maxHealth,
        state: agent.state,
        isEnemy: agent.instance.isEnemy,
      });
    });

    const ammoDrops: AmmoLootSnapshot[] = this.ammoDrops.map((d) => ({
      id: d.id,
      x: d.x,
      z: d.z,
      amount: d.amount,
      collected: d.collected,
    }));

    return { enemies, ammoDrops, kills, totalEnemies };
  }
}
