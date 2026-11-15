import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveGameUrl, readManifestPath } from '../runtime/boot/urls';
import { bootGame } from '../runtime/boot/bootGame';
import type { BootScreen } from '../runtime/boot/bootScreen';
import { GAME_MANIFEST_FORMAT, GAME_MANIFEST_SCHEMA_VERSION, checkGameManifest } from '../shared/project/gameManifest';
import type { GameManifestV1 } from '../shared/project/gameManifest';
import { createBlankLevelV3, createDefaultGameData } from '../shared/project';

const TEX_SHA = 'a'.repeat(64);

function manifest(overrides: Partial<GameManifestV1> = {}): GameManifestV1 {
  const level = createBlankLevelV3(16, 'Entry');
  level.wallTextures[0][0] = 'tex-aaaaaaaaaaaaaaaa';
  return {
    format: GAME_MANIFEST_FORMAT,
    schemaVersion: GAME_MANIFEST_SCHEMA_VERSION,
    runtimeVersion: '0.1.0',
    meta: { title: 'Test Game', author: 'Tester', description: '', version: '1.0.0' },
    levels: [{ id: 'level-1', title: 'Entry', data: level }],
    campaign: { carryOverHealth: true, carryOverAmmo: true },
    gameData: createDefaultGameData(),
    assets: [{ id: 'tex-aaaaaaaaaaaaaaaa', kind: 'texture', path: 'assets/aaaaaaaaaaaaaaaa.png', sha256: TEX_SHA, size: 3 }],
    ...overrides,
  };
}

function recordingScreen() {
  const log: { kind: 'progress' | 'error' | 'hide'; text: string }[] = [];
  const screen: BootScreen = {
    progress: (label) => log.push({ kind: 'progress', text: label }),
    error: (title, detail) => log.push({ kind: 'error', text: `${title}: ${detail}` }),
    hide: () => log.push({ kind: 'hide', text: '' }),
  };
  return { screen, log };
}

/** A fake web server: path on the page's origin to bytes */
function server(files: Record<string, Uint8Array | string>) {
  const requested: string[] = [];
  const fetchBytes = async (url: string, onProgress: (n: number) => void) => {
    requested.push(url);
    const file = files[new URL(url).pathname];
    if (file === undefined) throw new Error(`404 ${url}`);
    const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
    onProgress(bytes.length);
    return bytes;
  };
  return { fetchBytes, requested };
}

describe('single-player boot (P3.1)', () => {
  it('resolves game paths for pages at /, /a/b/ and /a/b/index.html', () => {
    const file = 'data/game.0123456789abcdef.json';
    assert.equal(resolveGameUrl(file, 'https://host.example/'), 'https://host.example/data/game.0123456789abcdef.json');
    assert.equal(resolveGameUrl(file, 'https://host.example/a/b/'), 'https://host.example/a/b/data/game.0123456789abcdef.json');
    assert.equal(resolveGameUrl(file, 'https://host.example/a/b/index.html'), 'https://host.example/a/b/data/game.0123456789abcdef.json');
    assert.equal(resolveGameUrl('draco/', 'https://user.itch.io/game/index.html'), 'https://user.itch.io/game/draco/');
  });

  it('refuses absolute paths, other origins and parent folders', () => {
    for (const bad of ['/data/game.json', '//evil.example/x.json', 'https://evil.example/x.json', 'data:application/json,{}', 'javascript:alert(1)', '../secret.json', 'data/../../x.json', '']) {
      assert.throws(() => resolveGameUrl(bad, 'https://host.example/a/b/'), bad);
    }
  });

  it('reads the manifest path from the page', () => {
    const doc = { querySelector: () => ({ getAttribute: () => ' data/game.abc.json ' }) } as unknown as Document;
    assert.equal(readManifestPath(doc), 'data/game.abc.json');
    assert.equal(readManifestPath({ querySelector: () => null } as unknown as Document), null);
  });

  it('shows the error screen for a manifest with a newer schema, and starts nothing', async () => {
    const { screen, log } = recordingScreen();
    const { fetchBytes } = server({ '/a/b/data/game.json': JSON.stringify(manifest({ schemaVersion: GAME_MANIFEST_SCHEMA_VERSION + 1 })) });
    let started = false;
    const ok = await bootGame({
      manifestPath: 'data/game.json',
      baseURI: 'https://host.example/a/b/index.html',
      fetchBytes,
      toObjectUrl: () => 'blob:x',
      screen,
      start: () => {
        started = true;
      },
    });
    assert.equal(ok, false);
    assert.equal(started, false);
    const error = log.find((e) => e.kind === 'error');
    assert.match(error?.text ?? '', /newer editor/);
  });

  it('loads the manifest and every asset relative to the page, then starts', async () => {
    const { screen, log } = recordingScreen();
    const { fetchBytes, requested } = server({
      '/games/proving-grounds/data/game.json': JSON.stringify(manifest()),
      '/games/proving-grounds/assets/aaaaaaaaaaaaaaaa.png': new Uint8Array([1, 2, 3]),
    });
    let startedWith: Map<string, string> | null = null;
    const ok = await bootGame({
      manifestPath: 'data/game.json',
      baseURI: 'https://host.example/games/proving-grounds/',
      fetchBytes,
      toObjectUrl: (bytes, mime) => `blob:${mime}:${bytes.length}`,
      screen,
      start: (_m, urls) => {
        startedWith = urls;
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(requested, [
      'https://host.example/games/proving-grounds/data/game.json',
      'https://host.example/games/proving-grounds/assets/aaaaaaaaaaaaaaaa.png',
    ]);
    assert.equal(startedWith!.get('tex-aaaaaaaaaaaaaaaa'), 'blob:image/png:3');
    assert.ok(log.some((e) => e.kind === 'progress' && e.text.includes('1 of 1')));
  });

  it('refuses a manifest whose assets point outside assets/', () => {
    const bad = manifest();
    bad.assets[0].path = '../evil.png';
    const result = checkGameManifest(bad);
    assert.equal(result.ok, false);
    const otherMajor = checkGameManifest(manifest({ runtimeVersion: '2.0.0' }));
    assert.equal(otherMajor.ok, false);
    assert.equal(otherMajor.ok ? '' : otherMajor.reason, 'runtime-mismatch');
  });

  it('has no absolute fetch anywhere in src/runtime', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf-8');
          // fetch('/...'), fetch("http..."), new URL('/...', ...) or a literal origin passed to a loader
          if (/\bfetch\(\s*['"`](?:\/|https?:)/.test(text) || /new URL\(\s*['"`]\//.test(text)) offenders.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), 'src/runtime'));
    assert.deepEqual(offenders, []);
  });
});
