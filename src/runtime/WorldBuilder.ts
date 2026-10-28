/**
 * ============================================================================
 * FORGECORE WORLD BUILDER & PER-CELL TEXTURE / ENTITY EXTRUDER (PHASE 2 & 3)
 * ============================================================================
 * Parses the level's square 2D Grid Array (up to 128x128) along with:
 *  - `wallTextures[row][col]`    : Per-cell Wall Texture Asset IDs
 *  - `floorTextures[row][col]`   : Per-cell Floor Tile Texture Asset IDs
 *  - `ceilingTextures[row][col]` : Per-cell Ceiling Tile Texture Asset IDs
 *  - `entities[]`                : Placed 3D `.glb` Enemy AI & Object coordinates
 *
 * Floors, ceilings, and static walls are batched into chunked `InstancedMesh`es
 * (one per chunk and material) so large maps stay at a few hundred draw calls.
 * A wall cell only becomes a standalone mesh when a pushwall needs to move it.
 *
 * Phase 3 Enhancements:
 *  - Collects `wallMeshes` for accurate Line-of-Sight and Weapon `Raycaster`
 *    occlusion checks.
 *  - Instantiates `EnemyAISystem` and registers all spawned `.glb` entities
 *    for FSM updates (`Idle` / `Chase` / `Attack` / `Dead`) and loot drops.
 */

import * as THREE from 'three';
import {
  CellType,
  ENGINE_CONFIG,
  PlacedEntity,
  TextureAsset,
  VerticalLevelData,
} from './types';
import { CollisionSystem } from './CollisionSystem';
import { TextureGenerator } from './TextureGenerator';
import { EntityLoader } from './EntityLoader';
import { EnemyAISystem } from './EnemyAISystem';
import { isStaticModel } from './categories';
import { getFootprintRect } from './sim/footprint';
import { radiansToBam } from './sim/trigTable';
import { layerCellKey } from './sim/raycast';
import { SurfaceBatch, buildLayeredSurfaces } from './LayeredSurfaces';
import { applyVerticalPlacement, entityAnchorWorld, tileFloorMeters } from './entityPlacement';

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

export interface WorldBuildResult {
  worldGroup: THREE.Group;
  wallMeshes: THREE.Object3D[];
  /** Returns a movable standalone wall block for a pushwall cell, detaching it from its batch. */
  getWallBlockGroup: (cellKey: string) => THREE.Group | undefined;
  doorMeshes: Map<string, THREE.Group>;
  keyMeshes: Map<string, THREE.Group>;
  floorLayer: InstancedCellLayer;
  ceilingLayer: InstancedCellLayer | null;
  enemyAI: EnemyAISystem;
  wallCount: number;
  /** Root groups of solid static models (also appended to `wallMeshes` as they load) */
  staticSolidMeshes: THREE.Object3D[];
  /**
   * Vertical levels only: redraws floors, ceilings and wall faces for new ground-layer
   * heights (lifts and moving floors change them during play). Call it every frame with
   * the in-between heights; only the moving tiles and their neighbours are redrawn.
   */
  updateLayeredHeights?: (floorHeights: number[][], ceilingHeights: number[][]) => void;
}

export class WorldBuilder {
  /**
   * Builds the complete 3D maze geometry with per-cell wall, floor, and ceiling
   * textures and spawns all placed `.glb` entities into the `EnemyAISystem`.
   */
  public static buildWorldFromGrid(
    grid: number[][],
    wallTextures: string[][],
    floorTextures: string[][],
    ceilingTextures: string[][],
    customTextures: TextureAsset[],
    entities: PlacedEntity[],
    doorTexture: THREE.Texture,
    maxAnisotropy: number,
    options: {
      showCeiling: boolean;
      showWireframe: boolean;
      spawn: { row: number; col: number; yaw: number };
      collectedKeys: Set<string>;
      openDoors: Set<string>;
      onAsyncAssetReady?: () => void;
      /** Stacked layers, heights, slopes and holes; absent for flat levels */
      vertical?: VerticalLevelData;
      /** Build only the level geometry; the caller places the models itself */
      skipEntities?: boolean;
    }
  ): WorldBuildResult {
    const worldGroup = new THREE.Group();
    worldGroup.name = 'ForgeCore_ExtrudedWorld_Phase3';

    const gridSize = grid.length;
    const wallMeshes: THREE.Object3D[] = [];
    const doorMeshes = new Map<string, THREE.Group>();
    const keyMeshes = new Map<string, THREE.Group>();

    const lootContainer = new THREE.Group();
    lootContainer.name = 'ForgeCore_AmmoLootContainer';
    worldGroup.add(lootContainer);

    const enemyAI = new EnemyAISystem(lootContainer);

    const cellSize = ENGINE_CONFIG.CELL_SIZE;
    const wallHeight = ENGINE_CONFIG.WALL_HEIGHT;

    const tileGeo = new THREE.PlaneGeometry(cellSize, cellSize);
    const mainWallGeo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
    const plinthGeo = new THREE.BoxGeometry(
      cellSize + 0.06,
      0.24,
      cellSize + 0.06
    );

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.65,
      wireframe: options.showWireframe,
    });

    const wallMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const floorMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const ceilingMatCache = new Map<string, THREE.MeshStandardMaterial>();

    const getWallMaterial = (texId: string): THREE.MeshStandardMaterial => {
      const id = texId || 'default-grid';
      if (!wallMatCache.has(id)) {
        const tex = TextureGenerator.resolveTextureById(
          id,
          customTextures,
          maxAnisotropy,
          options.onAsyncAssetReady
        );
        wallMatCache.set(
          id,
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.52,
            metalness: 0.18,
            wireframe: options.showWireframe,
            ...alphaMaterialOptions(id),
          })
        );
      }
      return wallMatCache.get(id)!;
    };

    const getFloorMaterial = (texId: string): THREE.MeshStandardMaterial => {
      const id = texId || 'floor-obsidian';
      if (!floorMatCache.has(id)) {
        const tex = TextureGenerator.resolveTextureById(
          id,
          customTextures,
          maxAnisotropy,
          options.onAsyncAssetReady
        );
        floorMatCache.set(
          id,
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.78,
            metalness: 0.14,
            wireframe: options.showWireframe,
            ...alphaMaterialOptions(id),
          })
        );
      }
      return floorMatCache.get(id)!;
    };

    const getCeilingMaterial = (texId: string): THREE.MeshStandardMaterial => {
      const id = texId || 'ceiling-coffer';
      if (!ceilingMatCache.has(id)) {
        const tex = TextureGenerator.resolveTextureById(
          id,
          customTextures,
          maxAnisotropy,
          options.onAsyncAssetReady
        );
        ceilingMatCache.set(
          id,
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.84,
            metalness: 0.15,
            wireframe: options.showWireframe,
            ...alphaMaterialOptions(id),
          })
        );
      }
      return ceilingMatCache.get(id)!;
    };

    // See-through textures cut out their transparent pixels and show both sides
    const alphaMaterialOptions = (texId: string): THREE.MeshStandardMaterialParameters =>
      TextureGenerator.isAlphaTexture(texId, customTextures)
        ? { alphaTest: 0.5, side: THREE.DoubleSide }
        : {};

    let wallCount = 0;
    const vertical = options.vertical;

    const floorLayer = new InstancedCellLayer(tileGeo, -Math.PI / 2, 0, [0], {
      cast: false,
      receive: true,
    });
    const ceilingLayer = options.showCeiling
      ? new InstancedCellLayer(tileGeo, Math.PI / 2, wallHeight, [0], {
          cast: false,
          receive: false,
        })
      : null;
    const wallCubeLayer = new InstancedCellLayer(
      mainWallGeo,
      0,
      0,
      [wallHeight / 2],
      { cast: true, receive: true }
    );
    const wallTrimLayer = new InstancedCellLayer(
      plinthGeo,
      0,
      0,
      [0.12, wallHeight - 0.12],
      { cast: false, receive: false }
    );
    const wallTexByCell = new Map<string, string>();

    // Doors and keycards of any layer; `cellKey` is "row,col" on the ground, "L<layer>:row,col" above
    const addDoor = (row: number, col: number, layer: number, cellKey: string) => {
      const { x, z } = CollisionSystem.gridToWorld(row, col, gridSize);
      // D. Interactive Bulkhead Door
      const doorGroup = new THREE.Group();
      doorGroup.position.set(x, tileFloorMeters(vertical, layer, row, col), z);
      const isOpen = options.openDoors.has(cellKey);

      const doorLeafGeo = new THREE.BoxGeometry(
        cellSize * 0.92,
        wallHeight * 0.96,
        cellSize * 0.35
      );
      const doorLeafMat = new THREE.MeshStandardMaterial({
        map: doorTexture,
        roughness: 0.4,
        metalness: 0.5,
        wireframe: options.showWireframe,
      });
      const doorLeaf = new THREE.Mesh(doorLeafGeo, doorLeafMat);
      doorLeaf.name = 'doorLeaf';
      doorLeaf.position.y = isOpen
        ? wallHeight * 1.38
        : (wallHeight * 0.96) / 2;
      doorGroup.add(doorLeaf);

      const thresholdGeo = new THREE.BoxGeometry(cellSize, 0.06, 0.6);
      const thresholdMesh = new THREE.Mesh(thresholdGeo, trimMat);
      thresholdMesh.position.y = 0.03;
      doorGroup.add(thresholdMesh);

      worldGroup.add(doorGroup);
      doorMeshes.set(cellKey, doorGroup);
    };
    const addKey = (row: number, col: number, layer: number, cellKey: string) => {
      if (options.collectedKeys.has(cellKey)) return;
      const { x, z } = CollisionSystem.gridToWorld(row, col, gridSize);
      // E. Collectible Security Keycard
      const keyGroup = new THREE.Group();
      keyGroup.position.set(x, tileFloorMeters(vertical, layer, row, col), z);

      const pedGeo = new THREE.CylinderGeometry(0.45, 0.58, 0.24, 16);
      const pedMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.3,
        metalness: 0.7,
      });
      const pedMesh = new THREE.Mesh(pedGeo, pedMat);
      pedMesh.position.y = 0.12;
      keyGroup.add(pedMesh);

      const cardHolder = new THREE.Group();
      cardHolder.name = 'floatingKeycard';
      cardHolder.position.y = 1.25;

      const cardBodyGeo = new THREE.BoxGeometry(0.75, 0.48, 0.08);
      const cardBodyMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xd97706,
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.8,
      });
      const cardBody = new THREE.Mesh(cardBodyGeo, cardBodyMat);
      cardHolder.add(cardBody);

      const stripeGeo = new THREE.BoxGeometry(0.77, 0.12, 0.09);
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.5,
      });
      const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
      stripeMesh.position.y = 0.1;
      cardHolder.add(stripeMesh);

      keyGroup.add(cardHolder);
      worldGroup.add(keyGroup);
      keyMeshes.set(cellKey, keyGroup);
    };

    // ------------------------------------------------------------------------
    // 1. PARSE GRID FOR PER-CELL FLOORS, CEILINGS, WALLS, DOORS & KEYS
    // ------------------------------------------------------------------------
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const cellType = grid[row]?.[col] ?? CellType.EMPTY;
        const { x, z } = CollisionSystem.gridToWorld(row, col, gridSize);
        const cellKey = `${row},${col}`;

        // A. Per-Cell Floor Tile (vertical levels draw floors and ceilings as layered surfaces)
        const floorTexId = floorTextures[row]?.[col] || 'floor-obsidian';
        if (!vertical) floorLayer.add(row, col, x, z, getFloorMaterial(floorTexId));

        // B. Optional Per-Cell Ceiling Tile
        if (ceilingLayer && !vertical) {
          const ceilingTexId =
            ceilingTextures[row]?.[col] || 'ceiling-coffer';
          ceilingLayer.add(row, col, x, z, getCeilingMaterial(ceilingTexId));
        }

        // C. Extruded Solid Wall Block (batched; detached on demand for pushwalls)
        if (cellType === CellType.WALL) {
          wallCount++;
          const wallTexId = wallTextures[row]?.[col] || 'default-grid';
          wallTexByCell.set(cellKey, wallTexId);
          wallCubeLayer.add(row, col, x, z, getWallMaterial(wallTexId));
          wallTrimLayer.add(row, col, x, z, trimMat);
          continue;
        }

        if (cellType === CellType.DOOR) addDoor(row, col, 0, cellKey);
        else if (cellType === CellType.KEY) addKey(row, col, 0, cellKey);
      }
    }

    // Doors and keycards on stacked layers
    vertical?.layers.forEach((layerData, i) => {
      const layer = i + 1;
      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const cellType = layerData.grid[row]?.[col];
          const cellKey = layerCellKey(row, col, layer);
          if (cellType === CellType.DOOR) addDoor(row, col, layer, cellKey);
          else if (cellType === CellType.KEY) addKey(row, col, layer, cellKey);
        }
      }
    });

    floorLayer.build(worldGroup, wallHeight);
    ceilingLayer?.build(worldGroup, wallHeight);
    wallCubeLayer.build(worldGroup, 0);
    wallTrimLayer.build(worldGroup, 0);
    wallMeshes.push(...wallCubeLayer.meshes);

    // Layered floors, ceilings and wall faces of a vertical level
    let updateLayeredHeights: WorldBuildResult['updateLayeredHeights'];
    if (vertical) {
      const layeredGroup = new THREE.Group();
      layeredGroup.name = 'ForgeCore_LayeredSurfaces';
      worldGroup.add(layeredGroup);
      const materialFor = (batch: SurfaceBatch) =>
        batch.kind === 'wall'
          ? getWallMaterial(batch.textureId)
          : batch.kind === 'floor'
          ? getFloorMaterial(batch.textureId)
          : getCeilingMaterial(batch.textureId);
      /** Replaces a set of surface meshes with freshly built ones */
      const rebuild = (
        old: THREE.Mesh[],
        floorHeights: number[][],
        ceilingHeights: number[][],
        includeTile: (row: number, col: number) => boolean
      ): THREE.Mesh[] => {
        for (const mesh of old) {
          layeredGroup.remove(mesh);
          mesh.geometry.dispose();
          const idx = wallMeshes.indexOf(mesh);
          if (idx >= 0) wallMeshes.splice(idx, 1);
        }
        const meshes = buildLayeredSurfaces({
          grid,
          wallTextures,
          floorTextures,
          ceilingTextures,
          vertical,
          floorHeights,
          ceilingHeights,
          showCeiling: options.showCeiling,
          includeTile,
        }).map((batch) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
          geo.computeBoundingSphere();
          const mesh = new THREE.Mesh(geo, materialFor(batch));
          mesh.name = `Layered_${batch.kind}_${batch.textureId}`;
          mesh.receiveShadow = true;
          mesh.castShadow = batch.kind === 'wall';
          layeredGroup.add(mesh);
          return mesh;
        });
        // Floors and ceilings stop shots and sight lines between layers, like walls
        wallMeshes.push(...meshes);
        return meshes;
      };

      // Tiles whose heights have moved, plus their neighbours (whose edge walls change
      // with them), are drawn apart from the rest so a lift can be redrawn every frame
      const builtFloors = vertical.floorHeights;
      const builtCeilings = vertical.ceilingHeights;
      const moving = new Set<string>();
      const dynamic = new Set<string>();
      const isDynamic = (r: number, c: number) => dynamic.has(`${r},${c}`);
      let staticMeshes = rebuild([], builtFloors, builtCeilings, () => true);
      let dynamicMeshes: THREE.Mesh[] = [];
      let dynamicKey = '';
      updateLayeredHeights = (floorHeights, ceilingHeights) => {
        let grew = false;
        for (let r = 0; r < gridSize; r++) {
          for (let c = 0; c < gridSize; c++) {
            if (
              (floorHeights[r]?.[c] ?? 0) === (builtFloors[r]?.[c] ?? 0) &&
              (ceilingHeights[r]?.[c] ?? 0) === (builtCeilings[r]?.[c] ?? 0)
            ) {
              continue;
            }
            const key = `${r},${c}`;
            if (moving.has(key)) continue;
            moving.add(key);
            for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
              dynamic.add(`${r + dr},${c + dc}`);
            }
            grew = true;
          }
        }
        if (grew) {
          staticMeshes = rebuild(staticMeshes, builtFloors, builtCeilings, (r, c) => !isDynamic(r, c));
        }
        if (moving.size === 0) return;
        let key = '';
        for (const tile of moving) {
          const [r, c] = tile.split(',').map(Number);
          key += `${floorHeights[r][c]}/${ceilingHeights[r][c]};`;
        }
        if (!grew && key === dynamicKey) return;
        dynamicKey = key;
        dynamicMeshes = rebuild(dynamicMeshes, floorHeights, ceilingHeights, isDynamic);
      };
    }

    const detachedWallBlocks = new Map<string, THREE.Group>();
    const getWallBlockGroup = (cellKey: string): THREE.Group | undefined => {
      const existing = detachedWallBlocks.get(cellKey);
      if (existing) return existing;
      const wallTexId = wallTexByCell.get(cellKey);
      if (wallTexId === undefined) return undefined;

      wallCubeLayer.hideCell(cellKey);
      wallTrimLayer.hideCell(cellKey);

      const [row, col] = cellKey.split(',').map(Number);
      const { x, z } = CollisionSystem.gridToWorld(row, col, gridSize);
      const wallBlockGroup = new THREE.Group();
      wallBlockGroup.position.set(x, 0, z);

      const cubeMesh = new THREE.Mesh(mainWallGeo, getWallMaterial(wallTexId));
      cubeMesh.position.y = wallHeight / 2;
      cubeMesh.castShadow = true;
      cubeMesh.receiveShadow = true;
      wallBlockGroup.add(cubeMesh);
      wallMeshes.push(cubeMesh);

      const basePlinth = new THREE.Mesh(plinthGeo, trimMat);
      basePlinth.position.y = 0.12;
      wallBlockGroup.add(basePlinth);

      const topCornice = new THREE.Mesh(plinthGeo, trimMat);
      topCornice.position.y = wallHeight - 0.12;
      wallBlockGroup.add(topCornice);

      worldGroup.add(wallBlockGroup);
      detachedWallBlocks.set(cellKey, wallBlockGroup);
      return wallBlockGroup;
    };

    // ------------------------------------------------------------------------
    // 2. SPAWN 3D .GLB ENTITIES & REGISTER WITH ENEMY AI SYSTEM
    // ------------------------------------------------------------------------
    const entitiesContainer = new THREE.Group();
    entitiesContainer.name = 'ForgeCore_EntitiesContainer';
    worldGroup.add(entitiesContainer);

    const staticSolidMeshes: THREE.Object3D[] = [];

    // Free loaded models this world no longer places (the 3D editor loads models itself)
    if (!options.skipEntities) EntityLoader.releaseModelsNotUsedBy(entities);

    (options.skipEntities ? [] : entities).forEach((entity) => {
      const isStatic = isStaticModel(entity);
      if (!isStatic && grid[entity.row]?.[entity.col] === CellType.WALL) return;

      // Static models sit centered on their whole footprint rectangle
      const worldPos = entityAnchorWorld(entity, gridSize);
      EntityLoader.loadEntityInstance(
        entity,
        worldPos,
        options.showWireframe
      ).then((spawned) => {
        if (vertical) applyVerticalPlacement(spawned.rootGroup, entity, worldPos, vertical);
        entitiesContainer.add(spawned.rootGroup);
        if (!isStatic) {
          enemyAI.registerEntity(spawned);
        } else if (entity.collision === 'solid') {
          // Solid static models block shots and enemy line of sight via their 12-triangle bounding-box hitbox
          staticSolidMeshes.push(spawned.hitboxMesh);
          wallMeshes.push(spawned.hitboxMesh);
        }
      });
    });

    // ------------------------------------------------------------------------
    // 3. PLAYER SPAWN PAD MARKER ON FLOOR
    // ------------------------------------------------------------------------
    const spawnPos = CollisionSystem.gridToWorld(
      options.spawn.row,
      options.spawn.col,
      gridSize
    );
    const spawnPadGroup = new THREE.Group();
    spawnPadGroup.position.set(
      spawnPos.x,
      tileFloorMeters(vertical, vertical?.spawnLayer ?? 0, options.spawn.row, options.spawn.col) + 0.025,
      spawnPos.z
    );

    const ringGeo = new THREE.RingGeometry(0.7, 0.95, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      side: THREE.DoubleSide,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    spawnPadGroup.add(ringMesh);

    worldGroup.add(spawnPadGroup);

    return {
      worldGroup,
      wallMeshes,
      getWallBlockGroup,
      doorMeshes,
      keyMeshes,
      floorLayer,
      ceilingLayer,
      enemyAI,
      wallCount,
      staticSolidMeshes,
      ...(updateLayeredHeights ? { updateLayeredHeights } : {}),
    };
  }

  /**
   * Safely disposes geometries and materials inside an old world group
   * before replacing it, without disposing shared geometries owned by `EntityLoader.assetCache`.
   */
  public static disposeWorldGroup(group: THREE.Group | null): void {
    if (!group) return;
    group.traverse((obj) => {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        (obj as THREE.InstancedMesh).dispose();
      }
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (!mesh.userData?.isCachedGltfClone) {
          mesh.geometry?.dispose();
        }
        if (mesh.userData?.isHitbox) return;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
  }
}
