import React from 'react';
import { SKYBOX_THEMES, SkyboxThemeId } from '../../types/engine';
import { Sparkles } from 'lucide-react';

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
}) => {
  return (
    <>
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
