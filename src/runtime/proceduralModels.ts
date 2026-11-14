/** The built-in archetype models (sentinel bot, turret, crate) built from primitives with idle animations
 * (moved out of EntityLoader.ts in P1.4). */
import * as THREE from 'three';
import {
  EntityArchetypeId,
} from './types';

/**
 * Constructs multi-part 3D source geometry + keyframe `AnimationClip`s for
 * the built-in archetypes before exporting them into binary `.glb` format.
 */
export function buildProceduralArchetypeSource(
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
