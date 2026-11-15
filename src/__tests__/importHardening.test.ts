import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LevelSerializer } from '../editor/engine/LevelSerializer';
import { sanitizeCustomTexture } from '../editor/project/legacy';
import { AssetRegistry } from '../runtime';
import { MAX_PROJECT_FILE_BYTES, intakeUpload, sniffMimeType } from '../editor/library/uploadIntake';
import { PROJECT_LIMITS } from '../shared/project';
import { buildGlb, checkGlb } from '../editor/library/gltfSanitizer';
import { MAX_DECODE_SIDE, exceedsDecodeLimits, imageHeaderSize } from '../editor/library/imageHeader';

const MINIMAL_GLTF = { asset: { version: '2.0' }, buffers: [{ byteLength: 12 }] };

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
    const glb = new File([buildGlb(MINIMAL_GLTF, new Uint8Array(12))], 'crate.glb');
    const result = await intakeUpload(glb, 'model');
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.upload.id, /^glb-[0-9a-f]{16}$/);
  });
});

describe('GLB sanitizer (P7.2)', () => {
  const fail = (json: object, bin = new Uint8Array(12)) => {
    const result = checkGlb(buildGlb(json, bin), 'model.glb');
    return result.ok ? '' : result.error;
  };

  it('accepts self-contained models, including the e2e Draco cube', () => {
    assert.deepEqual(checkGlb(buildGlb(MINIMAL_GLTF, new Uint8Array(12))), { ok: true });
    const draco = fs.readFileSync(path.join(process.cwd(), 'e2e/assets/draco-cube.glb'));
    assert.deepEqual(checkGlb(new Uint8Array(draco)), { ok: true });
    const embedded = { ...MINIMAL_GLTF, images: [{ uri: `data:image/png;base64,${PNG}` }] };
    assert.deepEqual(checkGlb(buildGlb(embedded, new Uint8Array(12))), { ok: true });
  });

  it('refuses images and buffers that point outside the file', () => {
    assert.match(fail({ ...MINIMAL_GLTF, images: [{ uri: 'https://example.com/x.png' }] }), /outside image \('https:\/\/example\.com\/x\.png'\)/);
    assert.match(fail({ ...MINIMAL_GLTF, images: [{ uri: 'textures/wood.png' }] }), /outside image/);
    assert.match(fail({ asset: { version: '2.0' }, buffers: [{ byteLength: 12, uri: 'model.bin' }] }), /outside file/);
    assert.match(fail({ asset: { version: '2.0' }, buffers: [{ byteLength: 12, uri: 'data:text/html;base64,PGI+' }] }), /outside file/);
  });

  it('refuses sizes that do not add up and unknown required extensions', () => {
    assert.match(fail({ asset: { version: '2.0' }, buffers: [{ byteLength: 4096 }] }), /more binary data than the file holds/);
    assert.match(
      fail({ asset: { version: '2.0' }, buffers: [{ byteLength: PROJECT_LIMITS.MAX_ASSET_BYTES + 1, uri: 'data:application/octet-stream;base64,AA==' }] }),
      /larger than an upload/
    );
    assert.match(fail({ ...MINIMAL_GLTF, extensionsRequired: ['VENDOR_secret_loader'] }), /requires the glTF extension 'VENDOR_secret_loader'/);
    const truncated = buildGlb(MINIMAL_GLTF, new Uint8Array(12)).subarray(0, 30);
    assert.equal(checkGlb(truncated).ok, false);
    assert.equal(checkGlb(new TextEncoder().encode('glTF\x02\0\0\0 not really')).ok, false);
  });
});

describe('image headers (P7.2)', () => {
  it('reads PNG, JPEG and WebP sizes without decoding', () => {
    assert.deepEqual(imageHeaderSize(Uint8Array.from(Buffer.from(PNG, 'base64')), 'image/png'), { width: 1, height: 1 });
    // SOI, an empty APP0 segment, then SOF0 declaring 640x480
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(imageHeaderSize(jpeg, 'image/jpeg'), { width: 640, height: 480 });
    const vp8x = new Uint8Array(30);
    vp8x.set(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8X'), 0);
    vp8x.set([0xff, 0x0f, 0x00, 0x7f, 0x02, 0x00], 24); // 4096 x 640
    assert.deepEqual(imageHeaderSize(vp8x, 'image/webp'), { width: 4096, height: 640 });
  });

  it('refuses images too large to decode safely before decoding them', async () => {
    assert.equal(exceedsDecodeLimits({ width: 2048, height: 2048 }), false);
    assert.equal(exceedsDecodeLimits({ width: MAX_DECODE_SIDE + 1, height: 10 }), true);
    assert.equal(exceedsDecodeLimits({ width: 10000, height: 10000 }), true);
    // A PNG header declaring 50000x50000 pixels
    const bomb = Uint8Array.from(Buffer.from(PNG, 'base64'));
    new DataView(bomb.buffer).setUint32(16, 50000);
    new DataView(bomb.buffer).setUint32(20, 50000);
    const result = await intakeUpload(new File([bomb], 'bomb.png'), 'texture');
    assert.equal(result.ok, false);
    assert.match(result.ok ? '' : result.error, /50000x50000, too large to open/);
  });
});
