/**
 * The textures and models the editor can use: built-ins, the asset folders, the GitHub asset
 * library, uploads, and the model library's per-model settings. This is the catalog to pick
 * from, not project data; placed copies and painted cells live in the project document.
 * Moved out of App in P2.4.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_ENTITY_BLUEPRINTS,
  Model3DAsset,
  PlacedEntity,
  TextureAsset,
} from '../types/engine';
import { EntityLoader, TextureGenerator } from '../../runtime';
import { AssetFolderLoader, parseGitHubRepoSpec } from '../engine/AssetFolderLoader';
import { DEFAULT_GITHUB_ASSETS_REPO } from '../engine/gitHubAssets';
import { LIBRARY_VERSION, fetchLibrary } from '../library/libraryIndex';
import { AssetRegistry } from '../engine/AssetRegistry';
import { useModelLibrary } from '../components/inspector/modelLibrary/useModelLibrary';
import { resolveModelSettings, setModelSettings } from '../engine/modelLibrary/libraryState';
import { getCategoryInfo } from '../engine/modelLibrary/categories';
import {
  collectUsedTextureIdsFromMatrices,
  loadRecentTextureIds,
  recordRecentTexture,
  saveRecentTextureIds,
} from '../engine/textureLibrary';

export interface UseAssetCatalogOptions {
  log: (message: string) => void;
  /** Texture matrices of the opening level, to seed the recent textures list */
  initialTextureMatrices: string[][][];
  /** A model was deleted from the library: its copies leave the project and its history */
  onModelRemoved: (modelId: string) => void;
  /** Stored models moved to new ids (`renamed` maps old to new) */
  onModelIdsRenamed: (renamed: Record<string, string>) => void;
  /** Switches the editor to the model placement tool */
  onUseModelTool: () => void;
}

/** True for the default assets repository, which the editor uses only as the pinned library */
function isLibraryRepo(input: string): boolean {
  const spec = parseGitHubRepoSpec(input);
  return Boolean(spec && `${spec.owner}/${spec.repo}`.toLowerCase() === DEFAULT_GITHUB_ASSETS_REPO.toLowerCase());
}

function mergeById<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const byId = new Map(prev.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return [...byId.values()];
}

function addMissing<T extends { id: string }>(prev: T[], incoming: T[]): T[] {
  const existing = new Set(prev.map((t) => t.id));
  const fresh = incoming.filter((t) => !existing.has(t.id));
  return fresh.length > 0 ? [...prev, ...fresh] : prev;
}

export function useAssetCatalog({
  log,
  initialTextureMatrices,
  onModelRemoved,
  onModelIdsRenamed,
  onUseModelTool,
}: UseAssetCatalogOptions) {
  const logRef = useRef(log);
  logRef.current = log;
  const autoDiscoveredFolderAssets = useMemo(() => AssetFolderLoader.getAutoDiscoveredSrcAssets(), []);

  // ------------------------------------------------------------------ textures
  const builtInTextures = useMemo(() => TextureGenerator.getBuiltInTextureAssets(), []);
  const [customTextures, setCustomTextures] = useState<TextureAsset[]>(() => autoDiscoveredFolderAssets.textures);
  const allTextures = useMemo(() => [...builtInTextures, ...customTextures], [builtInTextures, customTextures]);
  const [recentTextureIds, setRecentTextureIds] = useState<string[]>(() =>
    loadRecentTextureIds(collectUsedTextureIdsFromMatrices(initialTextureMatrices))
  );
  const trackRecentTexture = useCallback((texId: string) => {
    setRecentTextureIds((prev) => {
      const next = recordRecentTexture(prev, texId);
      saveRecentTextureIds(next);
      return next;
    });
  }, []);
  /** Textures that arrived with an opened project file */
  const addCustomTextures = useCallback((textures: TextureAsset[]) => {
    setCustomTextures((prev) => mergeById(prev, textures));
  }, []);
  const handleAddCustomTexture = useCallback(
    (asset: TextureAsset) => {
      setCustomTextures((prev) => [...prev, asset]);
      trackRecentTexture(asset.id);
    },
    [trackRecentTexture]
  );

  // -------------------------------------------------------------------- models
  const builtInModel3DAssets = useMemo<Model3DAsset[]>(
    () =>
      DEFAULT_ENTITY_BLUEPRINTS.filter((bp) => bp.id !== 'custom-glb').map((bp) => ({
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
      })),
    []
  );
  const [customModel3DAssets, setCustomModel3DAssets] = useState<Model3DAsset[]>(() => autoDiscoveredFolderAssets.models);
  const allModel3DAssets = useMemo<Model3DAsset[]>(
    () => [...builtInModel3DAssets, ...customModel3DAssets],
    [builtInModel3DAssets, customModel3DAssets]
  );
  const [selectedModelAssetId, setSelectedModelAssetId] = useState<string>('sentinel-bot');
  /** Models that arrived with an opened project file */
  const addCustomModels = useCallback((models: Model3DAsset[]) => {
    setCustomModel3DAssets((prev) => mergeById(prev, models));
  }, []);

  // ------------------------------------------------------- GitHub asset library
  const [gitHubRepoInput, setGitHubRepoInput] = useState<string>(() => AssetFolderLoader.getSavedGitHubRepoInput());
  const [isSyncingGitHubAssets, setIsSyncingGitHubAssets] = useState<boolean>(false);
  const [gitHubAssetsStats, setGitHubAssetsStats] = useState<{
    repoLabel: string;
    textures: number;
    models: number;
    error?: string;
  }>(() => ({ repoLabel: `Asset library ${LIBRARY_VERSION}`, textures: 0, models: 0 }));

  /** Loads the pinned version of the asset library (P2.7) */
  const loadPinnedLibrary = useCallback(async () => {
    setIsSyncingGitHubAssets(true);
    try {
      const library = await fetchLibrary();
      for (const t of library.textures) AssetRegistry.registerTexture(t);
      for (const m of library.models) AssetRegistry.registerModel(m);
      setCustomTextures((prev) => mergeById(prev, library.textures));
      setCustomModel3DAssets((prev) => mergeById(prev, library.models));
      const repoLabel = `Asset library ${library.version}`;
      setGitHubAssetsStats({ repoLabel, textures: library.textures.length, models: library.models.length });
      logRef.current(`Asset library ${library.version}: ${library.textures.length} textures and ${library.models.length} models.`);
    } catch (err) {
      const error = `The asset library could not be loaded (${err instanceof Error ? err.message : String(err)}).`;
      setGitHubAssetsStats((prev) => ({ ...prev, error }));
      logRef.current(error);
    } finally {
      setIsSyncingGitHubAssets(false);
    }
  }, []);

  const handleSyncGitHubAssets = useCallback(async (repoToLoad: string, forceRefresh = false) => {
    const targetRepo = repoToLoad.trim() || AssetFolderLoader.getSavedGitHubRepoInput();
    if (isLibraryRepo(targetRepo)) {
      // The default repository is the published library, always at its pinned version
      AssetFolderLoader.setSavedGitHubRepoInput(DEFAULT_GITHUB_ASSETS_REPO);
      setGitHubRepoInput(DEFAULT_GITHUB_ASSETS_REPO);
      await loadPinnedLibrary();
      return;
    }
    setIsSyncingGitHubAssets(true);
    const res = await AssetFolderLoader.fetchGitHubRepoAssets(targetRepo, { forceRefresh });
    setIsSyncingGitHubAssets(false);

    if (res.error || !res.spec) {
      const errMsg = res.error || 'Could not load GitHub assets repository.';
      setGitHubAssetsStats((prev) => ({ ...prev, repoLabel: targetRepo, error: errMsg }));
      logRef.current(`GitHub Assets: ${errMsg}`);
      return;
    }

    const repoLabel = `${res.spec.owner}/${res.spec.repo}@${res.spec.branch}`;
    AssetFolderLoader.setSavedGitHubRepoInput(repoLabel);
    setGitHubRepoInput(repoLabel);

    for (const t of res.textures) AssetRegistry.registerTexture(t);
    for (const m of res.models) AssetRegistry.registerModel(m);
    setCustomTextures((prev) => mergeById(prev, res.textures));
    setCustomModel3DAssets((prev) => mergeById(prev, res.models));

    setGitHubAssetsStats({ repoLabel, textures: res.textures.length, models: res.models.length });
    logRef.current(
      `GitHub Assets: Loaded ${res.textures.length} textures & ${res.models.length} 3D models from ${repoLabel}${
        res.fromCache ? ' (cached)' : ''
      }.`
    );
  }, [loadPinnedLibrary]);

  // On mount: assets listed in /public/assets/manifest.json, the pinned library, and a custom repo if one was chosen
  useEffect(() => {
    let active = true;
    AssetFolderLoader.fetchPublicManifestAssets().then((manifestAssets) => {
      if (!active) return;
      if (manifestAssets.textures.length > 0) {
        for (const t of manifestAssets.textures) AssetRegistry.registerTexture(t);
        setCustomTextures((prev) => addMissing(prev, manifestAssets.textures));
      }
      if (manifestAssets.models.length > 0) {
        for (const m of manifestAssets.models) AssetRegistry.registerModel(m);
        setCustomModel3DAssets((prev) => addMissing(prev, manifestAssets.models));
      }
    });
    void loadPinnedLibrary();
    const savedRepo = AssetFolderLoader.getSavedGitHubRepoInput();
    if (!isLibraryRepo(savedRepo)) void handleSyncGitHubAssets(savedRepo, false);
    return () => {
      active = false;
    };
  }, [handleSyncGitHubAssets, loadPinnedLibrary]);

  // ------------------------------------------------------------- model library
  const onModelRemovedRef = useRef(onModelRemoved);
  onModelRemovedRef.current = onModelRemoved;
  const onModelIdsRenamedRef = useRef(onModelIdsRenamed);
  onModelIdsRenamedRef.current = onModelIdsRenamed;

  const handleRestoredUploads = useCallback((restored: Model3DAsset[]) => {
    setCustomModel3DAssets((prev) => {
      const restoredIds = new Set(restored.map((m) => m.id));
      return [...prev.filter((m) => !restoredIds.has(m.id)), ...restored];
    });
  }, []);
  // Deleting a model is permanent: its copies leave the project and the undo / redo steps
  const handleRemoveModelAsset = useCallback((modelId: string) => {
    setCustomModel3DAssets((prev) => prev.filter((m) => m.id !== modelId));
    onModelRemovedRef.current(modelId);
    AssetRegistry.removeModelFile(modelId);
  }, []);
  // Placed copies (and undo / redo steps) follow stored models that moved to new ids
  const handleModelIdsRenamed = useCallback((renamed: Record<string, string>) => {
    onModelIdsRenamedRef.current(renamed);
    setSelectedModelAssetId((prev) => renamed[prev] ?? prev);
  }, []);
  const modelLibrary = useModelLibrary({
    models: allModel3DAssets,
    onLog: log,
    onRestoredUploads: handleRestoredUploads,
    onRemoveModel: handleRemoveModelAsset,
    onModelIdsRenamed: handleModelIdsRenamed,
  });
  const { libraryState, setLibraryState, setSelectedVariant } = modelLibrary;

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
      if (asset.id.startsWith('folder-glb-') && asset.id !== selectedModelAssetId) continue;
      const settings = resolveModelSettings(libraryState, asset);
      if (getCategoryInfo(settings.category).sizing !== 'real' || settings.measuredSizeMeters) continue;
      measuredAttemptsRef.current.add(asset.id);
      EntityLoader.measureModelSize(asset).then((size) => {
        if (!size) return;
        setLibraryState((prev) =>
          setModelSettings(prev, asset.id, { measuredSizeMeters: { width: size.width, depth: size.depth } })
        );
      });
    }
  }, [allModel3DAssets, libraryState, setLibraryState, selectedModelAssetId]);

  const getLibrarySettings = useCallback(
    (entity: PlacedEntity) => {
      const asset = allModel3DAssets.find((m) => m.id === (entity.modelAssetId ?? entity.blueprintId));
      return asset ? resolveModelSettings(libraryState, asset) : null;
    },
    [allModel3DAssets, libraryState]
  );

  const onUseModelToolRef = useRef(onUseModelTool);
  onUseModelToolRef.current = onUseModelTool;
  const handleSelectModelAsset = useCallback(
    (assetId: string) => {
      setSelectedModelAssetId(assetId);
      setSelectedVariant(null);
      onUseModelToolRef.current();
    },
    [setSelectedVariant]
  );
  const handlePickVariant = useCallback(
    (variant: NonNullable<typeof modelLibrary.selectedVariant>) => {
      setSelectedVariant(variant);
      setSelectedModelAssetId(variant.modelAssetId);
      onUseModelToolRef.current();
    },
    [setSelectedVariant]
  );
  const handleAddCustomModel3DAsset = useCallback((asset: Model3DAsset) => {
    setCustomModel3DAssets((prev) => [...prev.filter((m) => m.id !== asset.id), asset]);
    setSelectedModelAssetId(asset.id);
    onUseModelToolRef.current();
    logRef.current(`Asset Library: Imported 3D model '${asset.name}' — drag it onto any 2D grid cell!`);
  }, []);

  return {
    customTextures,
    allTextures,
    addCustomTextures,
    handleAddCustomTexture,
    recentTextureIds,
    trackRecentTexture,
    allModel3DAssets,
    addCustomModels,
    selectedModelAssetId,
    setSelectedModelAssetId,
    handleSelectModelAsset,
    handlePickVariant,
    handleAddCustomModel3DAsset,
    modelLibrary,
    getLibrarySettings,
    gitHubRepoInput,
    isSyncingGitHubAssets,
    gitHubAssetsStats,
    handleSyncGitHubAssets,
  };
}
