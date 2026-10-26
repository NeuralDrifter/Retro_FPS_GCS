import React, { useMemo, useRef, useState } from 'react';
import {
  Model3DAsset,
  PlacedEntity,
  SurfaceTarget,
  TextureAsset,
} from '../../types/engine';
import type {
  ModelCategoryId,
  ModelLibraryState,
  PlacementVariant,
} from '../../types/modelLibrary';
import {
  createFolder,
  deleteFolder,
  filterModels,
  getFolderCategory,
  moveModelToFolder,
  renameFolder,
  resolveModelFolder,
  resolveModelSettings,
  setModelTags,
} from '../../engine/modelLibrary/libraryState';
import { getCategoryInfo } from '../../engine/modelLibrary/categories';
import { groupPlacementsIntoVariants } from '../../engine/modelLibrary/variants';
import { ModelFolderTree } from './modelLibrary/ModelFolderTree';
import { ModelLibraryFilters } from './modelLibrary/ModelLibraryFilters';
import { UsedInLevelList } from './modelLibrary/UsedInLevelList';
import { ModelTagEditor } from './modelLibrary/ModelTagEditor';
import {
  AssetRegistry,
  computeDeterministicAssetId,
} from '../../engine/AssetRegistry';
import { Model3DThumbnailSvg } from './Model3DThumbnailSvg';
import { uploadedModelId } from '../../engine/modelLibrary/uploadStore';
import { Check, Download, GripVertical, PaintBucket, Trash2, Upload } from 'lucide-react';

interface AssetLibraryTabProps {
  textures: TextureAsset[];
  selectedTextureId: string;
  onSelectTexture: (id: string) => void;
  targetSurface: SurfaceTarget;
  onChangeTargetSurface: (surface: SurfaceTarget) => void;
  onAddCustomTexture: (asset: TextureAsset) => void;
  onFillSurfaceWithTexture: (surface: SurfaceTarget, textureId: string) => void;
  model3DAssets: Model3DAsset[];
  selectedModelAssetId: string;
  onSelectModelAsset: (assetId: string) => void;
  onAddCustomModel3DAsset: (asset: Model3DAsset) => void;
  libraryState: ModelLibraryState;
  onLibraryChange: (next: ModelLibraryState) => void;
  placedEntities: PlacedEntity[];
  selectedVariantKey: string | null;
  onPickVariant: (variant: PlacementVariant) => void;
  /** Called with the original file so it can be kept across reloads */
  onModelFileUploaded: (file: File, asset: Model3DAsset) => void;
  onRemoveUploadedModel: (modelId: string) => void;
  onExportLibrary: () => void;
  onImportLibraryFile: (file: File) => void;
}

/** Uploaded or URL-linked models (not built-ins or project folder files) can be removed */
const isRemovableModel = (m: Model3DAsset): boolean =>
  m.id.startsWith('glb-') && (m.sourceType === 'file' || m.sourceType === 'url');

const DEFAULT_CUSTOM_ENEMY_HEALTH = 85;
const DEFAULT_CUSTOM_PROP_HEALTH = 50;
const DEFAULT_CUSTOM_ENEMY_SPEED = 4.5;
const DEFAULT_CUSTOM_ENEMY_DAMAGE = 14;
const MAX_ASSET_LABEL_LENGTH = 18;

function sanitizeAssetLabel(filenameOrUrl: string, fallback: string): string {
  const leaf = filenameOrUrl.split('/').pop() || filenameOrUrl;
  const stripped = leaf.replace(/\.[^/.]+$/, '').slice(0, MAX_ASSET_LABEL_LENGTH);
  return stripped || fallback;
}

function buildCustomModel3DAsset(params: {
  id: string;
  name: string;
  sourceType: 'file' | 'url';
  category: ModelCategoryId;
  customCount: number;
  customGlbUrl: string;
}): Model3DAsset {
  const isEnemy = params.category === 'characters';
  return {
    id: params.id,
    blueprintId: 'custom-glb',
    name: params.name,
    sourceType: params.sourceType,
    isEnemy: isEnemy,
    defaultHealth: isEnemy
      ? DEFAULT_CUSTOM_ENEMY_HEALTH
      : DEFAULT_CUSTOM_PROP_HEALTH,
    moveSpeed: isEnemy ? DEFAULT_CUSTOM_ENEMY_SPEED : 0,
    attackDamage: isEnemy ? DEFAULT_CUSTOM_ENEMY_DAMAGE : 0,
    accentHex: isEnemy ? '#10B981' : '#38BDF8',
    badgeText: `G${params.customCount}`,
    customGlbUrl: params.customGlbUrl,
    category: params.category,
  };
}

export const AssetLibraryTab: React.FC<AssetLibraryTabProps> = ({
  textures,
  selectedTextureId,
  onSelectTexture,
  targetSurface,
  onChangeTargetSurface,
  onAddCustomTexture,
  onFillSurfaceWithTexture,
  model3DAssets,
  selectedModelAssetId,
  onSelectModelAsset,
  onAddCustomModel3DAsset,
  libraryState,
  onLibraryChange,
  placedEntities,
  selectedVariantKey,
  onPickVariant,
  onModelFileUploaded,
  onRemoveUploadedModel,
  onExportLibrary,
  onImportLibraryFile,
}) => {
  const [texFilter, setTexFilter] = useState<'all' | 'uploaded'>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [usedOnly, setUsedOnly] = useState(false);
  const libraryFileInputRef = useRef<HTMLInputElement | null>(null);
  const [draggingTexId, setDraggingTexId] = useState<string | null>(null);
  const [draggingModelId, setDraggingModelId] = useState<string | null>(null);
  const [isTexFileDropOver, setIsTexFileDropOver] = useState(false);
  const [isGlbFileDropOver, setIsGlbFileDropOver] = useState(false);

  const texFileInputRef = useRef<HTMLInputElement | null>(null);
  const glbFileInputRef = useRef<HTMLInputElement | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [glbUrlInput, setGlbUrlInput] = useState('');

  const uploadedTextures = textures.filter(
    (t) => t.sourceType === 'file' || t.sourceType === 'url'
  );
  const displayedTextures =
    texFilter === 'uploaded' ? uploadedTextures : textures;

  const uploadedModels = model3DAssets.filter(
    (m) => m.sourceType === 'file' || m.sourceType === 'url'
  );
  const usedModelIds = useMemo(
    () =>
      new Set(
        placedEntities.map((e) => e.modelAssetId ?? e.blueprintId)
      ),
    [placedEntities]
  );
  const variants = useMemo(
    () => groupPlacementsIntoVariants(placedEntities),
    [placedEntities]
  );
  const displayedModels = filterModels(model3DAssets, libraryState, {
    folderId: selectedFolderId,
    search: modelSearch,
    tags: selectedTags,
    usedModelIds: usedOnly ? usedModelIds : null,
  });
  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of model3DAssets) {
      for (const tag of libraryState.modelTags[m.id] ?? m.tags ?? []) {
        if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [model3DAssets, libraryState.modelTags]);
  const selectedModel = model3DAssets.find((m) => m.id === selectedModelAssetId);
  // New uploads land in the open folder (or Decorations when viewing all models)
  const uploadFolderId = selectedFolderId ?? 'cat:decorations';
  const uploadCategory = getFolderCategory(libraryState, uploadFolderId);

  const addModelToLibrary = (newModel: Model3DAsset) => {
    onAddCustomModel3DAsset(newModel);
    onLibraryChange(moveModelToFolder(libraryState, newModel.id, uploadFolderId));
    onSelectModelAsset(newModel.id);
  };

  const applyLibraryEdit = (edit: () => ModelLibraryState) => {
    try {
      onLibraryChange(edit());
    } catch {
      // Invalid names and built-in folder edits are ignored
    }
  };

  const processUploadedImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const newAsset = AssetRegistry.registerTexture({
        id: computeDeterministicAssetId('tex', reader.result),
        name: sanitizeAssetLabel(file.name, 'Custom Texture'),
        sourceType: 'file',
        previewUrl: reader.result,
        recommendedSurface: targetSurface,
      });
      onAddCustomTexture(newAsset);
      onSelectTexture(newAsset.id);
    };
    reader.readAsDataURL(file);
  };

  const handleTextureFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(processUploadedImageFile);
    e.target.value = '';
  };

  const handleAddTextureUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    const newAsset = AssetRegistry.registerTexture({
      id: computeDeterministicAssetId('tex', trimmed),
      name: `URL Tex #${uploadedTextures.length + 1}`,
      sourceType: 'url',
      previewUrl: trimmed,
      recommendedSurface: targetSurface,
    });
    onAddCustomTexture(newAsset);
    onSelectTexture(newAsset.id);
    setUrlInput('');
  };

  const processUploadedGlbFile = (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const customCount = uploadedModels.length + 1;
    const newModel = AssetRegistry.registerModel(
      buildCustomModel3DAsset({
        id: uploadedModelId(file.name, file.size),
        name: sanitizeAssetLabel(file.name, `Custom .glb #${customCount}`),
        sourceType: 'file',
        category: uploadCategory,
        customCount,
        customGlbUrl: objectUrl,
      })
    );
    addModelToLibrary(newModel);
    onModelFileUploaded(file, newModel);
  };

  const handleGlbFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(processUploadedGlbFile);
    e.target.value = '';
  };

  const handleApplyGlbUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = glbUrlInput.trim();
    if (!trimmed) return;
    const customCount = uploadedModels.length + 1;
    const newModel = AssetRegistry.registerModel(
      buildCustomModel3DAsset({
        id: computeDeterministicAssetId('glb', trimmed),
        name: sanitizeAssetLabel(trimmed, `Remote .glb #${customCount}`),
        sourceType: 'url',
        category: uploadCategory,
        customCount,
        customGlbUrl: trimmed,
      })
    );
    addModelToLibrary(newModel);
    setGlbUrlInput('');
  };

  const handleTextureDragStart = (
    e: React.DragEvent<HTMLElement>,
    tex: TextureAsset
  ) => {
    e.dataTransfer.setData('application/pie3d-texture-id', tex.id);
    e.dataTransfer.setData('text/plain', `tex:${tex.id}`);
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingTexId(tex.id);
    onSelectTexture(tex.id);
  };

  const handleModelDragStart = (
    e: React.DragEvent<HTMLElement>,
    model: Model3DAsset
  ) => {
    e.dataTransfer.setData('application/pie3d-model-id', model.id);
    e.dataTransfer.setData('text/plain', `model:${model.id}`);
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingModelId(model.id);
    onSelectModelAsset(model.id);
  };

  return (
    <>
      {/* 1. TEXTURE ASSET LIBRARY: DRAG-AND-DROP TEXTURE THUMBNAILS */}
      <div>
        <div className="ide-section-header">
          <span>1. Texture Assets ({displayedTextures.length})</span>
          <span className="font-mono text-[#4ec9b0] text-[9px]">
            DRAG TO 2D GRID
          </span>
        </div>

        <div className="p-2.5 space-y-2.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="ide-label">Drop / Paint Target Surface</span>
              <span className="font-mono text-[10px] text-[#478cbf] uppercase">
                {targetSurface}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {(['wall', 'floor', 'ceiling'] as SurfaceTarget[]).map((surf) => (
                <button
                  key={surf}
                  type="button"
                  onClick={() => onChangeTargetSurface(surf)}
                  className={`ide-btn flex-1 capitalize ${
                    targetSurface === surf ? 'ide-btn--active' : ''
                  }`}
                >
                  {surf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-1 pt-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTexFilter('all')}
                className={`ide-btn !h-[18px] !px-2 !text-[10px] ${
                  texFilter === 'all' ? 'ide-btn--active' : ''
                }`}
              >
                All ({textures.length})
              </button>
              <button
                type="button"
                onClick={() => setTexFilter('uploaded')}
                className={`ide-btn !h-[18px] !px-2 !text-[10px] ${
                  texFilter === 'uploaded' ? 'ide-btn--active' : ''
                }`}
              >
                Uploaded ({uploadedTextures.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                onFillSurfaceWithTexture(targetSurface, selectedTextureId)
              }
              className="ide-btn !h-[18px] !px-2 !text-[10px]"
              title={`Fill all ${targetSurface} cells with active texture`}
            >
              <PaintBucket className="w-2.5 h-2.5" />
              <span>Fill {targetSurface}s</span>
            </button>
          </div>

          {displayedTextures.length === 0 ? (
            <div className="p-3 bg-[#181818] border border-dashed border-[#3e3e42] text-center text-[11px] text-[#858585]">
              No custom textures uploaded yet. Upload an image file below or
              switch to &ldquo;All&rdquo; to drag built-in textures.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {displayedTextures.map((tex) => {
                const isSelected = tex.id === selectedTextureId;
                const isBeingDragged = tex.id === draggingTexId;
                return (
                  <div
                    key={tex.id}
                    draggable={true}
                    onDragStart={(e) => handleTextureDragStart(e, tex)}
                    onDragEnd={() => setDraggingTexId(null)}
                    onClick={() => onSelectTexture(tex.id)}
                    title={`Drag '${tex.name}' onto any 2D Grid cell (applies to ${targetSurface})`}
                    className={`group relative p-1.5 rounded-[2px] border text-left cursor-grab active:cursor-grabbing select-none transition-colors ${
                      isBeingDragged
                        ? 'border-[#4ec9b0] bg-[#094771]/70 opacity-75'
                        : isSelected
                        ? 'border-[#478cbf] bg-[#094771]/50'
                        : 'border-[#333333] bg-[#181818] hover:border-[#555558]'
                    }`}
                  >
                    <div className="relative w-full aspect-square bg-[#111111] overflow-hidden border border-[#2d2d30]">
                      <img
                        src={tex.previewUrl}
                        alt={tex.name}
                        draggable={false}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      <span className="absolute top-1 left-1 px-1 py-0.5 bg-[#181818]/85 border border-[#3e3e42] text-[9px] font-mono text-[#cccccc] flex items-center gap-0.5">
                        <GripVertical className="w-2.5 h-2.5 text-[#478cbf]" />
                        <span>DRAG</span>
                      </span>
                      {isSelected && (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-[#478cbf] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] font-medium truncate text-[#cccccc]">
                        {tex.name}
                      </span>
                      <span className="text-[9px] font-mono uppercase text-[#858585] shrink-0">
                        {tex.sourceType === 'procedural'
                          ? 'STD'
                          : tex.sourceType.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <input
            ref={texFileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleTextureFileUpload}
            className="hidden"
          />
          <div
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setIsTexFileDropOver(true);
              }
            }}
            onDragLeave={() => setIsTexFileDropOver(false)}
            onDrop={(e) => {
              if (e.dataTransfer.files?.length) {
                e.preventDefault();
                setIsTexFileDropOver(false);
                Array.from(e.dataTransfer.files).forEach(
                  processUploadedImageFile
                );
              }
            }}
            onClick={() => texFileInputRef.current?.click()}
            className={`p-2 border border-dashed rounded-[2px] text-center cursor-pointer transition-colors ${
              isTexFileDropOver
                ? 'border-[#4ec9b0] bg-[#094771]/30 text-white'
                : 'border-[#3e3e42] bg-[#181818] hover:border-[#478cbf] text-[#cccccc]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium">
              <Upload className="w-3.5 h-3.5 text-[#478cbf]" />
              <span>Upload Image Texture(s)</span>
            </div>
            <div className="text-[9px] text-[#858585] mt-0.5">
              Click to browse or drop PNG/JPG/WebP files here
            </div>
          </div>

          <form onSubmit={handleAddTextureUrl} className="flex gap-1">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste Texture URL (https://...)"
              className="ide-input flex-1"
            />
            <button
              type="submit"
              disabled={!urlInput.trim()}
              className="ide-btn ide-btn--primary"
            >
              Add
            </button>
          </form>
        </div>
      </div>

      {/* 2. 3D MODEL ASSET LIBRARY (.GLB): DRAG-AND-DROP 3D THUMBNAILS */}
      <div>
        <div className="ide-section-header">
          <span>2. 3D Model Assets (.glb) ({displayedModels.length})</span>
          <span className="font-mono text-[#4ec9b0] text-[9px]">
            DRAG TO 2D GRID
          </span>
        </div>

        <div className="p-2.5 space-y-2.5">
          <ModelFolderTree
            state={libraryState}
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            onCreateFolder={(name, parentId) =>
              applyLibraryEdit(() => createFolder(libraryState, name, parentId).state)
            }
            onRenameFolder={(id, name) =>
              applyLibraryEdit(() => renameFolder(libraryState, id, name))
            }
            onDeleteFolder={(id) => {
              applyLibraryEdit(() => deleteFolder(libraryState, id));
              if (selectedFolderId === id) setSelectedFolderId(null);
            }}
            onDropModel={(modelId, folderId) =>
              onLibraryChange(moveModelToFolder(libraryState, modelId, folderId))
            }
          />

          <ModelLibraryFilters
            search={modelSearch}
            onSearch={setModelSearch}
            allTags={allTags}
            selectedTags={selectedTags}
            onToggleTag={(tag) =>
              setSelectedTags((prev) =>
                prev.some((t) => t.toLowerCase() === tag.toLowerCase())
                  ? prev.filter((t) => t.toLowerCase() !== tag.toLowerCase())
                  : [...prev, tag]
              )
            }
            usedOnly={usedOnly}
            onToggleUsedOnly={() => setUsedOnly((prev) => !prev)}
          />

          {usedOnly && (
            <div className="space-y-1">
              <span className="ide-label block">Placed in this level (variants)</span>
              <UsedInLevelList
                variants={variants}
                selectedVariantKey={selectedVariantKey}
                onPickVariant={onPickVariant}
              />
            </div>
          )}

          {displayedModels.length === 0 ? (
            <div className="p-3 bg-[#181818] border border-dashed border-[#3e3e42] text-center text-[11px] text-[#858585]">
              No models here. Pick another folder, clear the search or tag
              filters, or drop a .glb/.gltf file below.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5">
              {displayedModels.map((model) => {
                const isSelected = model.id === selectedModelAssetId;
                const isBeingDragged = model.id === draggingModelId;
                return (
                  <div
                    key={model.id}
                    draggable={true}
                    onDragStart={(e) => handleModelDragStart(e, model)}
                    onDragEnd={() => setDraggingModelId(null)}
                    onClick={() => onSelectModelAsset(model.id)}
                    title={`Drag 3D Model '${model.name}' onto any 2D Grid cell to spawn`}
                    className={`group relative p-1.5 rounded-[2px] border text-left cursor-grab active:cursor-grabbing select-none transition-colors ${
                      isBeingDragged
                        ? 'border-[#4ec9b0] bg-[#094771]/70 opacity-75'
                        : isSelected
                        ? 'border-[#478cbf] bg-[#094771]/50'
                        : 'border-[#333333] bg-[#181818] hover:border-[#555558]'
                    }`}
                  >
                    <div className="relative w-full aspect-square bg-[#111111] overflow-hidden border border-[#2d2d30]">
                      <Model3DThumbnailSvg
                        blueprintId={model.blueprintId}
                        accentHex={model.accentHex}
                        isEnemy={model.isEnemy}
                      />

                      <span className="absolute top-1 left-1 px-1 py-0.5 bg-[#181818]/90 border border-[#3e3e42] text-[9px] font-mono text-[#cccccc] flex items-center gap-0.5">
                        <GripVertical className="w-2.5 h-2.5 text-[#478cbf]" />
                        <span>DRAG</span>
                      </span>

                      {isSelected ? (
                        <span className="absolute top-1 right-1 w-4 h-4 bg-[#478cbf] text-white flex items-center justify-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      ) : (
                        <span
                          className="absolute top-1 right-1 px-1 py-0.5 text-[9px] font-mono font-bold border"
                          style={{
                            backgroundColor: `${model.accentHex}22`,
                            borderColor: model.accentHex,
                            color: model.accentHex,
                          }}
                        >
                          {model.badgeText}
                        </span>
                      )}

                      <span className="absolute bottom-1 left-1 right-1 px-1 py-0.5 bg-[#181818]/90 text-[9px] font-mono text-center truncate text-[#cccccc]">
                        {(() => {
                          const resolved = resolveModelSettings(libraryState, model);
                          const label = getCategoryInfo(resolved.category).label.toUpperCase();
                          return resolved.isEnemy
                            ? `${label} · ${resolved.maxHealth}HP`
                            : label;
                        })()}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="text-[10px] font-medium truncate text-[#cccccc]">
                        {model.name}
                      </span>
                      <span className="text-[9px] font-mono uppercase text-[#858585] shrink-0">
                        {model.sourceType === 'builtin'
                          ? 'GLB'
                          : model.sourceType.toUpperCase()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedModel && (
            <div className="p-2 bg-[#181818] border border-[#333333] space-y-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-[#cccccc] truncate">
                  {selectedModel.name}
                </span>
                {isRemovableModel(selectedModel) && (
                  <button
                    type="button"
                    onClick={() => onRemoveUploadedModel(selectedModel.id)}
                    className="ide-btn !h-[18px] !px-1.5 !text-[10px] text-[#f48771]"
                    title="Remove this model from the library (placed copies stay in the level)"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    <span>Remove</span>
                  </button>
                )}
              </div>
              <div className="font-mono text-[10px] text-[#858585]">
                {getCategoryInfo(resolveModelSettings(libraryState, selectedModel).category).label}
                {' · '}
                {libraryState.folders.find(
                  (f) => f.id === resolveModelFolder(libraryState, selectedModel)
                )?.name ?? ''}
              </div>
              <ModelTagEditor
                tags={libraryState.modelTags[selectedModel.id] ?? selectedModel.tags ?? []}
                onChange={(tags) =>
                  onLibraryChange(setModelTags(libraryState, selectedModel.id, tags))
                }
              />
            </div>
          )}

          <input
            ref={glbFileInputRef}
            type="file"
            accept=".glb,.gltf"
            multiple
            onChange={handleGlbFileUpload}
            className="hidden"
          />
          <div
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setIsGlbFileDropOver(true);
              }
            }}
            onDragLeave={() => setIsGlbFileDropOver(false)}
            onDrop={(e) => {
              if (e.dataTransfer.files?.length) {
                e.preventDefault();
                setIsGlbFileDropOver(false);
                Array.from(e.dataTransfer.files).forEach(processUploadedGlbFile);
              }
            }}
            onClick={() => glbFileInputRef.current?.click()}
            className={`p-2 border border-dashed rounded-[2px] text-center cursor-pointer transition-colors ${
              isGlbFileDropOver
                ? 'border-[#4ec9b0] bg-[#094771]/30 text-white'
                : 'border-[#3e3e42] bg-[#181818] hover:border-[#478cbf] text-[#cccccc]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5 text-[11px] font-medium">
              <Upload className="w-3.5 h-3.5 text-[#d14d41]" />
              <span>Upload 3D .glb Model(s)</span>
            </div>
            <div className="text-[9px] text-[#858585] mt-0.5">
              Click to browse or drop .glb / .gltf files here
            </div>
          </div>

          <form onSubmit={handleApplyGlbUrl} className="flex gap-1">
            <input
              type="url"
              value={glbUrlInput}
              onChange={(e) => setGlbUrlInput(e.target.value)}
              placeholder="Paste .glb URL (https://...)"
              className="ide-input flex-1"
            />
            <button
              type="submit"
              disabled={!glbUrlInput.trim()}
              className="ide-btn ide-btn--primary"
            >
              Add
            </button>
          </form>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onExportLibrary}
              className="ide-btn flex-1"
              title="Save folders, tags and model settings to a pie3d-library.json file"
            >
              <Download className="w-3 h-3" />
              <span>Export Library</span>
            </button>
            <button
              type="button"
              onClick={() => libraryFileInputRef.current?.click()}
              className="ide-btn flex-1"
              title="Load folders, tags and model settings from a pie3d-library.json file"
            >
              <Upload className="w-3 h-3" />
              <span>Import Library</span>
            </button>
            <input
              ref={libraryFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImportLibraryFile(file);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
        </div>
      </div>
    </>
  );
};
