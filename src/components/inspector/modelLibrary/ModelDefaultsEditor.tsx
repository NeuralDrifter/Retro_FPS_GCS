import React from 'react';
import type {
  ModelCategoryId,
  ModelCollision,
  ModelSettings,
  ResolvedModelSettings,
} from '../../../types/modelLibrary';
import { MODEL_CATEGORIES } from '../../../engine/modelLibrary/categories';
import { SIM_CONFIG } from '../../../engine/sim/types';
import { RotateCcw } from 'lucide-react';

interface ModelDefaultsEditorProps {
  settings: ResolvedModelSettings;
  /** Moves the model into the category's folder (and adopts that category) */
  onChangeCategory: (category: ModelCategoryId) => void;
  onChangeSettings: (patch: ModelSettings) => void;
}

const clampCells = (v: number) =>
  Math.max(1, Math.min(SIM_CONFIG.MAX_FOOTPRINT_CELLS, Math.trunc(v) || 1));

/**
 * Library defaults for one model: what new placements start with. Changing
 * them never alters copies already placed in a level.
 */
export const ModelDefaultsEditor: React.FC<ModelDefaultsEditorProps> = ({
  settings,
  onChangeCategory,
  onChangeSettings,
}) => (
  <div className="space-y-1.5">
    <span className="ide-label block">Defaults for new placements</span>
    <div className="grid grid-cols-2 gap-1.5">
      <select
        value={settings.category}
        onChange={(e) => onChangeCategory(e.target.value as ModelCategoryId)}
        aria-label="Category"
        className="ide-select w-full"
      >
        {MODEL_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        value={settings.collision}
        onChange={(e) => onChangeSettings({ collision: e.target.value as ModelCollision })}
        aria-label="Collision"
        className="ide-select w-full"
      >
        <option value="solid">Solid</option>
        <option value="nonSolid">Non-solid</option>
      </select>
    </div>
    <div className="flex items-center gap-1.5">
      {(['footprintW', 'footprintD'] as const).map((key) => (
        <label key={key} className="flex items-center gap-1 flex-1">
          <span className="ide-label">{key === 'footprintW' ? 'W' : 'D'}</span>
          <input
            type="number"
            min={1}
            max={SIM_CONFIG.MAX_FOOTPRINT_CELLS}
            value={settings[key]}
            onChange={(e) =>
              onChangeSettings({
                footprintW: settings.footprintW,
                footprintD: settings.footprintD,
                [key]: clampCells(Number(e.target.value)),
                footprintOverride: true,
              })
            }
            className="ide-input w-full font-mono"
          />
        </label>
      ))}
      <label className="flex items-center gap-1 flex-1">
        <span className="ide-label">Scale</span>
        <input
          type="number"
          min={0.01}
          max={5}
          step={0.01}
          value={settings.scale}
          onChange={(e) =>
            onChangeSettings({
              scale: Math.max(0.01, Math.min(5, Number(e.target.value) || 1)),
            })
          }
          className="ide-input w-full font-mono"
        />
      </label>
      <button
        type="button"
        onClick={() => onChangeSettings({ footprintOverride: false })}
        disabled={!settings.footprintOverride}
        className="ide-btn !px-1"
        title="Use the footprint measured from the model"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
    </div>
  </div>
);
