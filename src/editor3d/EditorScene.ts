/**
 * ============================================================================
 * 3D LEVEL EDITOR SCENE (FLY CAMERA, PICKING, MOVE/ROTATE GIZMO, SURFACE DROPS)
 * ============================================================================
 * The center pane in Edit mode. It draws the level with the game's own world
 * builder, so what you build is what you play, then adds editing on top:
 *  - Fly camera: hold the right mouse button to look; W/A/S/D move, Q/E go
 *    down/up, Shift is faster, the wheel flies forward and back.
 *  - Left click picks a model (shows the gizmo) or a tile (selects it).
 *  - Move arrows and rotate rings (G / R) with optional grid snap.
 *  - Surface picking for drops: a model sticks to the floor, wall or ceiling
 *    under the mouse, turned to match it.
 *  - Walkable models: bakes the real top and bottom shape into whole numbers.
 *  - Solid models: measures their real height so they block only that much.
 *  - Layers above the one being edited can be hidden with a clipping plane.
 * No React here; `EditorViewport3D` wraps it.
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CellType,
  ENGINE_CONFIG,
  PlacedEntity,
  SkyboxThemeId,
  TextureAsset,
  VerticalLevelData,
} from '../runtime/types';
import { SIM_CONFIG, WALK_SURFACE_EMPTY, WalkSurfaceSpec } from '../runtime/sim';
import { getFootprintRect } from '../runtime/sim/footprint';
import { radiansToBam } from '../runtime/sim/trigTable';
import { WorldBuilder } from '../runtime/WorldBuilder';
import { TextureGenerator } from '../runtime/TextureGenerator';
import { EntityLoader } from '../runtime/EntityLoader';
import { CollisionSystem } from '../runtime/CollisionSystem';
import {
  LAYER_METERS,
  applyVerticalPlacement,
  entityAnchorWorld,
} from '../runtime/entityPlacement';

const UNITS_PER_METER = SIM_CONFIG.CELL_UNITS / ENGINE_CONFIG.CELL_SIZE;
const CELL = ENGINE_CONFIG.CELL_SIZE;
/** Grid snap step for moving and placing (meters) and rotating (radians) */
const SNAP_METERS = 0.25;
const SNAP_RADIANS = THREE.MathUtils.degToRad(15);
/** Most samples per side of a baked walk surface */
const WALK_SURFACE_MAX_SIDE = 48;

export interface EditorLevelInput {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  customTextures: TextureAsset[];
  entities: PlacedEntity[];
  spawn: { row: number; col: number; yaw: number };
  skyboxTheme: SkyboxThemeId;
  skyboxSeed: number;
  showCeiling: boolean;
  vertical: VerticalLevelData;
}

export type SurfaceKind = 'floor' | 'wall' | 'ceiling';

/** A point on the level's surfaces under the mouse */
export interface SurfaceHit {
  point: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  surface: SurfaceKind;
  /** The open tile in front of the surface, and its layer */
  row: number;
  col: number;
  layer: number;
}

export interface EditorSceneCallbacks {
  onSelectEntity: (entityId: string | null) => void;
  onSelectCell: (row: number, col: number, layer: number) => void;
  onCommitEntityTransform: (updated: PlacedEntity) => void;
  onDeleteEntity: (entityId: string) => void;
  onWalkSurfaceBaked: (entityId: string, surface: WalkSurfaceSpec) => void;
  onModelBoundsMeasured: (entityId: string, bounds: ModelBounds) => void;
}

/** A model's lowest and highest point relative to its origin, in whole sim units */
export interface ModelBounds {
  bottomUnits: number;
  topUnits: number;
}

interface LoadedEntity {
  key: string;
  entity: PlacedEntity;
  root: THREE.Object3D;
  /** The model itself, without its floor ring and health bar */
  model: THREE.Object3D;
}

export class EditorScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly transform: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly entitiesGroup = new THREE.Group();
  private readonly helpersGroup = new THREE.Group();
  private readonly loaded = new Map<string, LoadedEntity>();
  private readonly pending = new Set<string>();
  private worldGroup: THREE.Group | null = null;
  private worldKey = '';
  private level: EditorLevelInput | null = null;
  private skyboxTex: THREE.Texture | null = null;
  private skyKey = '';
  private layerGrid: THREE.GridHelper | null = null;
  private cellBox: THREE.LineSegments | null = null;

  private selectedId: string | null = null;
  private activeLayer = 0;
  private hideAbove = false;
  private snap = true;
  private flySpeed = 8;

  private flying = false;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = -0.5;
  private downAt: { x: number; y: number } | null = null;
  private gizmoWasActive = false;
  private frame = 0;
  private lastTime = performance.now();
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;
  private readonly removeListeners: () => void;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: EditorSceneCallbacks
  ) {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.outline = 'none';
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, width / height, 0.05, 600);
    this.camera.position.set(0, 14, 18);
    this.applyCameraRotation();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.75));
    const sun = new THREE.DirectionalLight(0xfffbeb, 1.2);
    sun.position.set(14, 28, 12);
    this.scene.add(sun);
    this.scene.add(this.entitiesGroup);
    this.scene.add(this.helpersGroup);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.9);
    this.applySnap();
    this.transform.addEventListener('dragging-changed', (event) => {
      if (!(event as unknown as { value: boolean }).value) this.commitSelectedTransform();
    });
    this.scene.add(this.transform.getHelper());

    this.removeListeners = this.attachInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.loop();
  }

  // --------------------------------------------------------------------------
  // Level content
  // --------------------------------------------------------------------------

  setLevel(level: EditorLevelInput): void {
    const first = this.level === null;
    this.level = level;
    const skyKey = `${level.skyboxTheme}|${level.skyboxSeed}`;
    if (skyKey !== this.skyKey) {
      this.skyKey = skyKey;
      this.skyboxTex?.dispose();
      const sky = TextureGenerator.createSkyboxTexture(level.skyboxTheme, level.skyboxSeed);
      this.skyboxTex = sky.texture;
      this.scene.background = sky.texture;
    }

    const worldKey = JSON.stringify([
      level.grid,
      level.wallTextures,
      level.floorTextures,
      level.ceilingTextures,
      level.customTextures.map((t) => t.id),
      level.spawn,
      level.showCeiling,
      level.vertical,
    ]);
    if (worldKey !== this.worldKey) {
      this.worldKey = worldKey;
      this.rebuildWorld();
      // Placement depends on floor heights, so models are re-placed with the world
      for (const e of this.loaded.values()) e.key = '';
    }
    this.syncEntities();
    this.applyClipping();
    this.updateLayerHelpers();
    if (first) this.frameWholeLevel();
  }

  private rebuildWorld(): void {
    const level = this.level!;
    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      WorldBuilder.disposeWorldGroup(this.worldGroup);
    }
    const built = WorldBuilder.buildWorldFromGrid(
      level.grid,
      level.wallTextures,
      level.floorTextures,
      level.ceilingTextures,
      level.customTextures,
      [],
      TextureGenerator.createDoorTexture(this.renderer.capabilities.getMaxAnisotropy()),
      this.renderer.capabilities.getMaxAnisotropy(),
      {
        showCeiling: level.showCeiling,
        showWireframe: false,
        spawn: level.spawn,
        collectedKeys: new Set(),
        openDoors: new Set(),
        vertical: level.vertical,
        skipEntities: true,
      }
    );
    this.worldGroup = built.worldGroup;
    this.scene.add(this.worldGroup);
  }

  private syncEntities(): void {
    const level = this.level!;
    const gridSize = level.grid.length;
    const wanted = new Map(level.entities.map((e) => [e.id, e]));

    for (const [id, item] of this.loaded) {
      if (!wanted.has(id)) {
        this.entitiesGroup.remove(item.root);
        this.loaded.delete(id);
        if (this.selectedId === id) this.select(null, false);
      }
    }

    for (const entity of level.entities) {
      const key = JSON.stringify(entity);
      const existing = this.loaded.get(entity.id);
      if (existing && existing.key === key) continue;
      const anchor = entityAnchorWorld(entity, gridSize);
      if (existing && existing.entity.scale === entity.scale && existing.entity.modelAssetId === entity.modelAssetId) {
        // Same model: just move it
        existing.key = key;
        existing.entity = entity;
        applyVerticalPlacement(existing.root, entity, anchor, level.vertical);
        this.refreshModelBounds(existing);
        continue;
      }
      if (this.pending.has(entity.id)) continue;
      this.pending.add(entity.id);
      EntityLoader.loadEntityInstance(entity, anchor, false)
        .then((spawned) => {
          this.pending.delete(entity.id);
          if (this.disposed) return;
          const latest = this.level?.entities.find((e) => e.id === entity.id);
          if (!latest) return;
          const old = this.loaded.get(entity.id);
          if (old) this.entitiesGroup.remove(old.root);
          spawned.rootGroup.userData.entityId = entity.id;
          spawned.baseRing.visible = false;
          if (spawned.healthBarGroup) spawned.healthBarGroup.visible = false;
          applyVerticalPlacement(
            spawned.rootGroup,
            latest,
            entityAnchorWorld(latest, this.level!.grid.length),
            this.level!.vertical
          );
          this.entitiesGroup.add(spawned.rootGroup);
          const item: LoadedEntity = {
            key: JSON.stringify(latest),
            entity: latest,
            root: spawned.rootGroup,
            model: spawned.modelGroup,
          };
          this.loaded.set(entity.id, item);
          this.refreshModelBounds(item);
          if (this.selectedId === entity.id) this.transform.attach(spawned.rootGroup);
          // A walkable model whose shape is not baked yet gets baked once it has loaded
          if (latest.walkable && !latest.walkSurface) {
            const surface = this.bakeWalkSurface(entity.id);
            if (surface) this.callbacks.onWalkSurfaceBaked(entity.id, surface);
          }
          // The level may have changed again while this model loaded
          this.syncEntities();
        })
        .catch(() => this.pending.delete(entity.id));
    }
  }

  // --------------------------------------------------------------------------
  // Selection, gizmo, layers, snap
  // --------------------------------------------------------------------------

  select(entityId: string | null, notify = true): void {
    this.selectedId = entityId;
    const item = entityId ? this.loaded.get(entityId) : undefined;
    if (item) this.transform.attach(item.root);
    else this.transform.detach();
    if (notify) this.callbacks.onSelectEntity(entityId);
  }

  setGizmoMode(mode: 'translate' | 'rotate'): void {
    this.transform.setMode(mode);
  }

  setSnap(enabled: boolean): void {
    this.snap = enabled;
    this.applySnap();
  }

  private applySnap(): void {
    this.transform.setTranslationSnap(this.snap ? SNAP_METERS : null);
    this.transform.setRotationSnap(this.snap ? SNAP_RADIANS : null);
  }

  setActiveLayer(layer: number, hideAbove: boolean): void {
    this.activeLayer = layer;
    this.hideAbove = hideAbove;
    this.applyClipping();
    this.updateLayerHelpers();
  }

  /** Cuts away everything above the layer being edited, when there is anything above it */
  private applyClipping(): void {
    const layerCount = 1 + (this.level?.vertical.layers.length ?? 0);
    const clip = this.hideAbove && this.activeLayer < layerCount - 1;
    this.renderer.clippingPlanes = clip
      ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), (this.activeLayer + 1) * LAYER_METERS - 0.02)]
      : [];
  }

  highlightCell(cell: { row: number; col: number; layer: number } | null): void {
    if (this.cellBox) {
      this.helpersGroup.remove(this.cellBox);
      this.cellBox.geometry.dispose();
      this.cellBox = null;
    }
    if (!cell || !this.level) return;
    const { x, z } = CollisionSystem.gridToWorld(cell.row, cell.col, this.level.grid.length);
    const box = new THREE.BoxGeometry(CELL, LAYER_METERS, CELL);
    this.cellBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x478cbf })
    );
    box.dispose();
    this.cellBox.position.set(x, cell.layer * LAYER_METERS + LAYER_METERS / 2, z);
    this.helpersGroup.add(this.cellBox);
  }

  private updateLayerHelpers(): void {
    if (!this.level) return;
    const size = this.level.grid.length;
    if (this.layerGrid) {
      this.helpersGroup.remove(this.layerGrid);
      this.layerGrid.geometry.dispose();
    }
    this.layerGrid = new THREE.GridHelper(size * CELL, size, 0x478cbf, 0x2d3d4d);
    (this.layerGrid.material as THREE.Material).transparent = true;
    (this.layerGrid.material as THREE.Material).opacity = 0.35;
    this.layerGrid.position.y = this.activeLayer * LAYER_METERS + 0.02;
    this.helpersGroup.add(this.layerGrid);
  }

  focusSelected(): void {
    const item = this.selectedId ? this.loaded.get(this.selectedId) : undefined;
    if (!item) return;
    const target = new THREE.Box3().setFromObject(item.root).getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.camera.position.copy(target).addScaledVector(dir, -6);
  }

  private frameWholeLevel(): void {
    const size = (this.level?.grid.length ?? 10) * CELL;
    this.camera.position.set(0, size * 0.55, size * 0.65);
    this.yaw = 0;
    this.pitch = -0.7;
    this.applyCameraRotation();
  }

  // --------------------------------------------------------------------------
  // Committing gizmo edits
  // --------------------------------------------------------------------------

  /** Turns the selected model's dragged transform back into its placement fields */
  private commitSelectedTransform(): void {
    const item = this.selectedId ? this.loaded.get(this.selectedId) : undefined;
    if (!item || !this.level) return;
    const root = item.root;
    root.rotation.reorder('YXZ');
    const gridSize = this.level.grid.length;
    const layerCount = 1 + this.level.vertical.layers.length;
    const pos = root.position;
    const layer = Math.max(0, Math.min(layerCount - 1, Math.floor((pos.y + 0.001) / LAYER_METERS)));

    // Re-anchor the footprint on the tile under the model so collision follows it
    const turned = { ...item.entity, yaw: root.rotation.y };
    const rect = getFootprintRect({ ...turned, yawBam: radiansToBam(turned.yaw) });
    const w = rect.col1 - rect.col0 + 1;
    const d = rect.row1 - rect.row0 + 1;
    const half = (gridSize * CELL) / 2;
    const col = Math.max(0, Math.min(gridSize - w, Math.round((pos.x + half) / CELL - w / 2)));
    const row = Math.max(0, Math.min(gridSize - d, Math.round((pos.z + half) / CELL - d / 2)));
    const anchor = entityAnchorWorld({ ...turned, row, col }, gridSize);

    const updated: PlacedEntity = {
      ...item.entity,
      row,
      col,
      layer,
      offsetX: round3(pos.x - anchor.x),
      offsetZ: round3(pos.z - anchor.z),
      elevation: round3(pos.y - layer * LAYER_METERS),
      yaw: round3(root.rotation.y),
      pitch: round3(root.rotation.x),
      roll: round3(root.rotation.z),
    };
    if (updated.walkable) {
      const surface = this.bakeWalkSurface(item.entity.id);
      if (surface) updated.walkSurface = surface;
    } else if (updated.collision === 'solid') {
      const bounds = this.measureModelBounds(item.entity.id);
      if (bounds) {
        updated.modelBottomUnits = bounds.bottomUnits;
        updated.modelTopUnits = bounds.topUnits;
      }
    }
    item.entity = updated;
    item.key = JSON.stringify(updated);
    this.callbacks.onCommitEntityTransform(updated);
  }

  // --------------------------------------------------------------------------
  // Solid model height
  // --------------------------------------------------------------------------

  /** Measures a loaded model's lowest and highest point relative to its origin */
  measureModelBounds(entityId: string): ModelBounds | null {
    const item = this.loaded.get(entityId);
    if (!item) return null;
    item.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    item.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.isHitbox) box.expandByObject(mesh);
    });
    if (box.isEmpty()) return null;
    const baseY = item.root.getWorldPosition(new THREE.Vector3()).y;
    const bottomUnits = Math.round((box.min.y - baseY) * UNITS_PER_METER);
    const topUnits = Math.round((box.max.y - baseY) * UNITS_PER_METER);
    return topUnits > bottomUnits ? { bottomUnits, topUnits } : null;
  }

  /** Reports a solid model's height when it differs from what the level has stored */
  private refreshModelBounds(item: LoadedEntity): void {
    if (item.entity.collision !== 'solid' || item.entity.walkable) return;
    const bounds = this.measureModelBounds(item.entity.id);
    if (
      !bounds ||
      (bounds.bottomUnits === item.entity.modelBottomUnits &&
        bounds.topUnits === item.entity.modelTopUnits)
    ) {
      return;
    }
    this.callbacks.onModelBoundsMeasured(item.entity.id, bounds);
  }

  // --------------------------------------------------------------------------
  // Walkable model shape
  // --------------------------------------------------------------------------

  /**
   * Samples a loaded model's real top and bottom heights on a grid from above and below,
   * in whole sim units, so standing on it follows its shape in the deterministic game.
   */
  bakeWalkSurface(entityId: string): WalkSurfaceSpec | null {
    const item = this.loaded.get(entityId);
    if (!item) return null;
    item.root.updateMatrixWorld(true);
    const meshes: THREE.Object3D[] = [];
    item.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.isHitbox) meshes.push(mesh);
    });
    const box = new THREE.Box3();
    for (const m of meshes) box.expandByObject(m);
    if (box.isEmpty()) return null;

    const sizeX = box.max.x - box.min.x;
    const sizeZ = box.max.z - box.min.z;
    const spacing = Math.max(0.08, Math.max(sizeX, sizeZ) / (WALK_SURFACE_MAX_SIDE - 1));
    const cols = Math.min(WALK_SURFACE_MAX_SIDE, Math.floor(sizeX / spacing) + 1);
    const rows = Math.min(WALK_SURFACE_MAX_SIDE, Math.floor(sizeZ / spacing) + 1);
    const top: number[] = [];
    const bottom: number[] = [];
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const span = box.max.y - box.min.y + 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = box.min.x + c * spacing;
        const z = box.min.z + r * spacing;
        ray.set(new THREE.Vector3(x, box.max.y + 1, z), down);
        ray.far = span;
        const hitTop = ray.intersectObjects(meshes, false)[0];
        ray.set(new THREE.Vector3(x, box.min.y - 1, z), up);
        const hitBottom = ray.intersectObjects(meshes, false)[0];
        if (!hitTop || !hitBottom) {
          top.push(WALK_SURFACE_EMPTY);
          bottom.push(WALK_SURFACE_EMPTY);
        } else {
          top.push(Math.round(hitTop.point.y * UNITS_PER_METER));
          bottom.push(Math.round(hitBottom.point.y * UNITS_PER_METER));
        }
      }
    }
    if (top.every((t) => t === WALK_SURFACE_EMPTY)) return null;
    return {
      originXUnits: Math.round(box.min.x * UNITS_PER_METER),
      originZUnits: Math.round(box.min.z * UNITS_PER_METER),
      spacingUnits: Math.max(1, Math.round(spacing * UNITS_PER_METER)),
      cols,
      rows,
      top,
      bottom,
    };
  }

  // --------------------------------------------------------------------------
  // Picking
  // --------------------------------------------------------------------------

  private setRayFromClient(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = 1000;
  }

  /** Hits above the clipping plane are hidden, so they cannot be picked either */
  private visibleHits(hits: THREE.Intersection[]): THREE.Intersection[] {
    const plane = this.renderer.clippingPlanes[0];
    if (!plane) return hits;
    // The plane keeps points where -y + constant >= 0; anything on or above the cut is hidden
    return hits.filter((h) => h.point.y < plane.constant);
  }

  /** The placed model under the mouse, if any */
  pickEntity(clientX: number, clientY: number): string | null {
    this.setRayFromClient(clientX, clientY);
    const hits = this.visibleHits(this.raycaster.intersectObjects(this.entitiesGroup.children, true));
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && obj.userData.entityId === undefined) obj = obj.parent;
      if (obj) return obj.userData.entityId as string;
    }
    return null;
  }

  /** The level surface under the mouse: point, facing, kind, and the open tile in front of it */
  pickSurface(clientX: number, clientY: number): SurfaceHit | null {
    if (!this.worldGroup || !this.level) return null;
    this.setRayFromClient(clientX, clientY);
    const hits = this.visibleHits(this.raycaster.intersectObject(this.worldGroup, true));
    // The first surface that faces open air: cut-away walls show their insides (trim,
    // back faces), which must not take a model
    for (const hit of hits) {
      if (!hit.face || (hit.object as THREE.Mesh).userData.isHitbox) continue;
      const surfaceHit = this.describeHit(hit);
      if (surfaceHit && !this.isSolidTile(surfaceHit.row, surfaceHit.col, surfaceHit.layer)) {
        return surfaceHit;
      }
    }
    return null;
  }

  private describeHit(hit: THREE.Intersection): SurfaceHit | null {
    if (!hit.face || !this.level) return null;
    const normal = hit.face.normal.clone();
    const mesh = hit.object as THREE.Mesh;
    if ((mesh as THREE.InstancedMesh).isInstancedMesh && hit.instanceId !== undefined) {
      const m = new THREE.Matrix4();
      (mesh as THREE.InstancedMesh).getMatrixAt(hit.instanceId, m);
      normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(m));
    }
    normal.transformDirection(mesh.matrixWorld);
    // Faces seen from behind (double-sided see-through textures) point at the camera
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();

    const surface: SurfaceKind = normal.y > 0.7 ? 'floor' : normal.y < -0.7 ? 'ceiling' : 'wall';
    const inFront = hit.point.clone().addScaledVector(normal, 0.05);
    const gridSize = this.level.grid.length;
    const half = (gridSize * CELL) / 2;
    const layerCount = 1 + this.level.vertical.layers.length;
    return {
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: normal.x, y: normal.y, z: normal.z },
      surface,
      row: clampInt(Math.floor((inFront.z + half) / CELL), 0, gridSize - 1),
      col: clampInt(Math.floor((inFront.x + half) / CELL), 0, gridSize - 1),
      layer: clampInt(Math.floor(inFront.y / LAYER_METERS), 0, layerCount - 1),
    };
  }

  private isSolidTile(row: number, col: number, layer: number): boolean {
    const level = this.level!;
    const grid = layer === 0 ? level.grid : level.vertical.layers[layer - 1]?.grid;
    return (grid?.[row]?.[col] ?? CellType.WALL) === CellType.WALL;
  }

  /** Snaps a surface point to the editor grid within the surface's own plane */
  snapPoint(hit: SurfaceHit): { x: number; y: number; z: number } {
    if (!this.snap) return { ...hit.point };
    const s = (v: number) => Math.round(v / SNAP_METERS) * SNAP_METERS;
    if (hit.surface === 'wall') {
      // Keep the point on the wall; snap along it and up it
      const alongX = Math.abs(hit.normal.z) > Math.abs(hit.normal.x);
      return {
        x: alongX ? s(hit.point.x) : hit.point.x,
        y: s(hit.point.y),
        z: alongX ? hit.point.z : s(hit.point.z),
      };
    }
    return { x: s(hit.point.x), y: hit.point.y, z: s(hit.point.z) };
  }

  // --------------------------------------------------------------------------
  // Fly camera & input
  // --------------------------------------------------------------------------

  private applyCameraRotation(): void {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private attachInput(): () => void {
    const el = this.renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      el.focus();
      if (e.button === 2) {
        this.flying = true;
        el.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 0) {
        // A press on the gizmo belongs to the gizmo, not to picking
        this.gizmoWasActive = this.transform.axis !== null;
        this.downAt = { x: e.clientX, y: e.clientY };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!this.flying) return;
      this.yaw -= e.movementX * 0.0035;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - e.movementY * 0.0035));
      this.applyCameraRotation();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 2) {
        this.flying = false;
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0 || !this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      this.downAt = null;
      if (moved > 4 || this.gizmoWasActive) return;
      const entityId = this.pickEntity(e.clientX, e.clientY);
      if (entityId) {
        this.select(entityId);
        return;
      }
      this.select(null);
      const surface = this.pickSurface(e.clientX, e.clientY);
      if (surface) {
        // A click on a floor or ceiling selects that tile; on a wall, the wall's own tile
        if (surface.surface === 'wall') {
          const back = new THREE.Vector3(surface.point.x, surface.point.y, surface.point.z).addScaledVector(
            new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z),
            -0.05
          );
          const gridSize = this.level!.grid.length;
          const half = (gridSize * CELL) / 2;
          this.callbacks.onSelectCell(
            clampInt(Math.floor((back.z + half) / CELL), 0, gridSize - 1),
            clampInt(Math.floor((back.x + half) / CELL), 0, gridSize - 1),
            surface.layer
          );
        } else {
          this.callbacks.onSelectCell(surface.row, surface.col, surface.layer);
        }
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.flying) {
        // While flying, the wheel sets the flying speed
        this.flySpeed = Math.max(1, Math.min(60, this.flySpeed * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        return;
      }
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.camera.position.addScaledVector(dir, (e.deltaY < 0 ? 1 : -1) * 1.5);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (this.flying) return;
      if (e.code === 'KeyG') this.setGizmoMode('translate');
      else if (e.code === 'KeyR') this.setGizmoMode('rotate');
      else if (e.code === 'KeyF') this.focusSelected();
      else if (e.code === 'Escape') this.select(null);
      else if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedId) {
        e.preventDefault();
        this.callbacks.onDeleteEntity(this.selectedId);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onBlur = () => {
      this.keys.clear();
      this.flying = false;
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('blur', onBlur);
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }

  private updateCamera(dt: number): void {
    // W/A/S/D and Q/E fly while the right button is held; arrow keys always move
    const k = this.keys;
    const fly = this.flying;
    const forward = (fly && k.has('KeyW')) || k.has('ArrowUp') ? 1 : 0;
    const back = (fly && k.has('KeyS')) || k.has('ArrowDown') ? 1 : 0;
    const left = (fly && k.has('KeyA')) || k.has('ArrowLeft') ? 1 : 0;
    const right = (fly && k.has('KeyD')) || k.has('ArrowRight') ? 1 : 0;
    const upKey = (fly && k.has('KeyE')) || k.has('PageUp') ? 1 : 0;
    const downKey = (fly && k.has('KeyQ')) || k.has('PageDown') ? 1 : 0;
    if (!forward && !back && !left && !right && !upKey && !downKey) return;
    const speed = this.flySpeed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1) * dt;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const side = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
    this.camera.position
      .addScaledVector(dir, (forward - back) * speed)
      .addScaledVector(side, (right - left) * speed)
      .addScaledVector(new THREE.Vector3(0, 1, 0), (upKey - downKey) * speed);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  /** Camera position and view, for showing where you are */
  getCameraInfo(): { x: number; y: number; z: number } {
    return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.removeListeners();
    this.resizeObserver.disconnect();
    this.transform.detach();
    this.transform.dispose();
    if (this.worldGroup) WorldBuilder.disposeWorldGroup(this.worldGroup);
    this.skyboxTex?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
