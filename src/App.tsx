/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ============================================================================
 * PIE3D GAME CREATION SYSTEM — DESKTOP GAME ENGINE IDE SHELL (PHASE 1, 2 & 3)
 * ============================================================================
 * Structured as a native-style Desktop Game Engine IDE (Godot / TrenchBroom /
 * Unity layout) using CSS Grid (`.ide-shell` in `src/index.css`):
 *  - Top (28px)   : `.ide-menubar`   — File Save/Load, Undo/Redo, Presets & View controls
 *  - Left (40px)  : `.ide-toolbar`   — Vertical SVG Tool Palette + Undo/Redo quick actions
 *  - Middle (1fr) : `.ide-workspace` — Resizable Split Pane housing 2D Grid Editor & 3D Viewport
 *  - Right (280px): `.ide-inspector` — Properties Inspector, Asset Browser & World Settings
 *  - Bottom (24px): `.ide-statusbar` — Engine Status Log, History Depth & Coordinate Readout
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  ENGINE_CONFIG,
  EditorToolMode,
  LevelStateData,
  MAP_PRESETS,
  Model3DAsset,
  PlacedEntity,
  PlayerTransform,
  SkyboxThemeId,
  SurfaceTarget,
  TextureAsset,
  createUniformTextureMatrix,
  resizeSquareMatrix,
} from './types/engine';
import { CollisionSystem } from './engine/CollisionSystem';
import { TextureGenerator } from './engine/TextureGenerator';
import {
  LevelSerializer,
  computeNextEntityId,
} from './engine/LevelSerializer';
import { AssetFolderLoader } from './engine/AssetFolderLoader';
import { AssetRegistry } from './engine/AssetRegistry';
import {
  SimulationState,
  createInitialSimulationState,
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
  EventDefinition,
  RegionDefinition,
  VariableRegistrySpec,
} from './engine/sim';
import {
  DesignStateSnapshot,
  HistoryManager,
  MAX_HISTORY_DEPTH,
} from './engine/HistoryManager';
import { MapEditor2D } from './components/MapEditor2D';
import { Viewport3D } from './components/Viewport3D';
import { PropertiesInspector } from './components/PropertiesInspector';
import { ArchitectureModal } from './components/ArchitectureModal';
import { EventTriggerEditorModal } from './components/EventTriggerEditorModal';
import { TopMenuBar } from './components/ide/TopMenuBar';
import { LeftToolPalette } from './components/ide/LeftToolPalette';
import { BottomStatusBar } from './components/ide/BottomStatusBar';
import { useModelLibrary } from './components/inspector/modelLibrary/useModelLibrary';
import type { ModelSettings } from './types/modelLibrary';
import {
  resolveModelSettings,
  setModelSettings,
} from './engine/modelLibrary/libraryState';
import { getCategoryInfo } from './engine/modelLibrary/categories';
import { measuredFootprintFromSize } from './engine/modelLibrary/footprint';
import {
  entitiesFittingGrid,
  findPlacementConflicts,
  getEntitiesCoveringCell,
  getEntityRect,
} from './engine/modelLibrary/placement';
import { EntityLoader } from './engine/EntityLoader';

export default function App() {
  const initialPreset = MAP_PRESETS[0];
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  // --------------------------------------------------------------------------
  // 1. PRIMARY GRID & PER-CELL TEXTURE ASSIGNMENT MATRICES (SIZE = grid.length)
  // --------------------------------------------------------------------------
  const [grid, setGrid] = useState<number[][]>(() =>
    initialPreset.grid.map((row) => [...row])
  );
  const [wallTextures, setWallTextures] = useState<string[][]>(() =>
    createUniformTextureMatrix(
      initialPreset.defaultWallTex || 'default-grid',
      initialPreset.grid.length
    )
  );
  const [floorTextures, setFloorTextures] = useState<string[][]>(() =>
    createUniformTextureMatrix('floor-obsidian', initialPreset.grid.length)
  );
  const [ceilingTextures, setCeilingTextures] = useState<string[][]>(() =>
    createUniformTextureMatrix('ceiling-coffer', initialPreset.grid.length)
  );

  // --------------------------------------------------------------------------
  // 2. TEXTURE ASSETS & 3D .GLB MODEL ASSETS STATE (BUILT-IN + ASSETS FOLDERS)
  // --------------------------------------------------------------------------
  const autoDiscoveredFolderAssets = useMemo(
    () => AssetFolderLoader.getAutoDiscoveredSrcAssets(),
    []
  );

  const builtInTextures = useMemo(
    () => TextureGenerator.getBuiltInTextureAssets(),
    []
  );
  const [customTextures, setCustomTextures] = useState<TextureAsset[]>(
    () => autoDiscoveredFolderAssets.textures
  );
  const allTextures = useMemo(
    () => [...builtInTextures, ...customTextures],
    [builtInTextures, customTextures]
  );

  const [selectedTextureId, setSelectedTextureId] =
    useState<string>('default-grid');
  const [targetSurface, setTargetSurface] = useState<SurfaceTarget>('wall');

  const builtInModel3DAssets = useMemo<Model3DAsset[]>(
    () =>
      DEFAULT_ENTITY_BLUEPRINTS.filter((bp) => bp.id !== 'custom-glb').map(
        (bp) => ({
          id: bp.id,
          blueprintId: bp.id,
          name: bp.name,
          sourceType: 'builtin',
          isEnemy: bp.isEnemy,
          defaultHealth: bp.defaultHealth,
          moveSpeed: bp.moveSpeed,
          attackDamage: bp.attackDamage,
          accentHex: bp.accentHex,
          badgeText: bp.badgeText,
        })
      ),
    []
  );
  const [customModel3DAssets, setCustomModel3DAssets] = useState<
    Model3DAsset[]
  >(() => autoDiscoveredFolderAssets.models);
  const allModel3DAssets = useMemo<Model3DAsset[]>(
    () => [...builtInModel3DAssets, ...customModel3DAssets],
    [builtInModel3DAssets, customModel3DAssets]
  );

  // Load any external assets listed in /public/assets/manifest.json on mount
  useEffect(() => {
    let active = true;
    AssetFolderLoader.fetchPublicManifestAssets().then((manifestAssets) => {
      if (!active) return;
      if (manifestAssets.textures.length > 0) {
        setCustomTextures((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const fresh = manifestAssets.textures.filter(
            (t) => !existingIds.has(t.id)
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
      if (manifestAssets.models.length > 0) {
        setCustomModel3DAssets((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = manifestAssets.models.filter(
            (m) => !existingIds.has(m.id)
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const [selectedModelAssetId, setSelectedModelAssetId] =
    useState<string>('sentinel-bot');

  const [entities, setEntities] = useState<PlacedEntity[]>(() =>
    initialPreset.entities ? initialPreset.entities.map((e) => ({ ...e })) : []
  );
  const [nextEntityId, setNextEntityId] = useState<number>(() =>
    computeNextEntityId(initialPreset.entities || [])
  );
  const nextEntityIdRef = useRef<number>(nextEntityId);
  nextEntityIdRef.current = nextEntityId;

  // --------------------------------------------------------------------------
  // 3. IDE LAYOUT, SELECTED CELL, TOOL PALETTE & SKYBOX SETTINGS
  // --------------------------------------------------------------------------
  const [toolMode, setToolMode] = useState<EditorToolMode>('toggle');
  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
  }>({ row: 3, col: 3 });
  const [hoveredCell, setHoveredCell] = useState<{
    row: number;
    col: number;
  } | null>(null);

  // Keep the selection on the map when it shrinks (resize, undo/redo, preset or file load)
  useEffect(() => {
    const maxIdx = grid.length - 1;
    setSelectedCell((prev) =>
      prev.row > maxIdx || prev.col > maxIdx
        ? { row: Math.min(prev.row, maxIdx), col: Math.min(prev.col, maxIdx) }
        : prev
    );
  }, [grid.length]);

  // Resizable split pane percentage for 2D Map Editor (default 40%)
  const [splitRatioPct, setSplitRatioPct] = useState<number>(40);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);

  const [spawn, setSpawn] = useState<{ row: number; col: number; yaw: number }>(
    () => ({ ...initialPreset.spawn })
  );
  const [skyboxTheme, setSkyboxTheme] =
    useState<SkyboxThemeId>('retro-nebula');
  const [skyboxSeed, setSkyboxSeed] = useState<number>(1);
  const [showCeiling, setShowCeiling] = useState<boolean>(false);
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(true);
  const [isPlayFullscreen, setIsPlayFullscreen] = useState<boolean>(false);

  // --------------------------------------------------------------------------
  // 4. SINGLE SOURCE OF TRUTH SIMULATION STATE & BOTTOM STATUS BAR LOG
  // --------------------------------------------------------------------------
  const [simState, setSimState] = useState<SimulationState>(() => {
    const initialV3 = LevelSerializer.serializeLevelV3({
      grid: initialPreset.grid,
      wallTextures: createUniformTextureMatrix(
        initialPreset.defaultWallTex || 'default-grid',
        initialPreset.grid.length
      ),
      floorTextures: createUniformTextureMatrix(
        'floor-obsidian',
        initialPreset.grid.length
      ),
      ceilingTextures: createUniformTextureMatrix(
        'ceiling-coffer',
        initialPreset.grid.length
      ),
      entities: initialPreset.entities || [],
      nextEntityId: computeNextEntityId(initialPreset.entities || []),
      spawn: initialPreset.spawn,
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      cellTags: initialPreset.cellTags,
      events: initialPreset.events || [],
      regions: initialPreset.regions || [],
      variables: initialPreset.variables,
    });
    return createInitialSimulationState(initialV3, [0]);
  });
  const collectedKeys = useMemo(
    () => getCollectedKeysSetFromSim(simState),
    [simState]
  );
  const openDoors = useMemo(
    () => getOpenDoorsSetFromSim(simState),
    [simState]
  );

  const [resetSignal, setResetSignal] = useState<number>(0);
  const [isArchModalOpen, setIsArchModalOpen] = useState<boolean>(false);
  const [isEventEditorOpen, setIsEventEditorOpen] = useState<boolean>(false);
  const [engineLog, setEngineLog] = useState<string>(
    'Ready — Click 2D grid to sculpt level (Ctrl+Z Undo / Ctrl+Y Redo) or click 3D viewport to fire.'
  );

  // Global model library (folders, tags, per-model settings) shared by every level
  const handleRestoredUploads = useCallback((restored: Model3DAsset[]) => {
    setCustomModel3DAssets((prev) => {
      const restoredIds = new Set(restored.map((m) => m.id));
      return [...prev.filter((m) => !restoredIds.has(m.id)), ...restored];
    });
  }, []);
  const handleRemoveModelAsset = useCallback((modelId: string) => {
    setCustomModel3DAssets((prev) => prev.filter((m) => m.id !== modelId));
  }, []);
  const modelLibrary = useModelLibrary({
    models: allModel3DAssets,
    onLog: setEngineLog,
    onRestoredUploads: handleRestoredUploads,
    onRemoveModel: handleRemoveModelAsset,
  });
  const { libraryState, setLibraryState, selectedVariant } = modelLibrary;

  // When off, new placements may not overlap models, walls or doors (existing ones are untouched)
  const [allowOverlap, setAllowOverlap] = useState<boolean>(false);
  const allowOverlapRef = useRef(allowOverlap);
  allowOverlapRef.current = allowOverlap;

  // Measure each real-size custom model once so its footprint is known before placing
  const measuredAttemptsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const asset of allModel3DAssets) {
      if (
        asset.blueprintId !== 'custom-glb' ||
        !asset.customGlbUrl ||
        measuredAttemptsRef.current.has(asset.id)
      ) {
        continue;
      }
      const settings = resolveModelSettings(libraryState, asset);
      if (getCategoryInfo(settings.category).sizing !== 'real' || settings.measuredFootprint) {
        continue;
      }
      measuredAttemptsRef.current.add(asset.id);
      EntityLoader.measureModelSize(asset.customGlbUrl).then((size) => {
        if (!size) return;
        setLibraryState((prev) =>
          setModelSettings(prev, asset.id, {
            measuredFootprint: measuredFootprintFromSize(
              size.width * settings.scale,
              size.depth * settings.scale
            ),
          })
        );
      });
    }
  }, [allModel3DAssets, libraryState, setLibraryState]);

  const getLibrarySettings = useCallback(
    (entity: PlacedEntity) => {
      const asset = allModel3DAssets.find(
        (m) => m.id === (entity.modelAssetId ?? entity.blueprintId)
      );
      return asset ? resolveModelSettings(libraryState, asset) : null;
    },
    [allModel3DAssets, libraryState]
  );

  // --------------------------------------------------------------------------
  // 5. GLOBAL HISTORY MANAGEMENT SYSTEM (UNDO / REDO STACKS)
  // --------------------------------------------------------------------------
  const [pastHistory, setPastHistory] = useState<DesignStateSnapshot[]>([]);
  const [futureHistory, setFutureHistory] = useState<DesignStateSnapshot[]>([]);

  const pastHistoryRef = useRef<DesignStateSnapshot[]>(pastHistory);
  pastHistoryRef.current = pastHistory;

  const futureHistoryRef = useRef<DesignStateSnapshot[]>(futureHistory);
  futureHistoryRef.current = futureHistory;

  // Live ref to the current design state so history snapshots are always synchronous
  const currentDesignRef = useRef<DesignStateSnapshot>({
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities,
    spawn,
    actionLabel: 'Initial State',
  });
  currentDesignRef.current = {
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities,
    spawn,
    actionLabel: 'Current State',
  };

  /**
   * Records a deep-cloned snapshot of the current map state (`grid`, `entities`,
   * `wallTextures`, `floorTextures`, `ceilingTextures`, and `spawn`) onto the
   * Undo stack before a mutation is applied, and clears the Redo stack.
   */
  const recordHistorySnapshot = useCallback((actionLabel: string) => {
    const snapshot = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel,
    });

    setPastHistory((prev) => {
      if (
        prev.length > 0 &&
        HistoryManager.areSnapshotsEqual(prev[prev.length - 1], snapshot)
      ) {
        // Update action label of top entry if state hasn't changed yet
        const updated = [...prev];
        updated[updated.length - 1] = snapshot;
        return updated;
      }
      const next = [...prev, snapshot];
      return next.length > MAX_HISTORY_DEPTH
        ? next.slice(next.length - MAX_HISTORY_DEPTH)
        : next;
    });

    setFutureHistory([]);
  }, []);

  /**
   * Reverts the map design (`grid`, `entities`, `textureAssignments`, `spawn`)
   * to the previous snapshot on the Undo stack (`Ctrl+Z`).
   */
  const handleUndo = useCallback(() => {
    const prevPast = pastHistoryRef.current;
    if (prevPast.length === 0) {
      setEngineLog('History: Nothing to undo.');
      return;
    }

    const targetSnapshot = prevPast[prevPast.length - 1];
    const remainingPast = prevPast.slice(0, -1);

    // Push current state onto Redo stack
    const currentSnap = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel: targetSnapshot.actionLabel,
    });

    setPastHistory(remainingPast);
    setFutureHistory((prevFuture) => [...prevFuture, currentSnap]);

    // Restore state from targetSnapshot
    const restored = HistoryManager.cloneSnapshot(targetSnapshot);
    setGrid(restored.grid);
    setWallTextures(restored.wallTextures);
    setFloorTextures(restored.floorTextures);
    setCeilingTextures(restored.ceilingTextures);
    setEntities(restored.entities);
    setSpawn(restored.spawn);

    setEngineLog(
      `Undo (Ctrl+Z): Reverted '${targetSnapshot.actionLabel}' (${remainingPast.length} steps left).`
    );
  }, []);

  /**
   * Re-applies a previously undone map design step from the Redo stack (`Ctrl+Y` / `Ctrl+Shift+Z`).
   */
  const handleRedo = useCallback(() => {
    const prevFuture = futureHistoryRef.current;
    if (prevFuture.length === 0) {
      setEngineLog('History: Nothing to redo.');
      return;
    }

    const targetSnapshot = prevFuture[prevFuture.length - 1];
    const remainingFuture = prevFuture.slice(0, -1);

    // Push current state back onto Undo stack
    const currentSnap = HistoryManager.cloneSnapshot({
      ...currentDesignRef.current,
      actionLabel: targetSnapshot.actionLabel,
    });

    setFutureHistory(remainingFuture);
    setPastHistory((prevPast) => [...prevPast, currentSnap]);

    // Restore state from targetSnapshot
    const restored = HistoryManager.cloneSnapshot(targetSnapshot);
    setGrid(restored.grid);
    setWallTextures(restored.wallTextures);
    setFloorTextures(restored.floorTextures);
    setCeilingTextures(restored.ceilingTextures);
    setEntities(restored.entities);
    setSpawn(restored.spawn);

    setEngineLog(
      `Redo (Ctrl+Y): Restored '${targetSnapshot.actionLabel}' (${remainingFuture.length} steps left).`
    );
  }, []);

  // Global Keyboard Listener for Ctrl+Z (Undo) and Ctrl+Y / Ctrl+Shift+Z (Redo)
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      // Allow native undo/redo inside text inputs and textareas
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [handleUndo, handleRedo]);

  // --------------------------------------------------------------------------
  // 6. REAL-TIME FIRST-PERSON CAMERA TRANSFORM
  // --------------------------------------------------------------------------
  const initialWorld = CollisionSystem.gridToWorld(
    initialPreset.spawn.row,
    initialPreset.spawn.col,
    initialPreset.grid.length
  );
  const [playerTransform, setPlayerTransform] = useState<PlayerTransform>({
    x: initialWorld.x,
    y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
    z: initialWorld.z,
    yaw: initialPreset.spawn.yaw,
    pitch: 0,
    gridRow: initialPreset.spawn.row,
    gridCol: initialPreset.spawn.col,
    speed: 0,
  });

  // --------------------------------------------------------------------------
  // RESIZABLE SPLIT PANE DRAG HANDLER
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!isDraggingSplitter) return;

    const onPointerMove = (e: PointerEvent) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      const rect = ws.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitRatioPct(Math.max(24, Math.min(66, pct)));
    };

    const onPointerUp = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isDraggingSplitter]);

  const applyTextureToCell = useCallback(
    (row: number, col: number, surface: SurfaceTarget, texId: string) => {
      if (surface === 'wall') {
        setWallTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
      } else if (surface === 'floor') {
        setFloorTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
      } else if (surface === 'ceiling') {
        setCeilingTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
        setShowCeiling(true);
      }
    },
    []
  );

  const handleAssignCellTextureFromInspector = useCallback(
    (row: number, col: number, surface: SurfaceTarget, texId: string) => {
      recordHistorySnapshot(
        `Assign ${surface} texture '${texId}' at [X:${col}, Z:${row}]`
      );
      applyTextureToCell(row, col, surface, texId);
    },
    [recordHistorySnapshot, applyTextureToCell]
  );

  /**
   * Handles dropping a texture thumbnail dragged from the Inspector's Asset Library
   * directly onto a 2D Grid cell `[row, col]`.
   */
  const handleDropTextureOnCell = useCallback(
    (row: number, col: number, texId: string) => {
      const texAsset = allTextures.find((t) => t.id === texId);
      if (!texAsset) return;

      recordHistorySnapshot(
        `Drop texture '${texAsset.name}' onto ${targetSurface} at [X:${col}, Z:${row}]`
      );
      setSelectedCell({ row, col });
      setSelectedTextureId(texId);

      // If dropping a Wall texture onto an Empty cell, also extrude the cell as a Solid Wall
      if (targetSurface === 'wall') {
        setGrid((prev) => {
          if (prev[row][col] === CellType.WALL) return prev;
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.WALL;
          return next;
        });
      }

      applyTextureToCell(row, col, targetSurface, texId);
      setEngineLog(
        `Asset Library Drop: Applied '${texAsset.name}' to ${targetSurface} at [X:${col}, Z:${row}].`
      );
    },
    [allTextures, recordHistorySnapshot, targetSurface, applyTextureToCell]
  );

  const handleFillSurfaceWithTexture = useCallback(
    (surface: SurfaceTarget, texId: string) => {
      recordHistorySnapshot(`Fill all ${surface}s with '${texId}'`);
      if (surface === 'wall') {
        setWallTextures((prev) => createUniformTextureMatrix(texId, prev.length));
      } else if (surface === 'floor') {
        setFloorTextures((prev) => createUniformTextureMatrix(texId, prev.length));
      } else if (surface === 'ceiling') {
        setCeilingTextures((prev) =>
          createUniformTextureMatrix(texId, prev.length)
        );
        setShowCeiling(true);
      }
      setEngineLog(`Assets: Applied texture '${texId}' to all ${surface} cells.`);
    },
    [recordHistorySnapshot]
  );

  /**
   * Places a model anchored at [row, col] using its library settings (or a
   * picked variant's / `settingsOverride`). Returns false when the footprint
   * leaves the map, or overlaps something while overlap is off.
   */
  const placeEntityAtCell = useCallback(
    (
      row: number,
      col: number,
      assetOverride?: Model3DAsset,
      settingsOverride?: ModelSettings
    ): boolean => {
      const targetAsset =
        assetOverride ||
        allModel3DAssets.find((m) => m.id === selectedModelAssetId) ||
        allModel3DAssets[0];
      if (!targetAsset) return false;

      const variantSettings =
        selectedVariant && selectedVariant.modelAssetId === targetAsset.id
          ? selectedVariant.settings
          : {};
      const settings = {
        ...resolveModelSettings(libraryState, targetAsset),
        ...(settingsOverride ?? variantSettings),
      };

      const allocatedIdNum = nextEntityIdRef.current;
      // The asset's own id is stable across reloads; ids derived from object URLs are not
      const modelAssetId = AssetRegistry.registerModel(targetAsset).id;

      const newEntity: PlacedEntity = {
        id: `ent-${allocatedIdNum}`,
        row,
        col,
        blueprintId: targetAsset.blueprintId,
        modelAssetId,
        name: targetAsset.name,
        yaw: 0,
        scale: settings.scale ?? 1,
        customGlbUrl: targetAsset.customGlbUrl,
        category: settings.category,
        collision: settings.collision,
        footprintW: settings.footprintW,
        footprintD: settings.footprintD,
        ...(settings.footprintOverride ? { footprintOverride: true } : {}),
        isEnemy: settings.isEnemy,
        maxHealth: settings.maxHealth ?? 75,
        moveSpeed: settings.moveSpeed ?? 0,
        attackDamage: settings.attackDamage ?? 0,
      };

      const { grid: currentGrid, entities: currentEntities } = currentDesignRef.current;
      const reasons = findPlacementConflicts(currentGrid, currentEntities, newEntity);
      if (
        reasons.includes('off the map edge') ||
        (!allowOverlapRef.current && reasons.length > 0)
      ) {
        setEngineLog(`Placement blocked: ${reasons.join('; ')}`);
        return false;
      }

      nextEntityIdRef.current = allocatedIdNum + 1;
      setNextEntityId(allocatedIdNum + 1);
      setEntities((prev) => [...prev, newEntity]);
      setEngineLog(
        `Entity: Placed '${newEntity.name}' (${newEntity.id}) at cell [X:${col}, Z:${row}].`
      );
      return true;
    },
    [allModel3DAssets, selectedModelAssetId, libraryState, selectedVariant]
  );

  /** Places a copy with the same settings as an already placed model (variant drag) */
  const handleDropVariantOnCell = useCallback(
    (row: number, col: number, sourceEntityId: string) => {
      const source = currentDesignRef.current.entities.find(
        (e) => e.id === sourceEntityId
      );
      const asset = source
        ? allModel3DAssets.find(
            (m) => m.id === (source.modelAssetId ?? source.blueprintId)
          )
        : undefined;
      if (!source || !asset) {
        setEngineLog('Placement blocked: that variant is no longer in the level.');
        return;
      }
      recordHistorySnapshot(`Place '${source.name}' variant at [X:${col}, Z:${row}]`);
      setSelectedCell({ row, col });
      placeEntityAtCell(row, col, asset, {
        category: source.category,
        collision: source.collision,
        footprintW: source.footprintW,
        footprintD: source.footprintD,
        footprintOverride: source.footprintOverride,
        scale: source.scale,
        isEnemy: source.isEnemy,
        maxHealth: source.maxHealth,
        moveSpeed: source.moveSpeed,
        attackDamage: source.attackDamage,
      });
    },
    [allModel3DAssets, recordHistorySnapshot, placeEntityAtCell]
  );

  /**
   * Handles dropping a 3D .glb Model Asset card dragged from the Inspector's
   * Asset Library tab directly onto a 2D Grid cell `[row, col]`.
   */
  const handleDropModelOnCell = useCallback(
    (row: number, col: number, modelAssetId: string) => {
      const modelAsset = allModel3DAssets.find((m) => m.id === modelAssetId);
      if (!modelAsset) return;

      recordHistorySnapshot(
        `Drop 3D Model '${modelAsset.name}' at [X:${col}, Z:${row}]`
      );
      setSelectedCell({ row, col });
      setSelectedModelAssetId(modelAsset.id);
      placeEntityAtCell(row, col, modelAsset);
      setEngineLog(
        `Asset Library Drop: Spawned 3D model '${modelAsset.name}' at [X:${col}, Z:${row}].`
      );
    },
    [allModel3DAssets, recordHistorySnapshot, placeEntityAtCell]
  );

  const handlePlaceEntityFromInspector = useCallback(
    (row: number, col: number) => {
      recordHistorySnapshot(`Spawn Entity at [X:${col}, Z:${row}]`);
      placeEntityAtCell(row, col);
    },
    [recordHistorySnapshot, placeEntityAtCell]
  );

  /**
   * Invoked by 2D Map Editor cells (where `onStrokeStart` has already recorded
   * the pre-stroke snapshot onto the Undo stack).
   */
  const handleCellInteract = useCallback(
    (row: number, col: number, forceValue?: number) => {
      if (toolMode === 'spawn') {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.EMPTY;
          return next;
        });
        setSpawn((prev) => ({ ...prev, row, col }));
        setEngineLog(`Spawn: Relocated Player Spawn to [X:${col}, Z:${row}].`);
        return;
      }

      if (toolMode === 'entity') {
        const activeAsset =
          allModel3DAssets.find((m) => m.id === selectedModelAssetId) ||
          allModel3DAssets[0];

        // Clicking a cell covered by the active model removes that copy
        const existingAtCell = activeAsset
          ? getEntitiesCoveringCell(entities, row, col).find(
              (e) => (e.modelAssetId ?? e.blueprintId) === activeAsset.id
            )
          : undefined;
        if (existingAtCell) {
          setEntities((prev) => prev.filter((e) => e.id !== existingAtCell.id));
          setEngineLog(
            `Entity: Removed '${existingAtCell.name}' from [X:${col}, Z:${row}].`
          );
          return;
        }

        placeEntityAtCell(row, col, activeAsset);
        return;
      }

      if (toolMode === 'paint') {
        if (targetSurface === 'wall') {
          setGrid((prev) => {
            if (prev[row][col] === CellType.WALL) return prev;
            const next = prev.map((r) => [...r]);
            next[row][col] = CellType.WALL;
            return next;
          });
        }
        applyTextureToCell(row, col, targetSurface, selectedTextureId);
        setEngineLog(
          `Paint: Assigned '${selectedTextureId}' to ${targetSurface} at [X:${col}, Z:${row}].`
        );
        return;
      }

      const currentCellVal = currentDesignRef.current.grid[row]?.[col];

      if (toolMode === 'toggle') {
        const nextVal =
          forceValue !== undefined
            ? forceValue
            : currentCellVal === CellType.WALL
            ? CellType.EMPTY
            : CellType.WALL;
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = nextVal;
          return next;
        });
        if (nextVal === CellType.WALL && targetSurface === 'wall') {
          applyTextureToCell(row, col, 'wall', selectedTextureId);
        }
      } else if (toolMode === 'wall') {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.WALL;
          return next;
        });
        applyTextureToCell(row, col, 'wall', selectedTextureId);
      } else if (toolMode === 'empty') {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.EMPTY;
          return next;
        });
        setEntities((ents) => {
          const covering = new Set(
            getEntitiesCoveringCell(ents, row, col).map((e) => e.id)
          );
          return ents.filter((e) => !covering.has(e.id));
        });
      } else if (toolMode === 'door') {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] =
            prev[row][col] === CellType.DOOR ? CellType.EMPTY : CellType.DOOR;
          return next;
        });
      } else if (toolMode === 'key') {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] =
            prev[row][col] === CellType.KEY ? CellType.EMPTY : CellType.KEY;
          return next;
        });
      }
    },
    [
      toolMode,
      allModel3DAssets,
      selectedModelAssetId,
      entities,
      placeEntityAtCell,
      targetSurface,
      selectedTextureId,
      applyTextureToCell,
    ]
  );

  const handleSetCellType = useCallback(
    (row: number, col: number, cellType: CellType) => {
      recordHistorySnapshot(
        `Set cell [X:${col}, Z:${row}] to type ${cellType}`
      );
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = cellType;
        return next;
      });
      setEngineLog(
        `Inspector: Set cell [X:${col}, Z:${row}] to type ${cellType}.`
      );
    },
    [recordHistorySnapshot]
  );

  const handleUpdateEntity = useCallback(
    (updated: PlacedEntity) => {
      // Moving, rotating or resizing a footprint must still fit (and not overlap while overlap is off)
      const { grid: currentGrid, entities: currentEntities } = currentDesignRef.current;
      const previous = currentEntities.find((e) => e.id === updated.id);
      if (
        previous &&
        JSON.stringify(getEntityRect(previous)) !== JSON.stringify(getEntityRect(updated))
      ) {
        const reasons = findPlacementConflicts(
          currentGrid,
          currentEntities,
          updated,
          updated.id
        );
        if (
          reasons.includes('off the map edge') ||
          (!allowOverlapRef.current && reasons.length > 0)
        ) {
          setEngineLog(`Placement blocked: ${reasons.join('; ')}`);
          return;
        }
      }
      recordHistorySnapshot(
        `Edit Entity '${updated.name}' at [X:${updated.col}, Z:${updated.row}]`
      );
      setEntities((prev) =>
        prev.map((e) => (e.id === updated.id ? updated : e))
      );
    },
    [recordHistorySnapshot]
  );

  const handleRemoveEntity = useCallback(
    (entityId: string) => {
      const target = currentDesignRef.current.entities.find((e) => e.id === entityId);
      if (!target) return;
      recordHistorySnapshot(`Delete '${target.name}'`);
      setEntities((prev) => prev.filter((e) => e.id !== entityId));
      setEngineLog(`Inspector: Removed '${target.name}'.`);
    },
    [recordHistorySnapshot]
  );

  const handleLoadPreset = useCallback(
    (presetId: string) => {
      const found = MAP_PRESETS.find((p) => p.id === presetId);
      if (!found) return;
      recordHistorySnapshot(`Load Preset '${found.name}'`);
      const nextGrid = found.grid.map((r) => [...r]);
      const nextWallTex = createUniformTextureMatrix(
        found.defaultWallTex || 'default-grid',
        nextGrid.length
      );
      const nextFloorTex = createUniformTextureMatrix(
        'floor-obsidian',
        nextGrid.length
      );
      const nextCeilTex = createUniformTextureMatrix(
        'ceiling-coffer',
        nextGrid.length
      );
      const nextEnts = found.entities
        ? found.entities.map((e) => ({ ...e }))
        : [];
      setGrid(nextGrid);
      setWallTextures(nextWallTex);
      setFloorTextures(nextFloorTex);
      setCeilingTextures(nextCeilTex);
      setEntities(nextEnts);
      setNextEntityId((prev) =>
        computeNextEntityId(nextEnts, Math.max(prev, found.nextEntityId ?? 1))
      );
      setSpawn({ ...found.spawn });
      const presetV3 = LevelSerializer.serializeLevelV3({
        grid: nextGrid,
        wallTextures: nextWallTex,
        floorTextures: nextFloorTex,
        ceilingTextures: nextCeilTex,
        entities: nextEnts,
        spawn: found.spawn,
        skyboxTheme,
        skyboxSeed,
        showCeiling,
        minimapEnabled,
        cellTags: found.cellTags,
        events: found.events || [],
        regions: found.regions || [],
        variables: found.variables,
      });
      setSimState(createInitialSimulationState(presetV3, [0]));
      setResetSignal((n) => n + 1);
      setEngineLog(`Preset: Loaded '${found.name}'.`);
    },
    [
      recordHistorySnapshot,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
    ]
  );

  const handleRestoreLevelState = useCallback(
    (state: LevelStateData) => {
      recordHistorySnapshot('Import Level JSON');
      setGrid(state.grid.map((r) => [...r]));
      setWallTextures(state.wallTextures.map((r) => [...r]));
      setFloorTextures(state.floorTextures.map((r) => [...r]));
      setCeilingTextures(state.ceilingTextures.map((r) => [...r]));
      setCustomTextures([...state.customTextures]);
      const restoredEnts = state.entities.map((e) => ({ ...e }));
      setEntities(restoredEnts);
      setNextEntityId(
        computeNextEntityId(restoredEnts, state.nextEntityId)
      );
      setSpawn({ ...state.spawn });
      setSkyboxTheme(state.skybox.theme);
      setSkyboxSeed(state.skybox.seed);
      setShowCeiling(state.skybox.showCeiling);
      if (typeof state.minimapEnabled === 'boolean') {
        setMinimapEnabled(state.minimapEnabled);
      }
      const restoredV3 = LevelSerializer.serializeLevelV3({
        grid: state.grid,
        wallTextures: state.wallTextures,
        floorTextures: state.floorTextures,
        ceilingTextures: state.ceilingTextures,
        customTextures: state.customTextures,
        entities: restoredEnts,
        nextEntityId: state.nextEntityId,
        spawn: state.spawn,
        skyboxTheme: state.skybox.theme,
        skyboxSeed: state.skybox.seed,
        showCeiling: state.skybox.showCeiling,
        minimapEnabled:
          typeof state.minimapEnabled === 'boolean'
            ? state.minimapEnabled
            : true,
        cellTags: state.cellTags,
        events: state.events || [],
        regions: state.regions || [],
        variables: state.variables,
      });
      setSimState(createInitialSimulationState(restoredV3, [0]));
      setResetSignal((n) => n + 1);
      setEngineLog(
        `File: Loaded Level JSON (${state.entities.length} Entities, ${state.customTextures.length} Custom Textures).`
      );
    },
    [recordHistorySnapshot]
  );

  const handleSaveLevelDataFromEditor = useCallback(
    (updated: {
      events: EventDefinition[];
      regions: RegionDefinition[];
      variables: VariableRegistrySpec;
    }) => {
      recordHistorySnapshot('Edit Visual Triggers & Events');
      const updatedV3 = LevelSerializer.serializeLevelV3({
        grid,
        wallTextures,
        floorTextures,
        ceilingTextures,
        customTextures,
        entities,
        nextEntityId,
        spawn,
        skyboxTheme,
        skyboxSeed,
        showCeiling,
        minimapEnabled,
        cellTags: grid.map((r) => r.map(() => 0)),
        events: updated.events,
        regions: updated.regions,
        variables: updated.variables,
      });
      setSimState(createInitialSimulationState(updatedV3, [0]));
      setResetSignal((n) => n + 1);
      setIsEventEditorOpen(false);
      setEngineLog(
        `Visual Triggers: Updated ${updated.events.length} events, ${updated.regions.length} regions.`
      );
    },
    [
      recordHistorySnapshot,
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      nextEntityId,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
    ]
  );

  const currentLevelState = useMemo(
    () =>
      LevelSerializer.serializeLevel({
        grid,
        wallTextures,
        floorTextures,
        ceilingTextures,
        customTextures,
        entities,
        nextEntityId,
        spawn,
        skyboxTheme,
        skyboxSeed,
        showCeiling,
        minimapEnabled,
        events: simState.events,
        regions: simState.regions,
        variables: {
          flags: simState.flags,
          counters: simState.counters,
          timers: Object.keys(simState.timers),
        },
      }),
    [
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      nextEntityId,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      simState.events,
      simState.regions,
      simState.flags,
      simState.counters,
      simState.timers,
    ]
  );

  const handleSaveMap = useCallback(() => {
    LevelSerializer.downloadLevelJson(currentLevelState);
    setEngineLog('File: Exported level state to downloadable .json file.');
  }, [currentLevelState]);

  const handleLoadMapFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          try {
            const parsed = LevelSerializer.parseLevelJson(reader.result);
            handleRestoreLevelState(parsed);
          } catch (err) {
            setEngineLog(
              err instanceof Error
                ? `Error: ${err.message}`
                : 'Error: Failed to parse uploaded JSON map file.'
            );
          }
        }
      };
      reader.readAsText(file);
    },
    [handleRestoreLevelState]
  );

  const handleClearGrid = useCallback(() => {
    recordHistorySnapshot('Clear Grid');
    setGrid((prev) => prev.map((row) => row.map(() => CellType.EMPTY)));
    setEntities([]);
    setResetSignal((n) => n + 1);
    setEngineLog('Editor: Cleared grid and removed all entities.');
  }, [recordHistorySnapshot]);

  const handleResizeMap = useCallback(
    (requestedSize: number) => {
      const size = Math.max(
        ENGINE_CONFIG.MIN_GRID_SIZE,
        Math.min(ENGINE_CONFIG.MAX_GRID_SIZE, Math.trunc(requestedSize))
      );
      if (!Number.isFinite(size) || size === grid.length) return;
      recordHistorySnapshot(`Resize Map to ${size}x${size}`);
      const maxIdx = size - 1;
      setGrid((prev) => resizeSquareMatrix(prev, size, CellType.EMPTY as number));
      setWallTextures((prev) => resizeSquareMatrix(prev, size, 'default-grid'));
      setFloorTextures((prev) =>
        resizeSquareMatrix(prev, size, 'floor-obsidian')
      );
      setCeilingTextures((prev) =>
        resizeSquareMatrix(prev, size, 'ceiling-coffer')
      );
      setEntities((prev) => entitiesFittingGrid(prev, size));
      setSpawn((prev) => ({
        ...prev,
        row: Math.min(prev.row, maxIdx),
        col: Math.min(prev.col, maxIdx),
      }));
      setResetSignal((n) => n + 1);
      setEngineLog(`Editor: Resized map to ${size}x${size}.`);
    },
    [grid.length, recordHistorySnapshot]
  );

  const handleBorderWalls = useCallback(() => {
    recordHistorySnapshot('Build Perimeter Walls');
    setGrid((prev) =>
      prev.map((row, rIdx) =>
        row.map((val, cIdx) => {
          const isEdge =
            rIdx === 0 ||
            rIdx === prev.length - 1 ||
            cIdx === 0 ||
            cIdx === prev.length - 1;
          return isEdge ? CellType.WALL : val;
        })
      )
    );
    setEngineLog('Editor: Generated perimeter walls around map boundary.');
  }, [recordHistorySnapshot]);

  const handleRotateSpawn = useCallback(() => {
    recordHistorySnapshot('Rotate Player Spawn Yaw');
    setSpawn((prev) => ({
      ...prev,
      yaw: (prev.yaw + Math.PI / 2) % (Math.PI * 2),
    }));
  }, [recordHistorySnapshot]);

  const wallCount = useMemo(() => {
    let count = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell === CellType.WALL) count++;
      }
    }
    return count;
  }, [grid]);

  const activeCoord = hoveredCell || selectedCell;
  const nextUndoLabel =
    pastHistory.length > 0
      ? pastHistory[pastHistory.length - 1].actionLabel
      : null;
  const nextRedoLabel =
    futureHistory.length > 0
      ? futureHistory[futureHistory.length - 1].actionLabel
      : null;

  return (
    <div
      className={`ide-shell ${
        isPlayFullscreen ? 'ide-shell--play-fullscreen' : ''
      }`}
    >
      <TopMenuBar
        pastHistoryCount={pastHistory.length}
        futureHistoryCount={futureHistory.length}
        nextUndoLabel={nextUndoLabel}
        nextRedoLabel={nextRedoLabel}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onLoadPreset={handleLoadPreset}
        onSaveMap={handleSaveMap}
        onLoadMapFile={handleLoadMapFile}
        onOpenArchModal={() => setIsArchModalOpen(true)}
        onOpenEventEditor={() => setIsEventEditorOpen(true)}
        isPlayFullscreen={isPlayFullscreen}
        onTogglePlayFullscreen={() => setIsPlayFullscreen((prev) => !prev)}
        onRespawnPlayer={() => setResetSignal((n) => n + 1)}
      />

      {!isPlayFullscreen && (
        <LeftToolPalette
          toolMode={toolMode}
          onSelectTool={(mode) => {
            setToolMode(mode);
            setEngineLog(`Tool: Activated '${mode.toUpperCase()}'.`);
          }}
          pastHistoryCount={pastHistory.length}
          futureHistoryCount={futureHistory.length}
          nextUndoLabel={nextUndoLabel}
          nextRedoLabel={nextRedoLabel}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}

      {/* ====================================================================
          3. MIDDLE RESIZABLE WORKSPACE (2D Map Editor + 3D Viewport)
          ==================================================================== */}
      <main ref={workspaceRef} className="ide-workspace">
        {!isPlayFullscreen && (
          <>
            <div
              style={{ width: `${splitRatioPct}%` }}
              className="h-full min-w-[220px] shrink-0 overflow-hidden"
            >
              <MapEditor2D
                grid={grid}
                wallTextures={wallTextures}
                floorTextures={floorTextures}
                textures={allTextures}
                entities={entities}
                toolMode={toolMode}
                selectedCell={selectedCell}
                onSelectCell={(row, col) => setSelectedCell({ row, col })}
                onStrokeStart={recordHistorySnapshot}
                onCellInteract={handleCellInteract}
                onDropTextureOnCell={handleDropTextureOnCell}
                onDropModelOnCell={handleDropModelOnCell}
                onHoverCellChange={setHoveredCell}
                playerTransform={playerTransform}
                spawn={spawn}
                onClearGrid={handleClearGrid}
                onBorderWalls={handleBorderWalls}
                onDropVariantOnCell={handleDropVariantOnCell}
                allowOverlap={allowOverlap}
                onToggleAllowOverlap={() => setAllowOverlap((prev) => !prev)}
                collectedKeys={collectedKeys}
                openDoors={openDoors}
              />
            </div>

            {/* Draggable Vertical Splitter Bar */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize 2D Map Editor and 3D Viewport"
              onPointerDown={() => setIsDraggingSplitter(true)}
              className={`ide-splitter ${
                isDraggingSplitter ? 'ide-splitter--dragging' : ''
              }`}
            />
          </>
        )}

        {/* 3D First-Person Viewport & Combat Runtime */}
        <div className="flex-1 h-full min-w-[260px] overflow-hidden">
          <Viewport3D
            grid={grid}
            wallTextures={wallTextures}
            floorTextures={floorTextures}
            ceilingTextures={ceilingTextures}
            customTextures={customTextures}
            entities={entities}
            spawn={spawn}
            showCeiling={showCeiling}
            onToggleCeiling={() => setShowCeiling((prev) => !prev)}
            minimapEnabled={minimapEnabled}
            onToggleMinimap={() => setMinimapEnabled((prev) => !prev)}
            isPlayFullscreen={isPlayFullscreen}
            onTogglePlayFullscreen={() => setIsPlayFullscreen((prev) => !prev)}
            skyboxTheme={skyboxTheme}
            skyboxSeed={skyboxSeed}
            playerTransform={playerTransform}
            onPlayerMove={setPlayerTransform}
            simState={simState}
            onSimStateChange={setSimState}
            resetSignal={resetSignal}
            onEngineLog={setEngineLog}
          />
        </div>
      </main>

      {/* ====================================================================
          4. RIGHT PROPERTIES INSPECTOR PANEL (280px wide, grid-area: inspector)
          ==================================================================== */}
      {!isPlayFullscreen && (
        <PropertiesInspector
          selectedCell={selectedCell}
          grid={grid}
          wallTextures={wallTextures}
          floorTextures={floorTextures}
          ceilingTextures={ceilingTextures}
          textures={allTextures}
          selectedTextureId={selectedTextureId}
          onSelectTexture={(id) => {
            setSelectedTextureId(id);
            if (toolMode !== 'paint' && toolMode !== 'toggle') {
              setToolMode('paint');
            }
          }}
          targetSurface={targetSurface}
          onChangeTargetSurface={(surf) => {
            setTargetSurface(surf);
            setToolMode('paint');
          }}
          onAddCustomTexture={(asset) =>
            setCustomTextures((prev) => [...prev, asset])
          }
          onAssignCellTexture={handleAssignCellTextureFromInspector}
          onFillSurfaceWithTexture={handleFillSurfaceWithTexture}
          onSetCellType={handleSetCellType}
          spawn={spawn}
          onSetSpawnCell={(row, col) => {
            recordHistorySnapshot(
              `Move Player Spawn to [X:${col}, Z:${row}]`
            );
            setGrid((prev) => {
              const next = prev.map((r) => [...r]);
              next[row][col] = CellType.EMPTY;
              return next;
            });
            setSpawn((prev) => ({ ...prev, row, col }));
          }}
          onRotateSpawn={handleRotateSpawn}
          entities={entities}
          model3DAssets={allModel3DAssets}
          selectedModelAssetId={selectedModelAssetId}
          onSelectModelAsset={(assetId) => {
            setSelectedModelAssetId(assetId);
            // Picking a library model places it with library settings, not a variant's
            modelLibrary.setSelectedVariant(null);
            setToolMode('entity');
          }}
          onAddCustomModel3DAsset={(asset) => {
            setCustomModel3DAssets((prev) => [
              ...prev.filter((m) => m.id !== asset.id),
              asset,
            ]);
            setSelectedModelAssetId(asset.id);
            setToolMode('entity');
            setEngineLog(
              `Asset Library: Imported 3D model '${asset.name}' — drag it onto any 2D grid cell!`
            );
          }}
          onUpdateEntity={handleUpdateEntity}
          onPlaceEntityAtCell={handlePlaceEntityFromInspector}
          onRemoveEntity={handleRemoveEntity}
          getLibrarySettings={getLibrarySettings}
          skyboxTheme={skyboxTheme}
          onChangeSkyboxTheme={(theme) => {
            setSkyboxTheme(theme);
            if (showCeiling) setShowCeiling(false);
          }}
          skyboxSeed={skyboxSeed}
          onRegenerateSkybox={() => {
            setSkyboxSeed((s) => s + 1);
            if (showCeiling) setShowCeiling(false);
            setEngineLog(`Skybox: Generated procedural seed #${skyboxSeed + 1}.`);
          }}
          showCeiling={showCeiling}
          onToggleCeiling={() => setShowCeiling((prev) => !prev)}
          minimapEnabled={minimapEnabled}
          onToggleMinimap={() => setMinimapEnabled((prev) => !prev)}
          onBorderWalls={handleBorderWalls}
          onClearGrid={handleClearGrid}
          onResizeMap={handleResizeMap}
          libraryState={libraryState}
          onLibraryChange={setLibraryState}
          selectedVariantKey={modelLibrary.selectedVariant?.key ?? null}
          onPickVariant={(variant) => {
            modelLibrary.setSelectedVariant(variant);
            setSelectedModelAssetId(variant.modelAssetId);
            setToolMode('entity');
          }}
          onModelFileUploaded={modelLibrary.handleModelFileUploaded}
          onRemoveUploadedModel={modelLibrary.handleRemoveUploadedModel}
          onExportLibrary={modelLibrary.handleExportLibrary}
          onImportLibraryFile={modelLibrary.handleImportLibraryFile}
        />
      )}

      <BottomStatusBar
        engineLog={engineLog}
        pastHistoryCount={pastHistory.length}
        futureHistoryCount={futureHistory.length}
        activeCoord={activeCoord}
        playerTransform={playerTransform}
        wallCount={wallCount}
        entityCount={entities.length}
      />

      {/* Engine Architecture & JSON State Inspector Modal */}
      <ArchitectureModal
        isOpen={isArchModalOpen}
        onClose={() => setIsArchModalOpen(false)}
        levelState={currentLevelState}
        onImportLevelState={handleRestoreLevelState}
      />

      {/* Phase 4 Visual Event & Trigger Authoring IDE Modal (mounted only while open so each open starts from fresh level data) */}
      {isEventEditorOpen && <EventTriggerEditorModal
        isOpen={isEventEditorOpen}
        onClose={() => setIsEventEditorOpen(false)}
        events={simState.events}
        regions={simState.regions}
        variables={{
          flags: simState.flags,
          counters: simState.counters,
          timers: Object.keys(simState.timers),
        }}
        grid={grid}
        gridSize={grid.length}
        onSaveLevelData={handleSaveLevelDataFromEditor}
      />}
    </div>
  );
}
