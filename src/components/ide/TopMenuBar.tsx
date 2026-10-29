import React, { useRef } from 'react';
import { MAP_PRESETS } from '../../types/engine';
import {
  Columns2,
  Download,
  FileCode2,
  FolderOpen,
  PackageCheck,
  Play,
  Plus,
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
  campaignLevels: { title: string }[];
  activeLevelIndex: number;
  onSelectCampaignLevel: (index: number) => void;
  onAddCampaignLevel: () => void;
  onSaveMap: () => void;
  onLoadMapFile: (file: File) => void;
  onOpenArchModal: () => void;
  onOpenEventEditor: () => void;
  onOpenExportModal: () => void;
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
  campaignLevels,
  activeLevelIndex,
  onSelectCampaignLevel,
  onAddCampaignLevel,
  onSaveMap,
  onLoadMapFile,
  onOpenArchModal,
  onOpenEventEditor,
  onOpenExportModal,
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

        <div className="flex items-center gap-1 pr-2 border-r border-[#3e3e42]">
          <span className="ide-label text-[#38bdf8]">Level:</span>
          <select
            aria-label="Select Gameplay Level"
            value={activeLevelIndex}
            onChange={(e) => onSelectCampaignLevel(Number(e.target.value))}
            className="ide-select !h-[20px] max-w-[160px]"
            title="Switch active gameplay level in the campaign"
          >
            {campaignLevels.map((lvl, idx) => (
              <option key={idx} value={idx}>
                {idx + 1}/{campaignLevels.length}: {lvl.title || `Level ${idx + 1}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAddCampaignLevel}
            className="ide-btn !h-[20px] !px-1.5 text-[#38bdf8]"
            title="Add a new gameplay level to the campaign (configure carry-over in World tab)"
          >
            <Plus className="w-3 h-3" />
            <span>Level</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <span className="ide-label">Preset:</span>
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
          title="Export Level / Campaign State (Grid, Textures, Entities, All Levels) to JSON"
        >
          <Download className="w-3 h-3 text-[#478cbf]" />
          <span>Save JSON</span>
        </button>

        <button
          type="button"
          onClick={onOpenExportModal}
          className="ide-btn !h-[20px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium"
          title="Export Standalone Game (Vite/Three.js ZIP or Single Offline HTML)"
        >
          <PackageCheck className="w-3 h-3 text-[#38bdf8]" />
          <span>Export Game</span>
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
