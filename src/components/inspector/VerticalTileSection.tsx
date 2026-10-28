import React from 'react';
import { CardinalDirection, SIM_CONFIG } from '../../runtime/sim';
import { EditorLayerData } from '../../runtime/types';

const M = 4 / SIM_CONFIG.CELL_UNITS; // Meters per sim unit
const DIRS: (CardinalDirection | '')[] = ['', 'N', 'E', 'S', 'W'];

interface VerticalTileSectionProps {
  row: number;
  col: number;
  layer: number;
  layerData: EditorLayerData;
  onSetTileVertical: (
    row: number,
    col: number,
    values: {
      floor?: number;
      ceiling?: number;
      slope?: SlopeValue | null;
      ceilingSlope?: SlopeValue | null;
    }
  ) => void;
}

type SlopeValue = { dir: CardinalDirection; riseUnits: number };

/** Direction and rise of one sloped surface (floor or ceiling) */
const SlopeFields: React.FC<{
  label: string;
  slope: SlopeValue | undefined;
  onChange: (slope: SlopeValue | null) => void;
}> = ({ label, slope, onChange }) => (
  <>
    <div>
      <label className="ide-label block mb-0.5">{label} rises to</label>
      <select
        value={slope?.dir ?? ''}
        onChange={(e) => {
          const dir = e.target.value as CardinalDirection | '';
          onChange(dir ? { dir, riseUnits: slope?.riseUnits ?? 250 } : null);
        }}
        className="ide-input w-full"
      >
        {DIRS.map((d) => (
          <option key={d || 'flat'} value={d}>
            {d || 'flat'}
          </option>
        ))}
      </select>
    </div>
    <div>
      <label className="ide-label block mb-0.5">{label} rise (m)</label>
      <input
        type="number"
        step={0.25}
        min={0}
        max={4}
        disabled={!slope}
        value={Number(((slope?.riseUnits ?? 0) * M).toFixed(3))}
        onChange={(e) => {
          const u = Math.round(Number(e.target.value) / M);
          if (slope && Number.isFinite(u)) {
            onChange({ dir: slope.dir, riseUnits: Math.max(0, Math.min(SIM_CONFIG.MAX_SLOPE_RISE_UNITS, u)) });
          }
        }}
        className="ide-input w-full font-mono disabled:opacity-40"
      />
    </div>
  </>
);

/** Exact floor height, ceiling height and slopes of the selected tile, in meters */
export const VerticalTileSection: React.FC<VerticalTileSectionProps> = ({
  row,
  col,
  layer,
  layerData,
  onSetTileVertical,
}) => {
  const floor = layerData.floorHeights[row]?.[col] ?? 0;
  const ceiling = layerData.ceilingHeights[row]?.[col] ?? SIM_CONFIG.DEFAULT_CEILING_HEIGHT_UNITS;
  const slopeOf = (surface: 'floor' | 'ceiling') =>
    layerData.slopes.find((s) => s.row === row && s.col === col && (s.surface ?? 'floor') === surface);
  const floorSlope = slopeOf('floor');
  const ceilingSlope = slopeOf('ceiling');
  const minFloor = layer === 0 ? SIM_CONFIG.MIN_FLOOR_HEIGHT_UNITS : 0;
  const toUnits = (meters: string) => Math.round(Number(meters) / M);

  return (
    <div>
      <div className="ide-section-header">
        <span>Tile Heights (Layer {layer})</span>
        <span className="font-mono text-[#858585]">base {(layer * 4).toFixed(0)} m</span>
      </div>
      <div className="p-2.5 grid grid-cols-2 gap-1.5">
        <div>
          <label className="ide-label block mb-0.5">Floor (m)</label>
          <input
            type="number"
            step={0.25}
            min={minFloor * M}
            max={4}
            value={Number((floor * M).toFixed(3))}
            onChange={(e) => {
              const u = toUnits(e.target.value);
              if (Number.isFinite(u)) {
                onSetTileVertical(row, col, { floor: Math.max(minFloor, Math.min(ceiling - 100, u)) });
              }
            }}
            className="ide-input w-full font-mono"
          />
        </div>
        <div>
          <label className="ide-label block mb-0.5">Ceiling (m)</label>
          <input
            type="number"
            step={0.25}
            min={0}
            max={4}
            value={Number((ceiling * M).toFixed(3))}
            onChange={(e) => {
              const u = toUnits(e.target.value);
              if (Number.isFinite(u)) {
                onSetTileVertical(row, col, {
                  ceiling: Math.max(floor + 100, Math.min(SIM_CONFIG.LAYER_HEIGHT_UNITS, u)),
                });
              }
            }}
            className="ide-input w-full font-mono"
          />
        </div>
        <SlopeFields
          label="Floor slope"
          slope={floorSlope}
          onChange={(slope) => onSetTileVertical(row, col, { slope })}
        />
        <SlopeFields
          label="Ceiling slope"
          slope={ceilingSlope}
          onChange={(ceilingSlope) => onSetTileVertical(row, col, { ceilingSlope })}
        />
      </div>
    </div>
  );
};
