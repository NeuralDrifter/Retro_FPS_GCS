import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { SimPlacedEntityV3 } from '../sim';
import { IMPORTED_LICENSE_NOT_RECORDED, LICENSE_NOT_RECORDED, createDefaultProject } from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { checkGameManifest } from '../shared/project/gameManifest';
import type { GameManifestV1 } from '../shared/project/gameManifest';
import { buildGlb } from '../editor/library/gltfSanitizer';
import { buildCredits } from '../export/credits';
import type { CreditedAsset } from '../export/credits';
import { ExportError } from '../export/errors';
import { exportGame } from '../export/exportGame';
import type { AssetSource, ExportDeps, ExportRequest } from '../export/exportGame';
import { projectAssetIds } from '../export/references';
import { buildZip } from '../export/zip';
import { bootGame } from '../runtime/boot/bootGame';
import type { BootScreen } from '../runtime/boot/bootScreen';

// The export worker's pipeline (release plan P3.3), run in Node with an injected fetch

const RUNTIME = 'https://editor.test/runtime/';
const LIBRARY = 'https://library.test/';
const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const bytesOf = (text: string) => new TextEncoder().encode(text);

const runtimeJs = bytesOf('console.log("runtime");\n');
const dracoFiles = {
  'draco/draco_decoder.js': bytesOf('// decoder\n'),
  'draco/draco_decoder.wasm': new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
  'draco/draco_wasm_wrapper.js': bytesOf('// wrapper\n'),
};
const runtimeEntryFile = `game.${sha(runtimeJs).slice(0, 16)}.js`;
const runtimeManifest = {
  runtimeVersion: '0.1.0',
  entry: { file: runtimeEntryFile, sha256: sha(runtimeJs), size: runtimeJs.length },
  draco: Object.entries(dracoFiles).map(([file, b]) => ({ file, sha256: sha(b), size: b.length })),
};

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_UPLOAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const GLB = buildGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 12 }] }, new Uint8Array(12));
const DRACO_GLB = buildGlb(
  { asset: { version: '2.0' }, buffers: [{ byteLength: 12 }], extensionsUsed: ['KHR_draco_mesh_compression'] },
  new Uint8Array(12)
);

const entity = (id: string, modelAssetId: string): SimPlacedEntityV3 =>
  ({
    id,
    row: 3,
    col: 3,
    blueprintId: 'custom-glb',
    modelAssetId,
    name: 'Crate',
    yawBam: 0,
    scalePct: 100,
    isEnemy: false,
    maxHealth: 50,
    moveSpeedUnitsPerTick: 0,
    attackDamage: 0,
  }) as SimPlacedEntityV3;

const PACK = { title: 'Test Walls', author: 'Pack Author', license: 'CC0-1.0', source: 'https://example.test/walls' };

/** A one-level project: two library textures with the same bytes, an uploaded texture and an uploaded model */
function fixtureProject(model = GLB): ProjectDocV4 {
  const doc = createDefaultProject({ id: 'export-fixture', title: 'Export Fixture', author: 'Tester', now: '2026-11-15T00:00:00Z', editorVersion: '0.1.0' });
  const data = doc.levels[0].data;
  data.wallTextures[0][0] = 'folder-tex-a';
  data.wallTextures[0][1] = 'folder-tex-b';
  data.floorTextures[1][1] = 'tex-0123456789abcdef';
  data.entities = [entity('ent-1', 'glb-crate')];
  data.nextEntityId = 2;
  doc.userAssets = [
    { id: 'tex-0123456789abcdef', name: 'Upload', mimeType: 'image/png', sha256: sha(PNG_UPLOAD), size: PNG_UPLOAD.length, license: 'own-work' },
    { id: 'glb-crate', name: 'Crate', mimeType: 'model/gltf-binary', sha256: sha(model), size: model.length, license: 'CC0-1.0' },
  ];
  return doc;
}

function fixtureRequest(model = GLB): ExportRequest {
  const library = (file: string, b: Uint8Array): AssetSource => ({ type: 'library', url: LIBRARY + file, sha256: sha(b), size: b.length, path: `textures/${file}`, pack: PACK });
  return {
    doc: fixtureProject(model),
    runtimeBaseUrl: RUNTIME,
    sources: {
      'folder-tex-a': library('files/aaaaaaaaaaaaaaaa.png', PNG_A),
      'folder-tex-b': library('files/bbbbbbbbbbbbbbbb.png', PNG_A),
      'tex-0123456789abcdef': {
        type: 'user',
        name: 'Upload',
        mimeType: 'image/png',
        sha256: sha(PNG_UPLOAD),
        size: PNG_UPLOAD.length,
        blob: new Blob([PNG_UPLOAD]),
        license: 'own-work',
      },
      'glb-crate': { type: 'user', name: 'Crate', mimeType: 'model/gltf-binary', sha256: sha(model), size: model.length, bytes: model, license: 'CC0-1.0' },
    },
  };
}

/** A fetch that serves `files`, counting requests; `fail(url, attempt)` can make a request fail */
function fakeFetch(files: Map<string, Uint8Array>, fail?: (url: string, attempt: number) => boolean) {
  const calls = new Map<string, number>();
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const attempt = calls.get(url) ?? 0;
    calls.set(url, attempt + 1);
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (fail?.(url, attempt)) throw new TypeError('network down');
    const body = files.get(url);
    return body ? new Response(body as Uint8Array<ArrayBuffer>) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

function servedFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([
    [LIBRARY + 'files/aaaaaaaaaaaaaaaa.png', PNG_A],
    [LIBRARY + 'files/bbbbbbbbbbbbbbbb.png', PNG_A],
    [RUNTIME + 'runtime-manifest.json', bytesOf(JSON.stringify(runtimeManifest))],
    [RUNTIME + runtimeEntryFile, runtimeJs],
  ]);
  for (const [file, b] of Object.entries(dracoFiles)) files.set(RUNTIME + file, b);
  return files;
}

const deps = (fetchFn: typeof fetch, extra: Partial<ExportDeps> = {}): ExportDeps => ({ fetch: fetchFn, retryDelayMs: 1, ...extra });

async function expectExportError(promise: Promise<unknown>, code: string): Promise<ExportError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ExportError, String(err));
    assert.equal(err.code, code, err.message);
    return err;
  }
  assert.fail(`expected an ExportError '${code}'`);
}

describe('export worker pipeline (P3.3)', () => {
  it('writes a zip with a fixed SHA-256 for the fixture project (golden)', async () => {
    const first = await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn));
    const second = await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn, { concurrency: 1 }));
    assert.equal(first.sha256, second.sha256, 'exporting twice gives the same bytes');
    assert.equal(first.fileName, 'export-fixture-0.1.0.zip');
    assert.equal(first.runtimeVersion, '0.1.0');
    assert.equal(first.sha256, GOLDEN_SHA256, 'the zip bytes changed; update GOLDEN_SHA256 only for an intended format change');
  });

  it('lays out the zip as section 3.4 describes, and the runtime boots from it', async () => {
    const result = await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn));
    const zip = unzipSync(result.bytes);
    const paths = Object.keys(zip);
    assert.deepEqual(paths, [...paths].sort(), 'entries are sorted by path');
    assert.deepEqual(result.files.map((f) => f.path), paths);
    assert.equal(result.fileCount, paths.length);
    assert.ok(paths.includes('index.html'));
    assert.ok(paths.includes(runtimeEntryFile));
    assert.ok(!paths.some((p) => p.startsWith('draco/')), 'no Draco decoder without a Draco model');
    const dataPath = paths.find((p) => /^data\/game\.[0-9a-f]{16}\.json$/.test(p));
    assert.ok(dataPath);
    assert.equal(dataPath, `data/game.${sha(zip[dataPath]).slice(0, 16)}.json`);

    const html = strFromU8(zip['index.html']);
    assert.match(html, new RegExp(`<meta name="gcs:manifest" content="${dataPath.replace(/\./g, '\\.')}" />`));
    assert.match(html, new RegExp(`<script type="module" src="${runtimeEntryFile.replace(/\./g, '\\.')}">`));
    assert.match(html, /<title>Export Fixture<\/title>/);
    assert.doesNotMatch(html, /\{\{/);

    const checked = checkGameManifest(JSON.parse(strFromU8(zip[dataPath])));
    assert.ok(checked.ok, checked.ok ? '' : checked.message);

    // Every entry carries the fixed 1980-01-01 timestamp (DOS date 0x0021, time 0)
    const view = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    let entries = 0;
    for (let i = 0; i + 4 <= result.bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      assert.equal(view.getUint16(i + 12, true), 0, 'time');
      assert.equal(view.getUint16(i + 14, true), 0x21, 'date');
      entries++;
    }
    assert.equal(entries, paths.length);

    // The single-player boot sequence starts from the unzipped files
    const base = 'https://host.test/games/fixture/';
    let started = false;
    const screen: BootScreen = { progress() {}, error: (title, detail) => assert.fail(`${title}: ${detail}`), hide() {} };
    const ok = await bootGame({
      manifestPath: dataPath,
      baseURI: `${base}index.html`,
      fetchBytes: async (url) => {
        const file = zip[url.slice(base.length)];
        if (!file) throw new Error(`no ${url}`);
        return file;
      },
      toObjectUrl: () => 'blob:x',
      screen,
      start: (manifest) => {
        started = manifest.meta.title === 'Export Fixture' && manifest.assets.length === 4;
      },
      runtimeVersion: '0.1.0',
    });
    assert.equal(ok, true);
    assert.equal(started, true);
  });

  it('stores duplicate content once and points every id at it', async () => {
    const result = await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn));
    const zip = unzipSync(result.bytes);
    const manifest = JSON.parse(strFromU8(zip[Object.keys(zip).find((p) => p.startsWith('data/'))!])) as { assets: { id: string; path: string }[] };
    const a = manifest.assets.find((x) => x.id === 'folder-tex-a')!;
    const b = manifest.assets.find((x) => x.id === 'folder-tex-b')!;
    assert.equal(a.path, b.path);
    assert.equal(a.path, `assets/${sha(PNG_A).slice(0, 16)}.png`);
    assert.equal(Object.keys(zip).filter((p) => p.startsWith('assets/')).length, 3);
  });

  it('fails with an integrity error when a library file was tampered with', async () => {
    const files = servedFiles();
    files.set(LIBRARY + 'files/bbbbbbbbbbbbbbbb.png', new Uint8Array([...PNG_A.slice(0, -1), 0]));
    const err = await expectExportError(exportGame(fixtureRequest(), deps(fakeFetch(files).fn)), 'integrity');
    assert.match(err.message, /textures\/files\/bbbbbbbbbbbbbbbb\.png/);
    assert.match(err.detail ?? '', /expected [0-9a-f]{64}/);
  });

  it('ends without a file when cancelled', async () => {
    const controller = new AbortController();
    const { fn } = fakeFetch(servedFiles());
    const slowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      controller.abort();
      return fn(input, init);
    }) as typeof fetch;
    await expectExportError(exportGame(fixtureRequest(), deps(slowFetch, { signal: controller.signal })), 'cancelled');

    const before = new AbortController();
    before.abort();
    await expectExportError(exportGame(fixtureRequest(), deps(fn, { signal: before.signal })), 'cancelled');
  });

  it('retries a failed download twice, then reports a network error', async () => {
    const flaky = fakeFetch(servedFiles(), (url, attempt) => url.endsWith('aaaaaaaaaaaaaaaa.png') && attempt < 2);
    await exportGame(fixtureRequest(), deps(flaky.fn));
    assert.equal(flaky.calls.get(LIBRARY + 'files/aaaaaaaaaaaaaaaa.png'), 3);

    const down = fakeFetch(servedFiles(), (url) => url.endsWith('aaaaaaaaaaaaaaaa.png'));
    const err = await expectExportError(exportGame(fixtureRequest(), deps(down.fn)), 'network');
    assert.equal(down.calls.get(LIBRARY + 'files/aaaaaaaaaaaaaaaa.png'), 3);
    assert.match(err.detail ?? '', /network down/);
  });

  it('times out a stalled download', async () => {
    const stalled = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith('.png')
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
        : fakeFetch(servedFiles()).fn(input, init)) as typeof fetch;
    const err = await expectExportError(exportGame(fixtureRequest(), deps(stalled, { timeoutMs: 20, retries: 0 })), 'network');
    assert.match(err.detail ?? '', /timed out/);
  });

  it('ships the Draco decoder exactly when a model needs it', async () => {
    const result = await exportGame(fixtureRequest(DRACO_GLB), deps(fakeFetch(servedFiles()).fn));
    const paths = Object.keys(unzipSync(result.bytes));
    assert.deepEqual(paths.filter((p) => p.startsWith('draco/')), Object.keys(dracoFiles).sort());
  });

  it('refuses missing, unlicensed and damaged assets, and a damaged runtime', async () => {
    const fetchFn = fakeFetch(servedFiles()).fn;
    const missing = fixtureRequest();
    delete missing.sources['glb-crate'];
    await expectExportError(exportGame(missing, deps(fetchFn)), 'missing-asset');

    const unlicensed = fixtureRequest();
    unlicensed.sources['folder-tex-a'] = { type: 'unlicensed', name: 'Wall', url: 'https://raw.githubusercontent.com/x/y/main/wall.png' };
    await expectExportError(exportGame(unlicensed, deps(fetchFn)), 'unlicensed-asset');

    const damaged = fixtureRequest();
    damaged.sources['tex-0123456789abcdef'] = { ...(damaged.sources['tex-0123456789abcdef'] as Extract<AssetSource, { type: 'user' }>), blob: new Blob([PNG_A]) };
    await expectExportError(exportGame(damaged, deps(fetchFn)), 'missing-asset');

    const files = servedFiles();
    files.set(RUNTIME + runtimeEntryFile, bytesOf('tampered'));
    await expectExportError(exportGame(fixtureRequest(), deps(fakeFetch(files).fn)), 'runtime');
  });

  it('exports the sample project Proving Grounds', async () => {
    const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'samples/proving-grounds.gcs.json'), 'utf-8')) as ProjectDocV4;
    const used = projectAssetIds(sample);
    assert.ok(used.textures.length > 0 && used.models.length > 0);
    const files = servedFiles();
    const sources: Record<string, AssetSource> = {};
    for (const [kind, ids] of [['texture', used.textures], ['model', used.models]] as const) {
      for (const id of ids) {
        const b = kind === 'texture' ? new Uint8Array([...PNG_A, ...bytesOf(id)]) : buildGlb({ asset: { version: '2.0' }, extras: { id } }, new Uint8Array(0));
        const file = `files/${sha(b).slice(0, 16)}.${kind === 'texture' ? 'webp' : 'glb'}`;
        files.set(LIBRARY + file, b);
        sources[id] = { type: 'library', url: LIBRARY + file, sha256: sha(b), size: b.length, path: id, pack: PACK };
      }
    }
    const progress: string[] = [];
    const result = await exportGame(
      { doc: sample, runtimeBaseUrl: RUNTIME, sources },
      deps(fakeFetch(files).fn, { onProgress: (p) => progress.push(`${p.stage} ${p.done}/${p.total}`) })
    );
    assert.equal(result.fileName, `${sample.export.slug}-${sample.meta.version}.zip`);
    const zip = unzipSync(result.bytes);
    const manifest = checkGameManifest(JSON.parse(strFromU8(zip[Object.keys(zip).find((p) => p.startsWith('data/'))!])));
    assert.ok(manifest.ok, manifest.ok ? '' : manifest.message);
    assert.equal(manifest.ok && manifest.manifest.levels.length, 3);
    assert.ok(progress.includes(`download ${used.textures.length + used.models.length}/${used.textures.length + used.models.length}`));
    assert.equal(progress.at(-1), 'zip 1/1');
  });

  it('refuses unsafe zip paths', () => {
    for (const bad of ['../x', '/x', 'a/../b', 'a\\b', 'a/', './x']) {
      assert.throws(() => buildZip(new Map([[bad, new Uint8Array(1)]])), /unsafe zip path/, bad);
    }
  });
});

/** SHA-256 of the fixture's zip; it changes only with the zip format, the templates, the license texts or fflate */
const GOLDEN_SHA256 = 'cc07db8a74c862bd16a5ed0e2bb646b7fabd218c4ff99e36b6781bc5f6cf45d7';

describe('export credits and notices (P3.5)', () => {
  const unzipText = (zip: Record<string, Uint8Array>, file: string) => {
    assert.ok(zip[file], `${file} is in the zip`);
    return strFromU8(zip[file]);
  };
  const manifestOf = (zip: Record<string, Uint8Array>) =>
    JSON.parse(strFromU8(zip[Object.keys(zip).find((p) => p.startsWith('data/'))!])) as GameManifestV1;
  const NOTICE_FILES = ['CREDITS.txt', 'THIRD_PARTY_NOTICES.txt', 'LICENSE-runtime.txt', 'README.txt'];

  it('writes the four files, and credits every bundled asset in CREDITS.txt and the manifest', async () => {
    const zip = unzipSync((await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn))).bytes);
    for (const file of NOTICE_FILES) {
      assert.doesNotMatch(unzipText(zip, file), /\r/, `${file} uses LF line endings`);
    }

    const manifest = manifestOf(zip);
    const credits = unzipText(zip, 'CREDITS.txt');
    assert.ok(manifest.credits);
    const creditedPaths = new Set([
      ...manifest.credits.packs.flatMap((p) => p.files.map((f) => f.path)),
      ...manifest.credits.uploads.map((u) => u.path),
    ]);
    for (const asset of manifest.assets) {
      assert.ok(credits.includes(`(${asset.path})`) || credits.includes(`File: ${asset.path}`), `${asset.id} (${asset.path}) is in CREDITS.txt`);
      assert.ok(creditedPaths.has(asset.path), `${asset.id} is in the manifest credits`);
    }
    for (const text of [PACK.title, `Author: ${PACK.author}`, `License: ${PACK.license}`, `Source: ${PACK.source}`, 'textures/files/aaaaaaaaaaaaaaaa.png']) {
      assert.ok(credits.includes(text), text);
    }
    assert.match(credits, /Upload\n {2}License: The game author's own work/);
    assert.match(credits, /Crate\n {2}License: CC0 1\.0/);
    assert.match(credits, /^Export Fixture: credits\n/);
    assert.match(unzipText(zip, 'README.txt'), /^Export Fixture\n/);
    assert.doesNotMatch(unzipText(zip, 'README.txt'), /\{\{/);
  });

  it('includes the Draco notice exactly when the Draco files ship', async () => {
    for (const model of [GLB, DRACO_GLB]) {
      const zip = unzipSync((await exportGame(fixtureRequest(model), deps(fakeFetch(servedFiles()).fn))).bytes);
      const hasDraco = Object.keys(zip).some((p) => p.startsWith('draco/'));
      assert.equal(hasDraco, model === DRACO_GLB);
      const notices = unzipText(zip, 'THIRD_PARTY_NOTICES.txt');
      assert.equal(notices.includes('Draco 3D data compression'), hasDraco);
      assert.equal(notices.includes('Apache License'), hasDraco);
      assert.match(notices, /three\.js\nUsed in: game\.[0-9a-f]{16}\.js/);
      assert.match(notices, /Copyright © 2010-\d{4} three\.js authors/);
      assert.match(notices, /Retro FPS GCS game runtime/);
    }
  });

  it('ships the license texts unchanged from their sources', async () => {
    const zip = unzipSync((await exportGame(fixtureRequest(DRACO_GLB), deps(fakeFetch(servedFiles()).fn))).bytes);
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf-8').replace(/\r\n?/g, '\n').trimEnd();
    assert.equal(unzipText(zip, 'LICENSE-runtime.txt').trimEnd(), read('LICENSE'));
    assert.ok(read('LICENSE').includes('Michael P. Burgus'));
    assert.ok(unzipText(zip, 'THIRD_PARTY_NOTICES.txt').includes(read('node_modules/three/LICENSE')), 'the three.js license matches the installed package');
  });

  it('refuses any asset it cannot credit, before downloading anything', async () => {
    const cases: [string, (r: ExportRequest) => void][] = [
      ['a library file outside every pack', (r) => delete (r.sources['folder-tex-a'] as { pack?: unknown }).pack],
      ['a pack with an unknown license', (r) => Object.assign(r.sources['folder-tex-a'], { pack: { ...PACK, license: 'Unknown' } })],
      ['an upload with no license', (r) => delete (r.sources['glb-crate'] as { license?: unknown }).license],
      ['an upload from before licenses', (r) => Object.assign(r.sources['glb-crate'], { license: 'other', attribution: LICENSE_NOT_RECORDED })],
      ['an upload imported from a version 3 file', (r) => Object.assign(r.sources['glb-crate'], { license: 'other', attribution: IMPORTED_LICENSE_NOT_RECORDED })],
      ['a CC BY upload with no attribution', (r) => Object.assign(r.sources['glb-crate'], { license: 'CC-BY-4.0', attribution: ' ' })],
    ];
    for (const [label, change] of cases) {
      const request = fixtureRequest();
      change(request);
      const served = fakeFetch(servedFiles());
      await expectExportError(exportGame(request, deps(served.fn)), 'unlicensed-asset');
      assert.equal(served.calls.size, 0, `${label}: nothing downloaded`);
    }
  });

  it('credits an attribution, and gives the same credits for the same assets in any order', async () => {
    const request = fixtureRequest();
    Object.assign(request.sources['glb-crate'], { license: 'CC-BY-4.0', attribution: 'Crate by A. Modeller' });
    const credits = unzipText(unzipSync((await exportGame(request, deps(fakeFetch(servedFiles()).fn))).bytes), 'CREDITS.txt');
    assert.match(credits, /Crate\n {2}License: CC BY 4\.0\n {2}Attribution: Crate by A\. Modeller\n {2}File: assets\/[0-9a-f]{16}\.glb/);

    const assets: CreditedAsset[] = [
      { id: 'b', kind: 'texture', path: 'assets/bbbbbbbbbbbbbbbb.png', source: { type: 'library', path: 'textures/b.png', pack: PACK } },
      { id: 'a', kind: 'texture', path: 'assets/aaaaaaaaaaaaaaaa.png', source: { type: 'library', path: 'textures/a.png', pack: PACK } },
      { id: 'u', kind: 'model', path: 'assets/cccccccccccccccc.glb', source: { type: 'user', name: 'Thing', license: 'CC0-1.0' } },
    ];
    assert.deepEqual(buildCredits(assets), buildCredits([...assets].reverse()));
    assert.deepEqual(
      buildCredits(assets).packs[0].files.map((f) => f.name),
      ['textures/a.png', 'textures/b.png']
    );
  });

  it('lets the runtime refuse a manifest with malformed credits', async () => {
    const manifest = manifestOf(unzipSync((await exportGame(fixtureRequest(), deps(fakeFetch(servedFiles()).fn))).bytes));
    assert.ok(checkGameManifest(manifest).ok);
    const withoutCredits: Partial<GameManifestV1> = { ...manifest };
    delete withoutCredits.credits;
    assert.ok(checkGameManifest(withoutCredits).ok, 'games exported before P3.5 still load');
    const bad = { ...manifest, credits: { packs: [{ title: 'x', author: 'y', license: 'z', source: 's', files: [{ name: 'n', path: '../x' }] }], uploads: [] } };
    assert.equal(checkGameManifest(bad).ok, false);
  });
});
