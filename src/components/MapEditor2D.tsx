/**
 * ============================================================================
 * PIE3D DESKTOP IDE — 2D ORTHOGRAPHIC GRID MAP EDITOR VIEWPORT
 * ============================================================================
 * TrenchBroom / Godot style 2D grid drafting canvas injected into the middle
 * split workspace (`#map-editor-container`).
 *  - Clicking a cell executes the active tool from the left Tool Palette AND
 *    selects the cell `[Row, Col]` for inspection in the right Properties panel.
 *  - Supports HTML5 Drag-and-Drop (`onDragOver` / `onDrop`) so users can drag
 *    texture thumbnails directly from the Inspector's Asset Library tab onto
 *    any 2D grid cell!
 */

import React, { useState } from 'react';
import {
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  ENGINE_CONFIG,
  EditorToolMode,
  PlacedEntity,
  PlayerTransform,
  TextureAsset,
} from '../types/engine';
import { DoorClosed, KeyRound, Code2, Square, RotateCcw } from 'lucide-react';

interface MapEditor2DProps {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  textures: TextureAsset[];
  entities: PlacedEntity[];
  toolMode: EditorToolMode;
  selectedCell: { row: number; col: number };
  onSelectCell: (row: number, col: number) => void;
  onStrokeStart: (actionLabel: string) => void;
  onCellInteract: (row: number, col: number, forceValue?: number) => void;
  onDropTextureOnCell: (row: number, col: number, textureId: string) => void;
  onDropModelOnCell: (row: number, col: number, modelAssetId: string) => void;
  onHoverCellChange: (cell: { row: number; col: number } | null) => void;
  playerTransform: PlayerTransform;
  spawn: { row: number; col: number; yaw: number };
  onClearGrid: () => void;
  onBorderWalls: () => void;
  collectedKeys: Set<string>;
  openDoors: Set<string>;
}

export const MapEditor2D: React.FC<MapEditor2DProps> = ({
  grid,
  wallTextures,
  floorTextures,
  textures,
  entities,
  toolMode,
  selectedCell,
  onSelectCell,
  onStrokeStart,
  onCellInteract,
  onDropTextureOnCell,
  onDropModelOnCell,
  onHoverCellChange,
  playerTransform,
  spawn,
  onClearGrid,
  onBorderWalls,
  collectedKeys,
  openDoors,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragTargetValue, setDragTargetValue] = useState<number | undefined>(
    undefined
  );
  const [dragOverCell, setDragOverCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [showRawMatrix, setShowRawMatrix] = useState(false);

  const texMap = new Map<string, TextureAsset>();
  textures.forEach((t) => texMap.set(t.id, t));

  const entityByCell = new Map<string, PlacedEntity>();
  entities.forEach((ent) => entityByCell.set(`${ent.row},${ent.col}`, ent));

  const totalWorldSpan = ENGINE_CONFIG.GRID_SIZE * ENGINE_CONFIG.CELL_SIZE;
  const halfWorld = totalWorldSpan / 2;
  const playerPctX = Math.max(
    0,
    Math.min(100, ((playerTransform.x + halfWorld) / totalWorldSpan) * 100)
  );
  const playerPctY = Math.max(
    0,
    Math.min(100, ((playerTransform.z + halfWorld) / totalWorldSpan) * 100)
  );

  const dirX = -Math.sin(playerTransform.yaw);
  const dirZ = -Math.cos(playerTransform.yaw);
  const fovHalf = (37.5 * Math.PI) / 180;
  const coneLen = 15;

  const leftRayX =
    playerPctX +
    (dirX * Math.cos(-fovHalf) - dirZ * Math.sin(-fovHalf)) * coneLen;
  const leftRayY =
    playerPctY +
    (dirX * Math.sin(-fovHalf) + dirZ * Math.cos(-fovHalf)) * coneLen;
  const rightRayX =
    playerPctX +
    (dirX * Math.cos(fovHalf) - dirZ * Math.sin(fovHalf)) * coneLen;
  const rightRayY =
    playerPctY +
    (dirX * Math.sin(fovHalf) + dirZ * Math.cos(fovHalf)) * coneLen;

  const handlePointerDown = (row: number, col: number, e: React.PointerEvent) => {
    onSelectCell(row, col);
    // Right-click or Shift-click only selects the cell in the Inspector without mutating
    if (e.button !== 0 || e.shiftKey) return;

    // Record pre-stroke state onto the Undo history stack before mutating
    onStrokeStart(`2D Grid ${toolMode.toUpperCase()} at [X:${col}, Z:${row}]`);

    setIsDragging(true);
    if (toolMode === 'toggle') {
      const current = grid[row][col];
      const nextVal =
        current === CellType.WALL ? CellType.EMPTY : CellType.WALL;
      setDragTargetValue(nextVal);
      onCellInteract(row, col, nextVal);
    } else {
      setDragTargetValue(undefined);
      onCellInteract(row, col);
    }
  };

  const handlePointerEnter = (row: number, col: number) => {
    onHoverCellChange({ row, col });
    if (!isDragging) return;
    onSelectCell(row, col);
    if (toolMode === 'spawn' || toolMode === 'entity') return;
    if (toolMode === 'toggle' && dragTargetValue !== undefined) {
      onCellInteract(row, col, dragTargetValue);
    } else {
      onCellInteract(row, col);
    }
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    setDragTargetValue(undefined);
  };

  /**
   * Handles dropping a 2D texture OR a 3D .glb model dragged from the
   * Inspector's Asset Library tab directly onto a 2D Grid cell.
   */
  const handleCellDragOver = (
    e: React.DragEvent<HTMLButtonElement>,
    row: number,
    col: number
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverCell?.row !== row || dragOverCell?.col !== col) {
      setDragOverCell({ row, col });
      onHoverCellChange({ row, col });
    }
  };

  const handleCellDrop = (
    e: React.DragEvent<HTMLButtonElement>,
    row: number,
    col: number
  ) => {
    e.preventDefault();
    setDragOverCell(null);

    const modelId = e.dataTransfer.getData('application/pie3d-model-id');
    if (modelId) {
      onDropModelOnCell(row, col, modelId.trim());
      return;
    }

    const texId = e.dataTransfer.getData('application/pie3d-texture-id');
    if (texId) {
      onDropTextureOnCell(row, col, texId.trim());
      return;
    }

    const plainPayload = e.dataTransfer.getData('text/plain')?.trim();
    if (!plainPayload) return;

    if (plainPayload.startsWith('model:')) {
      onDropModelOnCell(row, col, plainPayload.slice('model:'.length));
    } else if (plainPayload.startsWith('tex:')) {
      onDropTextureOnCell(row, col, plainPayload.slice('tex:'.length));
    } else {
      onDropTextureOnCell(row, col, plainPayload);
    }
  };

  return (
    <section
      id="map-editor-container"
      aria-label="2D Grid Map Editor"
      className="flex flex-col w-full h-full bg-[#1e1e1e] select-none overflow-hidden"
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        handlePointerUp();
        onHoverCellChange(null);
      }}
    >
      {/* Compact 24px IDE Panel Header */}
      <div className="ide-panel-header">
        <div className="flex items-center gap-2">
          <span>2D Orthographic Map [10×10]</span>
          <span className="font-mono text-[#478cbf]">
            Tool: {toolMode.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBorderWalls}
            className="ide-btn !h-[18px] !px-1.5 !text-[10px]"
            title="Build Perimeter Walls around 10x10 Grid"
          >
            <Square className="w-2.5 h-2.5" />
            <span>Perimeter</span>
          </button>
          <button
            type="button"
            onClick={onClearGrid}
            className="ide-btn !h-[18px] !px-1.5 !text-[10px]"
            title="Clear all walls and entities"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Clear</span>
          </button>
          <button
            type="button"
            onClick={() => setShowRawMatrix((prev) => !prev)}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              showRawMatrix ? 'ide-btn--active' : ''
            }`}
            title="Toggle Raw 2D Matrix Array View"
          >
            <Code2 className="w-2.5 h-2.5" />
            <span>Array</span>
          </button>
        </div>
      </div>

      {/* Main 2D Drafting Canvas */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 overflow-auto bg-[#181818]">
        <div className="w-full max-w-[420px]">
          {/* X-Axis Ruler (X0..X9) */}
          <div className="grid grid-cols-10 mb-1 pl-6">
            {Array.from({ length: ENGINE_CONFIG.GRID_SIZE }).map((_, colIdx) => (
              <div
                key={colIdx}
                className={`text-center font-mono text-[10px] tabular-nums ${
                  selectedCell.col === colIdx
                    ? 'text-[#478cbf] font-semibold'
                    : 'text-[#858585]'
                }`}
              >
                X{colIdx}
              </div>
            ))}
          </div>

          <div className="flex items-stretch">
            {/* Z-Axis Ruler (Z0..Z9) */}
            <div className="flex flex-col justify-between pr-1.5 py-0.5">
              {Array.from({ length: ENGINE_CONFIG.GRID_SIZE }).map(
                (_, rowIdx) => (
                  <div
                    key={rowIdx}
                    className={`flex items-center justify-end font-mono text-[10px] tabular-nums h-full ${
                      selectedCell.row === rowIdx
                        ? 'text-[#478cbf] font-semibold'
                        : 'text-[#858585]'
                    }`}
                  >
                    Z{rowIdx}
                  </div>
                )
              )}
            </div>

            {/* 10x10 Grid Viewport Frame */}
            <div
              className="relative flex-1 aspect-square bg-[#141414] p-1 border border-[#3e3e42]"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverCell(null);
                }
              }}
            >
              <div className="grid grid-cols-10 grid-rows-10 gap-[1px] bg-[#2d2d30] w-full h-full">
                {grid.map((rowArr, rIdx) =>
                  rowArr.map((cellValue, cIdx) => {
                    const isSpawn =
                      spawn.row === rIdx && spawn.col === cIdx;
                    const isSelected =
                      selectedCell.row === rIdx && selectedCell.col === cIdx;
                    const isDragTarget =
                      dragOverCell?.row === rIdx && dragOverCell?.col === cIdx;
                    const cellKey = `${rIdx},${cIdx}`;
                    const isKeyCollected = collectedKeys.has(cellKey);
                    const isDoorOpen = openDoors.has(cellKey);
                    const placedEntity = entityByCell.get(cellKey);

                    const wallTexAsset = texMap.get(
                      wallTextures[rIdx]?.[cIdx] || 'default-grid'
                    );
                    const floorTexAsset = texMap.get(
                      floorTextures[rIdx]?.[cIdx] || 'floor-obsidian'
                    );

                    let cellBg =
                      'bg-[#1e1e1e] text-[#858585] hover:bg-[#252526]';
                    if (cellValue === CellType.WALL) {
                      cellBg = 'bg-[#3b566e] text-white font-semibold';
                    } else if (cellValue === CellType.DOOR) {
                      cellBg = isDoorOpen
                        ? 'bg-[#253746] text-[#478cbf]'
                        : 'bg-[#478cbf] text-white font-semibold';
                    } else if (cellValue === CellType.KEY) {
                      cellBg = isKeyCollected
                        ? 'bg-[#2a261d] text-[#858585]'
                        : 'bg-[#4d3c1d] text-[#ce9178] font-semibold';
                    }

                    const entBp = placedEntity
                      ? DEFAULT_ENTITY_BLUEPRINTS.find(
                          (b) => b.id === placedEntity.blueprintId
                        )
                      : undefined;

                    return (
                      <button
                        key={cellKey}
                        type="button"
                        onPointerDown={(e) => handlePointerDown(rIdx, cIdx, e)}
                        onPointerEnter={() => handlePointerEnter(rIdx, cIdx)}
                        onDragOver={(e) => handleCellDragOver(e, rIdx, cIdx)}
                        onDrop={(e) => handleCellDrop(e, rIdx, cIdx)}
                        aria-label={`Grid Cell X${cIdx} Z${rIdx}`}
                        className={`relative flex items-center justify-center text-[10px] font-mono tabular-nums overflow-hidden cursor-pointer ${cellBg} ${
                          isDragTarget
                            ? 'outline-2 outline-[#4ec9b0] bg-[#094771] z-20'
                            : isSelected
                            ? 'outline-1 outline-[#478cbf] z-10'
                            : ''
                        }`}
                      >
                        {/* Texture Preview Swatch inside Cell */}
                        {cellValue === CellType.WALL && wallTexAsset && (
                          <img
                            src={wallTexAsset.previewUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none"
                          />
                        )}
                        {cellValue === CellType.EMPTY &&
                          floorTexAsset &&
                          floorTextures[rIdx]?.[cIdx] !== 'floor-obsidian' && (
                            <img
                              src={floorTexAsset.previewUrl}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="absolute inset-0 w-full h-full object-cover opacity-40 pointer-events-none"
                            />
                          )}

                        {/* Wall Value */}
                        {cellValue === CellType.WALL && (
                          <span className="relative z-10 pointer-events-none bg-[#181818]/80 text-[#cccccc] px-1 text-[9px]">
                            1
                          </span>
                        )}

                        {/* Empty Dot */}
                        {cellValue === CellType.EMPTY &&
                          !isSpawn &&
                          !placedEntity && (
                            <span className="relative z-10 pointer-events-none opacity-30">
                              ·
                            </span>
                          )}

                        {/* Door Icon */}
                        {cellValue === CellType.DOOR && (
                          <DoorClosed className="relative z-10 w-3 h-3 pointer-events-none" />
                        )}

                        {/* Key Icon */}
                        {cellValue === CellType.KEY && (
                          <KeyRound className="relative z-10 w-3 h-3 pointer-events-none" />
                        )}

                        {/* Placed .GLB Entity / Enemy AI Marker */}
                        {placedEntity && cellValue !== CellType.WALL && (
                          <span
                            className={`absolute inset-0.5 z-10 border flex items-center justify-center font-bold text-[9px] pointer-events-none ${
                              placedEntity.isEnemy !== false
                                ? 'border-[#d14d41] bg-[#d14d41]/85 text-white'
                                : 'border-[#478cbf] bg-[#478cbf]/85 text-white'
                            }`}
                            title={placedEntity.name}
                          >
                            {entBp ? entBp.badgeText : 'GLB'}
                          </span>
                        )}

                        {/* Player Spawn Flag */}
                        {isSpawn && (
                          <span
                            className="absolute inset-0.5 z-10 border border-[#4ec9b0] bg-[#4ec9b0]/25 flex items-center justify-center pointer-events-none"
                            title="Player Spawn Point"
                          >
                            <span className="text-[9px] font-bold text-[#4ec9b0]">
                              S
                            </span>
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Real-Time First-Person Camera Position & View Frustum Cone */}
              <svg
                viewBox="0 0 100 100"
                className="absolute inset-1 w-[calc(100%-8px)] h-[calc(100%-8px)] pointer-events-none overflow-visible z-20"
              >
                <polygon
                  points={`${playerPctX},${playerPctY} ${leftRayX},${leftRayY} ${rightRayX},${rightRayY}`}
                  fill="rgba(71, 140, 191, 0.28)"
                  stroke="#478cbf"
                  strokeWidth="0.6"
                />
                <circle
                  cx={playerPctX}
                  cy={playerPctY}
                  r="2.2"
                  fill="#4ec9b0"
                  stroke="#181818"
                  strokeWidth="0.8"
                />
              </svg>
            </div>
          </div>

          {/* Raw 2D Matrix Array Drawer (When Toggled) */}
          {showRawMatrix && (
            <div className="mt-2 p-2 bg-[#141414] border border-[#3e3e42] font-mono text-[10px] text-[#cccccc] overflow-x-auto">
              <div className="text-[#858585] mb-1">
                // grid[10][10] (Drag textures from Asset Library onto cells)
              </div>
              {grid.map((row, rIdx) => (
                <div key={rIdx} className="pl-2 leading-tight tabular-nums">
                  [{row.join(', ')}]{rIdx < 9 ? ',' : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Compact 22px Bottom Legend Strip */}
      <div className="h-[22px] px-2.5 bg-[#252526] border-t border-[#3e3e42] flex items-center justify-between text-[10px] font-mono text-[#858585] shrink-0">
        <span>Drag Texture / 3D .glb → Cell</span>
        <div className="flex items-center gap-2.5">
          <span className="text-[#478cbf]">■ 1:Wall</span>
          <span className="text-[#d14d41]">■ E:Enemy</span>
          <span className="text-[#4ec9b0]">● Cam</span>
        </div>
      </div>
    </section>
  );
};
