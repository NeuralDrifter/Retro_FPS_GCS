import React, { useRef } from 'react';
import { MAP_PRESETS } from '../../types/engine';
import {
  Columns2,
  Download,
  FileCode2,
  FolderOpen,
  Play,
  Redo2,
  RotateCcw,
  Sliders,
  Undo2,
} from 'lucide-react';

interface TopMenuBarProps {
  pastHistoryCount: number;
  futureHistoryCount: number;
  nextUndoLabel: string | null;
  nextRedoLabel: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onLoadPreset: (presetId: string) => void;
  onSaveMap: () => void;
  onLoadMapFile: (file: File) => void;
  onOpenArchModal: () => void;
  onOpenEventEditor: () => void;
  isPlayFullscreen: boolean;
  onTogglePlayFullscreen: () => void;
  onRespawnPlayer: () => void;
}

export const TopMenuBar: React.FC<TopMenuBarProps> = ({
  pastHistoryCount,
  futureHistoryCount,
  nextUndoLabel,
  nextRedoLabel,
  onUndo,
  onRedo,
  onLoadPreset,
  onSaveMap,
  onLoadMapFile,
  onOpenArchModal,
  onOpenEventEditor,
  isPlayFullscreen,
  onTogglePlayFullscreen,
  onRespawnPlayer,
}) => {
  const loadMapInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <header className="ide-menubar">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 pr-2 border-r border-[#3e3e42]">
          <span className="w-2 h-2 bg-[#478cbf]" />
          <span className="font-semibold text-white tracking-tight">
            GridForge 3D
          </span>
          <span className="text-[10px] font-mono text-[#858585]">v3.0</span>
        </div>

        <div className="flex items-center gap-1 pr-2 border-r border-[#3e3e42]">
          <button
            type="button"
            onClick={onUndo}
            disabled={pastHistoryCount === 0}
            className="ide-btn !h-[20px]"
            title={
              nextUndoLabel
                ? `Undo: ${nextUndoLabel} (Ctrl+Z)`
                : 'Nothing to Undo (Ctrl+Z)'
            }
          >
            <Undo2 className="w-3 h-3 text-[#478cbf]" />
            <span>Undo</span>
            {pastHistoryCount > 0 && (
              <span className="font-mono text-[9px] text-[#858585]">
                ({pastHistoryCount})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={futureHistoryCount === 0}
            className="ide-btn !h-[20px]"
            title={
              nextRedoLabel
                ? `Redo: ${nextRedoLabel} (Ctrl+Y / Ctrl+Shift+Z)`
                : 'Nothing to Redo (Ctrl+Y)'
            }
          >
            <Redo2 className="w-3 h-3 text-[#478cbf]" />
            <span>Redo</span>
            {futureHistoryCount > 0 && (
              <span className="font-mono text-[9px] text-[#858585]">
                ({futureHistoryCount})
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="ide-label">Scene:</span>
          <select
            aria-label="Load Level Preset"
            onChange={(e) => onLoadPreset(e.target.value)}
            defaultValue="classic-maze"
            className="ide-select !h-[20px]"
          >
            {MAP_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onSaveMap}
          className="ide-btn !h-[20px]"
          title="Export Level State (Grid, Textures, Entities) to JSON"
        >
          <Download className="w-3 h-3 text-[#478cbf]" />
          <span>Save JSON</span>
        </button>

        <input
          ref={loadMapInputRef}
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoadMapFile(file);
            e.target.value = '';
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => loadMapInputRef.current?.click()}
          className="ide-btn !h-[20px]"
          title="Load Level State from JSON File"
        >
          <FolderOpen className="w-3 h-3" />
          <span>Load JSON</span>
        </button>

        <button
          type="button"
          onClick={onOpenArchModal}
          className="ide-btn !h-[20px]"
          title="Inspect Modular Engine Architecture & Raw JSON State"
        >
          <FileCode2 className="w-3 h-3" />
          <span>JSON / Docs</span>
        </button>

        <button
          type="button"
          onClick={onOpenEventEditor}
          className="ide-btn !h-[20px] text-[#4ec9b0]"
          title="Open Phase 4 Visual Event & Trigger Authoring IDE"
        >
          <Sliders className="w-3 h-3" />
          <span>Visual Triggers</span>
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onTogglePlayFullscreen}
          className={`ide-btn !h-[20px] ${
            isPlayFullscreen ? 'ide-btn--active' : ''
          }`}
          title="Toggle between Split Editor Layout and Fullscreen 3D Game View"
        >
          {isPlayFullscreen ? (
            <>
              <Columns2 className="w-3 h-3" />
              <span>Split Editor</span>
            </>
          ) : (
            <>
              <Play className="w-3 h-3 text-[#4ec9b0]" />
              <span>Play Game View</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onRespawnPlayer}
          className="ide-btn !h-[20px]"
          title="Respawn Player at Start Pad"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Respawn</span>
        </button>
      </div>
    </header>
  );
};
