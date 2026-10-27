/**
 * ============================================================================
 * SINGLE HTML OFFLINE GAME EXPORTER (`/src/engine/export/singleHtmlExporter.ts`)
 * ============================================================================
 * Phase 5 Single HTML Exporter:
 * Generates a self-contained, standalone .html file that plays by double-clicking
 * directly from disk (file:// protocol) with zero network requests.
 *
 * Inlines:
 *  - Three.js and ForgeCore runtime as an inlined script bundle (no CDN dependencies).
 *  - Non-procedural textures and models as Data URIs.
 *  - GameManifest as inlined JSON attached to window.__GRIDFORGE_MANIFEST__.
 *  - Responsive HTML5 WebGL canvas and start/pointer-lock overlay.
 */

import {
  AssetBundleResult,
  bundleLevelAssets,
  BundleOptions,
  GameManifest,
  LevelDataV3,
  LevelStateData,
  slugify,
} from '../../runtime';
import { assertExportPayloadIsSafe } from './safetyScanner';

export interface SingleHtmlExportResult {
  html: string;
  slug: string;
  filename: string;
  byteSize: number;
  manifest: GameManifest;
  bundle: AssetBundleResult;
}

export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  let b64: string;
  if (typeof Buffer !== 'undefined') {
    b64 = Buffer.from(bytes).toString('base64');
  } else {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    b64 = btoa(binary);
  }
  return `data:${mimeType};base64,${b64}`;
}

/**
 * Loads the precompiled single HTML runtime bundle.
 * Reads from public/single-html-runtime.js (via Node fs or browser fetch)
 * or invokes esbuild dynamically if needed.
 */
export async function loadSingleHtmlRuntimeBundle(): Promise<string> {
  // 1. In Node environment, read from public/single-html-runtime.js
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const candidatePaths = [
        path.resolve('public/single-html-runtime.js'),
        path.resolve('../public/single-html-runtime.js'),
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          return fs.readFileSync(p, 'utf-8');
        }
      }

      // If not yet compiled on disk, compile with esbuild on the fly
      const esbuild = await import('esbuild');
      const entryPath = path.resolve('src/runtime/singleHtmlLauncher.ts');
      const res = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'iife',
        write: false,
        platform: 'browser',
        target: 'es2020',
        minify: true,
        define: {
          'import.meta.url': 'document.baseURI',
        },
      });
      if (res.outputFiles && res.outputFiles[0]) {
        return res.outputFiles[0].text;
      }
    } catch (err) {
      console.warn('Failed to load runtime bundle via Node fs/esbuild:', err);
    }
  }

  // 2. In browser environment, fetch static /single-html-runtime.js
  if (typeof fetch === 'function') {
    try {
      const res = await fetch('/single-html-runtime.js');
      if (res.ok) {
        return await res.text();
      }
    } catch (err) {
      console.warn('Failed to fetch /single-html-runtime.js in browser:', err);
    }
  }

  throw new Error(
    'Unable to load single HTML runtime bundle. Ensure public/single-html-runtime.js exists.'
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes closing script tags in JSON strings to prevent premature script tag termination.
 */
function sanitizeJsonForScript(jsonString: string): string {
  return jsonString.replace(/<\/script/gi, '<\\/script');
}

export interface SingleHtmlExportOptions extends BundleOptions {
  customRuntimeJs?: string;
}

/**
 * Phase 5 Core Function:
 * Generates a self-contained Single HTML document with all assets and runtime inlined.
 */
export async function exportSingleHtml(
  levelInput: LevelDataV3 | LevelStateData | GameManifest,
  options: SingleHtmlExportOptions = {}
): Promise<SingleHtmlExportResult> {
  const bundle = await bundleLevelAssets(levelInput, options);
  const baseManifest = bundle.manifest;
  const slug = slugify(baseManifest.meta.title) || 'my-game';
  const filename = `${slug}.html`;

  // 1. Convert all non-procedural assets to Data URIs
  const inlinedTextures = bundle.manifest.assets.textures.map((tex) => {
    const asset = bundle.assets.find((a) => a.id === tex.id);
    const dataUri = asset ? bytesToDataUri(asset.bytes, asset.mimeType) : tex.path;
    return {
      ...tex,
      path: dataUri,
    };
  });

  const inlinedModels = bundle.manifest.assets.models.map((mdl) => {
    const asset = bundle.assets.find((a) => a.id === mdl.id);
    const dataUri = asset ? bytesToDataUri(asset.bytes, asset.mimeType) : mdl.path;
    return {
      ...mdl,
      path: dataUri,
    };
  });

  const inlinedManifest: GameManifest = {
    schemaVersion: 1,
    meta: { ...baseManifest.meta },
    level: bundle.level,
    assets: {
      textures: inlinedTextures,
      models: inlinedModels,
    },
  };

  // 2. Load the inlined runtime JS bundle and ensure zero external CDN/gstatic references
  let runtimeJs =
    options.customRuntimeJs || (await loadSingleHtmlRuntimeBundle());
  runtimeJs = runtimeJs.replace(/https?:\/\/[a-z0-9_.-]*gstatic\.com\/[^\s"']*/gi, '');

  const escapedTitle = escapeHtml(baseManifest.meta.title || 'GridForge 3D Game');
  const escapedDesc = escapeHtml(
    baseManifest.meta.description || 'A standalone 3D Retro FPS game.'
  );
  const manifestJsonString = sanitizeJsonForScript(
    JSON.stringify(inlinedManifest)
  );

  // 3. Assemble the complete standalone HTML document
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
        color: #f8fafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      }
      #game-container {
        width: 100%;
        height: 100%;
        position: relative;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      #click-to-play {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(10, 15, 29, 0.84);
        color: #fff;
        z-index: 50;
        cursor: pointer;
        backdrop-filter: blur(8px);
        text-align: center;
        padding: 24px;
        user-select: none;
      }
      #click-to-play h1 {
        font-size: 2.75rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
        color: #38bdf8;
        text-transform: uppercase;
        text-shadow: 0 0 24px rgba(56, 189, 248, 0.45);
      }
      #click-to-play p {
        font-size: 1.1rem;
        color: #94a3b8;
        max-width: 580px;
        margin-bottom: 1.75rem;
        line-height: 1.5;
      }
      #click-to-play .play-btn {
        background: #0284c7;
        color: white;
        padding: 14px 40px;
        font-size: 1.2rem;
        font-weight: 700;
        border-radius: 6px;
        border: none;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 0 28px rgba(56, 189, 248, 0.55);
        transition: transform 0.15s ease, background 0.15s ease;
      }
      #click-to-play .play-btn:hover {
        background: #0369a1;
        transform: scale(1.04);
      }
      #click-to-play .instructions {
        margin-top: 2.25rem;
        font-size: 0.85rem;
        color: #64748b;
        line-height: 1.7;
        letter-spacing: 0.02em;
      }
    </style>
  </head>
  <body>
    <div id="game-container">
      <div id="click-to-play">
        <h1>${escapedTitle}</h1>
        <p>${escapedDesc}</p>
        <button class="play-btn">Click to Play</button>
        <div class="instructions">
          WASD or Arrow keys to Move &bull; Mouse to Aim<br />
          Left Click to Fire &bull; Space or E to Interact &bull; Shift to Sprint
        </div>
      </div>
    </div>
    <script>
      window.__GRIDFORGE_MANIFEST__ = ${manifestJsonString};
    </script>
    <script>
${runtimeJs}
    </script>
  </body>
</html>`;

  const byteSize =
    typeof Buffer !== 'undefined'
      ? Buffer.byteLength(html, 'utf-8')
      : new TextEncoder().encode(html).length;

  assertExportPayloadIsSafe({
    'manifest.json': manifestJsonString,
    'game.html': html,
  });

  return {
    html,
    slug,
    filename,
    byteSize,
    manifest: inlinedManifest,
    bundle,
  };
}

/**
 * Triggers a browser download of the standalone single HTML file.
 */
export async function downloadSingleHtml(
  levelInput: LevelDataV3 | LevelStateData | GameManifest,
  options: SingleHtmlExportOptions = {}
): Promise<string> {
  const result = await exportSingleHtml(levelInput, options);
  const blob = new Blob([result.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return result.filename;
}
