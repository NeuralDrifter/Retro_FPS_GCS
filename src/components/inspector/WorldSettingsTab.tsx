import React, { useEffect, useState } from 'react';
import { ENGINE_CONFIG, SKYBOX_THEMES, SkyboxThemeId } from '../../types/engine';
import { Sparkles } from 'lucide-react';

const MAP_SIZE_PRESETS = [16, 32, 64, 128];

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
          <span>3D Skybox & Atmosphere</span>
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
          <span>Viewport & Level Operations</span>
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
