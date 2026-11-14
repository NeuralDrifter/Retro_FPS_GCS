import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalStringify,
  createDefaultGameData,
  createDefaultProject,
  isMultiplayerEnabled,
  slugify,
  validateProjectV4,
} from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { DEFAULT_ENTITY_BLUEPRINTS, ENGINE_CONFIG } from '../runtime/types';
import { createFullTestLevel } from './determinismFixtures';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maliciousDir = path.join(root, 'tests/fixtures/malicious');

const newProject = (): ProjectDocV4 =>
  createDefaultProject({ id: 'test-project', title: 'Test Game', now: '2026-11-14T08:00:00Z', editorVersion: '0.1.0' });

/** A richer document: the determinism fixture level, a user asset, campaign menus and multiplayer */
function sampleProject(): ProjectDocV4 {
  const doc = newProject();
  doc.levels.push({ id: 'full-level', title: 'Full Test Level', data: createFullTestLevel() });
  doc.userAssets.push({
    id: 'tex-brick',
    name: 'Brick',
    mimeType: 'image/png',
    sha256: 'a'.repeat(64),
    size: 6,
    license: 'CC-BY-4.0',
    attribution: 'Brick by A. Artist, CC BY 4.0',
    data: 'AAAAAAAA',
  });
  doc.campaign.menus = { presetId: 'retro-shareware', screens: [] };
  doc.multiplayer = {
    enabled: true,
    mode: 'coop',
    maxPlayers: 4,
    serverUrl: 'wss://play.example.org/game',
    allowedOrigins: ['https://example.org', 'https://user.itch.io'],
    allowSinglePlayer: true,
    coop: { friendlyFire: false, respawnSeconds: 5 },
    deathmatch: { fragLimit: 20, timeLimitMinutes: 10, respawnSeconds: 3 },
  };
  return doc;
}

/** Where each malicious fixture must be reported */
const EXPECTED_PATHS: Record<string, string> = {
  'root-array': '$',
  'root-null': '$',
  'proto-pollution-root': '$.__proto__',
  'constructor-key-in-level': '$.levels[0].data.constructor',
  'schema-version-5': '$.schemaVersion',
  'schema-version-missing': '$.schemaVersion',
  'unknown-root-field': '$.evil',
  'unknown-meta-field': '$.meta.script',
  'huge-title': '$.meta.title',
  'deep-nesting': '$.campaign.menus',
  'too-many-levels': '$.levels',
  'zero-levels': '$.levels',
  'duplicate-level-ids': '$.levels[1].id',
  'bad-level-grid-value': '$.levels[0].data',
  'multiplayer-enabled-string': '$.multiplayer.enabled',
  'multiplayer-ws-remote': '$.multiplayer.serverUrl',
  'multiplayer-origin-with-path': '$.multiplayer.allowedOrigins[0]',
  'multiplayer-nine-players': '$.multiplayer.maxPlayers',
  'asset-bad-sha256': '$.userAssets[0].sha256',
  'asset-size-mismatch': '$.userAssets[0].data',
  'asset-cc-by-without-attribution': '$.userAssets[0].attribution',
  'asset-html-mime': '$.userAssets[0].mimeType',
  'asset-builtin-texture-id': '$.userAssets[0].id',
  'health-as-string': '$.gameData.player.maxHealth',
  'slug-with-spaces': '$.export.slug',
  'negative-start-ammo': '$.gameData.player.startAmmo',
  'weapon-zero-cooldown': '$.gameData.weapons[0].fireCooldownMs',
  'uppercase-project-id': '$.id',
  'invalid-timestamp': '$.meta.createdAt',
};

describe('project schema v4 (P2.1)', () => {
  it('accepts the default and sample documents', () => {
    for (const doc of [newProject(), sampleProject()]) {
      const result = validateProjectV4(doc);
      assert.deepEqual(result.errors, []);
      assert.equal(result.valid, true);
    }
  });

  it('rejects every malicious fixture with a path-specific error and never throws', () => {
    const files = fs.readdirSync(maliciousDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, Object.keys(EXPECTED_PATHS).length, 'every fixture has an expected path');
    for (const file of files) {
      const name = file.replace(/\.json$/, '');
      const expected = EXPECTED_PATHS[name];
      assert.ok(expected, `no expected path for ${name}`);
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(maliciousDir, file), 'utf-8'));
      let result: ReturnType<typeof validateProjectV4> | undefined;
      assert.doesNotThrow(() => {
        result = validateProjectV4(parsed);
      }, name);
      assert.equal(result!.valid, false, `${name} must be rejected`);
      assert.ok(
        result!.errors.some((e) => e.path === expected || e.path.startsWith(`${expected}.`) || e.path.startsWith(`${expected}[`)),
        `${name}: expected an error at ${expected}, got ${result!.errors.map((e) => e.path).join(', ')}`
      );
    }
  });

  it('never throws, even on values JSON cannot produce', () => {
    const hostile = {
      ...newProject(),
      get meta(): never {
        throw new Error('getter bomb');
      },
    };
    const result = validateProjectV4(hostile);
    assert.equal(result.valid, false);
    for (const value of [undefined, 0, 'x', Symbol('s'), () => 1, new Map(), Object.create(null)]) {
      assert.doesNotThrow(() => validateProjectV4(value));
    }
  });

  it('counts multiplayer as on only when enabled is literally true', () => {
    const doc = sampleProject();
    assert.equal(isMultiplayerEnabled(doc), true);
    for (const enabled of ['true', 1, 'yes', null, undefined, false]) {
      assert.equal(isMultiplayerEnabled({ multiplayer: { ...doc.multiplayer, enabled } }), false, String(enabled));
    }
    assert.equal(isMultiplayerEnabled(newProject()), false);
  });

  it('serializes canonically: byte-stable regardless of key order', () => {
    const doc = sampleProject();
    const first = canonicalStringify(doc);
    assert.equal(canonicalStringify(doc), first);
    assert.equal(canonicalStringify(JSON.parse(first)), first);
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]))
          : value;
    assert.equal(canonicalStringify(reversed(doc)), first);
    assert.ok(first.endsWith('}\n'));
  });

  it('defaults reproduce the engine built-in rules', () => {
    const data = createDefaultGameData();
    assert.equal(data.player.maxHealth, ENGINE_CONFIG.PLAYER_MAX_HEALTH);
    assert.equal(data.player.startAmmo, ENGINE_CONFIG.PLAYER_START_AMMO);
    assert.equal(data.player.maxAmmo, ENGINE_CONFIG.PLAYER_MAX_AMMO);
    assert.equal(data.weapons[0].damage, ENGINE_CONFIG.WEAPON_DAMAGE);
    assert.equal(data.weapons[0].fireCooldownMs, ENGINE_CONFIG.WEAPON_FIRE_COOLDOWN * 1000);
    assert.equal(data.pickups[0].amount, ENGINE_CONFIG.AMMO_DROP_AMOUNT);
    for (const enemy of data.enemies) {
      const blueprint = DEFAULT_ENTITY_BLUEPRINTS.find((b) => b.id === enemy.id);
      assert.ok(blueprint, enemy.id);
      assert.equal(enemy.health, blueprint.defaultHealth, `${enemy.id} health`);
      assert.equal(enemy.moveSpeed, blueprint.moveSpeed, `${enemy.id} speed`);
      assert.equal(enemy.attackDamage, blueprint.attackDamage, `${enemy.id} damage`);
      assert.equal(enemy.attackRange, ENGINE_CONFIG.ENEMY_ATTACK_RANGE);
      assert.equal(enemy.attackCooldownMs, ENGINE_CONFIG.ENEMY_ATTACK_COOLDOWN * 1000);
      assert.equal(enemy.sightRange, ENGINE_CONFIG.ENEMY_LOS_RANGE);
    }
  });

  it('slugifies titles for export', () => {
    assert.equal(slugify('My Great Game!'), 'my-great-game');
    assert.equal(slugify('  ---  '), 'game');
    assert.equal(slugify('Ümlaut Café'), 'umlaut-cafe');
  });
});
