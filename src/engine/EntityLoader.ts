/**
 * ============================================================================
 * PIE3D MODULAR .GLB ENTITY LOADER & ANIMATION MIXER PIPELINE (PHASE 2 & 3)
 * ============================================================================
 * Provides a clean, modular, CORS-safe pipeline for loading 3D `.glb` / `.gltf`
 * entities (Enemy AI agents, animated avatars, and props) into the 3D world.
 *
 * Phase 3 Enhancements:
 *  - Clones `MeshStandardMaterial` per entity instance so hit-flash effects
 *    (flashing red for 0.12s when struck by a raycast shot) affect only the
 *    damaged enemy instance.
 *  - Tags all child meshes with `userData.entityId` and `userData.isEnemy` for
 *    instant `THREE.Raycaster` hit detection.
 *  - Attaches a 3D world-space tactical health bar above Enemy entities.
 */

import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  DEFAULT_ENTITY_BLUEPRINTS,
  EntityArchetypeId,
  PlacedEntity,
} from '../types/engine';
import { AssetRegistry } from './AssetRegistry';
import { isStaticModel } from './modelLibrary/categories';

export interface EntityMaterialSnapshot {
  material: THREE.MeshStandardMaterial;
  originalColorHex: number;
  originalEmissiveHex: number;
  originalEmissiveIntensity: number;
}

export interface SpawnedEntityInstance {
  entityId: string;
  placedEntity: PlacedEntity;
  isEnemy: boolean;
  maxHealth: number;
  moveSpeed: number;
  attackDamage: number;
  rootGroup: THREE.Group;
  modelGroup: THREE.Group;
  baseRing: THREE.Mesh;
  healthBarGroup: THREE.Group | null;
  healthBarFill: THREE.Mesh | null;
  mixer: THREE.AnimationMixer | null;
  materials: EntityMaterialSnapshot[];
}

interface CachedGltfAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export class EntityLoader {
  private static gltfLoader: GLTFLoader | null = null;
  private static assetCache = new Map<string, Promise<CachedGltfAsset>>();

  /**
   * Initializes and returns a singleton `GLTFLoader` configured with
   * `crossOrigin = 'anonymous'` and `DRACOLoader` support.
   */
  public static getLoader(): GLTFLoader {
    if (!this.gltfLoader) {
      const loader = new GLTFLoader();
      loader.setCrossOrigin('anonymous');

      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(
        'https://www.gstatic.com/draco/versioned/decoders/1.5.6/'
      );
      loader.setDRACOLoader(dracoLoader);

      this.gltfLoader = loader;
    }
    return this.gltfLoader;
  }

  /**
   * ==========================================================================
   * MAIN ENTRY POINT: SPAWN A 3D .GLB ENTITY / ENEMY AT A GRID CELL
   * ==========================================================================
   */
  public static async loadEntityInstance(
    entity: PlacedEntity,
    worldPos: { x: number; z: number },
    wireframe = false
  ): Promise<SpawnedEntityInstance> {
    const resolvedGlbUrl =
      entity.customGlbUrl ||
      AssetRegistry.getCustomGlbUrlForModelId(entity.modelAssetId);
    const cacheKey = resolvedGlbUrl
      ? `url:${resolvedGlbUrl}`
      : `builtin:${entity.blueprintId}`;

    // Resolve default combat stats from blueprint if not explicitly set on entity
    const bp = DEFAULT_ENTITY_BLUEPRINTS.find(
      (b) => b.id === entity.blueprintId
    );
    // Static models (decorations, items, buildings, vehicles) never fight or move
    const isStatic = isStaticModel(entity);
    const isEnemy = isStatic
      ? false
      : typeof entity.isEnemy === 'boolean'
      ? entity.isEnemy
      : bp
      ? bp.isEnemy
      : entity.blueprintId !== 'supply-crate';
    const maxHealth = entity.maxHealth ?? bp?.defaultHealth ?? 75;
    const moveSpeed = entity.moveSpeed ?? bp?.moveSpeed ?? (isEnemy ? 4.5 : 0);
    const attackDamage =
      entity.attackDamage ?? bp?.attackDamage ?? (isEnemy ? 12 : 0);

    // 1. Load (or retrieve cached) GLTF scene + animation clips
    if (!this.assetCache.has(cacheKey)) {
      this.assetCache.set(
        cacheKey,
        this.fetchOrGenerateGltfAsset(entity.blueprintId, resolvedGlbUrl)
      );
    }

    let cached: CachedGltfAsset;
    try {
      cached = await this.assetCache.get(cacheKey)!;
    } catch (error) {
      console.warn(
        `[GridForge EntityLoader] Failed to load custom .glb (${resolvedGlbUrl}). Falling back to built-in Sentinel .glb.`,
        error
      );
      cached = await this.fetchOrGenerateGltfAsset('sentinel-bot');
    }

    // 2. Clone the scene hierarchy using SkeletonUtils.clone()
    const clonedModel = SkeletonUtils.clone(cached.scene) as THREE.Group;

    // 3. Clone materials per instance (for independent red hit-flash) & tag userData for Raycaster
    const materials: EntityMaterialSnapshot[] = [];

    clonedModel.traverse((child) => {
      child.userData.entityId = entity.id;
      child.userData.isEnemy = isEnemy;

      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.entityId = entity.id;
        mesh.userData.isEnemy = isEnemy;

        const cloneAndRecordMat = (
          m: THREE.Material
        ): THREE.Material => {
          const clonedMat = m.clone();
          if ('wireframe' in clonedMat) {
            (clonedMat as THREE.MeshStandardMaterial).wireframe = wireframe;
          }
          if ((clonedMat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const std = clonedMat as THREE.MeshStandardMaterial;
            materials.push({
              material: std,
              originalColorHex: std.color.getHex(),
              originalEmissiveHex: std.emissive.getHex(),
              originalEmissiveIntensity: std.emissiveIntensity,
            });
          }
          return clonedMat;
        };

        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(cloneAndRecordMat);
        } else if (mesh.material) {
          mesh.material = cloneAndRecordMat(mesh.material);
        }
      }
    });

    // 4. Size & ground bottom-center pivot at y = 0 inside a pivot group:
    //    characters and built-in models are normalized to a fixed height,
    //    static custom models keep their real glTF size times their scale
    const targetHeight =
      entity.blueprintId === 'supply-crate' ? 1.5 : 2.55;
    if (isStatic && entity.blueprintId === 'custom-glb') {
      this.groundModelAtScale(clonedModel, entity.scale || 1);
    } else {
      this.normalizeAndGroundModel(
        clonedModel,
        targetHeight * (entity.scale || 1)
      );
    }

    const modelGroup = new THREE.Group();
    modelGroup.name = `ModelPivot_${entity.id}`;
    modelGroup.userData.entityId = entity.id;
    modelGroup.userData.isEnemy = isEnemy;
    modelGroup.add(clonedModel);

    // 5. Wrap in an entity root group positioned on the 3D floor
    const rootGroup = new THREE.Group();
    rootGroup.name = `Entity_${entity.id}`;
    rootGroup.position.set(worldPos.x, 0, worldPos.z);
    rootGroup.rotation.y = entity.yaw || 0;
    rootGroup.userData.entityId = entity.id;
    rootGroup.userData.isEnemy = isEnemy;

    // Tactical Floor Ring under the entity (changes color by AI state)
    const baseRingGeo = new THREE.RingGeometry(0.82, 0.98, 24);
    const ringColor = !isEnemy
      ? 0x38bdf8
      : entity.blueprintId === 'turret-guardian'
      ? 0xa855f7
      : 0xf43f5e;
    const baseRingMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      side: THREE.DoubleSide,
    });
    const baseRing = new THREE.Mesh(baseRingGeo, baseRingMat);
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.025;
    baseRing.visible = !isStatic;
    rootGroup.add(baseRing);

    rootGroup.add(modelGroup);

    // 6. Floating 3D Health Bar above Enemy entities
    let healthBarGroup: THREE.Group | null = null;
    let healthBarFill: THREE.Mesh | null = null;
    if (isEnemy) {
      healthBarGroup = new THREE.Group();
      healthBarGroup.name = 'EnemyHealthBar';
      healthBarGroup.position.set(0, targetHeight + 0.42, 0);

      const bgBar = new THREE.Mesh(
        new THREE.PlaneGeometry(1.36, 0.16),
        new THREE.MeshBasicMaterial({
          color: 0x090c12,
          side: THREE.DoubleSide,
        })
      );
      healthBarGroup.add(bgBar);

      healthBarFill = new THREE.Mesh(
        new THREE.PlaneGeometry(1.28, 0.1),
        new THREE.MeshBasicMaterial({
          color: 0xf43f5e,
          side: THREE.DoubleSide,
        })
      );
      healthBarFill.position.z = 0.01;
      healthBarGroup.add(healthBarFill);

      rootGroup.add(healthBarGroup);
    }

    // 7. Initialize THREE.AnimationMixer if the .glb contains animation clips
    let mixer: THREE.AnimationMixer | null = null;
    if (cached.animations && cached.animations.length > 0) {
      mixer = new THREE.AnimationMixer(clonedModel);
      const preferredClip =
        THREE.AnimationClip.findByName(cached.animations, 'Idle') ||
        THREE.AnimationClip.findByName(cached.animations, 'Walk') ||
        cached.animations[0];

      const action = mixer.clipAction(preferredClip);
      action.play();
    }

    return {
      entityId: entity.id,
      placedEntity: entity,
      isEnemy,
      maxHealth,
      moveSpeed,
      attackDamage,
      rootGroup,
      modelGroup,
      baseRing,
      healthBarGroup,
      healthBarFill,
      mixer,
      materials,
    };
  }

  /**
   * Loads an external/uploaded `.glb` URL via `GLTFLoader`, OR generates a
   * real binary `.glb` in-memory via `GLTFExporter` and parses it with
   * `GLTFLoader` so the pipeline is 100% authentic and zero-404 safe.
   */
  private static async fetchOrGenerateGltfAsset(
    blueprintId: EntityArchetypeId,
    customGlbUrl?: string
  ): Promise<CachedGltfAsset> {
    const loader = this.getLoader();

    // Case A: User supplied a custom .glb URL or local File ObjectURL
    if (customGlbUrl && customGlbUrl.trim().length > 0) {
      const gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(customGlbUrl, resolve, undefined, reject);
      });
      return {
        scene: gltf.scene,
        animations: gltf.animations ?? [],
      };
    }

    // Case B: Build articulated procedural model, export to binary .glb buffer
    // via GLTFExporter, and parse via GLTFLoader.parse()!
    const { root, animations } =
      this.buildProceduralArchetypeSource(blueprintId);

    const exporter = new GLTFExporter();
    const glbBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      exporter.parse(
        root,
        (result) => {
          if (result instanceof ArrayBuffer) {
            resolve(result);
          } else {
            reject(
              new Error('Expected binary .glb ArrayBuffer from GLTFExporter')
            );
          }
        },
        (err) => reject(err),
        { binary: true, animations }
      );
    });

    const parsedGltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(glbBuffer, '', resolve, reject);
    });

    return {
      scene: parsedGltf.scene,
      animations:
        parsedGltf.animations.length > 0 ? parsedGltf.animations : animations,
    };
  }

  /**
   * Measures a `.glb` model's native size in meters (unscaled), or returns
   * `null` when it cannot be loaded. Reuses the shared asset cache.
   */
  public static async measureModelSize(
    glbUrl: string
  ): Promise<{ width: number; depth: number; height: number } | null> {
    const cacheKey = `url:${glbUrl}`;
    if (!this.assetCache.has(cacheKey)) {
      this.assetCache.set(
        cacheKey,
        this.fetchOrGenerateGltfAsset('custom-glb', glbUrl)
      );
    }
    try {
      const cached = await this.assetCache.get(cacheKey)!;
      cached.scene.updateMatrixWorld(true);
      const size = new THREE.Box3()
        .setFromObject(cached.scene)
        .getSize(new THREE.Vector3());
      if (![size.x, size.y, size.z].every(Number.isFinite)) return null;
      return { width: size.x, depth: size.z, height: size.y };
    } catch {
      return null;
    }
  }

  /**
   * Scales a model uniformly by `scale` (keeping its real size), centers it on
   * X/Z, and shifts its bottom bounding plane to sit flush at `y = 0`.
   */
  private static groundModelAtScale(model: THREE.Object3D, scale: number): void {
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
  }

  /**
   * Centers a loaded `.glb` model on X/Z, scales it uniformly to `targetHeight`,
   * and shifts its bottom bounding plane to sit flush at `y = 0`.
   */
  private static normalizeAndGroundModel(
    model: THREE.Object3D,
    targetHeight: number
  ): void {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    if (size.y > 0.0001) {
      const scaleFactor = targetHeight / size.y;
      model.scale.multiplyScalar(scaleFactor);
      model.updateMatrixWorld(true);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
      model.position.x -= scaledCenter.x;
      model.position.z -= scaledCenter.z;
      model.position.y -= scaledBox.min.y;
    } else {
      model.position.sub(center);
    }
  }

  /**
   * Constructs multi-part 3D source geometry + keyframe `AnimationClip`s for
   * the built-in archetypes before exporting them into binary `.glb` format.
   */
  private static buildProceduralArchetypeSource(
    blueprintId: EntityArchetypeId
  ): { root: THREE.Group; animations: THREE.AnimationClip[] } {
    const root = new THREE.Group();
    root.name = `Archetype_${blueprintId}`;

    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.75,
    });
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.45,
      metalness: 0.55,
    });

    if (blueprintId === 'supply-crate') {
      const crateGroup = new THREE.Group();
      crateGroup.name = 'CrateBody';

      const coreBox = new THREE.Mesh(
        new THREE.BoxGeometry(1.3, 1.1, 1.3),
        new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.6,
          metalness: 0.3,
        })
      );
      coreBox.position.y = 0.55;
      crateGroup.add(coreBox);

      const bumperGeo = new THREE.BoxGeometry(0.18, 1.16, 0.18);
      const bumperMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        roughness: 0.4,
        metalness: 0.6,
      });
      const offsets = [
        [-0.6, -0.6],
        [0.6, -0.6],
        [-0.6, 0.6],
        [0.6, 0.6],
      ];
      offsets.forEach(([ox, oz]) => {
        const strut = new THREE.Mesh(bumperGeo, bumperMat);
        strut.position.set(ox, 0.58, oz);
        crateGroup.add(strut);
      });

      const lidBeacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, 0.14, 16),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.8,
          roughness: 0.2,
          metalness: 0.5,
        })
      );
      lidBeacon.position.y = 1.16;
      crateGroup.add(lidBeacon);

      root.add(crateGroup);
      return { root, animations: [] };
    }

    if (blueprintId === 'turret-guardian') {
      const baseTripod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.85, 0.9, 8),
        darkSteelMat
      );
      baseTripod.position.y = 0.45;
      root.add(baseTripod);

      const waistColumn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.32, 0.7, 12),
        armorMat
      );
      waistColumn.position.y = 1.15;
      root.add(waistColumn);

      const turretHead = new THREE.Group();
      turretHead.name = 'TurretHead';
      turretHead.position.y = 1.65;

      const podHousing = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.65, 1.05),
        armorMat
      );
      turretHead.add(podHousing);

      const eyeMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 16, 16),
        new THREE.MeshStandardMaterial({
          color: 0xc084fc,
          emissive: 0x9333ea,
          emissiveIntensity: 0.9,
          roughness: 0.15,
        })
      );
      eyeMesh.position.set(0, 0.05, 0.52);
      turretHead.add(eyeMesh);

      const barrelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.95, 12);
      barrelGeo.rotateX(Math.PI / 2);
      const leftBarrel = new THREE.Mesh(barrelGeo, darkSteelMat);
      leftBarrel.position.set(-0.34, 0, 0.65);
      const rightBarrel = new THREE.Mesh(barrelGeo, darkSteelMat);
      rightBarrel.position.set(0.34, 0, 0.65);
      turretHead.add(leftBarrel, rightBarrel);

      root.add(turretHead);

      const q0 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, -0.65, 0)
      );
      const q1 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0.65, 0)
      );
      const rotTrack = new THREE.QuaternionKeyframeTrack(
        'TurretHead.quaternion',
        [0, 1.5, 3.0],
        [
          q0.x,
          q0.y,
          q0.z,
          q0.w,
          q1.x,
          q1.y,
          q1.z,
          q1.w,
          q0.x,
          q0.y,
          q0.z,
          q0.w,
        ]
      );
      const clip = new THREE.AnimationClip('Idle', 3.0, [rotTrack]);
      return { root, animations: [clip] };
    }

    // ARCHETYPE 1 (DEFAULT): CYBER SENTINEL BOT (9-Part Articulated Enemy Avatar)
    const legGeo = new THREE.BoxGeometry(0.28, 0.95, 0.32);
    const leftLeg = new THREE.Mesh(legGeo, darkSteelMat);
    leftLeg.position.set(-0.26, 0.475, 0);
    const rightLeg = new THREE.Mesh(legGeo, darkSteelMat);
    rightLeg.position.set(0.26, 0.475, 0);
    root.add(leftLeg, rightLeg);

    const upperBody = new THREE.Group();
    upperBody.name = 'SentinelTorso';
    upperBody.position.set(0, 1.45, 0);

    const chestMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.95, 0.56),
      armorMat
    );
    upperBody.add(chestMesh);

    const reactorCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.24, 0.6),
      new THREE.MeshStandardMaterial({
        color: 0xf43f5e,
        emissive: 0xe11d48,
        emissiveIntensity: 0.85,
        roughness: 0.2,
      })
    );
    reactorCore.position.set(0, 0.12, 0);
    upperBody.add(reactorCore);

    const headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.48, 0.52),
      darkSteelMat
    );
    headMesh.position.set(0, 0.78, 0);
    upperBody.add(headMesh);

    const visorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.56),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.95,
      })
    );
    visorMesh.position.set(0, 0.8, 0.02);
    upperBody.add(visorMesh);

    const armGeo = new THREE.BoxGeometry(0.24, 0.82, 0.28);
    const leftArm = new THREE.Mesh(armGeo, darkSteelMat);
    leftArm.position.set(-0.64, -0.05, 0.1);
    const rightArm = new THREE.Mesh(armGeo, darkSteelMat);
    rightArm.position.set(0.64, -0.05, 0.15);
    upperBody.add(leftArm, rightArm);

    root.add(upperBody);

    const posTrack = new THREE.VectorKeyframeTrack(
      'SentinelTorso.position',
      [0, 1.2, 2.4],
      [0, 1.45, 0, 0, 1.58, 0, 0, 1.45, 0]
    );
    const qA = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, -0.25, 0)
    );
    const qB = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.25, 0));
    const rotTrack = new THREE.QuaternionKeyframeTrack(
      'SentinelTorso.quaternion',
      [0, 1.2, 2.4],
      [
        qA.x,
        qA.y,
        qA.z,
        qA.w,
        qB.x,
        qB.y,
        qB.z,
        qB.w,
        qA.x,
        qA.y,
        qA.z,
        qA.w,
      ]
    );

    const idleClip = new THREE.AnimationClip('Idle', 2.4, [posTrack, rotTrack]);
    return { root, animations: [idleClip] };
  }
}
