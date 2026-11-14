/**
 * Batched cell surfaces for the world mesh (moved out of WorldBuilder.ts in P1.4): floors, ceilings,
 * wall cubes and trim drawn as chunked InstancedMeshes, with per-cell height changes and hiding.
 */
import * as THREE from 'three';

/** Cells per side of one batched chunk; chunks keep frustum culling and raycasts local */
const CHUNK_CELLS = 16;

interface InstanceSlot {
  mesh: THREE.InstancedMesh;
  index: number;
  x: number;
  z: number;
  yOffset: number;
}

/**
 * One batched cell surface (floor tiles, ceiling tiles, wall cubes, or wall trim).
 * Each cell sits at height `baseY` and contributes one instance per entry in `yOffsets`.
 */
export class InstancedCellLayer {
  public readonly meshes: THREE.InstancedMesh[] = [];
  private readonly slots = new Map<string, InstanceSlot[]>();
  private readonly pending = new Map<
    string,
    { material: THREE.Material; cells: { cellKey: string; x: number; z: number }[] }
  >();
  private readonly rotation: THREE.Quaternion;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private static readonly UNIT_SCALE = new THREE.Vector3(1, 1, 1);
  private static readonly ZERO_SCALE = new THREE.Vector3(0, 0, 0);

  constructor(
    private readonly geometry: THREE.BufferGeometry,
    rotationX: number,
    private readonly baseY: number,
    private readonly yOffsets: number[],
    private readonly shadows: { cast: boolean; receive: boolean }
  ) {
    this.rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(rotationX, 0, 0)
    );
  }

  public add(
    row: number,
    col: number,
    x: number,
    z: number,
    material: THREE.Material
  ): void {
    const chunkKey = `${Math.floor(row / CHUNK_CELLS)},${Math.floor(
      col / CHUNK_CELLS
    )}|${material.uuid}`;
    let group = this.pending.get(chunkKey);
    if (!group) {
      group = { material, cells: [] };
      this.pending.set(chunkKey, group);
    }
    group.cells.push({ cellKey: `${row},${col}`, x, z });
  }

  /** Creates the instanced meshes for every queued cell and adds them to `parent`. */
  public build(parent: THREE.Object3D, maxCellTravel: number): void {
    this.pending.forEach(({ material, cells }) => {
      const mesh = new THREE.InstancedMesh(
        this.geometry,
        material,
        cells.length * this.yOffsets.length
      );
      mesh.castShadow = this.shadows.cast;
      mesh.receiveShadow = this.shadows.receive;
      let index = 0;
      for (const cell of cells) {
        const cellSlots: InstanceSlot[] = [];
        for (const yOffset of this.yOffsets) {
          const slot = { mesh, index, x: cell.x, z: cell.z, yOffset };
          this.writeSlot(slot, this.baseY, InstancedCellLayer.UNIT_SCALE);
          cellSlots.push(slot);
          index++;
        }
        this.slots.set(cell.cellKey, cellSlots);
      }
      mesh.instanceMatrix.needsUpdate = true;
      // Pad the bounds so cells raised or lowered later are not culled early
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += maxCellTravel;
      parent.add(mesh);
      this.meshes.push(mesh);
    });
    this.pending.clear();
  }

  /** Moves a cell's base to height `y` (world meters). */
  public setCellY(cellKey: string, y: number): void {
    const cellSlots = this.slots.get(cellKey);
    if (!cellSlots) return;
    for (const slot of cellSlots) {
      this.writeSlot(slot, y, InstancedCellLayer.UNIT_SCALE);
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Collapses a cell's instances to zero scale so they no longer render or block rays. */
  public hideCell(cellKey: string): void {
    const cellSlots = this.slots.get(cellKey);
    if (!cellSlots) return;
    for (const slot of cellSlots) {
      this.writeSlot(slot, 0, InstancedCellLayer.ZERO_SCALE);
      slot.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private writeSlot(slot: InstanceSlot, y: number, scale: THREE.Vector3): void {
    this.position.set(slot.x, y + slot.yOffset, slot.z);
    this.matrix.compose(this.position, this.rotation, scale);
    slot.mesh.setMatrixAt(slot.index, this.matrix);
  }
}
