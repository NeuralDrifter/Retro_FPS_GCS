/**
 * The editor shell, laid out as a desktop engine IDE (CSS Grid `.ide-shell` in `src/index.css`):
 *  - Top: `.ide-menubar`, file, undo and redo, presets and view controls
 *  - Left: `.ide-toolbar`, the tool palette
 *  - Middle: `.ide-workspace`, the 2D map and the 3D viewport in a resizable split
 *  - Right: `.ide-inspector`, properties, assets and world settings
 *  - Bottom: `.ide-statusbar`, the engine log, history depth and coordinates
 *
 * The project lives in the document store (release plan P2.3, P2.4): App reads it through
 * useEditorDocument and changes it only through the command hooks. Its own state is editor UI.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  CampaignSettings,
  CellType,
  ENGINE_CONFIG,
  EditorToolMode,
  PlayerTransform,
  SkyboxThemeId,
  SurfaceTarget,
  createDefaultMenuPack,
} from './types/engine';
import { CollisionSystem, registerDebugProbe } from '../runtime';
import type { LevelDataV3 } from '../sim';
import {
  SimulationState,
  createInitialSimulationState,
  getCollectedKeysSetFromSim,
  getOpenDoorsSetFromSim,
} from '../sim';
import { MapEditor2D } from './components/MapEditor2D';
import { Viewport3D } from './components/Viewport3D';
import { EditorViewport3D } from './components/EditorViewport3D';
import { LayerBar } from './components/LayerBar';
import { PropertiesInspector } from './components/PropertiesInspector';
import { ArchitectureModal } from './components/ArchitectureModal';
import { EventTriggerEditorModal } from './components/EventTriggerEditorModal';
import { ExportModal } from './components/ide/ExportModal';
import { TopMenuBar } from './components/ide/TopMenuBar';
import { LeftToolPalette } from './components/ide/LeftToolPalette';
import { BottomStatusBar } from './components/ide/BottomStatusBar';
import { MenuStudioWorkspace } from './components/menuStudio/MenuStudioWorkspace';
import { remapEntityModelIds, removeModelCopies } from './engine/modelLibrary/placement';
import { buildRuntimeLevel, runtimeLevelOf } from './store/levelView';
import { campaignMenus, mapAllEntities, useEditorDocument } from './store/useEditorDocument';
import { useAssetCatalog } from './hooks/useAssetCatalog';
import { useCampaignManager } from './hooks/useCampaignManager';
import { useEntityCommands } from './hooks/useEntityCommands';
import { useLayerManager } from './hooks/useLayerManager';
import { useLevelPersistence } from './hooks/useLevelPersistence';
import { layerOf, useMapCommands } from './hooks/useMapCommands';

/** Never changed: the editor shows no collected keys or open doors before a playtest */
const NO_CELLS = new Set<string>();

export default function App() {
  // Debug runs count App renders, so the e2e suite can check that playtest does not re-render the editor
  const appRenderCount = useRef(0);
  appRenderCount.current++;
  useEffect(() => registerDebugProbe('appRenders', () => appRenderCount.current), []);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const [engineLog, setEngineLog] = useState<string>(
    'Ready — Click 2D grid to sculpt level (Ctrl+Z Undo / Ctrl+Y Redo) or open UI Menu Studio to design custom menus.'
  );
  const { store, doc, past, future, view, activeIndex, setActiveLevelId, ctx, undo, redo } = useEditorDocument(setEngineLog);
  // Debug runs let the e2e suite read the project and the active level
  useEffect(() => registerDebugProbe('projectDocument', () => store.getState().doc), [store]);
  useEffect(() => registerDebugProbe('activeLevelId', () => view.id), [view.id]);
  useEffect(() => registerDebugProbe('undoDepth', () => store.getState().past.length), [store]);

  // --------------------------------------------------------------------------
  // EDITOR UI STATE (the project itself is in the store)
  // --------------------------------------------------------------------------
  const classic = Boolean(view.vertical.classic);
  const [activeLayer, setActiveLayer] = useState<number>(0);
  const activeLayerRef = useRef(activeLayer);
  activeLayerRef.current = activeLayer;
  const layerCount = view.vertical.layers.length;
  useEffect(() => {
    if (activeLayer > layerCount) setActiveLayer(layerCount);
  }, [activeLayer, layerCount]);

  // The center pane starts as the 3D editor; Test Play turns it into the game
  const [viewMode, setViewMode] = useState<'edit' | 'play'>('edit');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  // Height and slope tool settings (sim units: 1000 = one layer = 4 m)
  const [heightTarget, setHeightTarget] = useState<'floor' | 'ceiling'>('floor');
  const [heightStep, setHeightStep] = useState<number>(125);
  const [heightRaise, setHeightRaise] = useState<boolean>(true);
  const [selectedTextureId, setSelectedTextureId] = useState<string>('default-grid');
  const [targetSurface, setTargetSurface] = useState<SurfaceTarget>('wall');
  const [toolMode, setToolMode] = useState<EditorToolMode>('toggle');
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number }>({ row: 3, col: 3 });
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
  // Resizable split pane percentage for the 2D map editor
  const [splitRatioPct, setSplitRatioPct] = useState<number>(40);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState<boolean>(false);
  const [isPlayFullscreen, setIsPlayFullscreen] = useState<boolean>(false);
  const [resetSignal, setResetSignal] = useState<number>(0);
  const [isArchModalOpen, setIsArchModalOpen] = useState<boolean>(false);
  const [isEventEditorOpen, setIsEventEditorOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isMenuStudioOpen, setIsMenuStudioOpen] = useState<boolean>(false);
  const [startInMainMenu, setStartInMainMenu] = useState<boolean>(false);
  // When off, new placements may not overlap models, walls or doors (existing ones are untouched)
  const [allowOverlap, setAllowOverlap] = useState<boolean>(false);
  const allowOverlapRef = useRef(allowOverlap);
  allowOverlapRef.current = allowOverlap;
  // The game state a playtest starts from, built from the store when play begins (P1.7)
  const [playSim, setPlaySim] = useState<SimulationState | null>(null);

  // Keep the selection on the map when it shrinks (resize, undo or redo, preset or file load)
  useEffect(() => {
    const maxIdx = view.gridSize - 1;
    setSelectedCell((prev) =>
      prev.row > maxIdx || prev.col > maxIdx ? { row: Math.min(prev.row, maxIdx), col: Math.min(prev.col, maxIdx) } : prev
    );
  }, [view.gridSize]);

  // --------------------------------------------------------------------------
  // ASSET CATALOG (textures and models to pick from)
  // --------------------------------------------------------------------------
  const catalog = useAssetCatalog({
    log: setEngineLog,
    initialTextureMatrices: [view.wallTextures, view.floorTextures, view.ceilingTextures],
    // Deleting a model is permanent: its copies leave every level and every undo step
    onModelRemoved: (modelId) => store.rewriteAll((d) => mapAllEntities(d, (list) => removeModelCopies(list, modelId))),
    onModelIdsRenamed: (renamed) => store.rewriteAll((d) => mapAllEntities(d, (list) => remapEntityModelIds(list, renamed))),
    onUseModelTool: () => setToolMode('entity'),
  });
  const { allTextures, customTextures, modelLibrary, trackRecentTexture } = catalog;

  // --------------------------------------------------------------------------
  // EDIT COMMANDS
  // --------------------------------------------------------------------------
  const requestRespawn = useCallback(() => setResetSignal((n) => n + 1), []);
  /** After switching or replacing the level: ground layer, nothing selected, player respawned */
  const resetLevelUi = useCallback(() => {
    setActiveLayer(0);
    setSelectedEntityId(null);
    setResetSignal((n) => n + 1);
  }, []);

  const map = useMapCommands({
    ctx,
    activeLayerRef,
    toolMode,
    targetSurface,
    selectedTextureId,
    heightTarget,
    heightStep,
    heightRaise,
    allTextures,
    trackRecentTexture,
    setSelectedCell,
    setSelectedTextureId,
    setActiveLayer,
    requestRespawn,
  });
  const entity = useEntityCommands({
    ctx,
    activeLayerRef,
    allowOverlapRef,
    allModel3DAssets: catalog.allModel3DAssets,
    selectedModelAssetId: catalog.selectedModelAssetId,
    setSelectedModelAssetId: catalog.setSelectedModelAssetId,
    libraryState: modelLibrary.libraryState,
    selectedVariant: modelLibrary.selectedVariant,
    setSelectedEntityId,
    setSelectedCell,
    setActiveLayer,
  });
  const layers = useLayerManager({ ctx, view, setActiveLayer, setToolMode });
  const campaign = useCampaignManager({ ctx, doc, activeIndex, setActiveLevelId, onLevelSwitched: resetLevelUi });
  const files = useLevelPersistence({
    ctx,
    customTextures,
    addCustomTextures: catalog.addCustomTextures,
    setActiveLevelId,
    selectedCell,
    activeLayer,
    onLevelReplaced: resetLevelUi,
    onEventsSaved: () => {
      setIsEventEditorOpen(false);
      setResetSignal((n) => n + 1);
    },
  });

  // MapEditor2D starts a stroke (one undo step) on pointer down, then reports each cell
  const handleCellInteract = useCallback(
    (row: number, col: number, forceValue?: number) =>
      toolMode === 'entity' ? entity.handleEntityTool(row, col) : map.handleMapToolCell(row, col, forceValue),
    [toolMode, entity, map]
  );

  /** World settings of the active level (skybox, ceiling, minimap) */
  const editWorld = useCallback(
    (patch: { skybox?: Partial<LevelDataV3['skybox']>; minimapEnabled?: boolean }, label: string) => {
      const level = ctx.level();
      ctx.edit(
        {
          type: 'world/update',
          levelId: level.id,
          patch: {
            ...(patch.skybox ? { skybox: { ...level.data.skybox, ...patch.skybox } } : {}),
            ...(patch.minimapEnabled !== undefined ? { minimapEnabled: patch.minimapEnabled } : {}),
          },
        },
        label
      );
    },
    [ctx]
  );
  const handleChangeSkyboxTheme = useCallback(
    (theme: SkyboxThemeId) => editWorld({ skybox: { theme, showCeiling: false } }, `Skybox theme '${theme}'`),
    [editWorld]
  );
  const handleRegenerateSkybox = useCallback(() => {
    const next = ctx.view().skyboxSeed + 1;
    editWorld({ skybox: { seed: next, showCeiling: false } }, 'Regenerate skybox');
    setEngineLog(`Skybox: Generated procedural seed #${next}.`);
  }, [ctx, editWorld]);
  const handleToggleCeiling = useCallback(
    () => editWorld({ skybox: { showCeiling: !ctx.view().showCeiling } }, 'Toggle ceiling'),
    [ctx, editWorld]
  );
  const handleToggleMinimap = useCallback(
    () => editWorld({ minimapEnabled: !ctx.view().minimapEnabled }, 'Toggle minimap'),
    [ctx, editWorld]
  );

  const handleSelectTexture = useCallback(
    (id: string) => {
      setSelectedTextureId(id);
      trackRecentTexture(id);
      setToolMode((prev) => (prev !== 'paint' && prev !== 'toggle' ? 'paint' : prev));
    },
    [trackRecentTexture]
  );
  const handleChangeTargetSurface = useCallback((surf: SurfaceTarget) => {
    setTargetSurface(surf);
    setToolMode('paint');
  }, []);
  const handleSelectCell = useCallback((row: number, col: number) => setSelectedCell({ row, col }), []);
  const handleSelectCell3D = useCallback((row: number, col: number, layer: number) => {
    setSelectedCell({ row, col });
    setActiveLayer(layer);
    setSelectedEntityId(null);
  }, []);
  const handleToggleAllowOverlap = useCallback(() => setAllowOverlap((prev) => !prev), []);
  const handleTogglePlayFullscreen = useCallback(() => setIsPlayFullscreen((prev) => !prev), []);

  // --------------------------------------------------------------------------
  // VIEWS OF THE ACTIVE LEVEL
  // --------------------------------------------------------------------------
  /** The layer being edited, with every field filled in (layer 0 is the ground) */
  const activeLayerData = useMemo(() => layerOf(view, activeLayer), [view, activeLayer]);
  const activeLayerEntities = useMemo(
    () => view.entities.filter((e) => (e.layer ?? 0) === activeLayer),
    [view.entities, activeLayer]
  );
  const mapLayerView = useMemo(
    () => ({
      layer: activeLayer,
      floorHeights: activeLayerData.floorHeights,
      ceilingHeights: activeLayerData.ceilingHeights,
      slopes: activeLayerData.slopes,
      belowGrid: activeLayer === 0 ? null : activeLayer === 1 ? view.grid : view.vertical.layers[activeLayer - 2]?.grid ?? null,
      showSpawn: view.vertical.spawnLayer === activeLayer,
    }),
    [activeLayer, activeLayerData, view.grid, view.vertical.layers, view.vertical.spawnLayer]
  );
  const editorLevel = useMemo(
    () => ({
      grid: view.grid,
      wallTextures: view.wallTextures,
      floorTextures: view.floorTextures,
      ceilingTextures: view.ceilingTextures,
      customTextures,
      entities: view.entities,
      spawn: view.spawn,
      skyboxTheme: view.skyboxTheme,
      skyboxSeed: view.skyboxSeed,
      showCeiling: view.showCeiling,
      vertical: view.vertical,
    }),
    [view, customTextures]
  );
  // Where the player stands in edit mode: the spawn point. While playtesting, the live position
  // comes from playtestStore instead, so play never re-renders App (P1.7).
  const spawnTransform = useMemo<PlayerTransform>(() => {
    const world = CollisionSystem.gridToWorld(view.spawn.row, view.spawn.col, view.gridSize);
    return {
      x: world.x,
      y: ENGINE_CONFIG.PLAYER_EYE_HEIGHT,
      z: world.z,
      yaw: view.spawn.yaw,
      pitch: 0,
      gridRow: view.spawn.row,
      gridCol: view.spawn.col,
      speed: 0,
    };
  }, [view.spawn, view.gridSize]);
  const wallCount = useMemo(() => view.grid.reduce((n, row) => n + row.filter((c) => c === CellType.WALL).length, 0), [view.grid]);
  const collectedKeys = useMemo(() => (playSim ? getCollectedKeysSetFromSim(playSim) : NO_CELLS), [playSim]);
  const openDoors = useMemo(() => (playSim ? getOpenDoorsSetFromSim(playSim) : NO_CELLS), [playSim]);

  const menus = campaignMenus(doc);
  const campaignSettings = useMemo<CampaignSettings>(
    () => ({
      carryOverHealth: doc.campaign.carryOverHealth,
      carryOverAmmo: doc.campaign.carryOverAmmo,
      ...(menus ? { menus } : {}),
    }),
    [doc.campaign.carryOverHealth, doc.campaign.carryOverAmmo, menus]
  );
  const campaignLevelSummaries = useMemo(
    () =>
      doc.levels.map((lvl, idx) => ({
        title: lvl.title || `Level ${idx + 1}`,
        gridSize: lvl.data.gridSize,
        entityCount: lvl.data.entities.length,
        hasExitTrigger: lvl.data.events.some((ev) => ev.actions?.some((a) => a.type === 'exit_level')),
      })),
    [doc.levels]
  );
  const showsGame = !isMenuStudioOpen && (viewMode === 'play' || isPlayFullscreen);
  const campaignLevelsV3 = useMemo(() => (showsGame ? doc.levels.map(runtimeLevelOf) : []), [showsGame, doc.levels]);

  // --------------------------------------------------------------------------
  // PLAYTEST
  // --------------------------------------------------------------------------
  /** Builds the game state a playtest starts from, from the level as it is now */
  const preparePlay = useCallback(() => {
    setPlaySim(createInitialSimulationState(buildRuntimeLevel(ctx.level()), [0]));
  }, [ctx]);

  const handleRuntimeCampaignLevelChange = useCallback(
    (nextLevelIndex: number, _carriedStats: { health: number; ammo: number }, nextSimState: SimulationState) => {
      const target = store.getState().doc.levels[nextLevelIndex];
      if (!target) return;
      setActiveLevelId(target.id);
      setActiveLayer(0);
      setSelectedEntityId(null);
      setPlaySim(nextSimState);
    },
    [store, setActiveLevelId]
  );

  // Resizable split pane drag
  useEffect(() => {
    if (!isDraggingSplitter) return;
    const onPointerMove = (e: PointerEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      setSplitRatioPct(Math.max(24, Math.min(66, ((e.clientX - rect.left) / rect.width) * 100)));
    };
    const onPointerUp = () => setIsDraggingSplitter(false);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isDraggingSplitter]);

  const activeCoord = hoveredCell || selectedCell;
  const nextUndoLabel = past.length > 0 ? past[past.length - 1].label : null;
  const nextRedoLabel = future.length > 0 ? future[0].label : null;
  const levelTitle = view.title;

  return (
    <div className={`ide-shell ${isPlayFullscreen || isMenuStudioOpen ? 'ide-shell--play-fullscreen' : ''}`}>
      <TopMenuBar
        pastHistoryCount={past.length}
        futureHistoryCount={future.length}
        nextUndoLabel={nextUndoLabel}
        nextRedoLabel={nextRedoLabel}
        onUndo={undo}
        onRedo={redo}
        onLoadPreset={files.handleLoadPreset}
        campaignLevels={campaignLevelSummaries}
        activeLevelIndex={activeIndex}
        onSelectCampaignLevel={campaign.handleSelectCampaignLevel}
        onAddCampaignLevel={campaign.handleAddCampaignLevel}
        onSaveMap={files.handleSaveMap}
        onLoadMapFile={files.handleLoadMapFile}
        onOpenArchModal={() => setIsArchModalOpen(true)}
        onOpenEventEditor={() => setIsEventEditorOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        isMenuStudioOpen={isMenuStudioOpen}
        onToggleMenuStudio={() => {
          setIsMenuStudioOpen((prev) => {
            const next = !prev;
            if (next) {
              setIsPlayFullscreen(false);
              setEngineLog(
                'UI Menu Studio: Drag & drop widgets onto the 16:9 canvas, customize button shapes & textures, or configure In-Game Pause/Inventory overlays.'
              );
            } else {
              setEngineLog('Returned to 2D/3D Level Editor.');
            }
            return next;
          });
        }}
        isPlayFullscreen={isPlayFullscreen}
        onTogglePlayFullscreen={() => {
          if (isMenuStudioOpen) setIsMenuStudioOpen(false);
          // Fullscreen from the editor starts a playtest of the level as it is now
          if (!isPlayFullscreen && viewMode === 'edit') preparePlay();
          handleTogglePlayFullscreen();
        }}
        onRespawnPlayer={() => setResetSignal((n) => n + 1)}
      />

      {!isPlayFullscreen && !isMenuStudioOpen && (
        <LeftToolPalette
          toolMode={toolMode}
          onSelectTool={(mode) => {
            setToolMode(mode);
            setEngineLog(`Tool: Activated '${mode.toUpperCase()}'.`);
          }}
          pastHistoryCount={past.length}
          futureHistoryCount={future.length}
          nextUndoLabel={nextUndoLabel}
          nextRedoLabel={nextRedoLabel}
          onUndo={undo}
          onRedo={redo}
          disabledModes={classic ? ['height', 'slope', 'hole'] : []}
        />
      )}

      {/* Middle workspace: Menu Studio, or the 2D map and the 3D viewport */}
      <main ref={workspaceRef} className="ide-workspace">
        {isMenuStudioOpen && !isPlayFullscreen ? (
          <MenuStudioWorkspace
            menuPack={campaignSettings.menus || createDefaultMenuPack(levelTitle || 'GRIDFORGE 3D')}
            gameTitle={levelTitle || 'GRIDFORGE 3D'}
            textures={allTextures}
            campaignLevelNames={campaignLevelSummaries.map((l) => l.title)}
            onChangeMenuPack={(nextMenus) => campaign.handleUpdateCampaignSettings({ ...campaignSettings, menus: nextMenus })}
            onLaunch3DTestWithMainMenu={() => {
              preparePlay();
              setIsMenuStudioOpen(false);
              setStartInMainMenu(true);
              setViewMode('play');
              setIsPlayFullscreen(true);
              setEngineLog(
                '3D Menu Test Play: Booted into custom Main Menu with live 3D background diorama. Click Start Game or press ESC in-game!'
              );
            }}
          />
        ) : (
          <>
            {!isPlayFullscreen && (
              <>
                <div style={{ width: `${splitRatioPct}%` }} className="h-full min-w-[220px] shrink-0 overflow-hidden flex flex-col">
                  <LayerBar
                    activeLayer={activeLayer}
                    layerCount={layerCount + 1}
                    onSelectLayer={setActiveLayer}
                    onAddLayer={layers.handleAddLayer}
                    onRemoveTopLayer={layers.handleRemoveTopLayer}
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
                      onStrokeStart={ctx.beginStroke}
                      onCellInteract={handleCellInteract}
                      onEraseCell={map.handleEraseCell}
                      onDropTextureOnCell={map.handleDropTextureOnCell}
                      onDropModelOnCell={entity.handleDropModelOnCell}
                      onHoverCellChange={setHoveredCell}
                      playerTransform={spawnTransform}
                      spawn={view.spawn}
                      onClearGrid={map.handleClearGrid}
                      onBorderWalls={map.handleBorderWalls}
                      onDropVariantOnCell={entity.handleDropVariantOnCell}
                      allowOverlap={allowOverlap}
                      onToggleAllowOverlap={handleToggleAllowOverlap}
                      collectedKeys={collectedKeys}
                      openDoors={openDoors}
                    />
                  </div>
                </div>

                {/* Draggable vertical splitter */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize 2D Map Editor and 3D Viewport"
                  onPointerDown={() => setIsDraggingSplitter(true)}
                  className={`ide-splitter ${isDraggingSplitter ? 'ide-splitter--dragging' : ''}`}
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
                  onSelectEntity={entity.handleSelectEntity3D}
                  onSelectCell={handleSelectCell3D}
                  onCommitEntityTransform={entity.handleCommitEntityTransform}
                  onDeleteEntity={entity.handleRemoveEntity}
                  onWalkSurfaceBaked={entity.handleWalkSurfaceBaked}
                  onModelBoundsMeasured={entity.handleModelBoundsMeasured}
                  onDropModel={entity.handleDropModel3D}
                  onDropVariant={entity.handleDropVariant3D}
                  onDropTexture={map.handleDropTexture3D}
                  onEnterPlay={() => {
                    // Start the game from the level as it is now, layers and heights included
                    preparePlay();
                    setStartInMainMenu(false);
                    setViewMode('play');
                    setEngineLog('Test Play: Click the view to look around; press Edit to go back to building.');
                  }}
                />
              ) : (
                playSim && (
                  <Viewport3D
                    vertical={view.vertical}
                    campaignLevels={campaignLevelsV3}
                    activeLevelIndex={activeIndex}
                    campaignSettings={campaignSettings}
                    startInMainMenu={startInMainMenu}
                    onCampaignLevelChange={handleRuntimeCampaignLevelChange}
                    onExitPlay={() => {
                      setViewMode('edit');
                      setStartInMainMenu(false);
                      if (isPlayFullscreen) setIsPlayFullscreen(false);
                      setEngineLog('Edit mode: Fly with the right mouse button held and W/A/S/D/Q/E.');
                    }}
                    grid={view.grid}
                    wallTextures={view.wallTextures}
                    floorTextures={view.floorTextures}
                    ceilingTextures={view.ceilingTextures}
                    customTextures={customTextures}
                    entities={view.entities}
                    spawn={view.spawn}
                    showCeiling={view.showCeiling}
                    onToggleCeiling={handleToggleCeiling}
                    minimapEnabled={view.minimapEnabled}
                    onToggleMinimap={handleToggleMinimap}
                    isPlayFullscreen={isPlayFullscreen}
                    onTogglePlayFullscreen={handleTogglePlayFullscreen}
                    skyboxTheme={view.skyboxTheme}
                    skyboxSeed={view.skyboxSeed}
                    simState={playSim}
                    resetSignal={resetSignal}
                    onEngineLog={setEngineLog}
                  />
                )
              )}
            </div>
          </>
        )}
      </main>

      {/* Right properties inspector */}
      {!isPlayFullscreen && !isMenuStudioOpen && (
        <PropertiesInspector
          selectedCell={selectedCell}
          grid={activeLayerData.grid}
          wallTextures={activeLayerData.wallTextures}
          floorTextures={activeLayerData.floorTextures}
          ceilingTextures={activeLayerData.ceilingTextures}
          activeLayer={activeLayer}
          layerData={activeLayerData}
          onSetTileVertical={map.handleSetTileVertical}
          movement={view.vertical.movement}
          onUpdateMovement={layers.handleUpdateMovement}
          classic={classic}
          onToggleClassic={layers.handleToggleClassic}
          verticalFeatures={layers.verticalFeatures}
          selectedEntityId={selectedEntityId}
          layerCount={layerCount + 1}
          textures={allTextures}
          recentTextureIds={catalog.recentTextureIds}
          selectedTextureId={selectedTextureId}
          onSelectTexture={handleSelectTexture}
          targetSurface={targetSurface}
          onChangeTargetSurface={handleChangeTargetSurface}
          onAddCustomTexture={catalog.handleAddCustomTexture}
          onAssignCellTexture={map.handleAssignCellTextureFromInspector}
          onFillSurfaceWithTexture={map.handleFillSurfaceWithTexture}
          onSetCellType={map.handleSetCellType}
          spawn={view.spawn}
          onSetSpawnCell={map.handleSetSpawnCell}
          onRotateSpawn={map.handleRotateSpawn}
          entities={activeLayerEntities}
          model3DAssets={catalog.allModel3DAssets}
          selectedModelAssetId={catalog.selectedModelAssetId}
          onSelectModelAsset={catalog.handleSelectModelAsset}
          onAddCustomModel3DAsset={catalog.handleAddCustomModel3DAsset}
          onUpdateEntity={entity.handleUpdateEntity}
          onPlaceEntityAtCell={entity.handlePlaceEntityFromInspector}
          onRemoveEntity={entity.handleRemoveEntity}
          getLibrarySettings={catalog.getLibrarySettings}
          skyboxTheme={view.skyboxTheme}
          onChangeSkyboxTheme={handleChangeSkyboxTheme}
          skyboxSeed={view.skyboxSeed}
          onRegenerateSkybox={handleRegenerateSkybox}
          showCeiling={view.showCeiling}
          onToggleCeiling={handleToggleCeiling}
          minimapEnabled={view.minimapEnabled}
          onToggleMinimap={handleToggleMinimap}
          onBorderWalls={map.handleBorderWalls}
          onClearGrid={map.handleClearGrid}
          onResizeMap={map.handleResizeMap}
          campaignLevels={campaignLevelSummaries}
          activeLevelIndex={activeIndex}
          levelTitle={levelTitle}
          onSelectCampaignLevel={campaign.handleSelectCampaignLevel}
          onRenameCampaignLevel={campaign.handleRenameCampaignLevel}
          onAddCampaignLevel={campaign.handleAddCampaignLevel}
          onDuplicateCampaignLevel={campaign.handleDuplicateCampaignLevel}
          onDeleteCampaignLevel={campaign.handleDeleteCampaignLevel}
          onMoveCampaignLevel={campaign.handleMoveCampaignLevel}
          campaignSettings={campaignSettings}
          onUpdateCampaignSettings={campaign.handleUpdateCampaignSettings}
          onPlaceExitOnSelectedCell={files.handlePlaceExitOnSelectedCell}
          libraryState={modelLibrary.libraryState}
          onLibraryChange={modelLibrary.setLibraryState}
          selectedVariantKey={modelLibrary.selectedVariant?.key ?? null}
          onPickVariant={catalog.handlePickVariant}
          onModelAdded={modelLibrary.handleModelAdded}
          onRemoveUploadedModel={modelLibrary.handleRemoveUploadedModel}
          onExportLibrary={modelLibrary.handleExportLibrary}
          onImportLibraryFile={modelLibrary.handleImportLibraryFile}
          gitHubRepoInput={catalog.gitHubRepoInput}
          isSyncingGitHubAssets={catalog.isSyncingGitHubAssets}
          gitHubAssetsStats={catalog.gitHubAssetsStats}
          onSyncGitHubAssets={catalog.handleSyncGitHubAssets}
        />
      )}

      <BottomStatusBar
        engineLog={engineLog}
        pastHistoryCount={past.length}
        futureHistoryCount={future.length}
        activeCoord={activeCoord}
        playerTransform={spawnTransform}
        wallCount={wallCount}
        entityCount={view.entities.length}
      />

      {/* Engine architecture and JSON state inspector */}
      {isArchModalOpen && (
        <ArchitectureModal
          isOpen={isArchModalOpen}
          onClose={() => setIsArchModalOpen(false)}
          levelState={files.buildCurrentLevelState()}
          onImportLevelState={files.handleRestoreLevelState}
        />
      )}

      {/* Visual events and triggers (mounted only while open so each open starts from the level's data) */}
      {isEventEditorOpen && (
        <EventTriggerEditorModal
          isOpen={isEventEditorOpen}
          onClose={() => setIsEventEditorOpen(false)}
          events={view.events}
          regions={view.regions}
          variables={view.variables}
          grid={view.grid}
          gridSize={view.gridSize}
          onSaveLevelData={files.handleSaveLevelDataFromEditor}
        />
      )}

      {/* Game export */}
      {isExportModalOpen && (
        <ExportModal
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          levelState={files.buildCurrentLevelState()}
          setEngineLog={setEngineLog}
        />
      )}
    </div>
  );
}
