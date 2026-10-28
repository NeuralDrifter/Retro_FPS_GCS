/**
 * ============================================================================
 * LAYER SELECTOR & HEIGHT TOOL SETTINGS (ABOVE THE 2D MAP)
 * ============================================================================
 * Picks which stacked layer the 2D map edits (like a floor selector in a
 * building), adds or removes layers, and holds the Height/Slope tool settings.
 */

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { EditorToolMode } from '../types/engine';
import { ENGINE_CONFIG } from '../runtime/types';
import { SIM_CONFIG } from '../runtime/sim';

const METERS_PER_UNIT = ENGINE_CONFIG.CELL_SIZE / SIM_CONFIG.CELL_UNITS;
/** Height steps offered, in sim units (125 = 0.5 m) */
const STEP_CHOICES = [25, 50, 125, 250, 500, 1000];

interface LayerBarProps {
  activeLayer: number;
  layerCount: number;
  onSelectLayer: (layer: number) => void;
  onAddLayer: () => void;
  onRemoveTopLayer: () => void;
  toolMode: EditorToolMode;
  heightTarget: 'floor' | 'ceiling';
  onHeightTargetChange: (target: 'floor' | 'ceiling') => void;
  heightStep: number;
  onHeightStepChange: (step: number) => void;
  heightRaise: boolean;
  onHeightRaiseChange: (raise: boolean) => void;
  /** Classic retro levels keep one floor, so no layers can be added */
  classic?: boolean;
}

export const LayerBar: React.FC<LayerBarProps> = ({
  activeLayer,
  layerCount,
  onSelectLayer,
  onAddLayer,
  onRemoveTopLayer,
  toolMode,
  heightTarget,
  onHeightTargetChange,
  heightStep,
  onHeightStepChange,
  heightRaise,
  onHeightRaiseChange,
  classic = false,
}) => {
  const chip = (active: boolean) =>
    `px-1.5 py-0.5 text-[10px] rounded transition-colors ${
      active ? 'bg-[#478cbf] text-white font-semibold' : 'text-[#9d9d9d] hover:text-white hover:bg-[#2d2d30]'
    }`;
  const showHeightSettings = toolMode === 'height' || toolMode === 'slope';

  return (
    <div className="flex flex-col gap-1 px-2 py-1 bg-[#252526] border-b border-[#3e3e42] text-[10px] text-[#cccccc]">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="font-semibold text-white mr-1">Layer</span>
        {/* Highest layer first, like the floor buttons in a lift */}
        {Array.from({ length: layerCount }, (_, i) => layerCount - 1 - i).map((layer) => (
          <button
            key={layer}
            type="button"
            className={chip(layer === activeLayer)}
            onClick={() => onSelectLayer(layer)}
            title={layer === 0 ? 'Ground layer' : `Layer ${layer} (${layer * 4} m up)`}
          >
            {layer}
          </button>
        ))}
        <button
          type="button"
          className="p-0.5 rounded text-[#9d9d9d] hover:text-white hover:bg-[#2d2d30] disabled:opacity-30"
          onClick={onAddLayer}
          disabled={classic}
          title={
            classic
              ? 'Classic retro movement keeps one floor (World tab)'
              : 'Add a layer on top (starts solid; carve rooms into it)'
          }
          aria-label="Add layer"
        >
          <Plus className="w-3 h-3" />
        </button>
        <button
          type="button"
          className="p-0.5 rounded text-[#9d9d9d] hover:text-white hover:bg-[#2d2d30] disabled:opacity-30"
          onClick={onRemoveTopLayer}
          disabled={layerCount <= 1}
          title="Remove the top layer and the models on it"
          aria-label="Remove top layer"
        >
          <Minus className="w-3 h-3" />
        </button>
        {classic && <span className="ml-1 text-[#858585]">Classic retro: one floor</span>}
        {activeLayer > 0 && (
          <span className="ml-1 text-[#858585]">The layer below shows faintly through solid tiles</span>
        )}
      </div>

      {showHeightSettings && (
        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" className={chip(heightTarget === 'floor')} onClick={() => onHeightTargetChange('floor')}>
            Floor
          </button>
          <button
            type="button"
            className={chip(heightTarget === 'ceiling')}
            onClick={() => onHeightTargetChange('ceiling')}
          >
            Ceiling
          </button>
          <span className="mx-1 text-[#3e3e42]">|</span>
          {toolMode === 'height' && (
            <>
              <button type="button" className={chip(heightRaise)} onClick={() => onHeightRaiseChange(true)}>
                Raise
              </button>
              <button type="button" className={chip(!heightRaise)} onClick={() => onHeightRaiseChange(false)}>
                Lower
              </button>
              <span className="mx-1 text-[#3e3e42]">|</span>
            </>
          )}
          <span>{toolMode === 'slope' ? 'Slope rise' : 'Step'}</span>
          <select
            value={heightStep}
            onChange={(e) => onHeightStepChange(Number(e.target.value))}
            className="bg-[#1e1e1e] border border-[#3e3e42] rounded px-1 py-0.5 text-[10px]"
          >
            {STEP_CHOICES.map((u) => (
              <option key={u} value={u}>
                {(u * METERS_PER_UNIT).toFixed(2)} m
              </option>
            ))}
          </select>
          <span className="text-[#858585]">
            {toolMode === 'height'
              ? 'Click or drag over tiles'
              : `Click a tile to turn its ${heightTarget} slope: N, E, S, W, flat`}
          </span>
        </div>
      )}
    </div>
  );
};
