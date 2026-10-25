/**
 * ============================================================================
 * PIE3D PHASE 3: ENEMY AI FINITE STATE MACHINE & LOOT DROP SYSTEM (ai.ts)
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
} from '../types/engine';
import { SpawnedEntityInstance } from './EntityLoader';
import { CollisionSystem } from './CollisionSystem';

export interface RuntimeEnemyAgent {
  instance: SpawnedEntityInstance;
  health: number;
  maxHealth: number;
  state: EnemyAIState;
  hitFlashTimer: number;     // > 0 while flashing crimson red (0.12s on hit)
  attackCooldownTimer: number;
  memoryTimer: number;       // Remembers player briefly around corners
  deathTiltProgress: number; // 0..1 smooth fall-flat animation progress
  isCollidable: boolean;
}

export interface RuntimeAmmoDrop {
  id: string;
  x: number;
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

  constructor(lootContainer: THREE.Group) {
    this.lootContainer = lootContainer;
  }

  /**
   * Registers a loaded `.glb` entity instance with the AI & Combat runtime.
   */
  public registerEntity(spawned: SpawnedEntityInstance): void {
    this.agents.set(spawned.entityId, {
      instance: spawned,
      health: spawned.maxHealth,
      maxHealth: spawned.maxHealth,
      state: 'Idle',
      hitFlashTimer: 0,
      attackCooldownTimer: 0.4,
      memoryTimer: 0,
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
   * Returns all active root meshes for living enemies/destructibles so the
   * player's weapon `Raycaster` can test hits against them.
   */
  public getHittableObjects(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    this.agents.forEach((agent) => {
      if (agent.state !== 'Dead') {
        list.push(agent.instance.modelGroup);
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
    }
  ): void {
    this.playerEyePos.set(
      playerPos.x,
      ENGINE_CONFIG.PLAYER_EYE_HEIGHT * 0.85,
      playerPos.z
    );

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

      // Static non-enemy objects (like Supply Crates) stay in Idle unless broken
      if (!instance.isEnemy || isPlayerDead) {
        return;
      }

      // Compute planar distance & angle to player
      const dxToPlayer = playerPos.x - rootPos.x;
      const dzToPlayer = playerPos.z - rootPos.z;
      const distToPlayer = Math.hypot(dxToPlayer, dzToPlayer);

      // Line-of-Sight (LOS) Raycaster check from Enemy Eye to Player Eye
      let hasLineOfSight = false;
      if (distToPlayer <= ENGINE_CONFIG.ENEMY_LOS_RANGE) {
        this.enemyEyePos.set(rootPos.x, 1.5, rootPos.z);
        this.rayDir
          .subVectors(this.playerEyePos, this.enemyEyePos)
          .normalize();

        this.losRaycaster.set(this.enemyEyePos, this.rayDir);
        this.losRaycaster.near = 0.2;
        this.losRaycaster.far = distToPlayer;

        const wallHits = this.losRaycaster.intersectObjects(
          occluderMeshes,
          true
        );
        hasLineOfSight = wallHits.length === 0;
      }

      if (hasLineOfSight) {
        agent.memoryTimer = 2.8; // Keep chasing for 2.8s if player ducks behind a pillar
      } else {
        agent.memoryTimer = Math.max(0, agent.memoryTimer - dt);
      }

      // ----------------------------------------------------------------------
      // FINITE STATE MACHINE TRANSITIONS (Idle <-> Chase <-> Attack)
      // ----------------------------------------------------------------------
      if (distToPlayer <= ENGINE_CONFIG.ENEMY_ATTACK_RANGE && hasLineOfSight) {
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
        if (distToPlayer > ENGINE_CONFIG.ENEMY_ATTACK_RANGE * 0.88) {
          const dirX = dxToPlayer / Math.max(distToPlayer, 0.001);
          const dirZ = dzToPlayer / Math.max(distToPlayer, 0.001);

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

          const resolved = CollisionSystem.resolveMovement(
            rootPos.x,
            rootPos.z,
            stepX,
            stepZ,
            grid,
            openDoors,
            true
          );

          rootPos.x = resolved.x;
          rootPos.z = resolved.z;
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
      drop.meshGroup.position.y = 0.32 + Math.sin(elapsed * 4.2 + i) * 0.1;

      const distToPlayer = Math.hypot(
        playerPos.x - drop.x,
        playerPos.z - drop.z
      );
      if (distToPlayer <= ENGINE_CONFIG.AMMO_PICKUP_RADIUS) {
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
    collisionEnabled: boolean
  ): { x: number; z: number } {
    if (!collisionEnabled) return { x: playerX, z: playerZ };

    let rx = playerX;
    let rz = playerZ;
    const minDist = ENGINE_CONFIG.PLAYER_RADIUS + ENGINE_CONFIG.ENTITY_RADIUS * 0.72;

    this.agents.forEach((agent) => {
      if (!agent.isCollidable || agent.state === 'Dead') return;
      const ex = agent.instance.rootGroup.position.x;
      const ez = agent.instance.rootGroup.position.z;
      const dx = rx - ex;
      const dz = rz - ez;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist && dist > 0.0001) {
        const push = minDist - dist;
        rx += (dx / dist) * push;
        rz += (dz / dist) * push;
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
    z: number,
    amount: number
  ): void {
    const group = new THREE.Group();
    group.name = `AmmoPickup_${id}`;
    group.position.set(x, 0.32, z);

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
