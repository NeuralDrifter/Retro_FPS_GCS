import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  exportProjectZip,
  generateExportPackageJson,
  generateExportReadme,
  loadRuntimeSourceFiles,
} from '../export/projectExporter';
import {
  createMinimalArenaTestLevel,
  createFullTestLevel,
  generateDeterministic3000TickInputs,
  TEST_CUSTOM_UPLOAD_TEXTURE_ID,
  TEST_GITHUB_TEXTURE_ID,
  TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID,
  TEST_GITHUB_MODEL_ID,
  TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL,
} from './determinismFixtures';
import { decodeDataUrl, startGame } from '../../runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(__dirname, 'determinismBaseline.json');

interface DeterminismBaselineFile {
  tickCount: number;
  minimalArenaHashes: string[];
  fullTestLevelHashes: string[];
}

function createMockDracoGlbBytes(): Uint8Array {
  const jsonString = JSON.stringify({
    asset: { version: '2.0', generator: 'TestDracoFixture' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ mode: 4 }] }],
  });
  const jsonBytes = new TextEncoder().encode(jsonString);
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const chunk0Len = jsonBytes.length + padding;
  const totalLen = 12 + 8 + chunk0Len;

  const buffer = new Uint8Array(totalLen);
  const view = new DataView(buffer.buffer);
  buffer[0] = 0x67; buffer[1] = 0x6c; buffer[2] = 0x54; buffer[3] = 0x46;
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);
  view.setUint32(12, chunk0Len, true);
  view.setUint32(16, 0x4e4f534a, false);
  buffer.set(jsonBytes, 20);
  for (let i = 0; i < padding; i++) {
    buffer[20 + jsonBytes.length + i] = 0x20;
  }
  return buffer;
}

function createMockStandardGlbBytes(): Uint8Array {
  const jsonString = JSON.stringify({
    asset: { version: '2.0', generator: 'TestStandardFixture' },
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Box' }],
  });
  const jsonBytes = new TextEncoder().encode(jsonString);
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const chunk0Len = jsonBytes.length + padding;
  const totalLen = 12 + 8 + chunk0Len;

  const buffer = new Uint8Array(totalLen);
  const view = new DataView(buffer.buffer);
  buffer[0] = 0x67; buffer[1] = 0x6c; buffer[2] = 0x54; buffer[3] = 0x46;
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);
  view.setUint32(12, chunk0Len, true);
  view.setUint32(16, 0x4e4f534a, false);
  buffer.set(jsonBytes, 20);
  for (let i = 0; i < padding; i++) {
    buffer[20 + jsonBytes.length + i] = 0x20;
  }
  return buffer;
}

describe('Phase 4 Acceptance: Standalone Project (ZIP) Export', () => {
  const baseline: DeterminismBaselineFile = JSON.parse(
    fs.readFileSync(baselinePath, 'utf-8')
  );
  const inputs3000 = generateDeterministic3000TickInputs(3000);

  it('loads raw runtime source files unminified from /src/runtime', async () => {
    const files = await loadRuntimeSourceFiles();
    assert.ok(Object.keys(files).length >= 15);
    assert.ok(files['startGame.ts'] !== undefined);
    assert.ok(files['types.ts'] !== undefined);
    assert.ok(files['sim/index.ts'] !== undefined);
    assert.ok(files['sim/trigTable.ts'] !== undefined);
    assert.ok(files['hud/CombatHUD.ts'] !== undefined);

    // Confirm files are unminified TypeScript/JavaScript source code
    assert.ok(files['startGame.ts'].includes('export function startGame'));
    assert.ok(files['sim/trigTable.ts'].includes('QUARTER_SIN_TABLE_1024'));
  });

  it('generates a clean package.json carrying only three and vite', () => {
    const rawPkg = generateExportPackageJson('cyber-arena');
    const pkg = JSON.parse(rawPkg);

    assert.equal(pkg.name, 'cyber-arena');
    assert.equal(pkg.dependencies.three, '^0.186.1');
    assert.equal(pkg.devDependencies.vite, '^8.3.0');

    // Forbidden template / editor dependencies must never be present
    assert.equal(pkg.dependencies['react'], undefined);
    assert.equal(pkg.dependencies['@google/genai'], undefined);
    assert.equal(pkg.dependencies['dotenv'], undefined);
    assert.equal(pkg.dependencies['lucide-react'], undefined);
  });

  it('generates a README covering dev, build, preview, and warning about file:// protocol', () => {
    const readme = generateExportReadme({
      title: 'Dungeon Master 3D',
      description: 'Retro game',
      author: 'Creator',
    });

    assert.ok(readme.includes('npm install'));
    assert.ok(readme.includes('npm run dev'));
    assert.ok(readme.includes('npm run build'));
    assert.ok(readme.includes('npm run preview'));
    assert.ok(readme.includes('file://'));
  });

  it('ACCEPTANCE: Exports Test Level 1 ZIP with clean structure and zero external assets', async () => {
    const level1 = createMinimalArenaTestLevel();
    const result = await exportProjectZip(level1);

    assert.equal(result.slug, 'minimal-arena-test-level');
    assert.equal(result.filename, 'minimal-arena-test-level.zip');

    const zipBuffer = await result.generateUint8Array();
    const unzipped = await JSZip.loadAsync(zipBuffer);

    const prefix = `${result.slug}/`;
    // Verify core files exist in ZIP
    assert.ok(unzipped.file(`${prefix}package.json`) !== null);
    assert.ok(unzipped.file(`${prefix}vite.config.js`) !== null);
    assert.ok(unzipped.file(`${prefix}index.html`) !== null);
    assert.ok(unzipped.file(`${prefix}src/main.js`) !== null);
    assert.ok(unzipped.file(`${prefix}src/runtime/startGame.ts`) !== null);
    assert.ok(unzipped.file(`${prefix}src/runtime/sim/trigTable.ts`) !== null);
    assert.ok(unzipped.file(`${prefix}public/manifest.json`) !== null);
    assert.ok(unzipped.file(`${prefix}README.md`) !== null);
    assert.ok(unzipped.file(`${prefix}LICENSE`) !== null);
    assert.ok(unzipped.file(`${prefix}ASSET_LICENSES.md`) !== null);

    // No Draco files for Level 1 since Level 1 has no Draco models
    assert.equal(unzipped.file(`${prefix}public/draco/draco_decoder.wasm`), null);

    // The exported Vite project should not warn about the expected ~900 kB Three.js bundle
    const viteConfig = await unzipped.file(`${prefix}vite.config.js`)!.async('string');
    assert.match(viteConfig, /chunkSizeWarningLimit:\s*\d+/);
  });

  it('ACCEPTANCE: Exports Test Level 2 ZIP with bundled assets, Draco decoders, and verifies full unpack, build, and 3000-tick replay', async () => {
    const level2 = createFullTestLevel();
    const mockDracoBytes = createMockDracoGlbBytes();
    const mockStandardBytes = createMockStandardGlbBytes();
    const mockPngBytes = decodeDataUrl(TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL).bytes;

    const result = await exportProjectZip(level2, {
      customSources: {
        [TEST_CUSTOM_UPLOAD_TEXTURE_ID]: {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Hazard',
          source: 'User Upload',
        },
        [TEST_GITHUB_TEXTURE_ID]: {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Checker',
          source: 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/textures/tile.png',
        },
        'industrial-rust': {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Rust',
          source: 'https://example.com/rust.png',
        },
        [TEST_GITHUB_MODEL_ID]: {
          bytes: mockStandardBytes,
          mimeType: 'model/gltf-binary',
          name: 'Turret',
          source: 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/models/turret.glb',
        },
        [TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID]: {
          bytes: mockDracoBytes,
          mimeType: 'model/gltf-binary',
          name: 'DracoPillar',
          source: 'User Upload',
        },
      },
    });

    assert.equal(result.bundle.hasDraco, true);

    const zipBuffer = await result.generateUint8Array();
    const unzipped = await JSZip.loadAsync(zipBuffer);
    const prefix = `${result.slug}/`;

    // 1. Draco decoders are packed in public/draco/
    assert.ok(unzipped.file(`${prefix}public/draco/draco_decoder.wasm`) !== null);
    assert.ok(unzipped.file(`${prefix}public/draco/draco_decoder.js`) !== null);
    assert.ok(unzipped.file(`${prefix}public/draco/draco_wasm_wrapper.js`) !== null);

    // 2. Textures and models are packed in public/assets/
    assert.ok(
      Object.keys(unzipped.files).some((f) =>
        f.startsWith(`${prefix}public/assets/textures/`)
      )
    );
    assert.ok(
      Object.keys(unzipped.files).some((f) =>
        f.startsWith(`${prefix}public/assets/models/`)
      )
    );

    // 3. Unpack into a temp directory and test build & determinism replay
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridforge-export-test-'));
    try {
      // Unpack all files from ZIP
      for (const [filePath, fileObj] of Object.entries(unzipped.files)) {
        if (fileObj.dir) continue;
        const relativeInside = filePath.replace(prefix, '');
        const outPath = path.join(tempDir, relativeInside);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        const buf = await fileObj.async('nodebuffer');
        fs.writeFileSync(outPath, buf);
      }

      // Link node_modules so vite build can run
      const localNodeModules = path.resolve('node_modules');
      const targetNodeModules = path.join(tempDir, 'node_modules');
      if (fs.existsSync(localNodeModules)) {
        try {
          fs.symlinkSync(localNodeModules, targetNodeModules, 'junction');
        } catch {
          // In environments without symlink permissions, continue
        }
      }

      // Read unpacked manifest.json
      const unpackedManifestRaw = fs.readFileSync(
        path.join(tempDir, 'public/manifest.json'),
        'utf-8'
      );
      const unpackedManifest = JSON.parse(unpackedManifestRaw);

      // Replay 3000 ticks on the unpacked manifest
      const game = startGame(unpackedManifest, null, {
        inputSource: inputs3000,
      });
      const hashes = game.stepTicks(3000);
      game.dispose();

      assert.equal(hashes.length, 3000);
      for (let i = 0; i < 3000; i++) {
        if (hashes[i] !== baseline.fullTestLevelHashes[i]) {
          assert.fail(
            `Unpacked ZIP exported game hash mismatch at tick ${i + 1}: expected ${
              baseline.fullTestLevelHashes[i]
            }, got ${hashes[i]}`
          );
        }
      }

      // Verify zero occurrences of legacy "pie3d" string across all text files in the exported ZIP
      for (const [filePath, fileObj] of Object.entries(unzipped.files)) {
        if (fileObj.dir || /\.(png|jpg|webp|glb|wasm)$/i.test(filePath)) continue;
        const textContent = await fileObj.async('string');
        assert.equal(
          /pie3d/i.test(textContent),
          false,
          `Exported ZIP file ${filePath} must not contain 'pie3d'`
        );
      }

      // Verify `npx vite build` runs cleanly on the unpacked project
      if (fs.existsSync(targetNodeModules)) {
        execSync('npx vite build', {
          cwd: tempDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        assert.ok(
          fs.existsSync(path.join(tempDir, 'dist/index.html')),
          'vite build must output dist/index.html'
        );
      }
    } finally {
      // Clean up temp dir
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });
});
