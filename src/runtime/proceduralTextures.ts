/**
 * The built-in procedural wall, floor and ceiling patterns, painted on a canvas
 * (moved out of TextureGenerator.ts in P1.4).
 */
import {
  WallTexturePresetId,
} from './types';

/**
 * Renders a built-in procedural pattern onto an HTML5 Canvas element.
 */
export function renderProceduralCanvas(
  preset: WallTexturePresetId,
  size = 512
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const scale = size / 512;
  ctx.save();
  ctx.scale(scale, scale);

  if (preset === 'techbase-panel') {
    ctx.fillStyle = '#272C35';
    ctx.fillRect(0, 0, 512, 512);

    const panels = [
      { x: 20, y: 24, w: 224, h: 340 },
      { x: 268, y: 24, w: 224, h: 340 },
      { x: 20, y: 384, w: 472, h: 104 },
    ];

    panels.forEach((p) => {
      ctx.fillStyle = '#1E222B';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 4;
      ctx.strokeRect(p.x, p.y, p.w, p.h);

      ctx.fillStyle = '#94A3B8';
      const rOffsets = [
        [p.x + 12, p.y + 12],
        [p.x + p.w - 12, p.y + 12],
        [p.x + 12, p.y + p.h - 12],
        [p.x + p.w - 12, p.y + p.h - 12],
      ];
      rOffsets.forEach(([rx, ry]) => {
        ctx.beginPath();
        ctx.arc(rx, ry, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // Hazard stripe along bottom trim
    ctx.save();
    ctx.beginPath();
    ctx.rect(28, 392, 456, 88);
    ctx.clip();
    ctx.fillStyle = '#111827';
    ctx.fillRect(28, 392, 456, 88);
    ctx.fillStyle = '#D97706';
    for (let x = -100; x < 600; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 392);
      ctx.lineTo(x + 24, 392);
      ctx.lineTo(x - 16, 480);
      ctx.lineTo(x - 40, 480);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(48, 60, 168, 10);
    ctx.fillRect(296, 60, 168, 10);
  } else if (preset === 'dungeon-stone') {
    ctx.fillStyle = '#0F1419';
    ctx.fillRect(0, 0, 512, 512);

    const rows = 8;
    const rowH = 512 / rows;
    const shades = ['#334155', '#3B495E', '#2A3647', '#404E63', '#2E3B4E'];

    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const offset = (r % 2) * 64;
      const cols = 4;
      const colW = 512 / cols;

      for (let c = -1; c <= cols; c++) {
        const x = c * colW + offset;
        const pad = 4;
        const shade = shades[Math.abs(r * 7 + c * 3) % shades.length];

        ctx.fillStyle = shade;
        ctx.fillRect(x + pad, y + pad, colW - pad * 2, rowH - pad * 2);

        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + pad, y + rowH - pad);
        ctx.lineTo(x + pad, y + pad);
        ctx.lineTo(x + colW - pad, y + pad);
        ctx.stroke();

        ctx.strokeStyle = '#1E293B';
        ctx.beginPath();
        ctx.moveTo(x + colW - pad, y + pad);
        ctx.lineTo(x + colW - pad, y + rowH - pad);
        ctx.lineTo(x + pad, y + rowH - pad);
        ctx.stroke();
      }
    }
  } else if (preset === 'labyrinth-check') {
    const cells = 4;
    const cellSize = 512 / cells;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const isEven = (r + c) % 2 === 0;
        ctx.fillStyle = isEven ? '#0284C7' : '#0F172A';
        ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);

        ctx.strokeStyle = isEven ? '#38BDF8' : '#334155';
        ctx.lineWidth = 4;
        ctx.strokeRect(
          c * cellSize + 8,
          r * cellSize + 8,
          cellSize - 16,
          cellSize - 16
        );
      }
    }
  } else if (preset === 'grate-alpha') {
    // Steel bars on a fully transparent background: a see-through catwalk grate
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = '#5B6573';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(i * 64, 0, 14, 512);
      ctx.fillRect(0, i * 64 + 25, 512, 10);
    }
    ctx.strokeStyle = '#8B95A3';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 504, 504);
  } else if (preset === 'floor-obsidian') {
    ctx.fillStyle = '#0F141D';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#192335';
    ctx.lineWidth = 4;
    const sub = 512 / 4;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * sub, 0);
      ctx.lineTo(i * sub, 512);
      ctx.moveTo(0, i * sub);
      ctx.lineTo(512, i * sub);
      ctx.stroke();
    }

    ctx.strokeStyle = '#2A3B56';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 502, 502);

    ctx.fillStyle = '#475569';
    ctx.fillRect(20, 20, 12, 12);
    ctx.fillRect(512 - 32, 20, 12, 12);
    ctx.fillRect(20, 512 - 32, 12, 12);
    ctx.fillRect(512 - 32, 512 - 32, 12, 12);
  } else if (preset === 'ceiling-coffer') {
    ctx.fillStyle = '#090C12';
    ctx.fillRect(0, 0, 512, 512);

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 12;
    ctx.strokeRect(8, 8, 496, 496);

    ctx.fillStyle = '#0F1521';
    ctx.fillRect(56, 56, 400, 400);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.strokeRect(56, 56, 400, 400);
  } else {
    // DEFAULT UV ARCHITECTURAL GRID TEXTURE
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = '#192334';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillRect(256, 256, 256, 256);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    const step = 512 / 8;
    for (let i = 1; i < 8; i++) {
      const pos = i * step;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, 512);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(512, pos);
      ctx.stroke();
    }

    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.moveTo(0, 256);
    ctx.lineTo(512, 256);
    ctx.stroke();

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 502, 502);

    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 12, 488, 488);

    ctx.fillStyle = '#94A3B8';
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    ctx.fillText('FORGECORE // UV-1.0', 26, 42);
    ctx.fillText('4.0m x 4.0m', 26, 512 - 26);

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(256, 256, 24, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
  return canvas;
}
