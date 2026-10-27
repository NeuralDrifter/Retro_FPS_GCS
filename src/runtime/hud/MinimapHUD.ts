/**
 * ============================================================================
 * VANILLA DOM + INLINE SVG MINIMAP HUD (`/src/runtime/hud/MinimapHUD.ts`)
 * ============================================================================
 * Zero React or Lucide dependencies. Matches the visual layout, colors,
 * typography, radar windowing, and orientation toggle of `MinimapHUD.tsx` 1:1.
 */

import {
  AmmoLootSnapshot,
  CellType,
  ENGINE_CONFIG,
  EnemyTelemetrySnapshot,
  PlacedEntity,
  PlayerTransform,
} from '../types';
import { HUD_ICONS } from './icons';

/** Cells shown across the radar; smaller maps show the whole grid */
const RADAR_VIEW_CELLS = 16;

export interface MinimapHUDStateProps {
  visible: boolean;
  grid: number[][];
  entities: PlacedEntity[];
  enemySnapshots?: EnemyTelemetrySnapshot[];
  ammoDrops?: AmmoLootSnapshot[];
  playerTransform: PlayerTransform;
  collectedKeys: Set<string>;
  openDoors: Set<string>;
}

export class MinimapHUDController {
  private asideEl: HTMLElement;
  private cardinalEl: HTMLSpanElement;
  private coordsEl: HTMLSpanElement;
  private rotateBtnEl: HTMLButtonElement;
  private closeBtnEl: HTMLButtonElement;
  private svgEl: SVGSVGElement;
  private rotateWithPlayer = false;

  constructor(mountRoot: HTMLElement, onCloseMinimap: () => void) {
    this.asideEl = document.createElement('aside');
    this.asideEl.setAttribute('aria-label', 'In-Game Minimap Overlay');
    this.asideEl.className =
      'pointer-events-auto absolute top-8 right-2.5 z-10 w-36 bg-[#252526]/95 border border-[#3e3e42] p-1.5 select-none';
    this.asideEl.style.cssText =
      'position:absolute;top:32px;right:10px;z-index:10;width:144px;background:rgba(37,37,38,0.95);border:1px solid #3e3e42;padding:6px;user-select:none;pointer-events:auto;font-family:Inter,system-ui,-apple-system,sans-serif;';

    // Header Bar
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-1 mb-1';
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:4px;';

    const readout = document.createElement('div');
    readout.className =
      'flex items-center gap-1 text-[10px] font-mono font-semibold text-[#cccccc] tabular-nums';
    readout.style.cssText =
      'display:flex;align-items:center;gap:4px;font-size:10px;font-family:"JetBrains Mono",monospace;font-weight:600;color:#cccccc;font-variant-numeric:tabular-nums;';

    this.cardinalEl = document.createElement('span');
    this.cardinalEl.className = 'text-[#4ec9b0]';
    this.cardinalEl.style.color = '#4ec9b0';
    this.cardinalEl.textContent = 'N';

    const dotSep = document.createElement('span');
    dotSep.className = 'text-[#858585]';
    dotSep.style.color = '#858585';
    dotSep.textContent = '·';

    this.coordsEl = document.createElement('span');
    this.coordsEl.textContent = '[1,1]';

    readout.append(this.cardinalEl, dotSep, this.coordsEl);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex items-center gap-1';
    btnGroup.style.cssText = 'display:flex;align-items:center;gap:4px;';

    this.rotateBtnEl = document.createElement('button');
    this.rotateBtnEl.type = 'button';
    this.rotateBtnEl.innerHTML = HUD_ICONS.compass(10);
    this.rotateBtnEl.addEventListener('click', () => {
      this.rotateWithPlayer = !this.rotateWithPlayer;
      this.syncRotateButtonStyle();
    });
    this.syncRotateButtonStyle();

    this.closeBtnEl = document.createElement('button');
    this.closeBtnEl.type = 'button';
    this.closeBtnEl.className =
      'p-0.5 bg-[#181818] border border-[#333333] text-[#858585] hover:text-white cursor-pointer';
    this.closeBtnEl.style.cssText =
      'padding:2px;background:#181818;border:1px solid #333333;color:#858585;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
    this.closeBtnEl.title = 'Hide In-Game Minimap (Shortcut: M)';
    this.closeBtnEl.innerHTML = HUD_ICONS.eyeOff(10);
    this.closeBtnEl.addEventListener('click', () => onCloseMinimap());

    btnGroup.append(this.rotateBtnEl, this.closeBtnEl);
    header.append(readout, btnGroup);
    this.asideEl.appendChild(header);

    // SVG Radar Viewport
    const radarBox = document.createElement('div');
    radarBox.className =
      'relative w-full aspect-square bg-[#141414] border border-[#333333] overflow-hidden';
    radarBox.style.cssText =
      'position:relative;width:100%;aspect-ratio:1/1;background:#141414;border:1px solid #333333;overflow:hidden;';

    const svgNs = 'http://www.w3.org/2000/svg';
    this.svgEl = document.createElementNS(svgNs, 'svg');
    this.svgEl.setAttribute('viewBox', '0 0 100 100');
    this.svgEl.setAttribute('class', 'w-full h-full block');
    this.svgEl.style.cssText =
      'width:100%;height:100%;display:block;transform-origin:50% 50%;';
    radarBox.appendChild(this.svgEl);

    const northLabel = document.createElement('span');
    northLabel.className =
      'pointer-events-none absolute top-0.5 left-1 text-[8px] font-mono font-bold text-[#858585]';
    northLabel.style.cssText =
      'pointer-events:none;position:absolute;top:2px;left:4px;font-size:8px;font-family:"JetBrains Mono",monospace;font-weight:700;color:#858585;';
    northLabel.textContent = 'N';
    radarBox.appendChild(northLabel);

    this.asideEl.appendChild(radarBox);
    mountRoot.appendChild(this.asideEl);
  }

  private syncRotateButtonStyle(): void {
    this.rotateBtnEl.className = `p-0.5 border text-[9px] cursor-pointer ${
      this.rotateWithPlayer
        ? 'bg-[#478cbf] border-[#478cbf] text-white'
        : 'bg-[#181818] border-[#333333] text-[#858585] hover:text-white'
    }`;
    this.rotateBtnEl.style.cssText = this.rotateWithPlayer
      ? 'padding:2px;background:#478cbf;border:1px solid #478cbf;color:#ffffff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;'
      : 'padding:2px;background:#181818;border:1px solid #333333;color:#858585;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;';
    this.rotateBtnEl.title = this.rotateWithPlayer
      ? 'Radar Mode: Rotate with Player Heading'
      : 'Radar Mode: Fixed North-Up';
  }

  public update(props: MinimapHUDStateProps): void {
    if (!props.visible) {
      this.asideEl.style.display = 'none';
      return;
    }
    this.asideEl.style.display = 'block';

    const {
      grid,
      entities,
      enemySnapshots,
      ammoDrops = [],
      playerTransform,
      collectedKeys,
      openDoors,
    } = props;

    const gridSize = grid.length;
    const viewCells = Math.min(gridSize, RADAR_VIEW_CELLS);
    const cellPct = 100 / viewCells;
    const halfWorld = (gridSize * ENGINE_CONFIG.CELL_SIZE) / 2;

    const playerCellX =
      (playerTransform.x + halfWorld) / ENGINE_CONFIG.CELL_SIZE;
    const playerCellY =
      (playerTransform.z + halfWorld) / ENGINE_CONFIG.CELL_SIZE;
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

    this.cardinalEl.textContent = cardinal;
    this.coordsEl.textContent = `[${playerTransform.gridCol},${playerTransform.gridRow}]`;

    const radarRotationDeg = this.rotateWithPlayer
      ? (playerTransform.yaw * 180) / Math.PI
      : 0;
    this.svgEl.style.transform = this.rotateWithPlayer
      ? `rotate(${radarRotationDeg}deg)`
      : '';

    const parts: string[] = [];

    // 1. Grid cells
    for (let rIdx = firstRow; rIdx <= lastRow; rIdx++) {
      const rowArr = grid[rIdx];
      if (!rowArr) continue;
      for (let cIdx = firstCol; cIdx <= lastCol; cIdx++) {
        const cell = rowArr[cIdx] ?? CellType.EMPTY;
        const x = cellToPctX(cIdx);
        const y = cellToPctY(rIdx);
        const cellKey = `${rIdx},${cIdx}`;

        if (cell === CellType.WALL) {
          parts.push(
            `<rect x="${x + 0.4 * cellScale}" y="${
              y + 0.4 * cellScale
            }" width="${9.2 * cellScale}" height="${
              9.2 * cellScale
            }" fill="#478cbf" fill-opacity="0.75" />`
          );
        } else if (cell === CellType.DOOR) {
          const isOpen = openDoors.has(cellKey);
          parts.push(
            `<rect x="${x + 0.8 * cellScale}" y="${
              y + 0.8 * cellScale
            }" width="${8.4 * cellScale}" height="${8.4 * cellScale}" fill="${
              isOpen ? 'rgba(71, 140, 191, 0.2)' : '#5a9fd4'
            }" stroke="#5a9fd4" stroke-width="${0.8 * cellScale}" />`
          );
        } else if (cell === CellType.KEY && !collectedKeys.has(cellKey)) {
          parts.push(
            `<circle cx="${x + cellPct / 2}" cy="${y + cellPct / 2}" r="${
              2.5 * cellScale
            }" fill="#ce9178" />`
          );
        } else {
          parts.push(
            `<rect x="${x}" y="${y}" width="${cellPct}" height="${cellPct}" fill="none" stroke="#252526" stroke-width="${
              0.4 * cellScale
            }" />`
          );
        }
      }
    }

    // 2. Spawned Ammo Loot Pickups
    for (const drop of ammoDrops) {
      if (drop.collected) continue;
      const ax = worldToPctX(drop.x);
      const ay = worldToPctY(drop.z);
      parts.push(
        `<rect x="${ax - 1.8}" y="${
          ay - 1.8
        }" width="3.6" height="3.6" fill="#4ec9b0" stroke="#141414" stroke-width="0.5" />`
      );
    }

    // 3. Moving Enemies / Entities
    if (enemySnapshots && enemySnapshots.length > 0) {
      for (const ent of enemySnapshots) {
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
        const r = ent.state === 'Dead' ? 1.7 : 2.5;
        parts.push(
          `<circle cx="${ex}" cy="${ey}" r="${r}" fill="${fillHex}" stroke="#141414" stroke-width="0.7" />`
        );
      }
    } else {
      for (const ent of entities) {
        if (grid[ent.row]?.[ent.col] === CellType.WALL) continue;
        const ex = cellToPctX(ent.col) + cellPct / 2;
        const ey = cellToPctY(ent.row) + cellPct / 2;
        parts.push(
          `<circle cx="${ex}" cy="${ey}" r="2.4" fill="#d14d41" stroke="#141414" stroke-width="0.7" />`
        );
      }
    }

    // 4. Player View Frustum Cone
    parts.push(
      `<polygon points="${playerPctX},${playerPctY} ${leftRayX},${leftRayY} ${rightRayX},${rightRayY}" fill="rgba(78, 201, 176, 0.25)" stroke="rgba(78, 201, 176, 0.75)" stroke-width="0.6" />`
    );

    // 5. Player Orientation Vector Line
    parts.push(
      `<line x1="${playerPctX}" y1="${playerPctY}" x2="${noseX}" y2="${noseY}" stroke="#4ec9b0" stroke-width="1.5" stroke-linecap="round" />`
    );

    // 6. Player Position Dot
    parts.push(
      `<circle cx="${playerPctX}" cy="${playerPctY}" r="2.8" fill="#4ec9b0" stroke="#141414" stroke-width="1.0" />`
    );

    this.svgEl.innerHTML = parts.join('');
  }

  public dispose(): void {
    this.asideEl.remove();
  }
}
