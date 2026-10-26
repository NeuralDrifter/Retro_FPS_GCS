/**
 * ============================================================================
 * PIE3D IN-GAME MINIMAP HUD OVERLAY (DESKTOP IDE / GAME WINDOW COMPONENT)
 * ============================================================================
 * Renders a real-time tactical radar/minimap inside the 3D Viewport
 * (`Viewport3D`) showing player position, orientation cone, walls, doors,
 * keycards, live Enemy AI positions, and dropped Ammo loot.
 *
 * Maps larger than `RADAR_VIEW_CELLS` show a window of that many cells that
 * follows the player, so only nearby cells are drawn.
 */

import React, { useState } from 'react';
import {
  AmmoLootSnapshot,
  CellType,
  ENGINE_CONFIG,
  EnemyTelemetrySnapshot,
  PlacedEntity,
  PlayerTransform,
} from '../types/engine';
import { Compass, EyeOff } from 'lucide-react';

/** Cells shown across the radar; smaller maps show the whole grid */
const RADAR_VIEW_CELLS = 16;

interface MinimapHUDProps {
  grid: number[][];
  entities: PlacedEntity[];
  enemySnapshots?: EnemyTelemetrySnapshot[];
  ammoDrops?: AmmoLootSnapshot[];
  playerTransform: PlayerTransform;
  collectedKeys: Set<string>;
  openDoors: Set<string>;
  onCloseMinimap: () => void;
}

export const MinimapHUD: React.FC<MinimapHUDProps> = ({
  grid,
  entities,
  enemySnapshots,
  ammoDrops = [],
  playerTransform,
  collectedKeys,
  openDoors,
  onCloseMinimap,
}) => {
  const [rotateWithPlayer, setRotateWithPlayer] = useState(false);

  const gridSize = grid.length;
  const viewCells = Math.min(gridSize, RADAR_VIEW_CELLS);
  const cellPct = 100 / viewCells;
  const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;

  // Radar window origin in cells, centered on the player and clamped to the map edges
  const playerCellX = (playerTransform.x + halfWorld) / ENGINE_CONFIG.CELL_SIZE;
  const playerCellY = (playerTransform.z + halfWorld) / ENGINE_CONFIG.CELL_SIZE;
  const originCol = Math.max(
    0,
    Math.min(gridSize - viewCells, playerCellX - viewCells / 2)
  );
  const originRow = Math.max(
    0,
    Math.min(gridSize - viewCells, playerCellY - viewCells / 2)
  );
  const firstCol = Math.floor(originCol);
  const firstRow = Math.floor(originRow);
  const lastCol = Math.min(gridSize - 1, Math.ceil(originCol + viewCells));
  const lastRow = Math.min(gridSize - 1, Math.ceil(originRow + viewCells));

  const worldToPctX = (wx: number) =>
    ((wx + halfWorld) / ENGINE_CONFIG.CELL_SIZE - originCol) * cellPct;
  const worldToPctY = (wz: number) =>
    ((wz + halfWorld) / ENGINE_CONFIG.CELL_SIZE - originRow) * cellPct;
  const cellToPctX = (col: number) => (col - originCol) * cellPct;
  const cellToPctY = (row: number) => (row - originRow) * cellPct;
  const cellScale = cellPct / 10;

  const playerPctX = worldToPctX(playerTransform.x);
  const playerPctY = worldToPctY(playerTransform.z);

  const dirX = -Math.sin(playerTransform.yaw);
  const dirZ = -Math.cos(playerTransform.yaw);

  const fovHalf = (37.5 * Math.PI) / 180;
  const coneLen = 18;
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

  const noseX = playerPctX + dirX * 9.5;
  const noseY = playerPctY + dirZ * 9.5;

  const headingDeg =
    (((-playerTransform.yaw * 180) / Math.PI) % 360 + 360) % 360;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const cardinal = cardinals[Math.round(headingDeg / 45) % 8];

  const radarRotationDeg = rotateWithPlayer
    ? (playerTransform.yaw * 180) / Math.PI
    : 0;

  return (
    <aside
      aria-label="In-Game Minimap Overlay"
      className="pointer-events-auto absolute top-8 right-2.5 z-10 w-36 bg-[#252526]/95 border border-[#3e3e42] p-1.5 select-none"
    >
      {/* Minimap Header Bar */}
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1 text-[10px] font-mono font-semibold text-[#cccccc] tabular-nums">
          <span className="text-[#4ec9b0]">{cardinal}</span>
          <span className="text-[#858585]">·</span>
          <span>
            [{playerTransform.gridCol},{playerTransform.gridRow}]
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRotateWithPlayer((prev) => !prev)}
            className={`p-0.5 border text-[9px] cursor-pointer ${
              rotateWithPlayer
                ? 'bg-[#478cbf] border-[#478cbf] text-white'
                : 'bg-[#181818] border-[#333333] text-[#858585] hover:text-white'
            }`}
            title={
              rotateWithPlayer
                ? 'Radar Mode: Rotate with Player Heading'
                : 'Radar Mode: Fixed North-Up'
            }
          >
            <Compass className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={onCloseMinimap}
            className="p-0.5 bg-[#181818] border border-[#333333] text-[#858585] hover:text-white cursor-pointer"
            title="Hide In-Game Minimap (Shortcut: M)"
          >
            <EyeOff className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* SVG Radar Viewport */}
      <div className="relative w-full aspect-square bg-[#141414] border border-[#333333] overflow-hidden">
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full block"
          style={{
            transform: rotateWithPlayer
              ? `rotate(${radarRotationDeg}deg)`
              : undefined,
            transformOrigin: '50% 50%',
          }}
        >
          {/* 1. Render Grid Cells inside the radar window */}
          {grid.slice(firstRow, lastRow + 1).map((rowArr, rOffset) =>
            rowArr.slice(firstCol, lastCol + 1).map((cell, cOffset) => {
              const rIdx = firstRow + rOffset;
              const cIdx = firstCol + cOffset;
              const x = cellToPctX(cIdx);
              const y = cellToPctY(rIdx);
              const cellKey = `${rIdx},${cIdx}`;

              if (cell === CellType.WALL) {
                return (
                  <rect
                    key={cellKey}
                    x={x + 0.4 * cellScale}
                    y={y + 0.4 * cellScale}
                    width={9.2 * cellScale}
                    height={9.2 * cellScale}
                    fill="#478cbf"
                    fillOpacity={0.75}
                  />
                );
              }

              if (cell === CellType.DOOR) {
                const isOpen = openDoors.has(cellKey);
                return (
                  <rect
                    key={cellKey}
                    x={x + 0.8 * cellScale}
                    y={y + 0.8 * cellScale}
                    width={8.4 * cellScale}
                    height={8.4 * cellScale}
                    fill={isOpen ? 'rgba(71, 140, 191, 0.2)' : '#5a9fd4'}
                    stroke="#5a9fd4"
                    strokeWidth={0.8 * cellScale}
                  />
                );
              }

              if (cell === CellType.KEY && !collectedKeys.has(cellKey)) {
                return (
                  <circle
                    key={cellKey}
                    cx={x + cellPct / 2}
                    cy={y + cellPct / 2}
                    r={2.5 * cellScale}
                    fill="#ce9178"
                  />
                );
              }

              return (
                <rect
                  key={cellKey}
                  x={x}
                  y={y}
                  width={cellPct}
                  height={cellPct}
                  fill="none"
                  stroke="#252526"
                  strokeWidth={0.4 * cellScale}
                />
              );
            })
          )}

          {/* 2. Render Spawned Ammo Loot Pickups */}
          {ammoDrops
            .filter((d) => !d.collected)
            .map((drop) => {
              const ax = worldToPctX(drop.x);
              const ay = worldToPctY(drop.z);
              return (
                <rect
                  key={drop.id}
                  x={ax - 1.8}
                  y={ay - 1.8}
                  width={3.6}
                  height={3.6}
                  fill="#4ec9b0"
                  stroke="#141414"
                  strokeWidth={0.5}
                />
              );
            })}

          {/* 3. Render Real-Time Moving Enemies / Entities */}
          {enemySnapshots && enemySnapshots.length > 0
            ? enemySnapshots.map((ent) => {
                const ex = worldToPctX(ent.x);
                const ey = worldToPctY(ent.z);
                const fillHex =
                  ent.state === 'Dead'
                    ? '#424245'
                    : ent.state === 'Attack'
                    ? '#ff1133'
                    : ent.state === 'Chase'
                    ? '#ce9178'
                    : ent.isEnemy
                    ? '#d14d41'
                    : '#478cbf';
                return (
                  <circle
                    key={ent.id}
                    cx={ex}
                    cy={ey}
                    r={ent.state === 'Dead' ? 1.7 : 2.5}
                    fill={fillHex}
                    stroke="#141414"
                    strokeWidth={0.7}
                  />
                );
              })
            : entities.map((ent) => {
                if (grid[ent.row]?.[ent.col] === CellType.WALL) return null;
                const ex = cellToPctX(ent.col) + cellPct / 2;
                const ey = cellToPctY(ent.row) + cellPct / 2;
                return (
                  <circle
                    key={ent.id}
                    cx={ex}
                    cy={ey}
                    r={2.4}
                    fill="#d14d41"
                    stroke="#141414"
                    strokeWidth={0.7}
                  />
                );
              })}

          {/* 4. Player View Frustum Cone */}
          <polygon
            points={`${playerPctX},${playerPctY} ${leftRayX},${leftRayY} ${rightRayX},${rightRayY}`}
            fill="rgba(78, 201, 176, 0.25)"
            stroke="rgba(78, 201, 176, 0.75)"
            strokeWidth={0.6}
          />

          {/* 5. Player Orientation Vector Line */}
          <line
            x1={playerPctX}
            y1={playerPctY}
            x2={noseX}
            y2={noseY}
            stroke="#4ec9b0"
            strokeWidth={1.5}
            strokeLinecap="round"
          />

          {/* 6. Player Position Dot */}
          <circle
            cx={playerPctX}
            cy={playerPctY}
            r={2.8}
            fill="#4ec9b0"
            stroke="#141414"
            strokeWidth={1.0}
          />
        </svg>

        <span className="pointer-events-none absolute top-0.5 left-1 text-[8px] font-mono font-bold text-[#858585]">
          N
        </span>
      </div>
    </aside>
  );
};
