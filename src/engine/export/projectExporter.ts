/**
 * ============================================================================
 * STANDALONE PROJECT (ZIP) EXPORTER (`/src/engine/export/projectExporter.ts`)
 * ============================================================================
 * Phase 4 Project Exporter:
 * Generates a clean, standalone Vite + Three.js project as a downloadable ZIP.
 * The exported project:
 *  - Contains verbatim unminified `/src/runtime` source code.
 *  - Carries all bundled offline textures, models, and local Draco decoders.
 *  - Has fresh, minimal package.json (depends ONLY on `three` and `vite`).
 *  - Includes index.html, vite.config.js, src/main.js, README.md, LICENSE,
 *    and ASSET_LICENSES.md.
 *  - Never contains editor code, React, lucide, @google/genai, or API keys.
 */

import JSZip from 'jszip';
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

export interface ExportProjectResult {
  zip: JSZip;
  slug: string;
  filename: string;
  manifest: GameManifest;
  bundle: AssetBundleResult;
  generateBlob: () => Promise<Blob>;
  generateUint8Array: () => Promise<Uint8Array>;
}

/**
 * Loads all raw source files from /src/runtime.
 * Uses Vite's import.meta.glob with ?raw in browser/bundle mode,
 * and falls back to Node.js fs when running in tsx / test runners.
 */
export async function loadRuntimeSourceFiles(): Promise<
  Record<string, string>
> {
  const result: Record<string, string> = {};

  // 1. Vite environment: MUST use literal `import.meta.glob(...)` so Vite's
  // compile-time AST transform replaces it with an eager map of raw strings.
  try {
    // @ts-ignore - Vite compile-time macro
    const modules = import.meta.glob('/src/runtime/**/*', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, unknown>;
    if (modules && typeof modules === 'object') {
      for (const [absPath, content] of Object.entries(modules)) {
        const relPath = absPath.replace(/^\/?src\/runtime\//, '');
        if (typeof content === 'string') {
          result[relPath] = content;
        }
      }
      if (Object.keys(result).length > 0) {
        return result;
      }
    }
  } catch {
    // Fall back to Node fs when running outside Vite (e.g. tsx test runner)
  }

  // 2. Node.js environment fallback
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const runtimeDir = path.resolve('src/runtime');

      function scanDir(dir: string, base: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(base, fullPath).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            scanDir(fullPath, base);
          } else if (entry.isFile()) {
            result[relPath] = fs.readFileSync(fullPath, 'utf-8');
          }
        }
      }

      if (fs.existsSync(runtimeDir)) {
        scanDir(runtimeDir, runtimeDir);
        return result;
      }
    } catch (err) {
      console.warn('Failed to scan runtime directory via Node fs:', err);
    }
  }

  return result;
}

export function generateExportPackageJson(gameSlug: string): string {
  const pkg = {
    name: gameSlug,
    private: true,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: {
      three: '^0.186.1',
    },
    devDependencies: {
      vite: '^8.3.0',
    },
  };
  return JSON.stringify(pkg, null, 2);
}

export function generateExportViteConfig(): string {
  return `import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'esnext',
  },
});
`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function generateExportIndexHtml(meta: {
  title: string;
  description: string;
}): string {
  const escapedTitle = escapeHtml(meta.title || 'GridForge 3D Game');
  const escapedDesc = escapeHtml(meta.description || 'A 3D Retro FPS Game');

  return `<!DOCTYPE html>
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
        background: rgba(10, 15, 29, 0.82);
        color: #fff;
        z-index: 50;
        cursor: pointer;
        backdrop-filter: blur(6px);
        text-align: center;
        padding: 24px;
        user-select: none;
      }
      #click-to-play h1 {
        font-size: 2.5rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
        color: #38bdf8;
        text-transform: uppercase;
        text-shadow: 0 0 24px rgba(56, 189, 248, 0.4);
      }
      #click-to-play p {
        font-size: 1.05rem;
        color: #94a3b8;
        max-width: 540px;
        margin-bottom: 1.75rem;
        line-height: 1.5;
      }
      #click-to-play .play-btn {
        background: #0284c7;
        color: white;
        padding: 14px 36px;
        font-size: 1.15rem;
        font-weight: 700;
        border-radius: 6px;
        border: none;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 0 25px rgba(56, 189, 248, 0.5);
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
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;
}

export function generateExportMainJs(hasDraco = true): string {
  const dracoPath = hasDraco ? '/draco/' : '';
  return `/**
 * Standalone Game Launcher
 * Fetches manifest.json and launches the ForgeCore game runtime.
 */
import { startGame } from './runtime/index.ts';

async function launch() {
  const container = document.getElementById('game-container');
  const overlay = document.getElementById('click-to-play');

  const res = await fetch('/manifest.json');
  if (!res.ok) {
    throw new Error('Failed to load /manifest.json (status: ' + res.status + ')');
  }
  const manifest = await res.json();

  const game = startGame(manifest, container, {
    hudRoot: container,
    autoLockPointerOnClick: true,
    assetBaseUrl: '',
    dracoDecoderPath: '${dracoPath}',
  });

  if (overlay) {
    overlay.addEventListener('click', () => {
      overlay.style.display = 'none';
      game.lockPointer();
    });
  }
}

launch().catch((err) => {
  console.error('Failed to launch game:', err);
  const container = document.getElementById('game-container');
  if (container) {
    container.innerHTML = '<div style="color:#ef4444;padding:32px;font-family:monospace;">' +
      '<h2>Failed to launch game</h2>' +
      '<pre>' + (err.stack || err.message) + '</pre>' +
      '</div>';
  }
});
`;
}

export function generateExportReadme(meta: {
  title: string;
  description: string;
  author: string;
}): string {
  return `# ${meta.title || 'GridForge 3D Game'}

${meta.description || 'A standalone 3D Retro FPS game built with GridForge 3D.'}

**Author**: ${meta.author || 'Anonymous'}  
**Engine**: GridForge 3D / ForgeCore Runtime (Zero external telemetry or dependencies)

---

## Getting Started

### 1. Install Dependencies
Make sure you have [Node.js](https://nodejs.org/) installed (v18 or higher recommended).
\`\`\`bash
npm install
\`\`\`

### 2. Run the Development Server
\`\`\`bash
npm run dev
\`\`\`
Your browser will open automatically at \`http://localhost:3000\`.

---

## Production Build & Static Hosting

To compile an optimized static production build:
\`\`\`bash
npm run build
\`\`\`

To test the compiled production build locally:
\`\`\`bash
npm run preview
\`\`\`

### ⚠️ Important Notice on \`file://\` Usage
Opening \`dist/index.html\` directly from your file system (\`file://...\`) **will not work**. Modern web browsers enforce Cross-Origin Resource Sharing (CORS) and ES Module security policies that block \`fetch('/manifest.json')\` and module scripts over the \`file://\` protocol.

To play the build:
- Use \`npm run preview\`
- Or upload the contents of the \`dist/\` folder to any static web host (GitHub Pages, Vercel, Netlify, Cloudflare Pages, S3, Firebase Hosting, itch.io, etc.).

---

## Controls
- **WASD / Arrow Keys**: Move & Strafe
- **Mouse**: Look / Aim (Pointer Lock)
- **Left Mouse Click**: Fire Weapon
- **E / Space**: Interact with Doors, Elevators, and Pushwalls
- **Shift**: Sprint

---

## Licensing
- **Runtime Engine Code**: Licensed under the MIT License (see \`LICENSE\`).
- **Game Assets**: See \`ASSET_LICENSES.md\` for complete attribution and licenses of all textures and 3D models.
`;
}

export function generateExportLicense(): string {
  return `MIT License

Copyright (c) 2026 GridForge 3D Engine Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

export interface ExportProjectOptions extends BundleOptions {
  customRuntimeFiles?: Record<string, string>;
}

/**
 * Phase 4 Core Function:
 * Generates the complete JSZip structure for the standalone project.
 */
export async function exportProjectZip(
  levelInput: LevelDataV3 | LevelStateData | GameManifest,
  options: ExportProjectOptions = {}
): Promise<ExportProjectResult> {
  const bundle = await bundleLevelAssets(levelInput, options);
  const manifest = bundle.manifest;
  const slug = slugify(manifest.meta.title) || 'my-game';
  const filename = `${slug}.zip`;

  const zip = new JSZip();
  const root = zip.folder(slug) || zip;

  // 1. Root configuration & build files
  root.file('package.json', generateExportPackageJson(slug));
  root.file('vite.config.js', generateExportViteConfig());
  root.file(
    'index.html',
    generateExportIndexHtml({
      title: manifest.meta.title,
      description: manifest.meta.description,
    })
  );
  root.file(
    'README.md',
    generateExportReadme({
      title: manifest.meta.title,
      description: manifest.meta.description,
      author: manifest.meta.author,
    })
  );
  root.file('LICENSE', generateExportLicense());
  root.file('ASSET_LICENSES.md', bundle.assetLicensesMarkdown);

  // 2. src/main.js
  const mainJsContent = generateExportMainJs(bundle.hasDraco);
  root.file('src/main.js', mainJsContent);

  // 3. src/runtime/... (verbatim unminified runtime source)
  const runtimeFiles =
    options.customRuntimeFiles || (await loadRuntimeSourceFiles());
  if (Object.keys(runtimeFiles).length === 0) {
    throw new Error(
      'Export failed: runtime source files could not be loaded for src/runtime/.'
    );
  }
  for (const [relPath, content] of Object.entries(runtimeFiles)) {
    root.file(`src/runtime/${relPath}`, content);
  }

  // 4. public/manifest.json
  root.file('public/manifest.json', JSON.stringify(manifest, null, 2));

  // 5. public/assets/textures/... and public/assets/models/...
  for (const asset of bundle.assets) {
    root.file(`public/${asset.exportPath}`, asset.bytes);
  }

  // 6. public/draco/... (only if Draco models exist)
  if (bundle.hasDraco && bundle.dracoFiles) {
    root.file('public/draco/draco_decoder.js', bundle.dracoFiles['draco_decoder.js']);
    root.file(
      'public/draco/draco_wasm_wrapper.js',
      bundle.dracoFiles['draco_wasm_wrapper.js']
    );
    root.file('public/draco/draco_decoder.wasm', bundle.dracoFiles['draco_decoder.wasm']);
  }

  // 7. Safety scan files before returning
  const filesToScan: Record<string, string | Uint8Array> = {
    'package.json': generateExportPackageJson(slug),
    'vite.config.js': generateExportViteConfig(),
    'index.html': generateExportIndexHtml({
      title: manifest.meta.title,
      description: manifest.meta.description,
    }),
    'README.md': generateExportReadme({
      title: manifest.meta.title,
      description: manifest.meta.description,
      author: manifest.meta.author,
    }),
    'public/manifest.json': JSON.stringify(manifest, null, 2),
    'src/main.js': mainJsContent,
  };
  assertExportPayloadIsSafe(filesToScan);

  return {
    zip,
    slug,
    filename,
    manifest,
    bundle,
    generateBlob: () =>
      zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }),
    generateUint8Array: () =>
      zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }),
  };
}

/**
 * Triggers a browser download of the generated project ZIP file.
 */
export async function downloadProjectZip(
  levelInput: LevelDataV3 | LevelStateData | GameManifest,
  options: ExportProjectOptions = {}
): Promise<string> {
  const result = await exportProjectZip(levelInput, options);
  const blob = await result.generateBlob();
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
