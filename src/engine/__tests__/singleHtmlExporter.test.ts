import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exportSingleHtml,
  bytesToDataUri,
} from '../export/singleHtmlExporter';
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

describe('Phase 5 Acceptance: Single HTML Offline Export', () => {
  const baseline: DeterminismBaselineFile = JSON.parse(
    fs.readFileSync(baselinePath, 'utf-8')
  );
  const inputs3000 = generateDeterministic3000TickInputs(3000);

  it('converts byte arrays to valid data URIs', () => {
    const raw = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const uri = bytesToDataUri(raw, 'text/plain');
    assert.equal(uri, 'data:text/plain;base64,SGVsbG8=');
  });

  it('ACCEPTANCE: Exports Test Level 1 as Single HTML, reports size, verifies zero external scripts, and passes 3000-tick replay', async () => {
    const level1 = createMinimalArenaTestLevel();
    const result = await exportSingleHtml(level1);

    assert.equal(result.filename, 'minimal-arena-test-level.html');
    assert.ok(result.byteSize > 800_000, 'HTML bundle includes Three.js runtime');
    console.log(
      `Phase 5 File Size (Test Level 1 - Minimal Arena): ${(
        result.byteSize / 1024
      ).toFixed(1)} KB (${result.byteSize} bytes)`
    );

    // Verify zero external script tags or CDNs
    assert.ok(!result.html.includes('src="http'), 'Must contain zero external http script tags');
    assert.ok(!result.html.includes('src="https'), 'Must contain zero external https script tags');
    assert.ok(!result.html.includes('cdnjs.cloudflare.com'), 'Must not reference cdnjs');
    assert.ok(!result.html.includes('unpkg.com'), 'Must not reference unpkg');
    assert.ok(!result.html.includes('gstatic.com'), 'Must not reference gstatic');

    // Verify Bug 2 fix (import.meta.url defined as document.baseURI) & ForgeCore rename
    assert.ok(
      result.html.includes('new URL("../libs/draco/draco_decoder.wasm",document.baseURI)'),
      'Bundled DRACOLoader must resolve URLs against document.baseURI instead of undefined import.meta.url'
    );
    assert.equal(
      /pie3d/i.test(result.html),
      false,
      'Single HTML export must not contain legacy pie3d references'
    );

    // Extract inlined manifest JSON
    const match = /window\.__GRIDFORGE_MANIFEST__\s*=\s*(\{.+?\});\s*<\/script>/s.exec(
      result.html
    );
    assert.ok(match, 'Must contain window.__GRIDFORGE_MANIFEST__ assignment');
    const inlinedManifest = JSON.parse(match[1]);

    // Replay 3000 ticks directly on inlined manifest
    const game = startGame(inlinedManifest, null, {
      inputSource: inputs3000,
    });
    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.minimalArenaHashes[i]) {
        assert.fail(
          `Single HTML Level 1 replay hash mismatch at tick ${i + 1}: expected ${
            baseline.minimalArenaHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });

  it('ACCEPTANCE: Exports Test Level 2 as Single HTML with inlined Data URIs, reports size, and passes 3000-tick replay', async () => {
    const level2 = createFullTestLevel();
    const mockDracoBytes = createMockDracoGlbBytes();
    const mockStandardBytes = createMockStandardGlbBytes();
    const mockPngBytes = decodeDataUrl(TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL).bytes;

    const result = await exportSingleHtml(level2, {
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

    assert.equal(result.filename, 'full-export-test-level.html');
    console.log(
      `Phase 5 File Size (Test Level 2 - Full Level): ${(
        result.byteSize / 1024
      ).toFixed(1)} KB (${result.byteSize} bytes)`
    );

    // Verify all non-procedural assets are inlined as data URIs
    for (const tex of result.manifest.assets.textures) {
      assert.ok(tex.path.startsWith('data:image/'), 'Texture path must be inlined as data URI');
    }
    for (const mdl of result.manifest.assets.models) {
      assert.ok(mdl.path.startsWith('data:model/'), 'Model path must be inlined as data URI');
    }

    // Extract inlined manifest JSON
    const match = /window\.__GRIDFORGE_MANIFEST__\s*=\s*(\{.+?\});\s*<\/script>/s.exec(
      result.html
    );
    assert.ok(match, 'Must contain window.__GRIDFORGE_MANIFEST__ assignment');
    const inlinedManifest = JSON.parse(match[1]);

    // Replay 3000 ticks directly on inlined manifest
    const game = startGame(inlinedManifest, null, {
      inputSource: inputs3000,
    });
    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.fullTestLevelHashes[i]) {
        assert.fail(
          `Single HTML Level 2 replay hash mismatch at tick ${i + 1}: expected ${
            baseline.fullTestLevelHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });
});
