import React, { useEffect, useState } from 'react';
import {
  CampaignSettings,
  ENGINE_CONFIG,
  SKYBOX_THEMES,
  SkyboxThemeId,
} from '../../types/engine';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  DoorOpen,
  Heart,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';

const MAP_SIZE_PRESETS = [16, 32, 64, 128];

export interface CampaignLevelSummary {
  title: string;
  gridSize: number;
  entityCount: number;
  hasExitTrigger: boolean;
}

interface WorldSettingsTabProps {
  skyboxTheme: SkyboxThemeId;
  onChangeSkyboxTheme: (theme: SkyboxThemeId) => void;
  skyboxSeed: number;
  onRegenerateSkybox: () => void;
  showCeiling: boolean;
  onToggleCeiling: () => void;
  minimapEnabled: boolean;
  onToggleMinimap: () => void;
  onBorderWalls: () => void;
  onClearGrid: () => void;
  gridSize: number;
  onResizeMap: (size: number) => void;
  campaignLevels: CampaignLevelSummary[];
  activeLevelIndex: number;
  levelTitle: string;
  onSelectCampaignLevel: (index: number) => void;
  onRenameCampaignLevel: (title: string) => void;
  onAddCampaignLevel: () => void;
  onDuplicateCampaignLevel: () => void;
  onDeleteCampaignLevel: (index: number) => void;
  onMoveCampaignLevel: (index: number, direction: -1 | 1) => void;
  campaignSettings: CampaignSettings;
  onUpdateCampaignSettings: (settings: CampaignSettings) => void;
  selectedCell: { row: number; col: number };
  onPlaceExitOnSelectedCell: () => void;
}

export const WorldSettingsTab: React.FC<WorldSettingsTabProps> = ({
  skyboxTheme,
  onChangeSkyboxTheme,
  skyboxSeed,
  onRegenerateSkybox,
  showCeiling,
  onToggleCeiling,
  minimapEnabled,
  onToggleMinimap,
  onBorderWalls,
  onClearGrid,
  gridSize,
  onResizeMap,
  campaignLevels,
  activeLevelIndex,
  levelTitle,
  onSelectCampaignLevel,
  onRenameCampaignLevel,
  onAddCampaignLevel,
  onDuplicateCampaignLevel,
  onDeleteCampaignLevel,
  onMoveCampaignLevel,
  campaignSettings,
  onUpdateCampaignSettings,
  selectedCell,
  onPlaceExitOnSelectedCell,
}) => {
  const [sizeDraft, setSizeDraft] = useState<string>(String(gridSize));
  useEffect(() => setSizeDraft(String(gridSize)), [gridSize]);

  const draftSize = Math.trunc(Number(sizeDraft));
  const isDraftValid =
    Number.isFinite(draftSize) &&
    draftSize >= ENGINE_CONFIG.MIN_GRID_SIZE &&
    draftSize <= ENGINE_CONFIG.MAX_GRID_SIZE;

  return (
    <>
      <div>
        <div className="ide-section-header">
          <span>Campaign &amp; Gameplay Levels</span>
          <span className="font-mono text-[#38bdf8]">
            {activeLevelIndex + 1}/{campaignLevels.length}
          </span>
        </div>
        <div className="p-2.5 space-y-2.5">
          <div>
            <span className="ide-label block mb-1">
              Active Level Title (Level {activeLevelIndex + 1})
            </span>
            <input
              type="text"
              value={levelTitle}
              onChange={(e) => onRenameCampaignLevel(e.target.value)}
              placeholder={`Level ${activeLevelIndex + 1}`}
              aria-label="Active level title"
              className="ide-input w-full"
            />
          </div>

          <div className="space-y-1">
            <span className="ide-label block">
              Game Level Sequence ({campaignLevels.length}{' '}
              {campaignLevels.length === 1 ? 'Level' : 'Levels'})
            </span>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
              {campaignLevels.map((lvl, idx) => {
                const isActive = idx === activeLevelIndex;
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-1 rounded-[2px] border px-1.5 py-1 text-[11px] ${
                      isActive
                        ? 'border-[#38bdf8] bg-[#0c2336]/80 text-white'
                        : 'border-[#333336] bg-[#1e1e1e] text-[#cccccc] hover:border-[#4b5563]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectCampaignLevel(idx)}
                      className="flex-1 min-w-0 text-left flex items-center justify-between gap-1.5 cursor-pointer"
                      title={`Switch editor to Level ${idx + 1}: ${lvl.title}`}
                    >
                      <span className="truncate font-medium">
                        <span className="font-mono text-[10px] text-[#38bdf8] mr-1">
                          #{idx + 1}
                        </span>
                        {lvl.title || `Level ${idx + 1}`}
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        {lvl.hasExitTrigger && (
                          <span
                            className="px-1 py-0.2 text-[9px] font-mono uppercase rounded bg-[#064e3b] text-[#34d399] border border-[#059669]/60"
                            title="Has an Exit Level trigger"
                          >
                            EXIT
                          </span>
                        )}
                        <span className="font-mono text-[9px] text-[#858585]">
                          {lvl.gridSize}×{lvl.gridSize}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onMoveCampaignLevel(idx, -1)}
                        className="p-0.5 text-[#858585] hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move level earlier in campaign"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === campaignLevels.length - 1}
                        onClick={() => onMoveCampaignLevel(idx, 1)}
                        className="p-0.5 text-[#858585] hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move level later in campaign"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={campaignLevels.length <= 1}
                        onClick={() => onDeleteCampaignLevel(idx)}
                        className="p-0.5 text-[#858585] hover:text-[#f48771] disabled:opacity-30 cursor-pointer"
                        title={
                          campaignLevels.length <= 1
                            ? 'A game requires at least 1 level'
                            : `Delete Level ${idx + 1}`
                        }
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onAddCampaignLevel}
              className="ide-btn ide-btn--primary justify-center"
              title="Create a new empty gameplay level at the end of the campaign"
            >
              <Plus className="w-3 h-3" />
              <span>Add Level</span>
            </button>
            <button
              type="button"
              onClick={onDuplicateCampaignLevel}
              className="ide-btn justify-center"
              title="Duplicate the current gameplay level as a new level"
            >
              <Copy className="w-3 h-3" />
              <span>Duplicate</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onPlaceExitOnSelectedCell}
            className="ide-btn w-full justify-between text-[#34d399] border-[#059669]/60 hover:border-[#10b981]"
            title="Places an Exit Level trigger on the currently selected cell so stepping onto it (or pressing E) finishes this level and advances to the next campaign level"
          >
            <span className="flex items-center gap-1.5">
              <DoorOpen className="w-3 h-3 text-[#34d399]" />
              <span>
                Set Cell [X:{selectedCell.col}, Z:{selectedCell.row}] as Level Exit
              </span>
            </span>
            <span className="font-mono text-[9px] uppercase text-[#34d399]">
              +Trigger
            </span>
          </button>

          <div className="pt-1.5 border-t border-[#333336] space-y-1.5">
            <span className="ide-label block flex items-center gap-1">
              <Layers className="w-3 h-3 text-[#38bdf8]" />
              <span>Between-Level Player Carry-Over</span>
            </span>

            <button
              type="button"
              onClick={() =>
                onUpdateCampaignSettings({
                  ...campaignSettings,
                  carryOverHealth: !campaignSettings.carryOverHealth,
                })
              }
              className={`ide-btn w-full justify-between ${
                campaignSettings.carryOverHealth ? 'ide-btn--active' : ''
              }`}
              title="When ON, the player keeps their remaining Health when advancing to the next gameplay level. When OFF, Health resets to 100 on each level."
            >
              <span className="flex items-center gap-1.5">
                <Heart className="w-3 h-3 text-[#f87171]" />
                <span>Carry Over Health Between Levels</span>
              </span>
              <span className="font-mono">
                {campaignSettings.carryOverHealth ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateCampaignSettings({
                  ...campaignSettings,
                  carryOverAmmo: !campaignSettings.carryOverAmmo,
                })
              }
              className={`ide-btn w-full justify-between ${
                campaignSettings.carryOverAmmo ? 'ide-btn--active' : ''
              }`}
              title="When ON, the player keeps their remaining Ammo when advancing to the next gameplay level. When OFF, Ammo resets to 32 on each level."
            >
              <span className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-[#fbbf24]" />
                <span>Carry Over Ammo Between Levels</span>
              </span>
              <span className="font-mono">
                {campaignSettings.carryOverAmmo ? 'ON' : 'OFF'}
              </span>
            </button>

            <p className="text-[10px] leading-snug text-[#858585]">
              When a player triggers an <code className="text-[#34d399]">exit_level</code> event, they advance to the next level in sequence. Carry-over settings apply in both Test Play and exported games.
            </p>
          </div>
        </div>
      </div>

      <div>
        <div className="ide-section-header">
          <span>Map Size</span>
          <span className="font-mono text-[#858585]">
            {gridSize}×{gridSize}
          </span>
        </div>
        <div className="p-2.5 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {MAP_SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => onResizeMap(size)}
                className={`ide-btn justify-center ${
                  gridSize === size ? 'ide-btn--active' : ''
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              type="number"
              min={ENGINE_CONFIG.MIN_GRID_SIZE}
              max={ENGINE_CONFIG.MAX_GRID_SIZE}
              value={sizeDraft}
              onChange={(e) => setSizeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isDraftValid) onResizeMap(draftSize);
              }}
              aria-label="Custom map size"
              className="ide-input flex-1 min-w-0"
            />
            <button
              type="button"
              disabled={!isDraftValid || draftSize === gridSize}
              onClick={() => onResizeMap(draftSize)}
              className="ide-btn ide-btn--primary"
            >
              Resize
            </button>
          </div>
          <p className="text-[10px] leading-snug text-[#858585]">
            {ENGINE_CONFIG.MIN_GRID_SIZE}–{ENGINE_CONFIG.MAX_GRID_SIZE} cells per
            side. Growing adds empty cells on the right and bottom; shrinking
            crops them (Ctrl+Z to undo).
          </p>
        </div>
      </div>

      <div>
        <div className="ide-section-header">
          <span>3D Skybox &amp; Atmosphere</span>
          <span className="font-mono text-[#858585]">Seed #{skyboxSeed}</span>
        </div>
        <div className="p-2.5 space-y-2">
          <div className="space-y-1">
            <span className="ide-label block">Skybox Theme</span>
            {SKYBOX_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => onChangeSkyboxTheme(theme.id)}
                className={`ide-btn w-full justify-between ${
                  skyboxTheme === theme.id ? 'ide-btn--active' : ''
                }`}
              >
                <span>{theme.label}</span>
                <span className="font-mono text-[10px] opacity-75">
                  #{theme.fogHex.toString(16).padStart(6, '0')}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRegenerateSkybox}
            className="ide-btn ide-btn--primary w-full"
          >
            <Sparkles className="w-3 h-3" />
            <span>Generate New Skybox Variation</span>
          </button>
        </div>
      </div>

      <div>
        <div className="ide-section-header">
          <span>Viewport &amp; Level Operations</span>
        </div>
        <div className="p-2.5 space-y-1.5">
          <button
            type="button"
            onClick={onToggleCeiling}
            className={`ide-btn w-full justify-between ${
              showCeiling ? 'ide-btn--active' : ''
            }`}
          >
            <span>Render Ceiling Mesh</span>
            <span className="font-mono">{showCeiling ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMinimap}
            className={`ide-btn w-full justify-between ${
              minimapEnabled ? 'ide-btn--active' : ''
            }`}
          >
            <span>In-Game Minimap Radar [M]</span>
            <span className="font-mono">{minimapEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <div className="pt-2 flex gap-1.5">
            <button
              type="button"
              onClick={onBorderWalls}
              className="ide-btn flex-1"
            >
              Perimeter Walls
            </button>
            <button
              type="button"
              onClick={onClearGrid}
              className="ide-btn flex-1 text-[#f48771]"
            >
              Clear Grid
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
