/**
 * ============================================================================
 * GRIDFORGE 3D DESKTOP IDE — ARCHITECTURE & JSON STATE SERIALIZATION DIALOG
 * ============================================================================
 */

import React, { useState } from 'react';
import { LevelStateData } from '../types/engine';
import { LevelSerializer } from '../engine/LevelSerializer';
import { X, Copy, Check, Download, FileCode2, Layers } from 'lucide-react';

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
  levelState: LevelStateData;
  onImportLevelState: (state: LevelStateData) => void;
}

export const ArchitectureModal: React.FC<ArchitectureModalProps> = ({
  isOpen,
  onClose,
  levelState,
  onImportLevelState,
}) => {
  const [copied, setCopied] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const serializedLevel = JSON.stringify(levelState, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(serializedLevel);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    LevelSerializer.downloadLevelJson(levelState);
  };

  const handleApplyJson = () => {
    try {
      const parsedState = LevelSerializer.parseLevelJson(jsonInput);
      onImportLevelState(parsedState);
      setImportError(null);
      onClose();
    } catch (err) {
      setImportError(
        err instanceof Error
          ? err.message
          : 'Invalid JSON syntax. Please check your level JSON format.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="bg-[#252526] border border-[#3e3e42] max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* IDE Dialog Header */}
        <div className="ide-panel-header !h-[28px] !px-3">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-3.5 h-3.5 text-[#478cbf]" />
            <span>GridForge 3D Architecture & JSON State Inspector</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ide-btn !h-[20px] !px-1.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-4 text-xs text-[#cccccc]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="p-2.5 bg-[#1e1e1e] border border-[#333333]">
              <div className="flex items-center gap-1.5 text-[#478cbf] font-semibold mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>1. Texture Manager (`engine/TextureGenerator.ts`)</span>
              </div>
              <p className="text-[11px] text-[#858585] leading-relaxed">
                Resolves per-cell wall, floor, and ceiling texture IDs with{' '}
                <code className="text-[#cccccc]">
                  TextureLoader.setCrossOrigin(&apos;anonymous&apos;)
                </code>{' '}
                and sRGB anisotropy caching.
              </p>
            </div>

            <div className="p-2.5 bg-[#1e1e1e] border border-[#333333]">
              <div className="flex items-center gap-1.5 text-[#478cbf] font-semibold mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>2. GLB Entity Loader (`engine/EntityLoader.ts`)</span>
              </div>
              <p className="text-[11px] text-[#858585] leading-relaxed">
                Loads <code className="text-[#cccccc]">.glb</code> models via{' '}
                <code className="text-[#cccccc]">GLTFLoader</code> +{' '}
                <code className="text-[#cccccc]">DRACOLoader</code>, clones
                skeletons via <code className="text-[#cccccc]">SkeletonUtils</code>
                , and clones materials per instance for hit-flash effects.
              </p>
            </div>

            <div className="p-2.5 bg-[#1e1e1e] border border-[#333333]">
              <div className="flex items-center gap-1.5 text-[#478cbf] font-semibold mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>3. Raycaster Combat (`engine/CombatSystem.ts`)</span>
              </div>
              <p className="text-[11px] text-[#858585] leading-relaxed">
                Attaches a 3D Plasma Rifle to the camera, casts a center{' '}
                <code className="text-[#cccccc]">THREE.Raycaster</code> on fire,
                decrements ammo, and triggers a 0.12s red enemy hit flash.
              </p>
            </div>

            <div className="p-2.5 bg-[#1e1e1e] border border-[#333333]">
              <div className="flex items-center gap-1.5 text-[#478cbf] font-semibold mb-1">
                <Layers className="w-3.5 h-3.5" />
                <span>4. Enemy AI & Loot (`engine/EnemyAISystem.ts`)</span>
              </div>
              <p className="text-[11px] text-[#858585] leading-relaxed">
                Runs a delta-time (<code className="text-[#cccccc]">dt</code>)
                Finite State Machine (<code className="text-[#cccccc]">Idle</code>
                , <code className="text-[#cccccc]">Chase</code> via LOS
                Raycaster, <code className="text-[#cccccc]">Attack</code>,{' '}
                <code className="text-[#cccccc]">Dead</code>) and spawns 3D{' '}
                <code className="text-[#cccccc]">Ammo</code> pickups.
              </p>
            </div>
          </div>

          {/* Live Serialized Level JSON */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="ide-label">
                Serialized LevelStateData JSON ({levelState.entities.length}{' '}
                Entities, {levelState.customTextures.length} Custom Textures)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="ide-btn"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[#4ec9b0]" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="ide-btn ide-btn--primary"
                >
                  <Download className="w-3 h-3" />
                  <span>Save Map (.json)</span>
                </button>
              </div>
            </div>
            <pre className="p-2.5 bg-[#181818] border border-[#333333] font-mono text-[11px] text-[#cccccc] overflow-x-auto max-h-44">
              {serializedLevel}
            </pre>
          </div>

          {/* Paste Custom LevelStateData JSON */}
          <div className="space-y-1.5">
            <label htmlFor="import-json" className="ide-label block">
              Paste Saved Level JSON to Rebuild World
            </label>
            <textarea
              id="import-json"
              rows={3}
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste a saved GridForge 3D LevelStateData JSON object here..."
              className="w-full p-2 bg-[#181818] border border-[#333333] font-mono text-[11px] text-white focus:outline-none focus:border-[#478cbf]"
            />
            {importError && (
              <p className="text-[11px] text-[#d14d41]">{importError}</p>
            )}
            <button
              type="button"
              onClick={handleApplyJson}
              disabled={!jsonInput.trim()}
              className="ide-btn ide-btn--primary"
            >
              Rebuild Level from JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
