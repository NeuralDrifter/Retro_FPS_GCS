import React, { useRef, useState } from 'react';
import {
  Model3DAsset,
  SurfaceTarget,
  TextureAsset,
} from '../../types/engine';
import {
  AssetRegistry,
  computeDeterministicAssetId,
} from '../../engine/AssetRegistry';
import { Model3DThumbnailSvg } from './Model3DThumbnailSvg';
import { Box, Check, GripVertical, PaintBucket, Upload } from 'lucide-react';

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
}

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
  isEnemy: boolean;
  customCount: number;
  customGlbUrl: string;
}): Model3DAsset {
  return {
    id: params.id,
    blueprintId: 'custom-glb',
    name: params.name,
    sourceType: params.sourceType,
    isEnemy: params.isEnemy,
    defaultHealth: params.isEnemy
      ? DEFAULT_CUSTOM_ENEMY_HEALTH
      : DEFAULT_CUSTOM_PROP_HEALTH,
    moveSpeed: params.isEnemy ? DEFAULT_CUSTOM_ENEMY_SPEED : 0,
    attackDamage: params.isEnemy ? DEFAULT_CUSTOM_ENEMY_DAMAGE : 0,
    accentHex: params.isEnemy ? '#10B981' : '#38BDF8',
    badgeText: `G${params.customCount}`,
    customGlbUrl: params.customGlbUrl,
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
}) => {
  const [texFilter, setTexFilter] = useState<'all' | 'uploaded'>('all');
  const [modelFilter, setModelFilter] = useState<'all' | 'uploaded'>('all');
  const [draggingTexId, setDraggingTexId] = useState<string | null>(null);
  const [draggingModelId, setDraggingModelId] = useState<string | null>(null);
  const [isTexFileDropOver, setIsTexFileDropOver] = useState(false);
  const [isGlbFileDropOver, setIsGlbFileDropOver] = useState(false);
  const [newGlbAsEnemy, setNewGlbAsEnemy] = useState(true);

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
  const displayedModels =
    modelFilter === 'uploaded' ? uploadedModels : model3DAssets;

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
        id: computeDeterministicAssetId(
          'glb',
          `${file.name}:${file.size}:${newGlbAsEnemy ? 'enemy' : 'prop'}`
        ),
        name: sanitizeAssetLabel(file.name, `Custom .glb #${customCount}`),
        sourceType: 'file',
        isEnemy: newGlbAsEnemy,
        customCount,
        customGlbUrl: objectUrl,
      })
    );
    onAddCustomModel3DAsset(newModel);
    onSelectModelAsset(newModel.id);
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
        isEnemy: newGlbAsEnemy,
        customCount,
        customGlbUrl: trimmed,
      })
    );
    onAddCustomModel3DAsset(newModel);
    onSelectModelAsset(newModel.id);
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
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setModelFilter('all')}
                className={`ide-btn !h-[18px] !px-2 !text-[10px] ${
                  modelFilter === 'all' ? 'ide-btn--active' : ''
                }`}
              >
                All ({model3DAssets.length})
              </button>
              <button
                type="button"
                onClick={() => setModelFilter('uploaded')}
                className={`ide-btn !h-[18px] !px-2 !text-[10px] ${
                  modelFilter === 'uploaded' ? 'ide-btn--active' : ''
                }`}
              >
                Uploaded ({uploadedModels.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => setNewGlbAsEnemy((prev) => !prev)}
              className={`ide-btn !h-[18px] !px-2 !text-[10px] ${
                newGlbAsEnemy ? 'ide-btn--active' : ''
              }`}
              title="Default AI classification for newly uploaded .glb models"
            >
              <Box className="w-2.5 h-2.5" />
              <span>{newGlbAsEnemy ? 'New: Enemy AI' : 'New: Prop'}</span>
            </button>
          </div>

          {displayedModels.length === 0 ? (
            <div className="p-3 bg-[#181818] border border-dashed border-[#3e3e42] text-center text-[11px] text-[#858585]">
              No custom 3D .glb models uploaded yet. Drop a .glb/.gltf file
              below or switch to &ldquo;All&rdquo; to drag built-in 3D models.
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
                        {model.isEnemy
                          ? `ENEMY · ${model.defaultHealth}HP`
                          : 'STATIC PROP'}
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
        </div>
      </div>
    </>
  );
};
