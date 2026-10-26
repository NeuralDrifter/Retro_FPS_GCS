/**
 * ============================================================================
 * PIE3D MODEL LIBRARY HOOK (STATE, PERSISTENCE & UPLOAD RESTORE)
 * ============================================================================
 * Owns the global model library state for `App`: loads it from browser
 * storage, saves every change, files disk-folder models into library folders,
 * restores uploaded `.glb` files on startup, and exports / imports the
 * library file. Storage failures are reported once through `onLog`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Model3DAsset } from '../../../types/engine';
import type { ModelLibraryState, PlacementVariant } from '../../../types/modelLibrary';
import { AssetRegistry } from '../../../engine/AssetRegistry';
import { mergeDiscoveredFolders } from '../../../engine/modelLibrary/libraryState';
import {
  exportLibraryJson,
  getBrowserStorage,
  importLibraryJson,
  loadLibraryState,
  saveLibraryState,
} from '../../../engine/modelLibrary/libraryStorage';
import {
  deleteUploadedModel,
  getAllUploadedModels,
  putUploadedModel,
  recordToAsset,
} from '../../../engine/modelLibrary/uploadStore';

const STORAGE_WARNING =
  'Library: browser storage unavailable — changes last until reload. Use Export Library to keep them.';
const UPLOAD_WARNING =
  'Upload kept for this session only (browser storage full or blocked).';

const isUploadedModel = (m: Model3DAsset): boolean =>
  m.id.startsWith('glb-') && (m.sourceType === 'file' || m.sourceType === 'url');

export function useModelLibrary(params: {
  models: Model3DAsset[];
  onLog: (message: string) => void;
  /** Uploaded models restored from browser storage on startup */
  onRestoredUploads: (assets: Model3DAsset[]) => void;
  onRemoveModel: (modelId: string) => void;
}) {
  const { models, onLog, onRestoredUploads, onRemoveModel } = params;
  const [libraryState, setLibraryState] = useState<ModelLibraryState>(() =>
    loadLibraryState(getBrowserStorage())
  );
  const [selectedVariant, setSelectedVariant] = useState<PlacementVariant | null>(null);
  const warnedStorageRef = useRef(false);
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const onRestoredUploadsRef = useRef(onRestoredUploads);
  onRestoredUploadsRef.current = onRestoredUploads;

  useEffect(() => {
    if (!saveLibraryState(getBrowserStorage(), libraryState) && !warnedStorageRef.current) {
      warnedStorageRef.current = true;
      onLogRef.current(STORAGE_WARNING);
    }
  }, [libraryState]);

  // File models from project folders and the manifest into their library folders
  useEffect(() => {
    setLibraryState((prev) => mergeDiscoveredFolders(prev, models));
  }, [models]);

  useEffect(() => {
    let active = true;
    getAllUploadedModels().then((records) => {
      if (!active || records.length === 0) return;
      const restored = records
        .map((r) => recordToAsset(r, (blob) => URL.createObjectURL(blob)))
        .filter((a): a is Model3DAsset => a !== null);
      if (restored.length > 0) onRestoredUploadsRef.current(restored);
    });
    return () => {
      active = false;
    };
  }, []);

  // Every model the app knows about must be registered, or saved levels using it fail to load
  useEffect(() => {
    for (const m of models) AssetRegistry.registerModel(m);
  }, [models]);

  /** Keeps an uploaded file (or a URL-linked model's URL) so it survives reloads */
  const handleModelAdded = useCallback((asset: Model3DAsset, file?: File) => {
    const { customGlbUrl, ...meta } = asset;
    const record = file
      ? { id: asset.id, name: file.name, blob: file as Blob, meta }
      : { id: asset.id, name: asset.name, blob: null, meta: { ...meta, customGlbUrl } };
    putUploadedModel(record).then((ok) => {
      if (!ok) onLogRef.current(UPLOAD_WARNING);
    });
  }, []);

  const handleRemoveUploadedModel = useCallback(
    (modelId: string) => {
      void deleteUploadedModel(modelId);
      onRemoveModel(modelId);
      setLibraryState((prev) => {
        const { [modelId]: _folder, ...modelFolder } = prev.modelFolder;
        const { [modelId]: _tags, ...modelTags } = prev.modelTags;
        const { [modelId]: _settings, ...modelSettings } = prev.modelSettings;
        return { ...prev, modelFolder, modelTags, modelSettings };
      });
      onLogRef.current('Library: Removed model from the library (placed copies stay in the level).');
    },
    [onRemoveModel]
  );

  const handleExportLibrary = useCallback(() => {
    const json = exportLibraryJson(
      libraryState,
      models.filter(isUploadedModel).map((m) => ({ id: m.id, name: m.name }))
    );
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pie3d-library.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    onLogRef.current('Library: Exported folders, tags and model settings to pie3d-library.json.');
  }, [libraryState, models]);

  const handleImportLibraryFile = useCallback((file: File) => {
    file
      .text()
      .then((text) => {
        setLibraryState(importLibraryJson(text));
        onLogRef.current(`Library: Imported '${file.name}'.`);
      })
      .catch((err: unknown) => {
        onLogRef.current(
          `Library: ${err instanceof Error ? err.message : 'Could not read the library file.'}`
        );
      });
  }, []);

  return {
    libraryState,
    setLibraryState,
    selectedVariant,
    setSelectedVariant,
    handleModelAdded,
    handleRemoveUploadedModel,
    handleExportLibrary,
    handleImportLibraryFile,
  };
}
