/**
 * ============================================================================
 * FORGECORE PHASE 3: RAYCASTER COMBAT, 3D CAMERA WEAPON & MUZZLE FLASH (combat.ts)
 * ============================================================================
 * Handles all first-person shooting mechanics:
 *  1. Attaches a 3D First-Person Plasma Rifle model directly to the Three.js
 *     `PerspectiveCamera` with view-bobbing, kickback recoil, and a 3D muzzle
 *     flash + dynamic `PointLight`.
 *  2. Casts a `THREE.Raycaster` ray from the exact center of the camera `(0,0)`
 *     forward when the player fires.
 *  3. Resolves wall/door occlusion vs. Enemy hits, spawns a 3D plasma tracer
 *     beam and impact spark, and triggers the Enemy hit event (`damageEntity`).
 */

import * as THREE from 'three';
import { ENGINE_CONFIG } from './types';
import { EnemyAISystem } from './EnemyAISystem';

export interface ShotResult {
  fired: boolean;
  hitEnemy: boolean;
  killedEnemy: boolean;
  hitEntityId: string | null;
  enemyName: string | null;
  enemyRemainingHealth: number | null;
  enemyMaxHealth: number | null;
  droppedAmmo: boolean;
}

export class CombatSystem {
  private raycaster = new THREE.Raycaster();
  private centerNdc = new THREE.Vector2(0, 0);

  // 3D Weapon attached to the player camera
  public weaponGroup: THREE.Group;
  private weaponMeshPivot: THREE.Group;
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleLight: THREE.PointLight;

  // 3D Plasma Tracer & Impact Spark visual effects in world space
  private fxGroup: THREE.Group;
  private tracerLine: THREE.Line;
  private tracerGeometry: THREE.BufferGeometry;
  private impactSparkMesh: THREE.Mesh;

  // Delta-time driven animation timers
  private muzzleFlashTimer = 0;
  private tracerTimer = 0;
  private recoilAmount = 0;
  private fireCooldownTimer = 0;

  // Pre-allocated vectors for Zero-GC shooting
  private barrelWorldPos = new THREE.Vector3();
  private defaultHitPos = new THREE.Vector3();
  private camForward = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene) {
    // 1. Build 3D First-Person Weapon Model and attach to Camera
    const builtWeapon = this.createFirstPersonWeaponModel();
    this.weaponGroup = builtWeapon.root;
    this.weaponMeshPivot = builtWeapon.pivot;
    this.muzzleFlashMesh = builtWeapon.muzzleFlash;
    this.muzzleLight = builtWeapon.muzzleLight;
    camera.add(this.weaponGroup);

    // 2. Build reusable 3D Plasma Tracer & Impact Spark in Scene space
    this.fxGroup = new THREE.Group();
    this.fxGroup.name = 'ForgeCore_CombatFX';

    this.tracerGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const tracerMat = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.9,
    });
    this.tracerLine = new THREE.Line(this.tracerGeometry, tracerMat);
    this.tracerLine.visible = false;
    this.fxGroup.add(this.tracerLine);

    this.impactSparkMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff3355,
      })
    );
    this.impactSparkMesh.visible = false;
    this.fxGroup.add(this.impactSparkMesh);

    scene.add(this.fxGroup);
  }

  /**
   * Fires a raycast shot from the center of the camera forward.
   * Decrements ammo in the caller if `fired === true`.
   */
  public fireWeapon(
    camera: THREE.PerspectiveCamera,
    currentAmmo: number,
    isPlayerDead: boolean,
    enemyAI: EnemyAISystem,
    occluderMeshes: THREE.Object3D[]
  ): ShotResult {
    if (isPlayerDead || currentAmmo <= 0 || this.fireCooldownTimer > 0) {
      return {
        fired: false,
        hitEnemy: false,
        killedEnemy: false,
        hitEntityId: null,
        enemyName: null,
        enemyRemainingHealth: null,
        enemyMaxHealth: null,
        droppedAmmo: false,
      };
    }

    this.fireCooldownTimer = ENGINE_CONFIG.WEAPON_FIRE_COOLDOWN;
    this.muzzleFlashTimer = 0.085;
    this.tracerTimer = 0.11;
    this.recoilAmount = 1.0;

    // Activate 3D Muzzle Flash & PointLight
    this.muzzleFlashMesh.visible = true;
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    this.muzzleLight.intensity = 5.0;

    // Cast Ray from exact center of camera forward
    this.raycaster.setFromCamera(this.centerNdc, camera);
    this.raycaster.near = 0.1;
    this.raycaster.far = 60.0;

    // 1. Check closest wall or closed door intersection
    const wallHits = this.raycaster.intersectObjects(occluderMeshes, true);
    const closestWallDist =
      wallHits.length > 0 ? wallHits[0].distance : Infinity;

    // 2. Check closest living Enemy / Entity intersection
    const hittableEntities = enemyAI.getHittableObjects();
    const entityHits = this.raycaster.intersectObjects(hittableEntities, true);

    // Compute world position of barrel tip for the 3D plasma tracer start
    this.muzzleFlashMesh.getWorldPosition(this.barrelWorldPos);

    if (
      entityHits.length > 0 &&
      entityHits[0].distance < closestWallDist
    ) {
      const hit = entityHits[0];
      const entityId = this.resolveEntityIdFromObject(hit.object);

      this.showTracerAndSpark(this.barrelWorldPos, hit.point, 0xff1133);

      if (entityId) {
        const dmgOutcome = enemyAI.damageEntity(
          entityId,
          ENGINE_CONFIG.WEAPON_DAMAGE
        );
        if (dmgOutcome) {
          return {
            fired: true,
            hitEnemy: true,
            killedEnemy: dmgOutcome.killed,
            hitEntityId: entityId,
            enemyName: dmgOutcome.enemyName,
            enemyRemainingHealth: dmgOutcome.remainingHealth,
            enemyMaxHealth: dmgOutcome.maxHealth,
            droppedAmmo: dmgOutcome.droppedAmmo,
          };
        }
      }
    }

    // Shot hit a wall or travelled into open space
    if (wallHits.length > 0) {
      this.showTracerAndSpark(
        this.barrelWorldPos,
        wallHits[0].point,
        0xf59e0b
      );
    } else {
      camera.getWorldDirection(this.camForward);
      this.defaultHitPos
        .copy(camera.position)
        .addScaledVector(this.camForward, 30);
      this.showTracerAndSpark(
        this.barrelWorldPos,
        this.defaultHitPos,
        0xf59e0b
      );
    }

    return {
      fired: true,
      hitEnemy: false,
      killedEnemy: false,
      hitEntityId: null,
      enemyName: null,
      enemyRemainingHealth: null,
      enemyMaxHealth: null,
      droppedAmmo: false,
    };
  }

  /**
   * Updates weapon recoil recovery, walking sway, muzzle flash decay, and
   * 3D laser tracer fade tied strictly to `requestAnimationFrame` delta time (`dt`).
   */
  public update(dt: number, elapsed: number, playerSpeed: number): void {
    if (this.fireCooldownTimer > 0) {
      this.fireCooldownTimer = Math.max(0, this.fireCooldownTimer - dt);
    }

    // Muzzle flash timer
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      if (this.muzzleFlashTimer === 0) {
        this.muzzleFlashMesh.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }

    // 3D Plasma Tracer & Impact Spark timer
    if (this.tracerTimer > 0) {
      this.tracerTimer = Math.max(0, this.tracerTimer - dt);
      const scale = Math.max(0.1, this.tracerTimer / 0.11);
      this.impactSparkMesh.scale.setScalar(scale);
      if (this.tracerTimer === 0) {
        this.tracerLine.visible = false;
        this.impactSparkMesh.visible = false;
      }
    }

    // Smooth weapon recoil recovery + walking bob
    this.recoilAmount = THREE.MathUtils.damp(this.recoilAmount, 0, 14, dt);
    const walkFactor = Math.min(1, playerSpeed / ENGINE_CONFIG.WALK_SPEED);
    const swayX = Math.cos(elapsed * 8.5) * 0.014 * walkFactor;
    const swayY = Math.abs(Math.sin(elapsed * 8.5)) * 0.018 * walkFactor;

    this.weaponMeshPivot.position.set(
      swayX,
      -swayY - this.recoilAmount * 0.025,
      this.recoilAmount * 0.11
    );
    this.weaponMeshPivot.rotation.x = this.recoilAmount * 0.16;
  }

  /**
   * Traverses up the Object3D parent chain to read `userData.entityId`.
   */
  private resolveEntityIdFromObject(obj: THREE.Object3D | null): string | null {
    let curr: THREE.Object3D | null = obj;
    while (curr) {
      if (typeof curr.userData?.entityId === 'string') {
        return curr.userData.entityId;
      }
      curr = curr.parent;
    }
    return null;
  }

  /**
   * Positions the 3D plasma tracer line and impact spark between the weapon
   * barrel and the raycast hit point.
   */
  private showTracerAndSpark(
    start: THREE.Vector3,
    end: THREE.Vector3,
    colorHex: number
  ): void {
    const posAttr = this.tracerGeometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    posAttr.setXYZ(0, start.x, start.y, start.z);
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;

    (this.tracerLine.material as THREE.LineBasicMaterial).color.setHex(
      colorHex
    );
    this.tracerLine.visible = true;

    this.impactSparkMesh.position.copy(end);
    (this.impactSparkMesh.material as THREE.MeshBasicMaterial).color.setHex(
      colorHex
    );
    this.impactSparkMesh.scale.setScalar(1);
    this.impactSparkMesh.visible = true;
  }

  /**
   * Constructs the 3D retro-futuristic Plasma Rifle attached to the camera.
   */
  private createFirstPersonWeaponModel(): {
    root: THREE.Group;
    pivot: THREE.Group;
    muzzleFlash: THREE.Mesh;
    muzzleLight: THREE.PointLight;
  } {
    const root = new THREE.Group();
    root.name = 'FirstPersonWeaponRoot';
    // Positioned in bottom-right / center-right of the first-person view
    root.position.set(0.32, -0.28, -0.52);

    const pivot = new THREE.Group();
    root.add(pivot);

    const gunSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.32,
      metalness: 0.78,
    });
    const gunChassisMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.45,
      metalness: 0.6,
    });
    const plasmaCoilMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });

    // Main Receiver Body
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.14, 0.46),
      gunChassisMat
    );
    pivot.add(receiver);

    // Top Cooling Shroud
    const shroud = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.05, 0.48),
      gunSteelMat
    );
    shroud.position.set(0, 0.08, -0.02);
    pivot.add(shroud);

    // Glowing Amber Plasma Accelerator Coils
    const coil = new THREE.Mesh(
      new THREE.BoxGeometry(0.142, 0.045, 0.26),
      plasmaCoilMat
    );
    coil.position.set(0, 0.02, -0.08);
    pivot.add(coil);

    // Twin Heavy Barrels
    const barrelGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.38, 12);
    barrelGeo.rotateX(Math.PI / 2);
    const upperBarrel = new THREE.Mesh(barrelGeo, gunSteelMat);
    upperBarrel.position.set(0, 0.035, -0.32);
    const lowerBarrel = new THREE.Mesh(barrelGeo, gunSteelMat);
    lowerBarrel.position.set(0, -0.025, -0.32);
    pivot.add(upperBarrel, lowerBarrel);

    // Muzzle Flash Starburst Mesh at Barrel Tip
    const flashGeo = new THREE.OctahedronGeometry(0.11, 0);
    flashGeo.scale(1.2, 1.2, 0.35);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xfef08a,
    });
    const muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    muzzleFlash.position.set(0, 0.015, -0.54);
    muzzleFlash.visible = false;
    pivot.add(muzzleFlash);

    const muzzleLight = new THREE.PointLight(0xf59e0b, 0, 8, 1.8);
    muzzleLight.position.set(0, 0.05, -0.56);
    pivot.add(muzzleLight);

    return { root, pivot, muzzleFlash, muzzleLight };
  }

  public dispose(): void {
    this.tracerGeometry.dispose();
    (this.tracerLine.material as THREE.Material).dispose();
    this.impactSparkMesh.geometry.dispose();
    (this.impactSparkMesh.material as THREE.Material).dispose();
  }
}
