import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LevelSerializer } from '../editor/engine/LevelSerializer';
import { sanitizeCustomTexture } from '../editor/project/legacy';
import { AssetRegistry } from '../runtime';
import { MAX_PROJECT_FILE_BYTES, intakeUpload, sniffMimeType } from '../editor/library/uploadIntake';
import { PROJECT_LIMITS } from '../shared/project';

const legacyDir = path.join(process.cwd(), 'tests/fixtures/malicious-legacy');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('custom textures from save files (P2.6, audit ED-2)', () => {
  it('drops textures with bad schemes, foreign hosts or reserved ids', () => {
    for (const name of ['texture-javascript-scheme', 'texture-remote-host', 'texture-svg-data', 'texture-builtin-id']) {
      const raw = fs.readFileSync(path.join(legacyDir, `${name}.json`), 'utf-8');
      const { customTextures } = LevelSerializer.migrateToV3(JSON.parse(raw), raw);
      assert.deepEqual(customTextures, [], name);
    }
    assert.equal(AssetRegistry.getTexture('default-grid')?.name === 'Fake Grid', false, 'the built-in texture was not replaced');
  });

  it('keeps only the fields the editor uses', () => {
    const raw = fs.readFileSync(path.join(legacyDir, 'texture-extra-fields.json'), 'utf-8');
    const { customTextures } = LevelSerializer.migrateToV3(JSON.parse(raw), raw);
    assert.equal(customTextures.length, 1);
    assert.deepEqual(Object.keys(customTextures[0]).sort(), ['id', 'name', 'previewUrl', 'recommendedSurface', 'sourceType']);
    assert.equal(customTextures[0].sourceType, 'file');
    assert.equal(customTextures[0].fromProject, undefined);
  });

  it('accepts asset library URLs and refuses to replace a library texture', () => {
    const url = 'https://raw.githubusercontent.com/NeuralDrifter/Retro_FPS_GCS-assets/main/textures/brick.png';
    assert.equal(sanitizeCustomTexture({ id: 'tex-library-url', previewUrl: url })?.sourceType, 'url');
    AssetRegistry.registerTexture({ id: 'lib-brick-wall', name: 'Brick', sourceType: 'url', previewUrl: url, recommendedSurface: 'wall', fromProject: true });
    assert.equal(sanitizeCustomTexture({ id: 'lib-brick-wall', previewUrl: `data:image/png;base64,${PNG}` }), null);
  });
});

describe('upload checks (P2.6)', () => {
  it('knows file types by their first bytes', () => {
    assert.equal(sniffMimeType(Uint8Array.from(Buffer.from(PNG, 'base64'))), 'image/png');
    assert.equal(sniffMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(sniffMimeType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
    assert.equal(sniffMimeType(new TextEncoder().encode('glTF\x02\0\0\0')), 'model/gltf-binary');
    assert.equal(sniffMimeType(new TextEncoder().encode('<svg onload="x">')), null);
  });

  it('refuses oversized files and files that are not what they claim', async () => {
    const big = new File([new Uint8Array(PROJECT_LIMITS.MAX_ASSET_BYTES + 1)], 'huge.png', { type: 'image/png' });
    const tooBig = await intakeUpload(big, 'texture');
    assert.equal(tooBig.ok, false);
    assert.match(tooBig.ok ? '' : tooBig.error, /at most 16\.0 MB/);

    const fake = new File(['<html>not an image</html>'], 'photo.png', { type: 'image/png' });
    const wrong = await intakeUpload(fake, 'texture');
    assert.equal(wrong.ok, false);
    assert.match(wrong.ok ? '' : wrong.error, /not a PNG, JPEG or WebP image/);

    const notGlb = await intakeUpload(new File([Buffer.from(PNG, 'base64')], 'model.glb'), 'model');
    assert.equal(notGlb.ok, false);
    assert.ok(MAX_PROJECT_FILE_BYTES === 64 * 1024 * 1024);
  });

  it('gives a GLB a content id from its SHA-256', async () => {
    const glb = new File([new TextEncoder().encode('glTF\x02\0\0\0 rest of the model')], 'crate.glb');
    const result = await intakeUpload(glb, 'model');
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.upload.id, /^glb-[0-9a-f]{16}$/);
  });
});
