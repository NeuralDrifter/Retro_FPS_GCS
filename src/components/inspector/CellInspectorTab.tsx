import React from 'react';
import {
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  EntityArchetypeId,
  Model3DAsset,
  PlacedEntity,
  SurfaceTarget,
  TextureAsset,
} from '../../types/engine';
import { CollisionSystem } from '../../engine/CollisionSystem';
import { Plus, RotateCw, Trash2 } from 'lucide-react';

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
  onRemoveEntityAtCell: (row: number, col: number) => void;
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
  onRemoveEntityAtCell,
}) => {
  const { row, col } = selectedCell;
  const cellType = grid[row]?.[col] ?? CellType.EMPTY;
  const worldPos = CollisionSystem.gridToWorld(row, col, grid.length);
  const isSpawnCell = spawn.row === row && spawn.col === col;

  const cellWallTex = wallTextures[row]?.[col] || 'default-grid';
  const cellFloorTex = floorTextures[row]?.[col] || 'floor-obsidian';
  const cellCeilTex = ceilingTextures[row]?.[col] || 'ceiling-coffer';

  const entityOnCell = entities.find((e) => e.row === row && e.col === col);

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
              <div className="flex items-center justify-between gap-2">
                <span className="ide-label">Label</span>
                <input
                  type="text"
                  value={entityOnCell.name}
                  onChange={(e) =>
                    onUpdateEntity({
                      ...entityOnCell,
                      name: e.target.value,
                    })
                  }
                  className="ide-input w-40"
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="ide-label">Archetype</span>
                <select
                  value={entityOnCell.blueprintId}
                  onChange={(e) => {
                    const bpId = e.target.value as EntityArchetypeId;
                    const bp = DEFAULT_ENTITY_BLUEPRINTS.find(
                      (b) => b.id === bpId
                    );
                    onUpdateEntity({
                      ...entityOnCell,
                      blueprintId: bpId,
                      name: bp?.name || entityOnCell.name,
                      isEnemy: bp ? bp.isEnemy : entityOnCell.isEnemy,
                      maxHealth: bp?.defaultHealth ?? entityOnCell.maxHealth,
                      moveSpeed: bp?.moveSpeed ?? entityOnCell.moveSpeed,
                      attackDamage:
                        bp?.attackDamage ?? entityOnCell.attackDamage,
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
                  onClick={() =>
                    onUpdateEntity({
                      ...entityOnCell,
                      isEnemy: !(entityOnCell.isEnemy ?? true),
                    })
                  }
                  className={`ide-btn w-40 ${
                    entityOnCell.isEnemy !== false ? 'ide-btn--active' : ''
                  }`}
                >
                  {entityOnCell.isEnemy !== false
                    ? 'Hostile Enemy AI'
                    : 'Static Prop / Object'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <div>
                  <label className="ide-label block mb-0.5">HP</label>
                  <input
                    type="number"
                    min={10}
                    max={500}
                    step={5}
                    value={entityOnCell.maxHealth ?? 75}
                    onChange={(e) =>
                      onUpdateEntity({
                        ...entityOnCell,
                        maxHealth: Math.max(10, Number(e.target.value)),
                      })
                    }
                    className="ide-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ide-label block mb-0.5">Speed</label>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    step={0.5}
                    value={entityOnCell.moveSpeed ?? 4.5}
                    onChange={(e) =>
                      onUpdateEntity({
                        ...entityOnCell,
                        moveSpeed: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="ide-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ide-label block mb-0.5">Damage</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={2}
                    value={entityOnCell.attackDamage ?? 12}
                    onChange={(e) =>
                      onUpdateEntity({
                        ...entityOnCell,
                        attackDamage: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="ide-input w-full font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="ide-label block mb-0.5">Entity Tag #</label>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    value={entityOnCell.tag ?? 0}
                    onChange={(e) =>
                      onUpdateEntity({
                        ...entityOnCell,
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
                      checked={Boolean(entityOnCell.ambush)}
                      onChange={(e) =>
                        onUpdateEntity({
                          ...entityOnCell,
                          ambush: e.target.checked,
                        })
                      }
                      className="accent-[#478cbf]"
                    />
                    <span className="text-[11px] text-[#cccccc]">Ambush (Closet)</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="ide-label block mb-0.5">
                    Scale ({entityOnCell.scale.toFixed(1)}x)
                  </label>
                  <input
                    type="number"
                    min={0.4}
                    max={2.5}
                    step={0.1}
                    value={entityOnCell.scale}
                    onChange={(e) =>
                      onUpdateEntity({
                        ...entityOnCell,
                        scale: Math.max(
                          0.4,
                          Math.min(2.5, Number(e.target.value))
                        ),
                      })
                    }
                    className="ide-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="ide-label block mb-0.5">Yaw (rad)</label>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateEntity({
                        ...entityOnCell,
                        yaw:
                          ((entityOnCell.yaw || 0) + Math.PI / 2) %
                          (Math.PI * 2),
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
                onClick={() => onRemoveEntityAtCell(row, col)}
                className="ide-btn w-full text-[#f48771] hover:bg-[#5a1d1d]"
              >
                <Trash2 className="w-3 h-3" />
                <span>
                  Delete Entity at [{col}, {row}]
                </span>
              </button>
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
