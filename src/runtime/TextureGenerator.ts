/**
 * ============================================================================
 * FORGECORE TEXTURE GENERATOR & CORS-SAFE TEXTURE MANAGER (PHASE 2)
 * ============================================================================
 * Manages both:
 *  1. Built-in procedural HTML5 2D Canvas textures (walls, floors, ceilings,
 *     doors, and 360° equirectangular skyboxes)
 *  2. Custom user-uploaded image files (DataURLs) and external image URLs
 *
 * CORS & Pathing Safety:
 *  - Configures `THREE.TextureLoader` with `setCrossOrigin('anonymous')` so
 *    remote texture URLs load cleanly into WebGL without tainting the canvas.
 *  - If a user-supplied URL fails to load or is blocked by remote CORS headers,
 *    gracefully falls back to a high-visibility diagnostic grid texture so the
 *    3D engine never crashes or renders black geometry.
 */

import * as THREE from 'three';
import {
  BuiltInTextureId,
  SkyboxThemeId,
  TextureAsset,
} from './types';
import { renderProceduralCanvas } from './proceduralTextures';

export interface GeneratedSkybox {
  texture: THREE.CanvasTexture;
  fogColor: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
}

export class TextureGenerator {
  private static textureCache = new Map<string, THREE.Texture>();
  private static previewDataUrlCache = new Map<string, string>();
  private static assetBaseUrl = '';

  public static setAssetBaseUrl(baseUrl: string): void {
    this.assetBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  }

  public static resolveAssetUrl(url: string): string {
    if (!url || !this.assetBaseUrl) return url;
    if (
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('/')
    ) {
      return url;
    }
    return `${this.assetBaseUrl}/${url.replace(/^\/+/, '')}`;
  }

  /**
   * Deterministic seeded PRNG for procedural skybox generation
   */
  private static createSeededRandom(seed: number): () => number {
    let s = (seed % 2147483647) + 1;
    if (s <= 0) s += 2147483646;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /**
   * Configures color space, tiling wrap mode, and hardware anisotropy on any
   * Three.js texture.
   */
  public static configureTexture(
    texture: THREE.Texture,
    maxAnisotropy = 4,
    repeatX = 1,
    repeatY = 1
  ): THREE.Texture {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.max(1, maxAnisotropy);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Returns the built-in procedural TextureAsset catalog with generated
   * DataURL thumbnail previews for the Phase 2 Asset Panel UI.
   */
  public static getBuiltInTextureAssets(): TextureAsset[] {
    const specs: {
      id: BuiltInTextureId;
      name: string;
      recommendedSurface: TextureAsset['recommendedSurface'];
    }[] = [
      {
        id: 'default-grid',
        name: 'UV Architect Grid',
        recommendedSurface: 'wall',
      },
      {
        id: 'techbase-panel',
        name: 'Techbase Bulkhead',
        recommendedSurface: 'wall',
      },
      {
        id: 'dungeon-stone',
        name: 'Dungeon Masonry',
        recommendedSurface: 'wall',
      },
      {
        id: 'labyrinth-check',
        name: 'Labyrinth Checker',
        recommendedSurface: 'any',
      },
      {
        id: 'floor-obsidian',
        name: 'Obsidian Deck Grate',
        recommendedSurface: 'floor',
      },
      {
        id: 'ceiling-coffer',
        name: 'Acoustic Coffer Tile',
        recommendedSurface: 'ceiling',
      },
      {
        id: 'grate-alpha',
        name: 'Catwalk Grate (see-through)',
        recommendedSurface: 'any',
      },
    ];

    return specs.map((spec) => ({
      id: spec.id,
      name: spec.name,
      sourceType: 'procedural',
      previewUrl: this.getProceduralPreviewDataUrl(spec.id),
      recommendedSurface: spec.recommendedSurface,
      ...(spec.id === 'grate-alpha' ? { hasAlpha: true } : {}),
    }));
  }

  /**
   * True when a texture has see-through parts. PNG, GIF and WebP uploads may carry
   * transparency, so they count too; fully opaque ones look the same either way.
   */
  public static isAlphaTexture(textureId: string, customAssets: TextureAsset[]): boolean {
    if (textureId === 'grate-alpha') return true;
    const custom = customAssets.find((a) => a.id === textureId);
    if (!custom) return false;
    if (custom.hasAlpha !== undefined) return custom.hasAlpha;
    return /^data:image\/(png|gif|webp)|\.(png|gif|webp)(\?|#|$)/i.test(custom.previewUrl);
  }

  /**
   * Generates a cached DataURL thumbnail for any built-in procedural texture ID.
   */
  public static getProceduralPreviewDataUrl(id: BuiltInTextureId): string {
    if (this.previewDataUrlCache.has(id)) {
      return this.previewDataUrlCache.get(id)!;
    }
    const canvas = renderProceduralCanvas(id, 128);
    const url = canvas.toDataURL('image/png');
    this.previewDataUrlCache.set(id, url);
    return url;
  }

  /**
   * Resolves any texture ID (built-in procedural ID or custom user asset ID)
   * into a cached `THREE.Texture` ready for `MeshStandardMaterial`.
   */
  public static resolveTextureById(
    textureId: string,
    customAssets: TextureAsset[],
    maxAnisotropy = 4,
    onAsyncLoad?: () => void
  ): THREE.Texture {
    const cacheKey = `${textureId}__aniso_${maxAnisotropy}`;
    if (this.textureCache.has(cacheKey)) {
      return this.textureCache.get(cacheKey)!;
    }

    // 1. Check if it matches a custom uploaded/URL texture asset
    const custom = customAssets.find((a) => a.id === textureId);
    if (custom) {
      const loader = new THREE.TextureLoader();
      // CRITICAL: Avoid CORS canvas tainting when loading external URLs
      loader.setCrossOrigin('anonymous');

      // Start with a procedural placeholder canvas texture while async image loads
      const placeholderCanvas = renderProceduralCanvas('default-grid', 256);
      const tex: THREE.Texture = new THREE.CanvasTexture(placeholderCanvas);
      this.configureTexture(tex, maxAnisotropy, 1, 1);
      this.textureCache.set(cacheKey, tex);

      const resolvedUrl = this.resolveAssetUrl(custom.previewUrl);
      loader.load(
        resolvedUrl,
        (loadedTex) => {
          if (this.textureCache.get(cacheKey) !== tex) return;
          // Release any 256x256 WebGL texStorage2D allocated for the placeholder
          // canvas before swapping in the loaded image's Source at its true size.
          tex.dispose();
          tex.source = loadedTex.source;
          tex.needsUpdate = true;
          if (onAsyncLoad) onAsyncLoad();
        },
        undefined,
        (err) => {
          console.warn(
            `[ForgeCore TextureManager] Failed to load texture URL (${resolvedUrl}). Using fallback grid.`,
            err
          );
        }
      );

      return tex;
    }

    // 2. Otherwise render built-in procedural texture
    const canvas = renderProceduralCanvas(
      textureId as BuiltInTextureId,
      512
    );
    const tex = new THREE.CanvasTexture(canvas);
    this.configureTexture(tex, maxAnisotropy, 1, 1);
    this.textureCache.set(cacheKey, tex);
    return tex;
  }

  /**
   * Clears cached textures on renderer dispose.
   */
  public static clearCache(): void {
    this.textureCache.forEach((t) => t.dispose());
    this.textureCache.clear();
  }

  /**
   * Generates a 1024x512 360° Equirectangular Skybox CanvasTexture
   */
  public static createSkyboxTexture(
    theme: SkyboxThemeId,
    seed = 1
  ): GeneratedSkybox {
    const width = 1024;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const rand = this.createSeededRandom(seed * 97 + theme.length * 31);

    let fogColor = 0x090c12;
    let hemiSkyColor = 0x38bdf8;
    let hemiGroundColor = 0x0f172a;

    if (theme === 'retro-nebula') {
      fogColor = 0x160b24;
      hemiSkyColor = 0xc084fc;
      hemiGroundColor = 0x1e1035;

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0.0, '#090314');
      bgGrad.addColorStop(0.35, '#1E0B3B');
      bgGrad.addColorStop(0.52, '#3B0F5C');
      bgGrad.addColorStop(0.7, '#140824');
      bgGrad.addColorStop(1.0, '#07030D');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      const nebulaColors = [
        'rgba(192, 38, 211, 0.16)',
        'rgba(147, 51, 234, 0.18)',
        'rgba(236, 72, 153, 0.12)',
        'rgba(56, 189, 248, 0.10)',
      ];
      for (let i = 0; i < 42; i++) {
        const cx = rand() * width;
        const cy = rand() * (height * 0.65);
        const radius = 50 + rand() * 140;
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius);
        const col = nebulaColors[Math.floor(rand() * nebulaColors.length)];
        grad.addColorStop(0, col);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 450; i++) {
        const sx = rand() * width;
        const sy = rand() * (height * 0.72);
        const sz = rand() < 0.85 ? 1.2 : 2.4;
        const tint =
          rand() < 0.6 ? '#F8FAFC' : rand() < 0.8 ? '#F0ABFC' : '#38BDF8';
        ctx.fillStyle = tint;
        ctx.fillRect(sx, sy, sz, sz);

        if (rand() < 0.04) {
          ctx.strokeStyle = 'rgba(240, 171, 252, 0.75)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx - 6, sy);
          ctx.lineTo(sx + 6, sy);
          ctx.moveTo(sx, sy - 6);
          ctx.lineTo(sx, sy + 6);
          ctx.stroke();
        }
      }
    } else if (theme === 'starry-void') {
      fogColor = 0x070a10;
      hemiSkyColor = 0x38bdf8;
      hemiGroundColor = 0x090d16;

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0.0, '#020408');
      bgGrad.addColorStop(0.5, '#070B12');
      bgGrad.addColorStop(1.0, '#030509');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 28; i++) {
        const cx = (i / 28) * width + (rand() - 0.5) * 40;
        const cy =
          height * 0.28 +
          Math.sin((cx / width) * Math.PI * 2) * 55 +
          (rand() - 0.5) * 30;
        const r = 45 + rand() * 80;
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0.06)');
        grad.addColorStop(0.5, 'rgba(148, 163, 184, 0.03)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      const starPalette = ['#FFFFFF', '#E2E8F0', '#93C5FD', '#FDE68A', '#CBD5E1'];
      for (let i = 0; i < 700; i++) {
        const sx = rand() * width;
        const sy = rand() * (height * 0.8);
        const size = rand() < 0.9 ? 1.1 : 2.2;
        ctx.fillStyle =
          starPalette[Math.floor(rand() * starPalette.length)];
        ctx.fillRect(sx, sy, size, size);
      }
    } else if (theme === 'crimson-dusk') {
      fogColor = 0x1f0c11;
      hemiSkyColor = 0xf97316;
      hemiGroundColor = 0x1c0a0e;

      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0.0, '#0D0407');
      bgGrad.addColorStop(0.32, '#2A0A14');
      bgGrad.addColorStop(0.47, '#7C1D26');
      bgGrad.addColorStop(0.53, '#D97706');
      bgGrad.addColorStop(0.62, '#1A070B');
      bgGrad.addColorStop(1.0, '#090305');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 30; i++) {
        const cx = rand() * width;
        const cy = height * 0.18 + rand() * (height * 0.32);
        const rx = 60 + rand() * 120;
        const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
        grad.addColorStop(0, 'rgba(245, 158, 11, 0.14)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rx, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#0F0508';
      ctx.beginPath();
      const horizonY = height * 0.54;
      ctx.moveTo(0, height);
      ctx.lineTo(0, horizonY);
      const segments = 48;
      for (let s = 1; s <= segments; s++) {
        const px = (s / segments) * width;
        const peakOffset =
          s === segments ? 0 : Math.sin(s * 1.7 + seed) * 18 + rand() * 26;
        ctx.lineTo(px, horizonY - Math.abs(peakOffset));
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    } else if (theme === 'emerald-grid') {
      fogColor = 0x061512;
      hemiSkyColor = 0x10b981;
      hemiGroundColor = 0x04120e;

      ctx.fillStyle = '#030B09';
      ctx.fillRect(0, 0, width, height);

      const hGrad = ctx.createLinearGradient(
        0,
        height * 0.38,
        0,
        height * 0.62
      );
      hGrad.addColorStop(0.0, 'rgba(16, 185, 129, 0)');
      hGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.28)');
      hGrad.addColorStop(1.0, 'rgba(16, 185, 129, 0)');
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, height * 0.38, width, height * 0.24);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.24)';
      ctx.lineWidth = 1.5;
      const lonSteps = 24;
      for (let i = 0; i <= lonSteps; i++) {
        const x = (i / lonSteps) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      const latSteps = 12;
      for (let j = 0; j <= latSteps; j++) {
        const y = (j / latSteps) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      for (let i = 0; i < 240; i++) {
        ctx.fillStyle = rand() < 0.7 ? '#6EE7B7' : '#38BDF8';
        ctx.fillRect(rand() * width, rand() * (height * 0.45), 2, 2);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;

    return {
      texture,
      fogColor,
      hemiSkyColor,
      hemiGroundColor,
    };
  }

  /**
   * Generates a procedural bulkhead door texture for CellType.DOOR (2).
   */
  public static createDoorTexture(maxAnisotropy = 4): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#312E2B';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#18181B';
    ctx.fillRect(size / 2 - 6, 0, 12, size);

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(size / 2 - 70, size / 2 - 44, 140, 88);
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 4;
    ctx.strokeRect(size / 2 - 70, size / 2 - 44, 140, 88);

    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 24px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('BULKHEAD', size / 2, size / 2 - 6);
    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillText('KEY / [E]', size / 2, size / 2 + 24);

    const texture = new THREE.CanvasTexture(canvas);
    return this.configureTexture(texture, maxAnisotropy, 1, 1) as THREE.CanvasTexture;
  }
}
