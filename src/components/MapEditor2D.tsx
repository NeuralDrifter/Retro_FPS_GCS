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
 *  - Draws the grid on a single canvas so maps up to 128x128 stay responsive;
 *    zoom with the header buttons or Ctrl + mouse wheel, scroll to pan.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CellType,
  DEFAULT_ENTITY_BLUEPRINTS,
  ENGINE_CONFIG,
  EditorToolMode,
  PlacedEntity,
  PlayerTransform,
  TextureAsset,
} from '../types/engine';
import { Code2, Square, RotateCcw, ZoomIn, ZoomOut, Maximize, Layers } from 'lucide-react';
import { getEntityRect } from '../engine/modelLibrary/placement';
import { resolveEntityCategory } from '../engine/modelLibrary/categories';
import { VARIANT_DRAG_TYPE } from './inspector/modelLibrary/UsedInLevelList';

/** Pixel width of the X/Z coordinate rulers drawn along the canvas edges */
const RULER_PX = 22;
const MIN_CELL_PX = 4;
const MAX_CELL_PX = 56;

const CELL_COLORS = {
  emptyBg: '#1e1e1e',
  gridLine: '#2d2d30',
  wallBg: '#3b566e',
  doorClosedBg: '#478cbf',
  doorOpenBg: '#253746',
  keyBg: '#4d3c1d',
  keyCollectedBg: '#2a261d',
  enemy: '#d14d41',
  object: '#478cbf',
  spawn: '#4ec9b0',
  selected: '#478cbf',
  dragTarget: '#4ec9b0',
  rulerText: '#858585',
  rulerActive: '#478cbf',
} as const;

/** Picks how many cells apart ruler labels are so they never overlap */
const getRulerStep = (cellPx: number): number => {
  if (cellPx >= 26) return 1;
  if (cellPx >= 13) return 2;
  if (cellPx >= 6) return 5;
  return 10;
};

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
  /** Places a copy with the settings of an already placed model (dragged from "Used in this level") */
  onDropVariantOnCell: (row: number, col: number, sourceEntityId: string) => void;
  allowOverlap: boolean;
  onToggleAllowOverlap: () => void;
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
  onDropVariantOnCell,
  allowOverlap,
  onToggleAllowOverlap,
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


  const gridSize = grid.length;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imageLoadTick, setImageLoadTick] = useState(0);
  const lastPointerCellRef = useRef<string | null>(null);

  // `null` zoom means "fit the whole map into the panel"
  const [zoomCellPx, setZoomCellPx] = useState<number | null>(null);
  const [fitCellPx, setFitCellPx] = useState<number>(32);
  const cellPx = zoomCellPx ?? fitCellPx;
  const canvasPx = RULER_PX + gridSize * cellPx;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const avail = Math.min(el.clientWidth, el.clientHeight) - RULER_PX - 16;
      setFitCellPx(
        Math.max(
          MIN_CELL_PX,
          Math.min(MAX_CELL_PX, Math.floor(avail / gridSize))
        )
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [gridSize]);

  const zoomBy = useCallback(
    (factor: number) => {
      setZoomCellPx((prev) => {
        const base = prev ?? fitCellPx;
        const next = Math.round(base * factor);
        return Math.max(
          MIN_CELL_PX,
          Math.min(MAX_CELL_PX, next === base ? base + Math.sign(factor - 1) : next)
        );
      });
    },
    [fitCellPx]
  );

  // Ctrl + wheel zooms (non-passive listener so the page itself does not zoom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const getTextureImage = (asset: TextureAsset | undefined) => {
    if (!asset?.previewUrl) return null;
    const cache = imageCacheRef.current;
    let img = cache.get(asset.previewUrl);
    if (!img) {
      img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => setImageLoadTick((n) => n + 1);
      img.src = asset.previewUrl;
      cache.set(asset.previewUrl, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  };

  // Redraw the whole map whenever anything it shows changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasPx * dpr);
    canvas.height = Math.round(canvasPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasPx, canvasPx);

    // Rulers
    const step = getRulerStep(cellPx);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < gridSize; i++) {
      const isSelCol = selectedCell.col === i;
      const isSelRow = selectedCell.row === i;
      if (i % step === 0 || isSelCol) {
        ctx.fillStyle = isSelCol ? CELL_COLORS.rulerActive : CELL_COLORS.rulerText;
        ctx.fillText(`X${i}`, RULER_PX + i * cellPx + cellPx / 2, RULER_PX / 2);
      }
      if (i % step === 0 || isSelRow) {
        ctx.fillStyle = isSelRow ? CELL_COLORS.rulerActive : CELL_COLORS.rulerText;
        ctx.fillText(`Z${i}`, RULER_PX / 2, RULER_PX + i * cellPx + cellPx / 2);
      }
    }

    ctx.fillStyle = CELL_COLORS.gridLine;
    ctx.fillRect(RULER_PX, RULER_PX, gridSize * cellPx, gridSize * cellPx);

    const gap = cellPx >= 8 ? 1 : 0;
    const showGlyphs = cellPx >= 14;
    ctx.font = `bold ${Math.max(8, Math.min(12, Math.floor(cellPx * 0.4)))}px ui-monospace, monospace`;

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cellValue = grid[r][c];
        const cellKey = `${r},${c}`;
        const x = RULER_PX + c * cellPx;
        const y = RULER_PX + r * cellPx;
        const w = cellPx - gap;
        const cx = x + w / 2;
        const cy = y + w / 2;

        let bg: string = CELL_COLORS.emptyBg;
        if (cellValue === CellType.WALL) bg = CELL_COLORS.wallBg;
        else if (cellValue === CellType.DOOR)
          bg = openDoors.has(cellKey) ? CELL_COLORS.doorOpenBg : CELL_COLORS.doorClosedBg;
        else if (cellValue === CellType.KEY)
          bg = collectedKeys.has(cellKey) ? CELL_COLORS.keyCollectedBg : CELL_COLORS.keyBg;
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, w, w);

        // Texture preview swatch inside the cell
        if (cellValue === CellType.WALL) {
          const img = getTextureImage(
            texMap.get(wallTextures[r]?.[c] || 'default-grid')
          );
          if (img) {
            ctx.globalAlpha = 0.55;
            ctx.drawImage(img, x, y, w, w);
            ctx.globalAlpha = 1;
          }
        } else if (
          cellValue === CellType.EMPTY &&
          floorTextures[r]?.[c] &&
          floorTextures[r][c] !== 'floor-obsidian'
        ) {
          const img = getTextureImage(texMap.get(floorTextures[r][c]));
          if (img) {
            ctx.globalAlpha = 0.4;
            ctx.drawImage(img, x, y, w, w);
            ctx.globalAlpha = 1;
          }
        }

        if (showGlyphs) {
          if (cellValue === CellType.DOOR) {
            ctx.fillStyle = openDoors.has(cellKey) ? CELL_COLORS.doorClosedBg : '#ffffff';
            ctx.fillText('D', cx, cy);
          } else if (cellValue === CellType.KEY) {
            ctx.fillStyle = '#ce9178';
            ctx.fillText('K', cx, cy);
          }
        }

        if (spawn.row === r && spawn.col === c) {
          const inset = Math.max(1, cellPx * 0.08);
          ctx.strokeStyle = CELL_COLORS.spawn;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + inset, y + inset, w - inset * 2, w - inset * 2);
          if (showGlyphs) {
            ctx.fillStyle = CELL_COLORS.spawn;
            ctx.fillText('S', cx, cy);
          }
        }
      }
    }

    // Placed models cover their whole footprint: solid ones filled, non-solid ones dashed
    for (const ent of entities) {
      const rect = getEntityRect(ent);
      const inset = Math.max(1, cellPx * 0.08);
      const x = RULER_PX + rect.col0 * cellPx + inset;
      const y = RULER_PX + rect.row0 * cellPx + inset;
      const w = (rect.col1 - rect.col0 + 1) * cellPx - gap - inset * 2;
      const h = (rect.row1 - rect.row0 + 1) * cellPx - gap - inset * 2;
      const isCharacter = resolveEntityCategory(ent) === 'characters';
      const color =
        isCharacter && ent.isEnemy !== false ? CELL_COLORS.enemy : CELL_COLORS.object;
      if ((ent.collision ?? 'solid') === 'solid') {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      } else {
        ctx.setLineDash([Math.max(2, cellPx * 0.15), Math.max(2, cellPx * 0.1)]);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      if (showGlyphs) {
        const bp = DEFAULT_ENTITY_BLUEPRINTS.find((b) => b.id === ent.blueprintId);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(
          bp ? bp.badgeText : 'GLB',
          RULER_PX + ent.col * cellPx + (cellPx - gap) / 2,
          RULER_PX + ent.row * cellPx + (cellPx - gap) / 2
        );
      }
    }

    const outlineCell = (row: number, col: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(
        RULER_PX + col * cellPx + width / 2,
        RULER_PX + row * cellPx + width / 2,
        cellPx - gap - width,
        cellPx - gap - width
      );
    };
    if (selectedCell.row < gridSize && selectedCell.col < gridSize) {
      outlineCell(selectedCell.row, selectedCell.col, CELL_COLORS.selected, 2);
    }
    if (dragOverCell) {
      outlineCell(dragOverCell.row, dragOverCell.col, CELL_COLORS.dragTarget, 2);
    }
    // texMap is rebuilt every render from these same props
  }, [
    grid,
    wallTextures,
    floorTextures,
    textures,
    entities,
    spawn,
    selectedCell,
    dragOverCell,
    collectedKeys,
    openDoors,
    cellPx,
    canvasPx,
    gridSize,
    imageLoadTick,
  ]);

  /** Maps a mouse/drag event to the grid cell under it, or null outside the grid */
  const getCellFromEvent = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left - RULER_PX) / cellPx);
    const row = Math.floor((e.clientY - rect.top - RULER_PX) / cellPx);
    if (row < 0 || col < 0 || row >= gridSize || col >= gridSize) return null;
    return { row, col };
  };

  // Player camera marker and view cone, in cell units over the canvas grid
  const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;
  const playerCellX = Math.max(
    0,
    Math.min(gridSize, (playerTransform.x + halfWorld) / ENGINE_CONFIG.CELL_SIZE)
  );
  const playerCellY = Math.max(
    0,
    Math.min(gridSize, (playerTransform.z + halfWorld) / ENGINE_CONFIG.CELL_SIZE)
  );

  const dirX = -Math.sin(playerTransform.yaw);
  const dirZ = -Math.cos(playerTransform.yaw);
  const fovHalf = (37.5 * Math.PI) / 180;
  const coneLen = 1.5;

  const leftRayX =
    playerCellX +
    (dirX * Math.cos(-fovHalf) - dirZ * Math.sin(-fovHalf)) * coneLen;
  const leftRayY =
    playerCellY +
    (dirX * Math.sin(-fovHalf) + dirZ * Math.cos(-fovHalf)) * coneLen;
  const rightRayX =
    playerCellX +
    (dirX * Math.cos(fovHalf) - dirZ * Math.sin(fovHalf)) * coneLen;
  const rightRayY =
    playerCellY +
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
    lastPointerCellRef.current = null;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;
    lastPointerCellRef.current = `${cell.row},${cell.col}`;
    handlePointerDown(cell.row, cell.col, e);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cell = getCellFromEvent(e);
    if (!cell) {
      if (lastPointerCellRef.current !== null) onHoverCellChange(null);
      lastPointerCellRef.current = null;
      return;
    }
    const key = `${cell.row},${cell.col}`;
    if (key === lastPointerCellRef.current) return;
    lastPointerCellRef.current = key;
    handlePointerEnter(cell.row, cell.col);
  };

  /**
   * Handles dropping a 2D texture OR a 3D .glb model dragged from the
   * Inspector's Asset Library tab directly onto a 2D Grid cell.
   */
  const handleCellDragOver = (e: React.DragEvent<HTMLCanvasElement>) => {
    const cell = getCellFromEvent(e);
    if (!cell) return;
    const { row, col } = cell;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverCell?.row !== row || dragOverCell?.col !== col) {
      setDragOverCell({ row, col });
      onHoverCellChange({ row, col });
    }
  };

  const handleCellDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setDragOverCell(null);
    const cell = getCellFromEvent(e);
    if (!cell) return;
    const { row, col } = cell;

    const variantEntityId = e.dataTransfer.getData(VARIANT_DRAG_TYPE);
    if (variantEntityId) {
      onDropVariantOnCell(row, col, variantEntityId.trim());
      return;
    }

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

    if (plainPayload.startsWith('variant:')) {
      onDropVariantOnCell(row, col, plainPayload.slice('variant:'.length));
    } else if (plainPayload.startsWith('model:')) {
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
          <span>
            2D Orthographic Map [{gridSize}×{gridSize}]
          </span>
          <span className="font-mono text-[#478cbf]">
            Tool: {toolMode.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.25)}
            className="ide-btn !h-[18px] !px-1 !text-[10px]"
            title="Zoom Out (Ctrl + Mouse Wheel)"
          >
            <ZoomOut className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.25)}
            className="ide-btn !h-[18px] !px-1 !text-[10px]"
            title="Zoom In (Ctrl + Mouse Wheel)"
          >
            <ZoomIn className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomCellPx(null)}
            className={`ide-btn !h-[18px] !px-1 !text-[10px] ${
              zoomCellPx === null ? 'ide-btn--active' : ''
            }`}
            title="Fit Whole Map"
          >
            <Maximize className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={onToggleAllowOverlap}
            className={`ide-btn !h-[18px] !px-1.5 !text-[10px] ${
              allowOverlap ? 'ide-btn--active' : ''
            }`}
            title={
              allowOverlap
                ? 'Overlap allowed: new models may cover walls, doors and other models'
                : 'Overlap blocked: new models may not cover walls, doors or other models (existing ones are untouched)'
            }
          >
            <Layers className="w-2.5 h-2.5" />
            <span>Overlap {allowOverlap ? 'On' : 'Off'}</span>
          </button>
          <button
            type="button"
            onClick={onBorderWalls}
            className="ide-btn !h-[18px] !px-1.5 !text-[10px]"
            title="Build Perimeter Walls around the Grid"
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
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-2 bg-[#181818]"
      >
        <div className="w-max mx-auto">
          <div
            className="relative"
            style={{ width: canvasPx, height: canvasPx }}
          >
            <canvas
              ref={canvasRef}
              aria-label={`2D Grid Map ${gridSize} by ${gridSize}`}
              style={{ width: canvasPx, height: canvasPx }}
              className="block cursor-pointer"
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onContextMenu={(e) => e.preventDefault()}
              onDragOver={handleCellDragOver}
              onDrop={handleCellDrop}
              onDragLeave={() => setDragOverCell(null)}
            />

            {/* Real-Time First-Person Camera Position & View Frustum Cone */}
            <svg
              viewBox={`0 0 ${gridSize} ${gridSize}`}
              className="absolute pointer-events-none overflow-visible"
              style={{
                left: RULER_PX,
                top: RULER_PX,
                width: gridSize * cellPx,
                height: gridSize * cellPx,
              }}
            >
              <polygon
                points={`${playerCellX},${playerCellY} ${leftRayX},${leftRayY} ${rightRayX},${rightRayY}`}
                fill="rgba(71, 140, 191, 0.28)"
                stroke="#478cbf"
                strokeWidth="0.06"
              />
              <circle
                cx={playerCellX}
                cy={playerCellY}
                r={0.22}
                fill="#4ec9b0"
                stroke="#181818"
                strokeWidth="0.08"
              />
            </svg>
          </div>

          {/* Raw 2D Matrix Array Drawer (When Toggled) */}
          {showRawMatrix && (
            <div className="mt-2 p-2 bg-[#141414] border border-[#3e3e42] font-mono text-[10px] text-[#cccccc] overflow-x-auto">
              <div className="text-[#858585] mb-1">
                // grid[{gridSize}][{gridSize}] (Drag textures from Asset Library onto cells)
              </div>
              {grid.map((row, rIdx) => (
                <div key={rIdx} className="pl-2 leading-tight tabular-nums">
                  [{row.join(', ')}]{rIdx < gridSize - 1 ? ',' : ''}
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
