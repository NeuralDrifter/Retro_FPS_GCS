import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { LIBRARY_ID, libraryContents, readLibraryIndex } from '../editor/library/libraryIndex';
import type { LibraryIndexEntry, LibraryPack } from '../editor/library/libraryIndex';
import { buildAssetsFromRepoPaths } from '../editor/engine/gitHubAssets';
import { LibraryIntegrityError } from '../shared/libraryIntegrity';
import { resolveAssetBytes } from '../export/collect';
import { AssetRegistry } from '../runtime';

const BASE = 'https://library.example/';
const bytes = new TextEncoder().encode('RIFF....WEBPVP8 texture bytes');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');

const entries: LibraryIndexEntry[] = [
  { path: 'textures/Horror/Brick/Brick 01.webp', kind: 'texture', pack: 'sbs-horror', sha256: sha, size: bytes.length, file: `files/${sha.slice(0, 16)}.webp`, thumb: `thumbs/${sha.slice(0, 16)}.webp` },
  { path: 'models/decorations/Dungeon/Barrel.glb', kind: 'model', pack: 'quaternius-dungeon', sha256: 'b'.repeat(64), size: 10, file: 'files/bbbbbbbbbbbbbbbb.glb', sizeMeters: { width: 1, depth: 1 } },
];
const packs: LibraryPack[] = [
  { id: 'sbs-horror', title: 'Screaming Brain Studios: Horror', author: 'Screaming Brain Studios', license: 'CC0-1.0', source: 'https://falsefox.dev', licenseFile: 'textures/Horror/LICENSE.txt' },
];

afterEach(() => vi.unstubAllGlobals());

describe('pinned asset library (P2.7)', () => {
  it('checks the published index before using it', () => {
    const index = { schemaVersion: 1, library: LIBRARY_ID, version: 'v1.0', assets: entries };
    assert.equal(readLibraryIndex(index, 'v1.0').length, 2);
    assert.throws(() => readLibraryIndex({ ...index, version: 'v9.9' }, 'v1.0'), /expected format/);
    assert.throws(() => readLibraryIndex({ ...index, assets: [{ ...entries[0], file: 'https://evil.example/x.webp' }] }, 'v1.0'), /entry 0/);
    assert.throws(() => readLibraryIndex({ ...index, assets: [{ ...entries[0], file: '../outside.webp' }] }, 'v1.0'), /entry 0/);
  });

  it('keeps the asset ids projects already use, and serves thumbnails for browsing', () => {
    const library = libraryContents('v1.0', entries, packs, BASE);
    const fromPaths = buildAssetsFromRepoPaths({ spec: { owner: 'o', repo: 'r', branch: 'main' }, paths: entries.map((e) => e.path) });
    assert.deepEqual(library.textures.map((t) => t.id), fromPaths.textures.map((t) => t.id));
    assert.deepEqual(library.models.map((m) => m.id), fromPaths.models.map((m) => m.id));
    assert.equal(library.textures[0].previewUrl, `${BASE}files/${sha.slice(0, 16)}.webp`);
    assert.equal(library.textures[0].thumbnailUrl, `${BASE}thumbs/${sha.slice(0, 16)}.webp`);
    assert.equal(library.models[0].customGlbUrl, `${BASE}files/bbbbbbbbbbbbbbbb.glb`);
  });

  it('exports a library file only when it matches its published SHA-256, credited to its pack', async () => {
    const library = libraryContents('v1.0', entries, packs, BASE);
    AssetRegistry.registerTexture(library.textures[0]);
    let served = bytes;
    vi.stubGlobal('fetch', async () => new Response(served, { headers: { 'content-type': 'image/webp' } }));

    const ok = await resolveAssetBytes(library.textures[0].id, 'texture');
    assert.equal(ok.license, 'CC0-1.0 (Screaming Brain Studios: Horror, by Screaming Brain Studios)');
    assert.equal(ok.source, 'https://falsefox.dev');
    assert.equal(ok.warnLicense, false);

    served = bytes.map((b, i) => (i === 3 ? b ^ 1 : b));
    await assert.rejects(resolveAssetBytes(library.textures[0].id, 'texture'), (err) => {
      assert.ok(err instanceof LibraryIntegrityError);
      assert.match(err.message, /Integrity check failed for 'textures\/Horror\/Brick\/Brick 01\.webp'/);
      return true;
    });
  });
});
