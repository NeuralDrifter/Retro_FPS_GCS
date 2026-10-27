import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectReferencedAssets,
  collectAllReferencedAssets,
  bundleLevelAssets,
  decodeDataUrl,
  detectDracoCompression,
  isBuiltInTexture,
  isBuiltInModel,
  startGame,
} from '../../runtime';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(__dirname, 'determinismBaseline.json');

interface DeterminismBaselineFile {
  tickCount: number;
  minimalArenaHashes: string[];
  fullTestLevelHashes: string[];
}

function createMockDracoGlbBytes(): Uint8Array {
  // Construct a minimal valid binary GLB container (magic 0x46546C67) with KHR_draco_mesh_compression in JSON chunk
  const jsonString = JSON.stringify({
    asset: { version: '2.0', generator: 'TestDracoFixture' },
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ mode: 4 }] }],
  });
  const jsonBytes = new TextEncoder().encode(jsonString);
  // Pad JSON chunk to 4-byte boundary with spaces (0x20)
  const padding = (4 - (jsonBytes.length % 4)) % 4;
  const chunk0Len = jsonBytes.length + padding;
  const totalLen = 12 + 8 + chunk0Len;

  const buffer = new Uint8Array(totalLen);
  const view = new DataView(buffer.buffer);
  // Header: magic 'glTF', version 2, length
  buffer[0] = 0x67; buffer[1] = 0x6c; buffer[2] = 0x54; buffer[3] = 0x46;
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLen, true);
  // Chunk 0: length, type 0x4E4F534A ("JSON")
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

describe('Phase 3 Acceptance: Asset Collection, Offline Bundling & Draco', () => {
  const baseline: DeterminismBaselineFile = JSON.parse(
    fs.readFileSync(baselinePath, 'utf-8')
  );
  const inputs3000 = generateDeterministic3000TickInputs(3000);

  it('correctly classifies built-in procedural textures and archetypes', () => {
    assert.equal(isBuiltInTexture('techbase-panel'), true);
    assert.equal(isBuiltInTexture('floor-obsidian'), true);
    assert.equal(isBuiltInTexture('ceiling-coffer'), true);
    assert.equal(isBuiltInTexture('dungeon-stone'), true);
    assert.equal(isBuiltInTexture('retro-nebula'), true);
    assert.equal(isBuiltInTexture('custom-tex-upload-hazard'), false);

    assert.equal(isBuiltInModel('sentinel-bot'), true);
    assert.equal(isBuiltInModel('turret-guardian'), true);
    assert.equal(isBuiltInModel('supply-crate'), true);
    assert.equal(isBuiltInModel('folder-glb-characters-robots-turret'), false);
    assert.equal(isBuiltInModel('custom-glb-draco-pillar'), false);
  });

  it('ACCEPTANCE 1a: Test Level 1 collects ONLY procedural built-ins and returns empty external assets', () => {
    const level1 = createMinimalArenaTestLevel();
    const collected = collectReferencedAssets(level1);
    const all = collectAllReferencedAssets(level1);

    // Non-procedural assets required for level 1: exactly zero
    assert.deepEqual(collected.textureIds, []);
    assert.deepEqual(collected.modelIds, []);

    // All referenced procedural assets match the arena
    assert.ok(all.builtInTextureIds.includes('techbase-panel'));
    assert.ok(all.builtInTextureIds.includes('default-grid'));
    assert.ok(all.builtInTextureIds.includes('floor-obsidian'));
    assert.ok(all.builtInTextureIds.includes('ceiling-coffer'));
    assert.ok(all.builtInModelIds.includes('sentinel-bot'));
  });

  it('ACCEPTANCE 1b: Test Level 2 collects EXACTLY the set of assets the level uses (nothing missing, nothing extra)', () => {
    const level2 = createFullTestLevel();
    const collected = collectReferencedAssets(level2);

    // Non-procedural textures used:
    // - custom-tex-upload-hazard (wall)
    // - folder-tex-floor-tiles-checker-tiles-bw-marble-tile-01 (floor)
    // - industrial-rust (set_ceiling_texture in evt-02)
    const expectedTextureIds = [
      TEST_CUSTOM_UPLOAD_TEXTURE_ID,
      TEST_GITHUB_TEXTURE_ID,
      'industrial-rust',
    ].sort();

    const actualTextureIds = [...collected.textureIds].sort();
    assert.deepEqual(
      actualTextureIds,
      expectedTextureIds,
      `Texture set mismatch: expected ${JSON.stringify(expectedTextureIds)}, got ${JSON.stringify(actualTextureIds)}`
    );

    // Non-procedural models used:
    // - folder-glb-characters-robots-turret (ent-2)
    // - custom-glb-draco-pillar (ent-3)
    // Built-in sentinel-bot and supply-crate are excluded.
    const expectedModelIds = [
      TEST_GITHUB_MODEL_ID,
      TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID,
    ].sort();

    const actualModelIds = [...collected.modelIds].sort();
    assert.deepEqual(
      actualModelIds,
      expectedModelIds,
      `Model set mismatch: expected ${JSON.stringify(expectedModelIds)}, got ${JSON.stringify(actualModelIds)}`
    );
  });

  it('decodes Data URLs to raw byte buffers accurately', () => {
    const decoded = decodeDataUrl(TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL);
    assert.equal(decoded.mimeType, 'image/png');
    assert.ok(decoded.bytes.length > 0);
    // Standard PNG header signature [137, 80, 78, 71, 13, 10, 26, 10]
    assert.equal(decoded.bytes[0], 137);
    assert.equal(decoded.bytes[1], 80);
    assert.equal(decoded.bytes[2], 78);
    assert.equal(decoded.bytes[3], 71);
  });

  it('detects Draco mesh compression (KHR_draco_mesh_compression) accurately', () => {
    const standardGlb = createMockStandardGlbBytes();
    assert.equal(detectDracoCompression(standardGlb), false);

    const dracoGlb = createMockDracoGlbBytes();
    assert.equal(detectDracoCompression(dracoGlb), true);
  });

  it('bundles assets offline, rewrites relative paths, detects Draco and generates ASSET_LICENSES.md', async () => {
    const level2 = createFullTestLevel();

    const mockDracoBytes = createMockDracoGlbBytes();
    const mockStandardBytes = createMockStandardGlbBytes();
    const mockPngBytes = decodeDataUrl(TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL).bytes;

    const bundle = await bundleLevelAssets(level2, {
      customSources: {
        [TEST_CUSTOM_UPLOAD_TEXTURE_ID]: {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Hazard Warning Stripes',
          source: 'User Upload',
          license: 'Unspecified, owned by creator',
        },
        [TEST_GITHUB_TEXTURE_ID]: {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Checker Floor Tile',
          source: 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/textures/tile.png',
          license: 'MIT (NeuralDrifter/Retro_FPS_GCS-assets)',
        },
        'industrial-rust': {
          bytes: mockPngBytes,
          mimeType: 'image/png',
          name: 'Industrial Rust Ceiling',
          source: 'https://example.com/rust.png',
          license: 'Unknown',
        },
        [TEST_GITHUB_MODEL_ID]: {
          bytes: mockStandardBytes,
          mimeType: 'model/gltf-binary',
          name: 'Robot Turret',
          source: 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/models/turret.glb',
          license: 'MIT (NeuralDrifter/Retro_FPS_GCS-assets)',
        },
        [TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID]: {
          bytes: mockDracoBytes,
          mimeType: 'model/gltf-binary',
          name: 'Draco Compression Pillar',
          source: 'User Upload',
          license: 'Unspecified, owned by creator',
        },
      },
    });

    // 1. All 5 non-procedural assets were resolved and bundled
    assert.equal(bundle.assets.length, 5);

    // 2. Draco was detected from TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID
    assert.equal(bundle.hasDraco, true);
    assert.ok(bundle.dracoFiles !== undefined);
    assert.ok(bundle.dracoFiles['draco_decoder.wasm'].length > 0);

    // 3. Manifest assets array populated
    assert.equal(bundle.manifest.assets.textures.length, 3);
    assert.equal(bundle.manifest.assets.models.length, 2);

    // 4. Paths rewritten to relative assets/ directory
    for (const tex of bundle.manifest.assets.textures) {
      assert.match(tex.path, /^assets\/textures\/[a-z0-9_-]+\.(png|jpg|svg)$/);
    }
    for (const mdl of bundle.manifest.assets.models) {
      assert.match(mdl.path, /^assets\/models\/[a-z0-9_-]+\.glb$/);
    }

    // 5. Ent-3 model has rewritten export path in manifest.assets.models
    const ent3Model = bundle.manifest.assets.models.find(
      (m) => m.id === TEST_CUSTOM_UPLOAD_DRACO_MODEL_ID
    );
    assert.ok(ent3Model?.path.startsWith('assets/models/'));

    // 6. License markdown contains inventory table
    assert.ok(bundle.assetLicensesMarkdown.includes('# Asset Licenses & Attribution: Full Export Test Level'));
    assert.ok(bundle.assetLicensesMarkdown.includes('MIT (NeuralDrifter/Retro_FPS_GCS-assets)'));
    assert.ok(bundle.assetLicensesMarkdown.includes('Unspecified, owned by creator'));

    // 7. Warned about unverified external license
    assert.ok(bundle.licenseWarnings.length > 0);
  });

  it('ACCEPTANCE 2: Replays 3000 ticks on bundled offline manifests with zero-network and matches baseline hashes on every tick', async () => {
    // 1. Test Level 1 bundled replay
    const level1 = createMinimalArenaTestLevel();
    const bundle1 = await bundleLevelAssets(level1);

    const game1 = startGame(bundle1.manifest, null, {
      inputSource: inputs3000,
    });
    const hashes1 = game1.stepTicks(3000);
    game1.dispose();

    assert.equal(hashes1.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes1[i] !== baseline.minimalArenaHashes[i]) {
        assert.fail(
          `Level 1 bundled offline replay hash mismatch at tick ${i + 1}: expected ${
            baseline.minimalArenaHashes[i]
          }, got ${hashes1[i]}`
        );
      }
    }

    // 2. Test Level 2 bundled replay
    const level2 = createFullTestLevel();
    const mockDracoBytes = createMockDracoGlbBytes();
    const mockStandardBytes = createMockStandardGlbBytes();
    const mockPngBytes = decodeDataUrl(TEST_CUSTOM_UPLOAD_TEXTURE_DATA_URL).bytes;

    const bundle2 = await bundleLevelAssets(level2, {
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

    const game2 = startGame(bundle2.manifest, null, {
      inputSource: inputs3000,
    });
    const hashes2 = game2.stepTicks(3000);
    game2.dispose();

    assert.equal(hashes2.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes2[i] !== baseline.fullTestLevelHashes[i]) {
        assert.fail(
          `Level 2 bundled offline replay hash mismatch at tick ${i + 1}: expected ${
            baseline.fullTestLevelHashes[i]
          }, got ${hashes2[i]}`
        );
      }
    }
  });
});
