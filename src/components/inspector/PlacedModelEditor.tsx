import React from 'react';
import {
  DEFAULT_ENTITY_BLUEPRINTS,
  EntityArchetypeId,
  PlacedEntity,
} from '../../types/engine';
import type {
  ModelCategoryId,
  ModelCollision,
  ResolvedModelSettings,
} from '../../types/modelLibrary';
import { SIM_CONFIG } from '../../runtime/sim/types';
import {
  MODEL_CATEGORIES,
  resolveEntityCategory,
} from '../../engine/modelLibrary/categories';
import { measuredFootprintAtScale } from '../../engine/modelLibrary/libraryState';
import { RotateCcw, Trash2 } from 'lucide-react';

interface PlacedModelEditorProps {
  entity: PlacedEntity;
  /** The library model's settings, used for "default / overridden" and Reset; null when unknown */
  librarySettings: ResolvedModelSettings | null;
  onUpdate: (updated: PlacedEntity) => void;
  onRemove: () => void;
}

const clampCells = (v: number) =>
  Math.max(1, Math.min(SIM_CONFIG.MAX_FOOTPRINT_CELLS, Math.trunc(v) || 1));

/** Shows whether a placed copy's setting matches its library model */
const OverrideBadge: React.FC<{ overridden: boolean | null }> = ({ overridden }) =>
  overridden === null ? null : (
    <span
      className={`font-mono text-[9px] ${overridden ? 'text-[#ce9178]' : 'text-[#858585]'}`}
    >
      {overridden ? 'overridden' : 'default'}
    </span>
  );

/**
 * Editor for one placed model: collision, footprint, scale, rotation, and,
 * for characters only, AI and combat stats.
 */
export const PlacedModelEditor: React.FC<PlacedModelEditorProps> = ({
  entity,
  librarySettings,
  onUpdate: onUpdateRaw,
  onRemove,
}) => {
  const category = resolveEntityCategory(entity);
  // Legacy copies have no stored category; writing it makes collision and footprint edits take effect
  const onUpdate = (updated: PlacedEntity) =>
    onUpdateRaw({ ...updated, category: updated.category ?? category });
  const isCharacter = category === 'characters';
  const collision: ModelCollision = entity.collision ?? 'solid';
  const footprintW = entity.footprintW ?? 1;
  const footprintD = entity.footprintD ?? 1;
  const differs = (a: unknown, b: unknown) => (librarySettings ? a !== b : null);
  // Measured footprint at this copy's own scale (falls back to the library's footprint)
  const measuredAt = (scale: number) =>
    (librarySettings && measuredFootprintAtScale(librarySettings, scale)) ?? {
      w: librarySettings?.footprintW ?? footprintW,
      d: librarySettings?.footprintD ?? footprintD,
    };
  const measured = measuredAt(entity.scale);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="ide-label">Label</span>
        <input
          type="text"
          value={entity.name}
          onChange={(e) => onUpdate({ ...entity, name: e.target.value })}
          className="ide-input w-40"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="ide-label">Category</span>
        <select
          value={category}
          onChange={(e) => {
            const next = e.target.value as ModelCategoryId;
            onUpdate({
              ...entity,
              category: next,
              ...(next === 'characters' ? {} : { isEnemy: false }),
            });
          }}
          className="ide-select w-40"
        >
          {MODEL_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="ide-label flex items-center gap-1.5">
          Collision <OverrideBadge overridden={differs(collision, librarySettings?.collision)} />
        </span>
        <select
          value={collision}
          onChange={(e) =>
            onUpdate({ ...entity, collision: e.target.value as ModelCollision })
          }
          className="ide-select w-40"
        >
          <option value="solid">Solid (blocks movement)</option>
          <option value="nonSolid">Non-solid (walk through)</option>
        </select>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="ide-label flex items-center gap-1.5">
            Footprint (cells){' '}
            <OverrideBadge
              overridden={differs(
                `${footprintW}x${footprintD}`,
                `${librarySettings?.footprintW}x${librarySettings?.footprintD}`
              )}
            />
          </span>
          <button
            type="button"
            onClick={() =>
              onUpdate({
                ...entity,
                footprintW: measured.w,
                footprintD: measured.d,
                footprintOverride: false,
              })
            }
            className="ide-btn !h-[18px] !px-1.5 !text-[10px]"
            title="Use the size measured from the model"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset to measured</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {(['footprintW', 'footprintD'] as const).map((key) => (
            <label key={key} className="flex items-center gap-1">
              <span className="ide-label w-10">{key === 'footprintW' ? 'Width' : 'Depth'}</span>
              <input
                type="number"
                min={1}
                max={SIM_CONFIG.MAX_FOOTPRINT_CELLS}
                step={1}
                value={key === 'footprintW' ? footprintW : footprintD}
                onChange={(e) =>
                  onUpdate({
                    ...entity,
                    [key]: clampCells(Number(e.target.value)),
                    footprintOverride: true,
                  })
                }
                className="ide-input w-full font-mono"
              />
            </label>
          ))}
        </div>
      </div>

      {isCharacter && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="ide-label">Archetype</span>
            <select
              value={entity.blueprintId}
              onChange={(e) => {
                const bpId = e.target.value as EntityArchetypeId;
                const bp = DEFAULT_ENTITY_BLUEPRINTS.find((b) => b.id === bpId);
                onUpdate({
                  ...entity,
                  blueprintId: bpId,
                  name: bp?.name || entity.name,
                  isEnemy: bp ? bp.isEnemy : entity.isEnemy,
                  maxHealth: bp?.defaultHealth ?? entity.maxHealth,
                  moveSpeed: bp?.moveSpeed ?? entity.moveSpeed,
                  attackDamage: bp?.attackDamage ?? entity.attackDamage,
                });
              }}
              className="ide-select w-40"
            >
              {DEFAULT_ENTITY_BLUEPRINTS.map((bp) => (
                <option key={bp.id} value={bp.id}>
                  {bp.name}
                </option>
              ))}
              <option value="custom-glb">Custom .glb Model</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="ide-label">AI Class</span>
            <button
              type="button"
              onClick={() => onUpdate({ ...entity, isEnemy: !(entity.isEnemy ?? true) })}
              className={`ide-btn w-40 ${entity.isEnemy !== false ? 'ide-btn--active' : ''}`}
            >
              {entity.isEnemy !== false ? 'Hostile Enemy AI' : 'Friendly NPC'}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {(
              [
                ['maxHealth', 'HP', 10, 500, 5, 75],
                ['moveSpeed', 'Speed', 0, 15, 0.5, 4.5],
                ['attackDamage', 'Damage', 0, 100, 2, 12],
              ] as const
            ).map(([key, label, min, max, step, fallback]) => (
              <div key={key}>
                <label className="ide-label block mb-0.5">{label}</label>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={entity[key] ?? fallback}
                  onChange={(e) =>
                    onUpdate({ ...entity, [key]: Math.max(min, Number(e.target.value)) })
                  }
                  className="ide-input w-full font-mono"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="ide-label block mb-0.5">Entity Tag #</label>
              <input
                type="number"
                min={0}
                max={9999}
                step={1}
                value={entity.tag ?? 0}
                onChange={(e) =>
                  onUpdate({
                    ...entity,
                    tag: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                  })
                }
                className="ide-input w-full font-mono"
                placeholder="0 = none"
              />
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="ide-label flex items-center gap-1.5 cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={Boolean(entity.ambush)}
                  onChange={(e) => onUpdate({ ...entity, ambush: e.target.checked })}
                  className="accent-[#478cbf]"
                />
                <span className="text-[11px] text-[#cccccc]">Ambush (Closet)</span>
              </label>
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="ide-label flex items-center gap-1.5 mb-0.5">
            Scale ({entity.scale.toFixed(2)}x){' '}
            <OverrideBadge overridden={differs(entity.scale, librarySettings?.scale)} />
          </label>
          <input
            type="number"
            min={0.01}
            max={5}
            step={0.01}
            value={entity.scale}
            onChange={(e) => {
              const scale = Math.max(0.01, Math.min(5, Number(e.target.value) || 1));
              // Unless the footprint was set by hand, it follows the model's scaled size
              const footprint = entity.footprintOverride ? null : measuredAt(scale);
              onUpdate({
                ...entity,
                scale,
                ...(footprint ? { footprintW: footprint.w, footprintD: footprint.d } : {}),
              });
            }}
            className="ide-input w-full font-mono"
          />
        </div>
        <div>
          <label className="ide-label block mb-0.5">Yaw (rad)</label>
          <button
            type="button"
            onClick={() =>
              onUpdate({
                ...entity,
                yaw: ((entity.yaw || 0) + Math.PI / 2) % (Math.PI * 2),
              })
            }
            className="ide-btn w-full font-mono"
          >
            Rotate +90°
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="ide-btn w-full text-[#f48771] hover:bg-[#5a1d1d]"
      >
        <Trash2 className="w-3 h-3" />
        <span>Delete '{entity.name}'</span>
      </button>
    </div>
  );
};
