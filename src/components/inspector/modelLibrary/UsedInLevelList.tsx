import React from 'react';
import type { PlacementVariant } from '../../../types/modelLibrary';
import { getCategoryInfo } from '../../../engine/modelLibrary/categories';

interface UsedInLevelListProps {
  variants: PlacementVariant[];
  selectedVariantKey: string | null;
  onPickVariant: (variant: PlacementVariant) => void;
}

/** Drag data carrying the id of a placed copy whose settings a new placement should copy */
export const VARIANT_DRAG_TYPE = 'application/gridforge-variant-entity-id';

/**
 * Models placed in the current level, one row per variant. Identical copies
 * count once ("x5"); a copy with different settings gets its own row.
 */
export const UsedInLevelList: React.FC<UsedInLevelListProps> = ({
  variants,
  selectedVariantKey,
  onPickVariant,
}) => {
  if (variants.length === 0) {
    return (
      <div className="p-2 bg-[#181818] border border-dashed border-[#3e3e42] text-center text-[11px] text-[#858585]">
        No models placed in this level yet.
      </div>
    );
  }
  return (
    <ul className="border border-[#333333] bg-[#181818] divide-y divide-[#2d2d30]">
      {variants.map((v) => {
        const s = v.settings;
        const label = s.category ? getCategoryInfo(s.category).label : '';
        return (
          <li
            key={v.key}
            draggable={true}
            onDragStart={(e) => {
              e.dataTransfer.setData(VARIANT_DRAG_TYPE, v.sampleEntityId);
              e.dataTransfer.setData('text/plain', `variant:${v.sampleEntityId}`);
              e.dataTransfer.effectAllowed = 'copy';
              onPickVariant(v);
            }}
            onClick={() => onPickVariant(v)}
            title="Click to place copies with these settings, or drag onto the 2D grid"
            className={`px-1.5 py-1 cursor-grab text-[11px] ${
              selectedVariantKey === v.key ? 'bg-[#094771]/60 text-white' : 'text-[#cccccc] hover:bg-[#2a2d2e]'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{v.name}</span>
              <span className="font-mono text-[#4ec9b0] shrink-0">×{v.count}</span>
            </div>
            <div className="font-mono text-[9px] text-[#858585] truncate">
              {label} · {s.collision === 'nonSolid' ? 'non-solid' : 'solid'} · {s.footprintW}×{s.footprintD} cells
              {s.scale !== undefined && s.scale !== 1 ? ` · ×${s.scale}` : ''}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
