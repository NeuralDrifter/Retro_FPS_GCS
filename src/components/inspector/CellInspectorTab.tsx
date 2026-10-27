import React, { useState } from 'react';
import {
  CellType,
  Model3DAsset,
  PlacedEntity,
  SurfaceTarget,
  TextureAsset,
} from '../../types/engine';
import { CollisionSystem } from '../../runtime/CollisionSystem';
import { getEntitiesCoveringCell } from '../../engine/modelLibrary/placement';
import type { ResolvedModelSettings } from '../../types/modelLibrary';
import { PlacedModelEditor } from './PlacedModelEditor';
import { Plus, RotateCw } from 'lucide-react';

interface CellInspectorTabProps {
  selectedCell: { row: number; col: number };
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  ceilingTextures: string[][];
  textures: TextureAsset[];
  onAssignCellTexture: (
    row: number,
    col: number,
    surface: SurfaceTarget,
    texId: string
  ) => void;
  onSetCellType: (row: number, col: number, cellType: CellType) => void;
  spawn: { row: number; col: number; yaw: number };
  onSetSpawnCell: (row: number, col: number) => void;
  onRotateSpawn: () => void;
  entities: PlacedEntity[];
  activeModelAsset: Model3DAsset | undefined;
  onUpdateEntity: (updated: PlacedEntity) => void;
  onPlaceEntityAtCell: (row: number, col: number) => void;
  onRemoveEntity: (entityId: string) => void;
  /** Library settings of the model a placed copy came from (null when unknown) */
  getLibrarySettings: (entity: PlacedEntity) => ResolvedModelSettings | null;
}

export const CellInspectorTab: React.FC<CellInspectorTabProps> = ({
  selectedCell,
  grid,
  wallTextures,
  floorTextures,
  ceilingTextures,
  textures,
  onAssignCellTexture,
  onSetCellType,
  spawn,
  onSetSpawnCell,
  onRotateSpawn,
  entities,
  activeModelAsset,
  onUpdateEntity,
  onPlaceEntityAtCell,
  onRemoveEntity,
  getLibrarySettings,
}) => {
  const [pickedEntityId, setPickedEntityId] = useState<string | null>(null);
  const { row, col } = selectedCell;
  const cellType = grid[row]?.[col] ?? CellType.EMPTY;
  const worldPos = CollisionSystem.gridToWorld(row, col, grid.length);
  const isSpawnCell = spawn.row === row && spawn.col === col;

  const cellWallTex = wallTextures[row]?.[col] || 'default-grid';
  const cellFloorTex = floorTextures[row]?.[col] || 'floor-obsidian';
  const cellCeilTex = ceilingTextures[row]?.[col] || 'ceiling-coffer';

  const coveringEntities = getEntitiesCoveringCell(entities, row, col);
  const entityOnCell =
    coveringEntities.find((e) => e.id === pickedEntityId) ?? coveringEntities[0];

  const surfaceRows: {
    label: string;
    surface: SurfaceTarget;
    currentTexId: string;
  }[] = [
    { label: 'Wall Tex', surface: 'wall', currentTexId: cellWallTex },
    { label: 'Floor Tex', surface: 'floor', currentTexId: cellFloorTex },
    { label: 'Ceiling Tex', surface: 'ceiling', currentTexId: cellCeilTex },
  ];

  return (
    <>
      {/* SECTION 1: SELECTED GRID CELL TRANSFORM & BLOCK TYPE */}
      <div>
        <div className="ide-section-header">
          <span>
            Selected Cell [X:{col}, Z:{row}]
          </span>
          <span className="font-mono text-[#858585]">
            ({worldPos.x.toFixed(0)}m, {worldPos.z.toFixed(0)}m)
          </span>
        </div>
        <div className="p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="ide-label">Block Type</span>
            <select
              value={cellType}
              onChange={(e) =>
                onSetCellType(row, col, Number(e.target.value) as CellType)
              }
              className="ide-select w-40 font-mono"
            >
              <option value={CellType.EMPTY}>0: Empty Floor</option>
              <option value={CellType.WALL}>1: Solid Wall</option>
              <option value={CellType.DOOR}>2: Bulkhead Door</option>
              <option value={CellType.KEY}>3: Keycard Pickup</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="ide-label">Player Spawn</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSetSpawnCell(row, col)}
                className={`ide-btn ${isSpawnCell ? 'ide-btn--active' : ''}`}
              >
                {isSpawnCell ? 'Active Spawn' : 'Move Spawn Here'}
              </button>
              <button
                type="button"
                onClick={onRotateSpawn}
                className="ide-btn"
                title="Rotate Player Spawn Yaw +90°"
              >
                <RotateCw className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: PER-CELL SURFACE TEXTURE ASSIGNMENTS */}
      <div>
        <div className="ide-section-header">
          <span>Cell Surface Materials</span>
          <span className="text-[9px] text-[#858585]">UV Mapped</span>
        </div>
        <div className="p-2.5 space-y-2">
          {surfaceRows.map(({ label, surface, currentTexId }) => (
            <div
              key={surface}
              className="flex items-center justify-between gap-2"
            >
              <span className="ide-label">{label}</span>
              <select
                value={currentTexId}
                onChange={(e) =>
                  onAssignCellTexture(row, col, surface, e.target.value)
                }
                className="ide-select w-40"
              >
                {textures.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 3: 3D .GLB ENTITY & ENEMY AI INSPECTOR */}
      <div>
        <div className="ide-section-header">
          <span>Entity / Enemy AI (.glb)</span>
          {entityOnCell ? (
            <span className="font-mono text-[#4ec9b0]">ACTIVE</span>
          ) : (
            <span className="font-mono text-[#858585]">NONE</span>
          )}
        </div>
        <div className="p-2.5 space-y-2.5">
          {entityOnCell ? (
            <>
              {coveringEntities.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {coveringEntities.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setPickedEntityId(e.id)}
                      className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
                        e.id === entityOnCell.id ? 'ide-btn--active' : ''
                      }`}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
              <PlacedModelEditor
                key={entityOnCell.id}
                entity={entityOnCell}
                librarySettings={getLibrarySettings(entityOnCell)}
                onUpdate={onUpdateEntity}
                onRemove={() => onRemoveEntity(entityOnCell.id)}
              />
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-[#858585]">
                No 3D entity on cell [{col}, {row}]. Spawn{' '}
                <code className="text-[#cccccc]">
                  {activeModelAsset?.name || 'Sentinel Bot (.glb)'}
                </code>{' '}
                here:
              </p>
              <button
                type="button"
                onClick={() => onPlaceEntityAtCell(row, col)}
                className="ide-btn ide-btn--primary w-full"
              >
                <Plus className="w-3 h-3" />
                <span>
                  Spawn .glb Entity at [{col}, {row}]
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
