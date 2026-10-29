/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ============================================================================
 * GRIDFORGE 3D GAME CREATION SYSTEM — DESKTOP GAME ENGINE IDE SHELL (PHASE 1, 2 & 3)
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
  CampaignSettings,
  CellType,
  DEFAULT_CAMPAIGN_SETTINGS,
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
import { CollisionSystem } from './runtime/CollisionSystem';
import { TextureGenerator } from './runtime/TextureGenerator';
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
} from './runtime/sim';
import {
  DesignStateSnapshot,
  HistoryManager,
  MAX_HISTORY_DEPTH,
} from './engine/HistoryManager';
import { MapEditor2D } from './components/MapEditor2D';
import { Viewport3D } from './components/Viewport3D';
import { EditorViewport3D, SurfaceDrop } from './components/EditorViewport3D';
import { LayerBar } from './components/LayerBar';
import type { ModelBounds, SurfaceHit } from './editor3d/EditorScene';
import {
  EditorLayerData,
  VerticalLevelData,
  cloneVerticalData,
  createDefaultVerticalData,
  createSolidLayer,
  isFlatVerticalData,
  resizeVerticalData,
} from './runtime/types';
import { LAYER_METERS, entityAnchorWorld } from './runtime/entityPlacement';
import { editorVerticalFeatures } from './runtime/verticalLevelData';
import {
  CardinalDirection,
  FloorSlopeSpec,
  MovementSettingsSpec,
  SIM_CONFIG,
  SlopeSurface,
  WalkSurfaceSpec,
} from './runtime/sim';
import { PropertiesInspector } from './components/PropertiesInspector';
import { ArchitectureModal } from './components/ArchitectureModal';
import { EventTriggerEditorModal } from './components/EventTriggerEditorModal';
import { ExportModal } from './components/ide/ExportModal';
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
import {
  entitiesFittingGrid,
  findPlacementConflicts,
  getEntitiesCoveringCell,
  getEntityRect,
  remapEntityModelIds,
  removeModelCopies,
} from './engine/modelLibrary/placement';
import { EntityLoader } from './runtime/EntityLoader';

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

  // Stacked layers, tile heights, slopes and movement settings. The ground layer's grid
  // and textures stay in the states above; every layer above it lives in `vertical.layers`.
  const [vertical, setVertical] = useState<VerticalLevelData>(() =>
    createDefaultVerticalData(initialPreset.grid.length)
  );
  // Classic retro movement: one flat floor, so the vertical tools are switched off
  const classic = Boolean(vertical.classic);
  const classicRef = useRef(classic);
  classicRef.current = classic;
  const [activeLayer, setActiveLayer] = useState<number>(0);
  const activeLayerRef = useRef(activeLayer);
  activeLayerRef.current = activeLayer;
  useEffect(() => {
    if (activeLayer > vertical.layers.length) setActiveLayer(vertical.layers.length);
  }, [activeLayer, vertical.layers.length]);

  // The center pane starts as the 3D editor; Test Play turns it into the game
  const [viewMode, setViewMode] = useState<'edit' | 'play'>('edit');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Height and slope tool settings (sim units: 1000 = one layer = 4 m)
  const [heightTarget, setHeightTarget] = useState<'floor' | 'ceiling'>('floor');
  const [heightStep, setHeightStep] = useState<number>(125);
  const [heightRaise, setHeightRaise] = useState<boolean>(true);

  /**
   * Setters for one matrix of the layer being edited: the ground layer's own state, or the
   * matching matrix of a stacked layer inside `vertical`.
   */
  type LayerMatrixKey = 'grid' | 'wallTextures' | 'floorTextures' | 'ceilingTextures';
  const routeToActiveLayer = useCallback(
    <T,>(key: LayerMatrixKey, setGround: React.Dispatch<React.SetStateAction<T[][]>>) =>
      (updater: (prev: T[][]) => T[][]) => {
        const layer = activeLayerRef.current;
        if (layer === 0) {
          setGround(updater);
          return;
        }
        setVertical((v) => {
          const target = v.layers[layer - 1];
          if (!target) return v;
          const before = target[key] as unknown as T[][];
          const after = updater(before);
          if (after === before) return v;
          const layers = [...v.layers];
          layers[layer - 1] = { ...target, [key]: after };
          return { ...v, layers };
        });
      },
    []
  );
  const setActiveGrid = useMemo(
    () => routeToActiveLayer<number>('grid', setGrid),
    [routeToActiveLayer]
  );
  const setActiveWallTextures = useMemo(
    () => routeToActiveLayer<string>('wallTextures', setWallTextures),
    [routeToActiveLayer]
  );
  const setActiveFloorTextures = useMemo(
    () => routeToActiveLayer<string>('floorTextures', setFloorTextures),
    [routeToActiveLayer]
  );
  const setActiveCeilingTextures = useMemo(
    () => routeToActiveLayer<string>('ceilingTextures', setCeilingTextures),
    [routeToActiveLayer]
  );

  /** The layer being edited, with every field filled in (layer 0 reads the top-level state) */
  const activeLayerData: EditorLayerData = useMemo(
    () =>
      activeLayer === 0 || !vertical.layers[activeLayer - 1]
        ? {
            grid,
            wallTextures,
            floorTextures,
            ceilingTextures,
            floorHeights: vertical.floorHeights,
            ceilingHeights: vertical.ceilingHeights,
            slopes: vertical.slopes,
          }
        : vertical.layers[activeLayer - 1],
    [activeLayer, grid, wallTextures, floorTextures, ceilingTextures, vertical]
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

  const [gitHubRepoInput, setGitHubRepoInput] = useState<string>(() =>
    AssetFolderLoader.getSavedGitHubRepoInput()
  );
  const [isSyncingGitHubAssets, setIsSyncingGitHubAssets] =
    useState<boolean>(false);
  const [gitHubAssetsStats, setGitHubAssetsStats] = useState<{
    repoLabel: string;
    textures: number;
    models: number;
    error?: string;
  }>(() => AssetFolderLoader.getBundledGitHubAssetsStats());

  const handleSyncGitHubAssets = useCallback(
    async (repoToLoad: string, forceRefresh = false) => {
      const targetRepo = repoToLoad.trim() || AssetFolderLoader.getSavedGitHubRepoInput();
      setIsSyncingGitHubAssets(true);
      const res = await AssetFolderLoader.fetchGitHubRepoAssets(targetRepo, {
        forceRefresh,
      });
      setIsSyncingGitHubAssets(false);

      if (res.error || !res.spec) {
        const errMsg = res.error || 'Could not load GitHub assets repository.';
        setGitHubAssetsStats((prev) => ({
          ...prev,
          repoLabel: targetRepo,
          error: errMsg,
        }));
        setEngineLog(`GitHub Assets: ${errMsg}`);
        return;
      }

      const repoLabel = `${res.spec.owner}/${res.spec.repo}@${res.spec.branch}`;
      AssetFolderLoader.setSavedGitHubRepoInput(repoLabel);
      setGitHubRepoInput(repoLabel);

      for (const t of res.textures) AssetRegistry.registerTexture(t);
      for (const m of res.models) AssetRegistry.registerModel(m);

      if (res.textures.length > 0) {
        setCustomTextures((prev) => {
          const byId = new Map(prev.map((t) => [t.id, t]));
          for (const t of res.textures) byId.set(t.id, t);
          return [...byId.values()];
        });
      }
      if (res.models.length > 0) {
        setCustomModel3DAssets((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          for (const m of res.models) byId.set(m.id, m);
          return [...byId.values()];
        });
      }

      setGitHubAssetsStats({
        repoLabel,
        textures: res.textures.length,
        models: res.models.length,
      });
      setEngineLog(
        `GitHub Assets: Loaded ${res.textures.length} textures & ${res.models.length} 3D models from ${repoLabel}${
          res.fromCache ? ' (cached)' : ''
        }.`
      );
    },
    []
  );

  // Load any external assets listed in /public/assets/manifest.json and the GitHub Assets repo on mount
  useEffect(() => {
    let active = true;
    AssetFolderLoader.fetchPublicManifestAssets().then((manifestAssets) => {
      if (!active) return;
      if (manifestAssets.textures.length > 0) {
        for (const t of manifestAssets.textures) AssetRegistry.registerTexture(t);
        setCustomTextures((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const fresh = manifestAssets.textures.filter(
            (t) => !existingIds.has(t.id)
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
      if (manifestAssets.models.length > 0) {
        for (const m of manifestAssets.models) AssetRegistry.registerModel(m);
        setCustomModel3DAssets((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const fresh = manifestAssets.models.filter(
            (m) => !existingIds.has(m.id)
          );
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
    });
    const savedRepo = AssetFolderLoader.getSavedGitHubRepoInput();
    const bundledRepo = AssetFolderLoader.getBundledGitHubAssetsStats().repoLabel;
    if (
      savedRepo.toLowerCase() !== bundledRepo.toLowerCase() &&
      `${savedRepo.toLowerCase()}@main` !== bundledRepo.toLowerCase()
    ) {
      void handleSyncGitHubAssets(savedRepo, false);
    }
    return () => {
      active = false;
    };
  }, [handleSyncGitHubAssets]);

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
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [engineLog, setEngineLog] = useState<string>(
    'Ready — Click 2D grid to sculpt level (Ctrl+Z Undo / Ctrl+Y Redo) or click 3D viewport to fire.'
  );

  // --------------------------------------------------------------------------
  // 4B. MULTI-LEVEL CAMPAIGN STATE & CARRY-OVER SETTINGS
  // --------------------------------------------------------------------------
  const [levelTitle, setLevelTitle] = useState<string>(
    () => initialPreset.name || 'Level 1'
  );
  const [campaignSettings, setCampaignSettings] = useState<CampaignSettings>(
    () => ({ ...DEFAULT_CAMPAIGN_SETTINGS })
  );
  const [activeLevelIndex, setActiveLevelIndex] = useState<number>(0);
  const [campaignLevels, setCampaignLevels] = useState<LevelStateData[]>(() => [
    LevelSerializer.serializeLevel({
      title: initialPreset.name || 'Level 1',
      grid: initialPreset.grid.map((r) => [...r]),
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
      customTextures: [],
      entities: initialPreset.entities
        ? initialPreset.entities.map((e) => ({ ...e }))
        : [],
      nextEntityId: computeNextEntityId(initialPreset.entities || []),
      spawn: { ...initialPreset.spawn },
      skyboxTheme: 'retro-nebula',
      skyboxSeed: 1,
      showCeiling: false,
      minimapEnabled: true,
      events: initialPreset.events || [],
      regions: initialPreset.regions || [],
      variables: initialPreset.variables,
    }),
  ]);

  // Global model library (folders, tags, per-model settings) shared by every level
  const handleRestoredUploads = useCallback((restored: Model3DAsset[]) => {
    setCustomModel3DAssets((prev) => {
      const restoredIds = new Set(restored.map((m) => m.id));
      return [...prev.filter((m) => !restoredIds.has(m.id)), ...restored];
    });
  }, []);
  // Deleting a model is permanent: its copies leave the level and the undo / redo steps
  const handleRemoveModelAsset = useCallback((modelId: string) => {
    const removeCopies = (snaps: DesignStateSnapshot[]) =>
      snaps.map((snap) => ({ ...snap, entities: removeModelCopies(snap.entities, modelId) }));
    setCustomModel3DAssets((prev) => prev.filter((m) => m.id !== modelId));
    setEntities((prev) => removeModelCopies(prev, modelId));
    setPastHistory(removeCopies);
    setFutureHistory(removeCopies);
    AssetRegistry.removeModelFile(modelId);
  }, []);
  // Placed copies (and undo / redo steps) follow stored models that moved to new ids
  const handleModelIdsRenamed = useCallback((renamed: Record<string, string>) => {
    const remapSnapshots = (snaps: DesignStateSnapshot[]) =>
      snaps.map((snap) => ({ ...snap, entities: remapEntityModelIds(snap.entities, renamed) }));
    setEntities((prev) => remapEntityModelIds(prev, renamed));
    setPastHistory(remapSnapshots);
    setFutureHistory(remapSnapshots);
    setSelectedModelAssetId((prev) => renamed[prev] ?? prev);
  }, []);
  const modelLibrary = useModelLibrary({
    models: allModel3DAssets,
    onLog: setEngineLog,
    onRestoredUploads: handleRestoredUploads,
    onRemoveModel: handleRemoveModelAsset,
    onModelIdsRenamed: handleModelIdsRenamed,
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
        (!asset.customGlbUrl && !AssetRegistry.getModelFile(asset.id)) ||
        measuredAttemptsRef.current.has(asset.id)
      ) {
        continue;
      }
      // Remote folder models without precomputed model-sizes.json measure only when selected
      if (asset.id.startsWith('folder-glb-') && asset.id !== selectedModelAssetId) {
        continue;
      }
      const settings = resolveModelSettings(libraryState, asset);
      if (getCategoryInfo(settings.category).sizing !== 'real' || settings.measuredSizeMeters) {
        continue;
      }
      measuredAttemptsRef.current.add(asset.id);
      EntityLoader.measureModelSize(asset).then((size) => {
        if (!size) return;
        setLibraryState((prev) =>
          setModelSettings(prev, asset.id, {
            measuredSizeMeters: { width: size.width, depth: size.depth },
          })
        );
      });
    }
  }, [allModel3DAssets, libraryState, setLibraryState, selectedModelAssetId]);

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
    vertical,
    actionLabel: 'Initial State',
  });
  currentDesignRef.current = {
    grid,
    wallTextures,
    floorTextures,
    ceilingTextures,
    entities,
    spawn,
    vertical,
    actionLabel: 'Current State',
  };

  /** The matrices of the layer being edited, read synchronously from the latest design */
  const getActiveLayerSnapshot = (): EditorLayerData => {
    const d = currentDesignRef.current;
    const layer = activeLayerRef.current;
    const v = d.vertical!;
    return layer === 0 || !v.layers[layer - 1]
      ? {
          grid: d.grid,
          wallTextures: d.wallTextures,
          floorTextures: d.floorTextures,
          ceilingTextures: d.ceilingTextures,
          floorHeights: v.floorHeights,
          ceilingHeights: v.ceilingHeights,
          slopes: v.slopes,
        }
      : v.layers[layer - 1];
  };
  /** Placed models on the layer being edited */
  const onActiveLayer = (e: PlacedEntity) => (e.layer ?? 0) === activeLayerRef.current;

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
    if (restored.vertical) setVertical(restored.vertical);

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
    if (restored.vertical) setVertical(restored.vertical);

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
        setActiveWallTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
      } else if (surface === 'floor') {
        setActiveFloorTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
      } else if (surface === 'ceiling') {
        setActiveCeilingTextures((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = texId;
          return next;
        });
        setShowCeiling(true);
      }
    },
    [setActiveWallTextures, setActiveFloorTextures, setActiveCeilingTextures]
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
        setActiveGrid((prev) => {
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
    [allTextures, recordHistorySnapshot, targetSurface, applyTextureToCell, setActiveGrid]
  );

  const handleFillSurfaceWithTexture = useCallback(
    (surface: SurfaceTarget, texId: string) => {
      recordHistorySnapshot(`Fill all ${surface}s with '${texId}'`);
      if (surface === 'wall') {
        setActiveWallTextures((prev) => createUniformTextureMatrix(texId, prev.length));
      } else if (surface === 'floor') {
        setActiveFloorTextures((prev) => createUniformTextureMatrix(texId, prev.length));
      } else if (surface === 'ceiling') {
        setActiveCeilingTextures((prev) =>
          createUniformTextureMatrix(texId, prev.length)
        );
        setShowCeiling(true);
      }
      setEngineLog(`Assets: Applied texture '${texId}' to all ${surface} cells.`);
    },
    [recordHistorySnapshot, setActiveWallTextures, setActiveFloorTextures, setActiveCeilingTextures]
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
      settingsOverride?: ModelSettings,
      surfaceDrop?: SurfaceDrop
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
        ...(activeLayerRef.current > 0 ? { layer: activeLayerRef.current } : {}),
      };

      if (surfaceDrop) {
        // Dropped in the 3D view: stick to the surface under the mouse, turned to face out of it
        const { hit, point } = surfaceDrop;
        const gridSize = currentDesignRef.current.grid.length;
        newEntity.layer = hit.layer;
        if (hit.surface === 'wall') {
          newEntity.yaw = Math.atan2(hit.normal.x, hit.normal.z);
        } else if (hit.surface === 'ceiling') {
          newEntity.roll = Math.PI;
        }
        // Anchor the footprint on the tile in front of the surface, then offset to the exact point
        const rect = getEntityRect(newEntity);
        const w = rect.col1 - rect.col0 + 1;
        const d = rect.row1 - rect.row0 + 1;
        newEntity.col = Math.max(0, Math.min(gridSize - w, hit.col - Math.floor((w - 1) / 2)));
        newEntity.row = Math.max(0, Math.min(gridSize - d, hit.row - Math.floor((d - 1) / 2)));
        if (classicRef.current) {
          // Classic retro levels place models on their tile, standing on the one floor
          delete newEntity.layer;
          delete newEntity.roll;
        } else {
          const anchor = entityAnchorWorld(newEntity, gridSize);
          newEntity.offsetX = Math.round((point.x - anchor.x) * 1000) / 1000;
          newEntity.offsetZ = Math.round((point.z - anchor.z) * 1000) / 1000;
          newEntity.elevation = Math.round((point.y - hit.layer * LAYER_METERS) * 1000) / 1000;
        }
      } else {
        const layerSnapshot = getActiveLayerSnapshot();
        const currentEntities = currentDesignRef.current.entities.filter(onActiveLayer);
        const reasons = findPlacementConflicts(layerSnapshot.grid, currentEntities, newEntity);
        if (
          reasons.includes('off the map edge') ||
          (!allowOverlapRef.current && reasons.length > 0)
        ) {
          setEngineLog(`Placement blocked: ${reasons.join('; ')}`);
          return false;
        }
      }

      nextEntityIdRef.current = allocatedIdNum + 1;
      setNextEntityId(allocatedIdNum + 1);
      setEntities((prev) => [...prev, newEntity]);
      setSelectedEntityId(newEntity.id);
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
      if (!source) {
        setEngineLog('Placement blocked: that variant is no longer in the level.');
        return;
      }
      if (!asset) {
        setEngineLog(`Placement blocked: '${source.name}' uses a model that is not in this library.`);
        return;
      }
      setSelectedCell({ row, col });
      const placed = placeEntityAtCell(row, col, asset, {
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
      if (placed) {
        recordHistorySnapshot(`Place '${source.name}' variant at [X:${col}, Z:${row}]`);
      }
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

      setSelectedCell({ row, col });
      setSelectedModelAssetId(modelAsset.id);
      // The snapshot still captures the pre-drop design (state updates apply on the next render)
      if (!placeEntityAtCell(row, col, modelAsset)) return;
      recordHistorySnapshot(
        `Drop 3D Model '${modelAsset.name}' at [X:${col}, Z:${row}]`
      );
      setEngineLog(
        `Asset Library Drop: Spawned 3D model '${modelAsset.name}' at [X:${col}, Z:${row}].`
      );
    },
    [allModel3DAssets, recordHistorySnapshot, placeEntityAtCell]
  );

  const handlePlaceEntityFromInspector = useCallback(
    (row: number, col: number) => {
      if (placeEntityAtCell(row, col)) {
        recordHistorySnapshot(`Spawn Entity at [X:${col}, Z:${row}]`);
      }
    },
    [recordHistorySnapshot, placeEntityAtCell]
  );

  /**
   * Completely clears whatever is on cell `[row, col]`:
   *  - Any placed 3D object / prop / NPC / enemy covering `[row, col]`
   *  - Any wall, door, or keycard in `grid[row][col]`
   *  - Any custom floor, wall, or ceiling texture assigned to `[row, col]`
   */
  const handleEraseCell = useCallback((row: number, col: number) => {
    const currentDesign = getActiveLayerSnapshot();
    const prevCell = currentDesign.grid[row]?.[col] ?? CellType.EMPTY;
    const coveringEntities = getEntitiesCoveringCell(
      currentDesignRef.current.entities.filter(onActiveLayer),
      row,
      col
    );
    const prevFloorTex = currentDesign.floorTextures[row]?.[col];
    const prevWallTex = currentDesign.wallTextures[row]?.[col];
    const prevCeilTex = currentDesign.ceilingTextures[row]?.[col];

    setActiveGrid((prev) => {
      if (prev[row]?.[col] === CellType.EMPTY) return prev;
      const next = prev.map((r) => [...r]);
      next[row][col] = CellType.EMPTY;
      return next;
    });

    setEntities((ents) => {
      const coveringIds = new Set(
        getEntitiesCoveringCell(ents.filter(onActiveLayer), row, col).map((e) => e.id)
      );
      if (coveringIds.size === 0) return ents;
      return ents.filter((e) => !coveringIds.has(e.id));
    });

    setActiveFloorTextures((prev) => {
      if (!prev[row] || prev[row][col] === 'floor-obsidian') return prev;
      const next = prev.map((r) => [...r]);
      next[row][col] = 'floor-obsidian';
      return next;
    });

    setActiveWallTextures((prev) => {
      if (!prev[row] || prev[row][col] === 'default-grid') return prev;
      const next = prev.map((r) => [...r]);
      next[row][col] = 'default-grid';
      return next;
    });

    setActiveCeilingTextures((prev) => {
      if (!prev[row] || prev[row][col] === 'ceiling-coffer') return prev;
      const next = prev.map((r) => [...r]);
      next[row][col] = 'ceiling-coffer';
      return next;
    });

    const removedItems: string[] = [];
    if (coveringEntities.length > 0) {
      removedItems.push(coveringEntities.map((e) => `'${e.name}'`).join(', '));
    }
    if (prevCell === CellType.WALL) removedItems.push('Wall');
    else if (prevCell === CellType.DOOR) removedItems.push('Door');
    else if (prevCell === CellType.KEY) removedItems.push('Keycard');
    if (prevFloorTex && prevFloorTex !== 'floor-obsidian') {
      removedItems.push(`Floor (${prevFloorTex})`);
    }
    if (
      prevWallTex &&
      prevWallTex !== 'default-grid' &&
      prevCell !== CellType.WALL
    ) {
      removedItems.push(`Wall Tex (${prevWallTex})`);
    }
    if (prevCeilTex && prevCeilTex !== 'ceiling-coffer') {
      removedItems.push(`Ceiling (${prevCeilTex})`);
    }

    if (removedItems.length > 0) {
      setEngineLog(
        `Erase: Removed ${removedItems.join(' + ')} at [X:${col}, Z:${row}].`
      );
    } else {
      setEngineLog(`Erase: Cleared cell [X:${col}, Z:${row}].`);
    }
  }, [setActiveGrid, setActiveWallTextures, setActiveFloorTextures, setActiveCeilingTextures]);

  /** Changes the floor/ceiling heights or slopes of one layer */
  const updateLayerHeights = useCallback(
    (
      layer: number,
      edit: (cur: Pick<EditorLayerData, 'floorHeights' | 'ceilingHeights' | 'slopes'>) => Partial<
        Pick<EditorLayerData, 'floorHeights' | 'ceilingHeights' | 'slopes'>
      >
    ) => {
      setVertical((v) => {
        if (layer === 0) return { ...v, ...edit(v) };
        const target = v.layers[layer - 1];
        if (!target) return v;
        const layers = [...v.layers];
        layers[layer - 1] = { ...target, ...edit(target) };
        return { ...v, layers };
      });
    },
    []
  );

  /** Height tool: raises or lowers the floor or ceiling of a tile by one step */
  const adjustTileHeight = useCallback(
    (row: number, col: number) => {
      const layer = activeLayerRef.current;
      const delta = heightRaise ? heightStep : -heightStep;
      const minFloor = layer === 0 ? SIM_CONFIG.MIN_FLOOR_HEIGHT_UNITS : 0;
      const LAYER = SIM_CONFIG.LAYER_HEIGHT_UNITS;
      updateLayerHeights(layer, (cur) => {
        const floors = cur.floorHeights.map((r) => [...r]);
        const ceilings = cur.ceilingHeights.map((r) => [...r]);
        if (heightTarget === 'floor') {
          floors[row][col] = Math.max(minFloor, Math.min(ceilings[row][col] - 100, floors[row][col] + delta));
        } else {
          ceilings[row][col] = Math.max(floors[row][col] + 100, Math.min(LAYER, ceilings[row][col] + delta));
        }
        return { floorHeights: floors, ceilingHeights: ceilings };
      });
      setEngineLog(
        `Height: ${heightRaise ? 'Raised' : 'Lowered'} the ${heightTarget} at [X:${col}, Z:${row}] by ${(heightStep * ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS).toFixed(2)} m.`
      );
    },
    [heightRaise, heightStep, heightTarget, updateLayerHeights]
  );

  /**
   * Slope tool: turns a tile's floor (or ceiling, per the Floor/Ceiling setting) slope through
   * none, N, E, S, W; it rises by one height step
   */
  const cycleTileSlope = useCallback(
    (row: number, col: number) => {
      const order: (CardinalDirection | null)[] = [null, 'N', 'E', 'S', 'W'];
      const layer = activeLayerRef.current;
      const surface = heightTarget;
      const isThis = (sl: FloorSlopeSpec) =>
        sl.row === row && sl.col === col && (sl.surface ?? 'floor') === surface;
      let label = 'flat';
      updateLayerHeights(layer, (cur) => {
        const existing = cur.slopes.find(isThis);
        const nextDir = order[(order.indexOf(existing?.dir ?? null) + 1) % order.length];
        const others = cur.slopes.filter((sl) => !isThis(sl));
        label = nextDir ? `rising to the ${nextDir}` : 'flat';
        const riseUnits = Math.min(SIM_CONFIG.MAX_SLOPE_RISE_UNITS, heightStep);
        return {
          slopes: nextDir
            ? [
                ...others,
                { row, col, dir: nextDir, riseUnits, ...(surface === 'ceiling' ? { surface } : {}) },
              ]
            : others,
        };
      });
      setEngineLog(`Slope: The ${surface} of tile [X:${col}, Z:${row}] is now ${label}.`);
    },
    [heightStep, heightTarget, updateLayerHeights]
  );

  /**
   * Invoked by 2D Map Editor cells (where `onStrokeStart` has already recorded
   * the pre-stroke snapshot onto the Undo stack).
   */
  const handleCellInteract = useCallback(
    (row: number, col: number, forceValue?: number) => {
      if (toolMode === 'spawn') {
        setActiveGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.EMPTY;
          return next;
        });
        setSpawn((prev) => ({ ...prev, row, col }));
        setVertical((v) =>
          v.spawnLayer === activeLayerRef.current ? v : { ...v, spawnLayer: activeLayerRef.current }
        );
        setEngineLog(`Spawn: Relocated Player Spawn to [X:${col}, Z:${row}].`);
        return;
      }

      if (toolMode === 'entity') {
        const activeAsset =
          allModel3DAssets.find((m) => m.id === selectedModelAssetId) ||
          allModel3DAssets[0];

        // Clicking a cell covered by the active model removes that copy
        const existingAtCell = activeAsset
          ? getEntitiesCoveringCell(entities.filter(onActiveLayer), row, col).find(
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

      if (classicRef.current && (toolMode === 'height' || toolMode === 'slope' || toolMode === 'hole')) {
        setEngineLog('Classic retro movement keeps one flat floor (World tab).');
        return;
      }
      if (toolMode === 'height') {
        adjustTileHeight(row, col);
        return;
      }
      if (toolMode === 'slope') {
        cycleTileSlope(row, col);
        return;
      }
      if (toolMode === 'hole') {
        setActiveGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = prev[row][col] === CellType.HOLE ? CellType.EMPTY : CellType.HOLE;
          return next;
        });
        setEngineLog(
          activeLayerRef.current === 0
            ? `Hole: Toggled a bottomless pit at [X:${col}, Z:${row}] (falling in kills the player).`
            : `Hole: Toggled an opening to the layer below at [X:${col}, Z:${row}].`
        );
        return;
      }

      if (toolMode === 'paint') {
        if (targetSurface === 'wall') {
          setActiveGrid((prev) => {
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

      const currentCellVal = getActiveLayerSnapshot().grid[row]?.[col];

      if (toolMode === 'toggle') {
        const nextVal =
          forceValue !== undefined
            ? forceValue
            : currentCellVal === CellType.WALL
            ? CellType.EMPTY
            : CellType.WALL;
        setActiveGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = nextVal;
          return next;
        });
        if (nextVal === CellType.WALL && targetSurface === 'wall') {
          applyTextureToCell(row, col, 'wall', selectedTextureId);
        }
      } else if (toolMode === 'wall') {
        setActiveGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] = CellType.WALL;
          return next;
        });
        applyTextureToCell(row, col, 'wall', selectedTextureId);
      } else if (toolMode === 'empty') {
        handleEraseCell(row, col);
      } else if (toolMode === 'door') {
        setActiveGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[row][col] =
            prev[row][col] === CellType.DOOR ? CellType.EMPTY : CellType.DOOR;
          return next;
        });
      } else if (toolMode === 'key') {
        setActiveGrid((prev) => {
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
      handleEraseCell,
      setActiveGrid,
      adjustTileHeight,
      cycleTileSlope,
    ]
  );

  const handleSetCellType = useCallback(
    (row: number, col: number, cellType: CellType) => {
      recordHistorySnapshot(
        `Set cell [X:${col}, Z:${row}] to type ${cellType}`
      );
      setActiveGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = cellType;
        return next;
      });
      setEngineLog(
        `Inspector: Set cell [X:${col}, Z:${row}] to type ${cellType}.`
      );
    },
    [recordHistorySnapshot, setActiveGrid]
  );

  const handleUpdateEntity = useCallback(
    (updatedIn: PlacedEntity) => {
      let updated = updatedIn;
      // Moving, rotating or resizing a footprint must still fit (and not overlap while overlap is off)
      const { entities: currentEntities } = currentDesignRef.current;
      const currentGrid = getActiveLayerSnapshot().grid;
      const previous = currentEntities.find((e) => e.id === updated.id);
      const placedIn3D = updated.elevation !== undefined || (updated.layer ?? 0) > 0;
      // A walkable model's baked shape is in world space: moving it means baking again
      if (
        previous &&
        updated.walkable &&
        updated.walkSurface &&
        updated.walkSurface === previous.walkSurface &&
        JSON.stringify([previous.row, previous.col, previous.layer, previous.offsetX, previous.offsetZ, previous.elevation, previous.yaw, previous.pitch, previous.roll, previous.scale]) !==
          JSON.stringify([updated.row, updated.col, updated.layer, updated.offsetX, updated.offsetZ, updated.elevation, updated.yaw, updated.pitch, updated.roll, updated.scale])
      ) {
        updated = { ...updated, walkSurface: undefined };
      }
      if (
        previous &&
        !placedIn3D &&
        JSON.stringify(getEntityRect(previous)) !== JSON.stringify(getEntityRect(updated))
      ) {
        const reasons = findPlacementConflicts(
          currentGrid,
          currentEntities.filter(onActiveLayer),
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

  /** Builds a single-level snapshot of the currently active editor state (without nested `levels`). */
  const buildActiveSingleLevelState = useCallback(
    (titleOverride?: string): LevelStateData => {
      const usedTexIds = new Set<string>();
      for (const row of wallTextures) for (const id of row) usedTexIds.add(id);
      for (const row of floorTextures) for (const id of row) usedTexIds.add(id);
      for (const row of ceilingTextures) for (const id of row) usedTexIds.add(id);
      for (const layer of vertical.layers) {
        for (const m of [
          layer.wallTextures,
          layer.floorTextures,
          layer.ceilingTextures,
        ]) {
          for (const row of m) for (const id of row) usedTexIds.add(id);
        }
      }
      const levelCustomTextures = customTextures.filter(
        (t) => !t.fromProject || usedTexIds.has(t.id)
      );
      return LevelSerializer.serializeLevel({
        title: titleOverride ?? levelTitle,
        grid,
        wallTextures,
        floorTextures,
        ceilingTextures,
        customTextures: levelCustomTextures,
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
        vertical:
          isFlatVerticalData(vertical) && !vertical.classic
            ? undefined
            : vertical,
      });
    },
    [
      levelTitle,
      vertical,
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

  /** Returns the full `campaignLevels` array with `activeLevelIndex` synced to the live editor state. */
  const getSyncedCampaignLevels = useCallback(
    (titleOverride?: string): LevelStateData[] => {
      const activeSnap = buildActiveSingleLevelState(titleOverride);
      if (campaignLevels.length === 0) return [activeSnap];
      const clampedIdx = Math.max(
        0,
        Math.min(campaignLevels.length - 1, activeLevelIndex)
      );
      return campaignLevels.map((lvl, idx) =>
        idx === clampedIdx ? activeSnap : lvl
      );
    },
    [buildActiveSingleLevelState, campaignLevels, activeLevelIndex]
  );

  /** Loads a single `LevelStateData` into the live editor React states. */
  const applySingleLevelToEditor = useCallback(
    (
      state: LevelStateData,
      targetIndex: number,
      options?: {
        preserveSimState?: SimulationState;
        resetUndoStacks?: boolean;
      }
    ) => {
      const nextGrid = state.grid.map((r) => [...r]);
      const nextWallTex = state.wallTextures.map((r) => [...r]);
      const nextFloorTex = state.floorTextures.map((r) => [...r]);
      const nextCeilTex = state.ceilingTextures.map((r) => [...r]);
      const restoredEnts = state.entities.map((e) => ({ ...e }));
      const restoredVertical = state.vertical
        ? cloneVerticalData(state.vertical)
        : createDefaultVerticalData(nextGrid.length);

      setLevelTitle(state.title || `Level ${targetIndex + 1}`);
      setGrid(nextGrid);
      setWallTextures(nextWallTex);
      setFloorTextures(nextFloorTex);
      setCeilingTextures(nextCeilTex);
      if (state.customTextures && state.customTextures.length > 0) {
        setCustomTextures((prev) => {
          const byId = new Map(prev.map((t) => [t.id, t]));
          for (const t of state.customTextures) byId.set(t.id, t);
          return [...byId.values()];
        });
      }
      setEntities(restoredEnts);
      setNextEntityId(computeNextEntityId(restoredEnts, state.nextEntityId));
      setSpawn({ ...state.spawn });
      setVertical(restoredVertical);
      setActiveLayer(0);
      setSelectedEntityId(null);
      setSkyboxTheme(state.skybox.theme);
      setSkyboxSeed(state.skybox.seed);
      setShowCeiling(state.skybox.showCeiling);
      if (typeof state.minimapEnabled === 'boolean') {
        setMinimapEnabled(state.minimapEnabled);
      }
      setActiveLevelIndex(targetIndex);

      if (options?.resetUndoStacks) {
        setPastHistory([]);
        setFutureHistory([]);
      }

      if (options?.preserveSimState) {
        setSimState(options.preserveSimState);
      } else {
        const restoredV3 = LevelSerializer.serializeLevelV3({
          title: state.title || `Level ${targetIndex + 1}`,
          grid: nextGrid,
          wallTextures: nextWallTex,
          floorTextures: nextFloorTex,
          ceilingTextures: nextCeilTex,
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
          vertical: restoredVertical,
        });
        setSimState(createInitialSimulationState(restoredV3, [0]));
        setResetSignal((n) => n + 1);
      }
    },
    []
  );

  const handleSelectCampaignLevel = useCallback(
    (targetIndex: number) => {
      const synced = getSyncedCampaignLevels();
      if (targetIndex < 0 || targetIndex >= synced.length) return;
      if (targetIndex === activeLevelIndex) return;
      setCampaignLevels(synced);
      const targetLevel = synced[targetIndex];
      applySingleLevelToEditor(targetLevel, targetIndex, {
        resetUndoStacks: true,
      });
      setEngineLog(
        `Campaign: Switched editor to Level ${targetIndex + 1}/${synced.length} ('${
          targetLevel.title || `Level ${targetIndex + 1}`
        }').`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex, applySingleLevelToEditor]
  );

  const handleRenameCampaignLevel = useCallback((nextTitle: string) => {
    setLevelTitle(nextTitle);
    setCampaignLevels((prev) =>
      prev.map((lvl, idx) =>
        idx === activeLevelIndex ? { ...lvl, title: nextTitle } : lvl
      )
    );
  }, [activeLevelIndex]);

  const handleAddCampaignLevel = useCallback(() => {
    const synced = getSyncedCampaignLevels();
    const newIndex = synced.length;
    const newTitle = `Level ${newIndex + 1}: Sector ${newIndex + 1}`;
    const size = 16;
    const freshGrid: number[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) =>
        r === 0 || r === size - 1 || c === 0 || c === size - 1
          ? CellType.WALL
          : CellType.EMPTY
      )
    );
    const freshLevel = LevelSerializer.serializeLevel({
      title: newTitle,
      grid: freshGrid,
      wallTextures: createUniformTextureMatrix('default-grid', size),
      floorTextures: createUniformTextureMatrix('floor-obsidian', size),
      ceilingTextures: createUniformTextureMatrix('ceiling-coffer', size),
      customTextures: [],
      entities: [],
      nextEntityId: 1,
      spawn: { row: Math.floor(size / 2), col: Math.floor(size / 2), yaw: 0 },
      skyboxTheme,
      skyboxSeed: skyboxSeed + 1,
      showCeiling: false,
      minimapEnabled: true,
    });
    const nextLevels = [...synced, freshLevel];
    setCampaignLevels(nextLevels);
    applySingleLevelToEditor(freshLevel, newIndex, { resetUndoStacks: true });
    setEngineLog(
      `Campaign: Added Level ${newIndex + 1}/${nextLevels.length} ('${newTitle}').`
    );
  }, [
    getSyncedCampaignLevels,
    skyboxTheme,
    skyboxSeed,
    applySingleLevelToEditor,
  ]);

  const handleDuplicateCampaignLevel = useCallback(() => {
    const synced = getSyncedCampaignLevels();
    const currentSnap = synced[activeLevelIndex] || buildActiveSingleLevelState();
    const cloneTitle = `${
      currentSnap.title || `Level ${activeLevelIndex + 1}`
    } (Copy)`;
    const clonedLevel: LevelStateData = JSON.parse(
      JSON.stringify({
        ...currentSnap,
        title: cloneTitle,
      })
    );
    const insertIndex = activeLevelIndex + 1;
    const nextLevels = [
      ...synced.slice(0, insertIndex),
      clonedLevel,
      ...synced.slice(insertIndex),
    ];
    setCampaignLevels(nextLevels);
    applySingleLevelToEditor(clonedLevel, insertIndex, {
      resetUndoStacks: true,
    });
    setEngineLog(
      `Campaign: Duplicated into Level ${insertIndex + 1}/${nextLevels.length} ('${cloneTitle}').`
    );
  }, [
    getSyncedCampaignLevels,
    activeLevelIndex,
    buildActiveSingleLevelState,
    applySingleLevelToEditor,
  ]);

  const handleDeleteCampaignLevel = useCallback(
    (deleteIndex: number) => {
      const synced = getSyncedCampaignLevels();
      if (synced.length <= 1) {
        setEngineLog('Campaign: A game must have at least 1 level.');
        return;
      }
      if (deleteIndex < 0 || deleteIndex >= synced.length) return;
      const removedTitle =
        synced[deleteIndex]?.title || `Level ${deleteIndex + 1}`;
      const nextLevels = synced.filter((_, idx) => idx !== deleteIndex);
      const nextActiveIdx =
        deleteIndex < activeLevelIndex
          ? activeLevelIndex - 1
          : Math.min(activeLevelIndex, nextLevels.length - 1);
      setCampaignLevels(nextLevels);
      applySingleLevelToEditor(nextLevels[nextActiveIdx], nextActiveIdx, {
        resetUndoStacks: true,
      });
      setEngineLog(
        `Campaign: Deleted '${removedTitle}'. Active level is now ${
          nextActiveIdx + 1
        }/${nextLevels.length}.`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex, applySingleLevelToEditor]
  );

  const handleMoveCampaignLevel = useCallback(
    (index: number, direction: -1 | 1) => {
      const synced = getSyncedCampaignLevels();
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= synced.length) return;
      const nextLevels = [...synced];
      const [moved] = nextLevels.splice(index, 1);
      nextLevels.splice(targetIndex, 0, moved);

      let nextActiveIdx = activeLevelIndex;
      if (activeLevelIndex === index) {
        nextActiveIdx = targetIndex;
      } else if (
        direction === -1 &&
        activeLevelIndex === targetIndex
      ) {
        nextActiveIdx = activeLevelIndex + 1;
      } else if (
        direction === 1 &&
        activeLevelIndex === targetIndex
      ) {
        nextActiveIdx = activeLevelIndex - 1;
      }

      setCampaignLevels(nextLevels);
      setActiveLevelIndex(nextActiveIdx);
      setEngineLog(
        `Campaign: Moved '${moved.title || `Level ${index + 1}`}' to position #${
          targetIndex + 1
        }.`
      );
    },
    [getSyncedCampaignLevels, activeLevelIndex]
  );

  const handleUpdateCampaignSettings = useCallback(
    (nextSettings: CampaignSettings) => {
      setCampaignSettings(nextSettings);
      setEngineLog(
        `Campaign Carry-Over: Health=${
          nextSettings.carryOverHealth ? 'ON' : 'OFF'
        }, Ammo=${nextSettings.carryOverAmmo ? 'ON' : 'OFF'}.`
      );
    },
    []
  );

  const handlePlaceExitOnSelectedCell = useCallback(() => {
    const { row, col } = selectedCell;
    recordHistorySnapshot(`Set Level Exit at [X:${col}, Z:${row}]`);
    // Ensure the exit tile is walkable
    setActiveGrid((prev) => {
      if (prev[row]?.[col] === CellType.EMPTY) return prev;
      const next = prev.map((r) => [...r]);
      next[row][col] = CellType.EMPTY;
      return next;
    });

    const exitEventId = `evt_exit_${row}_${col}`;
    const newExitEvent: EventDefinition = {
      id: exitEventId,
      name: `Level Exit at [X:${col}, Z:${row}]`,
      enabled: true,
      trigger: {
        type: 'enter_cell',
        row,
        col,
        who: 'player',
      },
      conditions: [],
      actions: [{ type: 'exit_level' }],
      options: { once: true, fire: 'once' },
    };

    const existingEvents = simState.events.filter(
      (ev) =>
        ev.id !== exitEventId &&
        !(
          ev.trigger.type === 'enter_cell' &&
          ev.trigger.row === row &&
          ev.trigger.col === col &&
          ev.actions.some((a) => a.type === 'exit_level')
        )
    );
    const nextEvents = [...existingEvents, newExitEvent];

    const updatedV3 = LevelSerializer.serializeLevelV3({
      title: levelTitle,
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
      cellTags: simState.cellTags,
      events: nextEvents,
      regions: simState.regions,
      variables: {
        flags: simState.flags,
        counters: simState.counters,
        timers: Object.keys(simState.timers),
      },
      vertical,
    });
    setSimState(createInitialSimulationState(updatedV3, [0]));
    setEngineLog(
      `Campaign Exit: Added 'exit_level' trigger on cell [X:${col}, Z:${row}]. Stepping on this cell finishes Level ${
        activeLevelIndex + 1
      }.`
    );
  }, [
    selectedCell,
    recordHistorySnapshot,
    setActiveGrid,
    simState,
    levelTitle,
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
    vertical,
    activeLevelIndex,
  ]);

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
      setLevelTitle(found.name);
      setGrid(nextGrid);
      setWallTextures(nextWallTex);
      setFloorTextures(nextFloorTex);
      setCeilingTextures(nextCeilTex);
      setEntities(nextEnts);
      setNextEntityId((prev) =>
        computeNextEntityId(nextEnts, Math.max(prev, found.nextEntityId ?? 1))
      );
      setSpawn({ ...found.spawn });
      setVertical(createDefaultVerticalData(nextGrid.length));
      setActiveLayer(0);
      setSelectedEntityId(null);
      const presetV3 = LevelSerializer.serializeLevelV3({
        title: found.name,
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
      setEngineLog(
        `Preset: Loaded '${found.name}' into Level ${activeLevelIndex + 1}.`
      );
    },
    [
      recordHistorySnapshot,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      minimapEnabled,
      activeLevelIndex,
    ]
  );

  const handleRestoreLevelState = useCallback(
    (state: LevelStateData) => {
      recordHistorySnapshot('Import Level JSON');
      if (state.campaign) {
        setCampaignSettings({
          carryOverHealth: state.campaign.carryOverHealth !== false,
          carryOverAmmo: state.campaign.carryOverAmmo !== false,
        });
      }
      if (Array.isArray(state.levels) && state.levels.length > 0) {
        const targetIdx =
          typeof state.activeLevelIndex === 'number' &&
          state.activeLevelIndex >= 0 &&
          state.activeLevelIndex < state.levels.length
            ? state.activeLevelIndex
            : 0;
        setCampaignLevels(state.levels);
        applySingleLevelToEditor(state.levels[targetIdx], targetIdx, {
          resetUndoStacks: true,
        });
        setEngineLog(
          `File: Loaded Campaign JSON (${state.levels.length} Gameplay Levels, active Level ${
            targetIdx + 1
          }).`
        );
        return;
      }

      const singleSnap: LevelStateData = {
        ...state,
        title: state.title || 'Level 1',
      };
      setCampaignLevels([singleSnap]);
      applySingleLevelToEditor(singleSnap, 0, { resetUndoStacks: true });
      setEngineLog(
        state.missingModelWarnings?.length
          ? `Warning: ${state.missingModelWarnings.join(' ')}`
          : `File: Loaded Level JSON (${state.entities.length} Entities, ${state.customTextures.length} Custom Textures).`
      );
    },
    [recordHistorySnapshot, applySingleLevelToEditor]
  );

  const handleSaveLevelDataFromEditor = useCallback(
    (updated: {
      events: EventDefinition[];
      regions: RegionDefinition[];
      variables: VariableRegistrySpec;
    }) => {
      recordHistorySnapshot('Edit Visual Triggers & Events');
      const updatedV3 = LevelSerializer.serializeLevelV3({
        title: levelTitle,
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
        vertical,
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
      levelTitle,
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
      vertical,
    ]
  );

  const buildCurrentLevelState = useCallback(() => {
    const syncedLevels = getSyncedCampaignLevels();
    const activeSingle = syncedLevels[activeLevelIndex] || buildActiveSingleLevelState();

    // Collect all used custom textures across all levels in the campaign
    const usedTexIds = new Set<string>();
    for (const lvl of syncedLevels) {
      for (const row of lvl.wallTextures) for (const id of row) usedTexIds.add(id);
      for (const row of lvl.floorTextures) for (const id of row) usedTexIds.add(id);
      for (const row of lvl.ceilingTextures) for (const id of row) usedTexIds.add(id);
      if (lvl.vertical) {
        for (const layer of lvl.vertical.layers) {
          for (const m of [
            layer.wallTextures,
            layer.floorTextures,
            layer.ceilingTextures,
          ]) {
            for (const row of m) for (const id of row) usedTexIds.add(id);
          }
        }
      }
    }
    const allUsedCustomTextures = customTextures.filter(
      (t) => !t.fromProject || usedTexIds.has(t.id)
    );

    return LevelSerializer.serializeLevel({
      title: activeSingle.title || levelTitle,
      grid: activeSingle.grid,
      wallTextures: activeSingle.wallTextures,
      floorTextures: activeSingle.floorTextures,
      ceilingTextures: activeSingle.ceilingTextures,
      customTextures: allUsedCustomTextures,
      entities: activeSingle.entities,
      nextEntityId: activeSingle.nextEntityId,
      spawn: activeSingle.spawn,
      skyboxTheme: activeSingle.skybox.theme,
      skyboxSeed: activeSingle.skybox.seed,
      showCeiling: activeSingle.skybox.showCeiling,
      minimapEnabled: activeSingle.minimapEnabled ?? true,
      events: activeSingle.events,
      regions: activeSingle.regions,
      variables: activeSingle.variables,
      vertical: activeSingle.vertical,
      levels: syncedLevels,
      activeLevelIndex,
      campaign: campaignSettings,
    });
  }, [
    getSyncedCampaignLevels,
    activeLevelIndex,
    buildActiveSingleLevelState,
    customTextures,
    levelTitle,
    campaignSettings,
  ]);

  const handleSaveMap = useCallback(() => {
    LevelSerializer.downloadLevelJson(buildCurrentLevelState());
    setEngineLog('File: Exported level state to downloadable .json file.');
  }, [buildCurrentLevelState]);

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
    setVertical((v) => ({ ...createDefaultVerticalData(v.floorHeights.length), movement: v.movement }));
    setActiveLayer(0);
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
      setVertical((v) => resizeVerticalData(v, size));
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
    setActiveGrid((prev) =>
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
  }, [recordHistorySnapshot, setActiveGrid]);

  const handleRotateSpawn = useCallback(() => {
    recordHistorySnapshot('Rotate Player Spawn Yaw');
    setSpawn((prev) => ({
      ...prev,
      yaw: (prev.yaw + Math.PI / 2) % (Math.PI * 2),
    }));
  }, [recordHistorySnapshot]);

  const handleSelectTexture = useCallback((id: string) => {
    setSelectedTextureId(id);
    setToolMode((prev) => (prev !== 'paint' && prev !== 'toggle' ? 'paint' : prev));
  }, []);

  const handleChangeTargetSurface = useCallback((surf: SurfaceTarget) => {
    setTargetSurface(surf);
    setToolMode('paint');
  }, []);

  const handleAddCustomTexture = useCallback((asset: TextureAsset) => {
    setCustomTextures((prev) => [...prev, asset]);
  }, []);

  const handleSetSpawnCell = useCallback(
    (row: number, col: number) => {
      recordHistorySnapshot(`Move Player Spawn to [X:${col}, Z:${row}]`);
      setActiveGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = CellType.EMPTY;
        return next;
      });
      setSpawn((prev) => ({ ...prev, row, col }));
      setVertical((v) => ({ ...v, spawnLayer: activeLayerRef.current }));
    },
    [recordHistorySnapshot, setActiveGrid]
  );

  // --------------------------------------------------------------------------
  // LAYERS, VERTICAL SETTINGS & 3D EDITOR ACTIONS
  // --------------------------------------------------------------------------
  const handleAddLayer = useCallback(() => {
    if (classicRef.current) {
      setEngineLog('Classic retro movement keeps one floor (World tab).');
      return;
    }
    if (vertical.layers.length >= SIM_CONFIG.MAX_LAYERS - 1) {
      setEngineLog(`Layers: A level can have at most ${SIM_CONFIG.MAX_LAYERS} layers.`);
      return;
    }
    recordHistorySnapshot('Add Layer');
    const newIndex = vertical.layers.length + 1;
    setVertical((v) => ({
      ...v,
      layers: [
        ...v.layers,
        createSolidLayer(grid.length, {
          wall: 'default-grid',
          floor: 'floor-obsidian',
          ceiling: 'ceiling-coffer',
        }),
      ],
    }));
    setActiveLayer(newIndex);
    setEngineLog(
      `Layers: Added layer ${newIndex} (solid; carve rooms into it, and use the Hole tool to open floors).`
    );
  }, [grid.length, recordHistorySnapshot, vertical.layers.length]);

  const handleRemoveTopLayer = useCallback(() => {
    const top = vertical.layers.length;
    if (top === 0) return;
    recordHistorySnapshot(`Remove Layer ${top}`);
    setVertical((v) => ({
      ...v,
      layers: v.layers.slice(0, -1),
      spawnLayer: Math.min(v.spawnLayer, top - 1),
    }));
    setEntities((prev) => prev.filter((e) => (e.layer ?? 0) < top));
    setActiveLayer((l) => Math.min(l, top - 1));
    setEngineLog(`Layers: Removed layer ${top} and the models on it.`);
  }, [recordHistorySnapshot, vertical.layers.length]);

  /** Vertical features in use; classic retro movement can only be switched on without them */
  const verticalFeatures = useMemo(
    () => editorVerticalFeatures(grid, vertical, entities),
    [grid, vertical, entities]
  );

  const handleToggleClassic = useCallback(
    (on: boolean) => {
      if (on && verticalFeatures.length > 0) return;
      recordHistorySnapshot(on ? 'Use Classic Retro Movement' : 'Use Full 3D Movement');
      setVertical((v) => {
        const next = { ...v };
        if (on) next.classic = true;
        else delete next.classic;
        return next;
      });
      if (on) {
        setActiveLayer(0);
        setToolMode((mode) => (mode === 'height' || mode === 'slope' || mode === 'hole' ? 'toggle' : mode));
      }
      setEngineLog(
        on
          ? 'Movement: Classic retro (one flat floor; layer, height, slope and hole tools are off).'
          : 'Movement: Full 3D (layers, heights, slopes, jumping and crouching are available).'
      );
    },
    [recordHistorySnapshot, verticalFeatures.length]
  );

  const handleUpdateMovement = useCallback(
    (movement: MovementSettingsSpec) => {
      recordHistorySnapshot('Edit Movement Settings');
      setVertical((v) => ({ ...v, movement }));
    },
    [recordHistorySnapshot]
  );

  /** Inspector: exact floor/ceiling height and slope of the selected tile */
  const handleSetTileVertical = useCallback(
    (
      row: number,
      col: number,
      values: {
        floor?: number;
        ceiling?: number;
        slope?: { dir: CardinalDirection; riseUnits: number } | null;
        ceilingSlope?: { dir: CardinalDirection; riseUnits: number } | null;
      }
    ) => {
      recordHistorySnapshot(`Edit heights at [X:${col}, Z:${row}]`);
      updateLayerHeights(activeLayerRef.current, (cur) => {
        const out: Partial<Pick<EditorLayerData, 'floorHeights' | 'ceilingHeights' | 'slopes'>> = {};
        if (values.floor !== undefined) {
          const floors = cur.floorHeights.map((r) => [...r]);
          floors[row][col] = Math.trunc(values.floor);
          out.floorHeights = floors;
        }
        if (values.ceiling !== undefined) {
          const ceilings = cur.ceilingHeights.map((r) => [...r]);
          ceilings[row][col] = Math.trunc(values.ceiling);
          out.ceilingHeights = ceilings;
        }
        let slopes = cur.slopes;
        const setSlope = (
          surface: SlopeSurface,
          value: { dir: CardinalDirection; riseUnits: number } | null
        ) => {
          const others = slopes.filter(
            (sl) => !(sl.row === row && sl.col === col && (sl.surface ?? 'floor') === surface)
          );
          slopes = value
            ? [...others, { row, col, ...value, ...(surface === 'ceiling' ? { surface } : {}) }]
            : others;
          out.slopes = slopes;
        };
        if (values.slope !== undefined) setSlope('floor', values.slope);
        if (values.ceilingSlope !== undefined) setSlope('ceiling', values.ceilingSlope);
        return out;
      });
    },
    [recordHistorySnapshot, updateLayerHeights]
  );

  /** Sets one texture on any layer (3D drops can land on a layer other than the active one) */
  const setLayerTexture = useCallback(
    (layer: number, surface: SurfaceTarget, row: number, col: number, texId: string) => {
      const key = surface === 'wall' ? 'wallTextures' : surface === 'floor' ? 'floorTextures' : 'ceilingTextures';
      const edit = (prev: string[][]) => {
        const next = prev.map((r) => [...r]);
        next[row][col] = texId;
        return next;
      };
      if (layer === 0) {
        if (key === 'wallTextures') setWallTextures(edit);
        else if (key === 'floorTextures') setFloorTextures(edit);
        else setCeilingTextures(edit);
        return;
      }
      setVertical((v) => {
        const target = v.layers[layer - 1];
        if (!target) return v;
        const layers = [...v.layers];
        layers[layer - 1] = { ...target, [key]: edit(target[key]) };
        return { ...v, layers };
      });
    },
    []
  );

  const handleDropModel3D = useCallback(
    (modelAssetId: string, drop: SurfaceDrop) => {
      const modelAsset = allModel3DAssets.find((m) => m.id === modelAssetId);
      if (!modelAsset) return;
      setSelectedModelAssetId(modelAsset.id);
      recordHistorySnapshot(`Place '${modelAsset.name}' on ${drop.hit.surface}`);
      if (placeEntityAtCell(drop.hit.row, drop.hit.col, modelAsset, undefined, drop)) {
        setActiveLayer(drop.hit.layer);
        setSelectedCell({ row: drop.hit.row, col: drop.hit.col });
      }
    },
    [allModel3DAssets, recordHistorySnapshot, placeEntityAtCell]
  );

  const handleDropVariant3D = useCallback(
    (sourceEntityId: string, drop: SurfaceDrop) => {
      const source = currentDesignRef.current.entities.find((e) => e.id === sourceEntityId);
      const asset = source
        ? allModel3DAssets.find((m) => m.id === (source.modelAssetId ?? source.blueprintId))
        : undefined;
      if (!source || !asset) {
        setEngineLog('Placement blocked: that variant or its model is no longer available.');
        return;
      }
      recordHistorySnapshot(`Place '${source.name}' variant on ${drop.hit.surface}`);
      placeEntityAtCell(
        drop.hit.row,
        drop.hit.col,
        asset,
        {
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
        },
        drop
      );
    },
    [allModel3DAssets, recordHistorySnapshot, placeEntityAtCell]
  );

  const handleDropTexture3D = useCallback(
    (texId: string, hit: SurfaceHit) => {
      const gridSize = grid.length;
      let row = hit.row;
      let col = hit.col;
      if (hit.surface === 'wall') {
        // A wall face belongs to the solid tile behind it
        row = Math.max(0, Math.min(gridSize - 1, row - Math.round(hit.normal.z)));
        col = Math.max(0, Math.min(gridSize - 1, col - Math.round(hit.normal.x)));
      }
      recordHistorySnapshot(`Paint ${hit.surface} at [X:${col}, Z:${row}] (layer ${hit.layer})`);
      setLayerTexture(hit.layer, hit.surface, row, col, texId);
      if (hit.surface === 'ceiling') setShowCeiling(true);
      setSelectedTextureId(texId);
      setEngineLog(`3D Paint: Applied '${texId}' to the ${hit.surface} at [X:${col}, Z:${row}].`);
    },
    [grid.length, recordHistorySnapshot, setLayerTexture]
  );

  const handleCommitEntityTransform = useCallback(
    (moved: PlacedEntity) => {
      let updated = moved;
      if (classicRef.current) {
        // Classic retro levels keep models on their tile, on the floor, turned only flat
        const { layer: _l, offsetX: _x, offsetZ: _z, elevation: _e, pitch: _p, roll: _r, ...flat } = moved;
        updated = flat;
      }
      recordHistorySnapshot(`Move/Rotate '${updated.name}'`);
      setEntities((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelectedCell({ row: updated.row, col: updated.col });
    },
    [recordHistorySnapshot]
  );

  const handleWalkSurfaceBaked = useCallback((entityId: string, surface: WalkSurfaceSpec) => {
    setEntities((prev) =>
      prev.map((e) => (e.id === entityId && e.walkable ? { ...e, walkSurface: surface } : e))
    );
  }, []);

  // Measured by the 3D editor, not an edit of its own, so it adds no undo step
  const handleModelBoundsMeasured = useCallback((entityId: string, bounds: ModelBounds) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === entityId
          ? { ...e, modelBottomUnits: bounds.bottomUnits, modelTopUnits: bounds.topUnits }
          : e
      )
    );
  }, []);

  const handleSelectCell3D = useCallback((row: number, col: number, layer: number) => {
    setSelectedCell({ row, col });
    setActiveLayer(layer);
    setSelectedEntityId(null);
  }, []);

  const handleSelectEntity3D = useCallback((entityId: string | null) => {
    setSelectedEntityId(entityId);
    if (!entityId) return;
    const ent = currentDesignRef.current.entities.find((e) => e.id === entityId);
    if (ent) {
      setSelectedCell({ row: ent.row, col: ent.col });
      setActiveLayer(ent.layer ?? 0);
    }
  }, []);

  const setSelectedVariant = modelLibrary.setSelectedVariant;
  const handleSelectModelAsset = useCallback(
    (assetId: string) => {
      setSelectedModelAssetId(assetId);
      setSelectedVariant(null);
      setToolMode('entity');
    },
    [setSelectedVariant]
  );

  const handleAddCustomModel3DAsset = useCallback((asset: Model3DAsset) => {
    setCustomModel3DAssets((prev) => [
      ...prev.filter((m) => m.id !== asset.id),
      asset,
    ]);
    setSelectedModelAssetId(asset.id);
    setToolMode('entity');
    setEngineLog(
      `Asset Library: Imported 3D model '${asset.name}' — drag it onto any 2D grid cell!`
    );
  }, []);

  const handleChangeSkyboxTheme = useCallback((theme: SkyboxThemeId) => {
    setSkyboxTheme(theme);
    setShowCeiling(false);
  }, []);

  const handleRegenerateSkybox = useCallback(() => {
    setSkyboxSeed((s) => {
      const next = s + 1;
      setEngineLog(`Skybox: Generated procedural seed #${next}.`);
      return next;
    });
    setShowCeiling(false);
  }, []);

  const handleToggleCeiling = useCallback(() => {
    setShowCeiling((prev) => !prev);
  }, []);

  const handleToggleMinimap = useCallback(() => {
    setMinimapEnabled((prev) => !prev);
  }, []);

  const handleTogglePlayFullscreen = useCallback(() => {
    setIsPlayFullscreen((prev) => !prev);
  }, []);

  const handlePickVariant = useCallback(
    (variant: NonNullable<typeof modelLibrary.selectedVariant>) => {
      setSelectedVariant(variant);
      setSelectedModelAssetId(variant.modelAssetId);
      setToolMode('entity');
    },
    [setSelectedVariant]
  );

  const handleSelectCell = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col });
  }, []);

  const handleToggleAllowOverlap = useCallback(() => {
    setAllowOverlap((prev) => !prev);
  }, []);

  const wallCount = useMemo(() => {
    let count = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell === CellType.WALL) count++;
      }
    }
    return count;
  }, [grid]);

  const editorLevel = useMemo(
    () => ({
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      vertical,
    }),
    [
      grid,
      wallTextures,
      floorTextures,
      ceilingTextures,
      customTextures,
      entities,
      spawn,
      skyboxTheme,
      skyboxSeed,
      showCeiling,
      vertical,
    ]
  );

  const activeLayerEntities = useMemo(
    () => entities.filter((e) => (e.layer ?? 0) === activeLayer),
    [entities, activeLayer]
  );
  const mapLayerView = useMemo(
    () => ({
      layer: activeLayer,
      floorHeights: activeLayerData.floorHeights,
      ceilingHeights: activeLayerData.ceilingHeights,
      slopes: activeLayerData.slopes,
      belowGrid:
        activeLayer === 0
          ? null
          : activeLayer === 1
          ? grid
          : vertical.layers[activeLayer - 2]?.grid ?? null,
      showSpawn: vertical.spawnLayer === activeLayer,
    }),
    [activeLayer, activeLayerData, grid, vertical.layers, vertical.spawnLayer]
  );

  const campaignLevelSummaries = useMemo(() => {
    const synced = getSyncedCampaignLevels();
    return synced.map((lvl, idx) => ({
      title: lvl.title || `Level ${idx + 1}`,
      gridSize: lvl.gridSize || lvl.grid.length,
      entityCount: lvl.entities?.length ?? 0,
      hasExitTrigger: Boolean(
        lvl.events?.some((ev) =>
          ev.actions?.some((a) => a.type === 'exit_level')
        )
      ),
    }));
  }, [getSyncedCampaignLevels]);

  const campaignLevelsV3 = useMemo(() => {
    const synced = getSyncedCampaignLevels();
    return synced.map((lvl, idx) =>
      LevelSerializer.serializeLevelV3({
        title: lvl.title || `Level ${idx + 1}`,
        grid: lvl.grid,
        wallTextures: lvl.wallTextures,
        floorTextures: lvl.floorTextures,
        ceilingTextures: lvl.ceilingTextures,
        customTextures: lvl.customTextures,
        entities: lvl.entities,
        nextEntityId: lvl.nextEntityId,
        spawn: lvl.spawn,
        skyboxTheme: lvl.skybox.theme,
        skyboxSeed: lvl.skybox.seed,
        showCeiling: lvl.skybox.showCeiling,
        minimapEnabled: lvl.minimapEnabled ?? true,
        cellTags: lvl.cellTags,
        events: lvl.events,
        regions: lvl.regions,
        variables: lvl.variables,
        vertical: lvl.vertical,
      })
    );
  }, [getSyncedCampaignLevels]);

  const handleRuntimeCampaignLevelChange = useCallback(
    (
      nextLevelIndex: number,
      _carriedStats: { health: number; ammo: number },
      nextSimState: SimulationState
    ) => {
      const synced = getSyncedCampaignLevels();
      const target = synced[nextLevelIndex];
      if (!target) return;
      setCampaignLevels(synced);
      applySingleLevelToEditor(target, nextLevelIndex, {
        preserveSimState: nextSimState,
        resetUndoStacks: true,
      });
    },
    [getSyncedCampaignLevels, applySingleLevelToEditor]
  );

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
        campaignLevels={campaignLevelSummaries}
        activeLevelIndex={activeLevelIndex}
        onSelectCampaignLevel={handleSelectCampaignLevel}
        onAddCampaignLevel={handleAddCampaignLevel}
        onSaveMap={handleSaveMap}
        onLoadMapFile={handleLoadMapFile}
        onOpenArchModal={() => setIsArchModalOpen(true)}
        onOpenEventEditor={() => setIsEventEditorOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        isPlayFullscreen={isPlayFullscreen}
        onTogglePlayFullscreen={handleTogglePlayFullscreen}
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
          disabledModes={classic ? ['height', 'slope', 'hole'] : []}
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
              className="h-full min-w-[220px] shrink-0 overflow-hidden flex flex-col"
            >
              <LayerBar
                activeLayer={activeLayer}
                layerCount={vertical.layers.length + 1}
                onSelectLayer={setActiveLayer}
                onAddLayer={handleAddLayer}
                onRemoveTopLayer={handleRemoveTopLayer}
                toolMode={toolMode}
                heightTarget={heightTarget}
                onHeightTargetChange={setHeightTarget}
                heightStep={heightStep}
                onHeightStepChange={setHeightStep}
                heightRaise={heightRaise}
                onHeightRaiseChange={setHeightRaise}
                classic={classic}
              />
              <div className="flex-1 min-h-0">
              <MapEditor2D
                grid={activeLayerData.grid}
                wallTextures={activeLayerData.wallTextures}
                floorTextures={activeLayerData.floorTextures}
                textures={allTextures}
                entities={activeLayerEntities}
                layerView={mapLayerView}
                toolMode={toolMode}
                selectedCell={selectedCell}
                onSelectCell={handleSelectCell}
                onStrokeStart={recordHistorySnapshot}
                onCellInteract={handleCellInteract}
                onEraseCell={handleEraseCell}
                onDropTextureOnCell={handleDropTextureOnCell}
                onDropModelOnCell={handleDropModelOnCell}
                onHoverCellChange={setHoveredCell}
                playerTransform={playerTransform}
                spawn={spawn}
                onClearGrid={handleClearGrid}
                onBorderWalls={handleBorderWalls}
                onDropVariantOnCell={handleDropVariantOnCell}
                allowOverlap={allowOverlap}
                onToggleAllowOverlap={handleToggleAllowOverlap}
                collectedKeys={collectedKeys}
                openDoors={openDoors}
              />
              </div>
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

        {/* Center pane: the 3D editor, or the game while test playing */}
        <div className="flex-1 h-full min-w-[260px] overflow-hidden">
          {viewMode === 'edit' && !isPlayFullscreen ? (
            <EditorViewport3D
              level={editorLevel}
              classic={classic}
              activeLayer={activeLayer}
              selectedEntityId={selectedEntityId}
              selectedCell={selectedCell}
              onSelectEntity={handleSelectEntity3D}
              onSelectCell={handleSelectCell3D}
              onCommitEntityTransform={handleCommitEntityTransform}
              onDeleteEntity={handleRemoveEntity}
              onWalkSurfaceBaked={handleWalkSurfaceBaked}
              onModelBoundsMeasured={handleModelBoundsMeasured}
              onDropModel={handleDropModel3D}
              onDropVariant={handleDropVariant3D}
              onDropTexture={handleDropTexture3D}
              onEnterPlay={() => {
                // Start the game from the level as it is now, layers and heights included
                const playV3 = LevelSerializer.serializeLevelV3({
                  title: levelTitle,
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
                  cellTags: simState.cellTags,
                  events: simState.events,
                  regions: simState.regions,
                  variables: {
                    flags: simState.flags,
                    counters: simState.counters,
                    timers: Object.keys(simState.timers),
                  },
                  vertical: isFlatVerticalData(vertical) && !vertical.classic ? undefined : vertical,
                });
                setSimState(createInitialSimulationState(playV3, [0]));
                setViewMode('play');
                setEngineLog('Test Play: Click the view to look around; press Edit to go back to building.');
              }}
            />
          ) : (
          <Viewport3D
            vertical={vertical}
            campaignLevels={campaignLevelsV3}
            activeLevelIndex={activeLevelIndex}
            campaignSettings={campaignSettings}
            onCampaignLevelChange={handleRuntimeCampaignLevelChange}
            onExitPlay={() => {
              setViewMode('edit');
              if (isPlayFullscreen) setIsPlayFullscreen(false);
              setEngineLog('Edit mode: Fly with the right mouse button held and W/A/S/D/Q/E.');
            }}
            grid={grid}
            wallTextures={wallTextures}
            floorTextures={floorTextures}
            ceilingTextures={ceilingTextures}
            customTextures={customTextures}
            entities={entities}
            spawn={spawn}
            showCeiling={showCeiling}
            onToggleCeiling={handleToggleCeiling}
            minimapEnabled={minimapEnabled}
            onToggleMinimap={handleToggleMinimap}
            isPlayFullscreen={isPlayFullscreen}
            onTogglePlayFullscreen={handleTogglePlayFullscreen}
            skyboxTheme={skyboxTheme}
            skyboxSeed={skyboxSeed}
            playerTransform={playerTransform}
            onPlayerMove={setPlayerTransform}
            simState={simState}
            onSimStateChange={setSimState}
            resetSignal={resetSignal}
            onEngineLog={setEngineLog}
          />
          )}
        </div>
      </main>

      {/* ====================================================================
          4. RIGHT PROPERTIES INSPECTOR PANEL (280px wide, grid-area: inspector)
          ==================================================================== */}
      {!isPlayFullscreen && (
        <PropertiesInspector
          selectedCell={selectedCell}
          grid={activeLayerData.grid}
          wallTextures={activeLayerData.wallTextures}
          floorTextures={activeLayerData.floorTextures}
          ceilingTextures={activeLayerData.ceilingTextures}
          activeLayer={activeLayer}
          layerData={activeLayerData}
          onSetTileVertical={handleSetTileVertical}
          movement={vertical.movement}
          onUpdateMovement={handleUpdateMovement}
          classic={classic}
          onToggleClassic={handleToggleClassic}
          verticalFeatures={verticalFeatures}
          selectedEntityId={selectedEntityId}
          layerCount={vertical.layers.length + 1}
          textures={allTextures}
          selectedTextureId={selectedTextureId}
          onSelectTexture={handleSelectTexture}
          targetSurface={targetSurface}
          onChangeTargetSurface={handleChangeTargetSurface}
          onAddCustomTexture={handleAddCustomTexture}
          onAssignCellTexture={handleAssignCellTextureFromInspector}
          onFillSurfaceWithTexture={handleFillSurfaceWithTexture}
          onSetCellType={handleSetCellType}
          spawn={spawn}
          onSetSpawnCell={handleSetSpawnCell}
          onRotateSpawn={handleRotateSpawn}
          entities={activeLayerEntities}
          model3DAssets={allModel3DAssets}
          selectedModelAssetId={selectedModelAssetId}
          onSelectModelAsset={handleSelectModelAsset}
          onAddCustomModel3DAsset={handleAddCustomModel3DAsset}
          onUpdateEntity={handleUpdateEntity}
          onPlaceEntityAtCell={handlePlaceEntityFromInspector}
          onRemoveEntity={handleRemoveEntity}
          getLibrarySettings={getLibrarySettings}
          skyboxTheme={skyboxTheme}
          onChangeSkyboxTheme={handleChangeSkyboxTheme}
          skyboxSeed={skyboxSeed}
          onRegenerateSkybox={handleRegenerateSkybox}
          showCeiling={showCeiling}
          onToggleCeiling={handleToggleCeiling}
          minimapEnabled={minimapEnabled}
          onToggleMinimap={handleToggleMinimap}
          onBorderWalls={handleBorderWalls}
          onClearGrid={handleClearGrid}
          onResizeMap={handleResizeMap}
          campaignLevels={campaignLevelSummaries}
          activeLevelIndex={activeLevelIndex}
          levelTitle={levelTitle}
          onSelectCampaignLevel={handleSelectCampaignLevel}
          onRenameCampaignLevel={handleRenameCampaignLevel}
          onAddCampaignLevel={handleAddCampaignLevel}
          onDuplicateCampaignLevel={handleDuplicateCampaignLevel}
          onDeleteCampaignLevel={handleDeleteCampaignLevel}
          onMoveCampaignLevel={handleMoveCampaignLevel}
          campaignSettings={campaignSettings}
          onUpdateCampaignSettings={handleUpdateCampaignSettings}
          onPlaceExitOnSelectedCell={handlePlaceExitOnSelectedCell}
          libraryState={libraryState}
          onLibraryChange={setLibraryState}
          selectedVariantKey={modelLibrary.selectedVariant?.key ?? null}
          onPickVariant={handlePickVariant}
          onModelAdded={modelLibrary.handleModelAdded}
          onRemoveUploadedModel={modelLibrary.handleRemoveUploadedModel}
          onExportLibrary={modelLibrary.handleExportLibrary}
          onImportLibraryFile={modelLibrary.handleImportLibraryFile}
          gitHubRepoInput={gitHubRepoInput}
          isSyncingGitHubAssets={isSyncingGitHubAssets}
          gitHubAssetsStats={gitHubAssetsStats}
          onSyncGitHubAssets={handleSyncGitHubAssets}
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
      {isArchModalOpen && (
        <ArchitectureModal
          isOpen={isArchModalOpen}
          onClose={() => setIsArchModalOpen(false)}
          levelState={buildCurrentLevelState()}
          onImportLevelState={handleRestoreLevelState}
        />
      )}

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

      {/* Phase 6 Game Export Modal */}
      {isExportModalOpen && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          levelState={buildCurrentLevelState()}
          setEngineLog={setEngineLog}
        />
      )}
    </div>
  );
}
