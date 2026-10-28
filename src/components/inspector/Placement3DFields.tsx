import React from 'react';
import { PlacedEntity } from '../../types/engine';

interface Placement3DFieldsProps {
  entity: PlacedEntity;
  layerCount: number;
  onUpdate: (updated: PlacedEntity) => void;
}

const toDeg = (rad: number | undefined) => Math.round(((rad ?? 0) * 180) / Math.PI);
const toRad = (deg: number) => (deg * Math.PI) / 180;
/** Meters per sim unit (one 4 m cell is 1000 units) */
const METERS_PER_UNIT = 4 / 1000;

/**
 * Exact numbers for a model's free 3D placement: layer, height, offset from its tile,
 * tilt, and whether players and enemies can stand on its real shape.
 */
export const Placement3DFields: React.FC<Placement3DFieldsProps> = ({
  entity,
  layerCount,
  onUpdate,
}) => {
  const num = (
    label: string,
    value: number,
    step: number,
    apply: (v: number) => Partial<PlacedEntity>,
    title?: string
  ) => (
    <div>
      <label className="ide-label block mb-0.5" title={title}>
        {label}
      </label>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onUpdate({ ...entity, ...apply(v) });
        }}
        className="ide-input w-full font-mono"
      />
    </div>
  );

  return (
    <div className="space-y-1.5 border-t border-[#333333] pt-2">
      <span className="ide-label block text-[#cccccc]">3D Placement</span>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="ide-label block mb-0.5">Layer</label>
          <select
            value={entity.layer ?? 0}
            onChange={(e) => onUpdate({ ...entity, layer: Number(e.target.value) })}
            className="ide-input w-full"
          >
            {Array.from({ length: layerCount }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? '0 (ground)' : i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ide-label block mb-0.5" title="Height above the layer's base; empty = on the floor">
            Height (m)
          </label>
          <div className="flex gap-1">
            <input
              type="number"
              step={0.25}
              value={entity.elevation === undefined ? '' : Number(entity.elevation.toFixed(3))}
              placeholder="floor"
              onChange={(e) => {
                const raw = e.target.value;
                onUpdate({ ...entity, elevation: raw === '' ? undefined : Number(raw) });
              }}
              className="ide-input w-full font-mono"
            />
          </div>
        </div>
        {num('Offset X (m)', entity.offsetX ?? 0, 0.25, (v) => ({ offsetX: v }), 'East/west from its tile')}
        {num('Offset Z (m)', entity.offsetZ ?? 0, 0.25, (v) => ({ offsetZ: v }), 'South/north from its tile')}
        {num('Yaw (°)', toDeg(entity.yaw), 15, (v) => ({ yaw: toRad(v) }), 'Turn left/right')}
        {num('Pitch (°)', toDeg(entity.pitch), 15, (v) => ({ pitch: toRad(v) }), 'Tilt forward/back')}
        {num('Roll (°)', toDeg(entity.roll), 15, (v) => ({ roll: toRad(v) }), 'Tilt sideways')}
      </div>
      <label
        className="ide-label flex items-center gap-1.5 cursor-pointer py-1"
        title="Players and enemies stand on the model's real shape, and slide off where it is too steep"
      >
        <input
          type="checkbox"
          checked={Boolean(entity.walkable)}
          onChange={(e) =>
            onUpdate({
              ...entity,
              walkable: e.target.checked,
              // The 3D editor bakes the shape once the model is loaded
              walkSurface: undefined,
            })
          }
        />
        <span>Walk on its shape</span>
        {entity.walkable && (
          <span className="font-mono text-[9px] text-[#858585]">
            {entity.walkSurface
              ? `baked ${entity.walkSurface.cols}×${entity.walkSurface.rows}`
              : 'bakes in the 3D editor'}
          </span>
        )}
      </label>
      {entity.collision === 'solid' && !entity.walkable && (
        <div
          className="ide-label font-mono text-[9px] text-[#858585]"
          title="On levels with heights or layers, a solid model blocks only the height it really has"
        >
          {entity.modelBottomUnits !== undefined && entity.modelTopUnits !== undefined
            ? `Blocks ${(entity.modelBottomUnits * METERS_PER_UNIT).toFixed(2)} to ${(entity.modelTopUnits * METERS_PER_UNIT).toFixed(2)} m above its origin`
            : 'Height is measured in the 3D editor'}
        </div>
      )}
    </div>
  );
};
