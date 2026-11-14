import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, migrateToV4, validateProjectV4 } from '../shared/project';
import type { MigrationOptions, ProjectDocV4 } from '../shared/project';
import { base64ToBytes, sha256Hex } from '../shared/bytes';
import { LegacyLevelSerializer } from '../editor/project/legacy';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const legacyDir = path.join(root, 'tests/fixtures/legacy');
const load = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(legacyDir, `${name}.json`), 'utf-8'));

const options: MigrationOptions = {
  legacyToV3: (level) => LegacyLevelSerializer.migrateToV3(level),
  projectId: 'migrated-project',
  now: '2026-11-14T09:00:00Z',
  editorVersion: '0.1.0',
};

function migrate(raw: unknown): ProjectDocV4 {
  const result = migrateToV4(raw, options);
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.deepEqual(validateProjectV4(result.doc).errors, []);
  return result.doc;
}

type Legacy = Record<string, unknown> & {
  grid: number[][];
  wallTextures: string[][];
  floorTextures: string[][];
  entities: unknown[];
  events?: { id: string }[];
};

describe('migrations to project schema v4 (P2.2)', () => {
  it('converts every legacy fixture to a valid v4 document', () => {
    const files = fs.readdirSync(legacyDir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 5);
    for (const file of files) migrate(load(file.replace(/\.json$/, '')));
  });

  it('v1: keeps the grid of a bare grid array', () => {
    const grid = load('v1-grid-only') as number[][];
    const doc = migrate(grid);
    assert.deepEqual(doc.levels[0].data.grid, grid);
  });

  it('v2: keeps grids, textures, entities and events of an editor save', () => {
    const source = load('v2-preset-classic-maze') as Legacy;
    const doc = migrate(source);
    const level = doc.levels[0];
    assert.equal(level.title, source.title);
    assert.equal(doc.meta.title, source.title);
    assert.deepEqual(level.data.grid, source.grid);
    assert.deepEqual(level.data.wallTextures, source.wallTextures);
    assert.deepEqual(level.data.floorTextures, source.floorTextures);
    assert.equal(level.data.entities.length, source.entities.length);
    assert.deepEqual(level.data.events.map((e) => e.id), (source.events ?? []).map((e) => e.id));
    assert.ok(level.data.events.length > 0, 'the preset has events');
  });

  it('v2 campaign: keeps every level and the campaign settings, and embeds custom textures with SHA-256', () => {
    const source = load('v2-campaign-custom-texture') as Legacy & { levels: Legacy[]; customTextures: { previewUrl: string }[] };
    const doc = migrate(source);
    assert.equal(doc.levels.length, source.levels.length);
    source.levels.forEach((lvl, i) => {
      assert.deepEqual(doc.levels[i].data.grid, lvl.grid);
      assert.deepEqual(doc.levels[i].data.wallTextures, lvl.wallTextures);
    });
    assert.deepEqual({ h: doc.campaign.carryOverHealth, a: doc.campaign.carryOverAmmo }, { h: true, a: false });

    assert.equal(doc.userAssets.length, 1);
    const asset = doc.userAssets[0];
    const bytes = base64ToBytes(source.customTextures[0].previewUrl.split(',')[1])!;
    assert.equal(asset.id, 'tex-legacy-brick');
    assert.equal(asset.mimeType, 'image/png');
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.sha256, sha256Hex(bytes));
    assert.equal(doc.levels[0].data.wallTextures[0][1], 'tex-legacy-brick');
  });

  it('v3 level and v3 manifest: keep the levels unchanged', () => {
    const level = load('v3-level') as { grid: number[][] };
    assert.deepEqual(migrate(level).levels[0].data, level);

    const manifest = load('v3-manifest') as { levels: unknown[]; meta: { title: string; author: string } };
    const doc = migrate(manifest);
    assert.deepEqual(doc.levels.map((l) => l.data), manifest.levels);
    assert.equal(doc.meta.title, manifest.meta.title);
    assert.equal(doc.meta.author, manifest.meta.author);
    assert.deepEqual({ h: doc.campaign.carryOverHealth, a: doc.campaign.carryOverAmmo }, { h: false, a: true });
  });

  it('v4: migrate returns an equal document', () => {
    const doc = migrate(load('v2-campaign-custom-texture'));
    const again = migrateToV4(JSON.parse(JSON.stringify(doc)), options);
    assert.ok(again.ok);
    assert.equal(again.from, 'v4');
    assert.deepEqual(again.doc, doc);
  });

  it('save, load, save gives identical canonical JSON', () => {
    for (const name of ['v1-grid-only', 'v2-campaign-custom-texture', 'v3-manifest']) {
      const saved = canonicalStringify(migrate(load(name)));
      const reloaded = migrateToV4(JSON.parse(saved), options);
      assert.ok(reloaded.ok);
      assert.equal(canonicalStringify(reloaded.doc), saved, name);
    }
  });

  it('refuses newer schemas, unknown files and legacy files without the editor converter', () => {
    const newer = migrateToV4({ schemaVersion: 7, levels: [] }, options);
    assert.equal(newer.ok, false);
    assert.match(newer.ok ? '' : newer.error, /schema version 7/);

    const unknown = migrateToV4({ hello: 'world' }, options);
    assert.equal(unknown.ok, false);

    const noConverter = migrateToV4(load('v2-preset-classic-maze'), { ...options, legacyToV3: undefined });
    assert.equal(noConverter.ok, false);
    assert.match(noConverter.ok ? '' : noConverter.error, /legacyToV3/);
  });
});
