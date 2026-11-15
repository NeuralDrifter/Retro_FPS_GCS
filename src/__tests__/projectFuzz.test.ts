import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createDefaultProject, migrateToV4, validateProjectV4 } from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { LevelSerializer } from '../editor/engine/LevelSerializer';
import { createFullTestLevel } from './determinismFixtures';

// S-02 (release plan P7.2): mutated documents never crash validation or migration, never pollute
// prototypes, and every rejection names where it failed. Seeded, so a failure reproduces.

const ITERATIONS = 10_000;
const legacyDir = path.join(process.cwd(), 'tests/fixtures/legacy');

function sampleProject(): ProjectDocV4 {
  const doc = createDefaultProject({ id: 'fuzz-project', title: 'Fuzz', now: '2026-11-15T00:00:00Z', editorVersion: '0.1.0' });
  doc.levels.push({ id: 'full-level', title: 'Full', data: createFullTestLevel() });
  doc.userAssets.push({ id: 'tex-brick', name: 'Brick', mimeType: 'image/png', sha256: 'a'.repeat(64), size: 6, license: 'own-work', data: 'AAAAAAAA' });
  doc.campaign.menus = { presetId: 'retro-shareware', screens: [] };
  doc.multiplayer = {
    enabled: true,
    mode: 'coop',
    maxPlayers: 4,
    serverUrl: 'wss://play.example.org/game',
    allowedOrigins: ['https://example.org'],
    allowSinglePlayer: true,
    coop: { friendlyFire: false, respawnSeconds: 5 },
    deathmatch: { fragLimit: 20, timeLimitMinutes: 10, respawnSeconds: 3 },
  };
  return doc;
}

const bases: unknown[] = [
  sampleProject(),
  ...fs.readdirSync(legacyDir).map((f) => JSON.parse(fs.readFileSync(path.join(legacyDir, f), 'utf-8')) as unknown),
];

/** Mulberry32: small, fast and seeded */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const deep = (depth: number): unknown => (depth === 0 ? 1 : [deep(depth - 1)]);
const HOSTILE_VALUES: (() => unknown)[] = [
  () => null,
  () => 0,
  () => -1,
  () => 1.5,
  () => Number.NaN,
  () => Number.POSITIVE_INFINITY,
  () => 2 ** 53,
  () => '',
  () => 'x'.repeat(5000),
  () => '<script>alert(1)</script>',
  () => 'javascript:alert(1)',
  () => [],
  () => ({}),
  () => true,
  () => deep(120),
  () => JSON.parse('{"__proto__":{"polluted":true}}'),
  () => JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
];
const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'evil', 'toString', 'valueOf', 'hasOwnProperty'];

type Container = Record<string, unknown> | unknown[];

/** Every object and array in the tree, up to a limit, so mutations can land anywhere */
function containers(root: unknown, limit = 4000): Container[] {
  const out: Container[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < limit) {
    const node = stack.pop();
    if (node && typeof node === 'object') {
      out.push(node as Container);
      for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
    }
  }
  return out;
}

function mutate(doc: unknown, random: () => number): unknown {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const all = containers(doc);
  const target = pick(all);
  const keys = Object.keys(target);
  const key = keys.length > 0 ? pick(keys) : '0';
  const roll = random();
  if (Array.isArray(target)) {
    const i = Number(key);
    if (roll < 0.25) target.splice(i, 1);
    else if (roll < 0.5) target.push(...Array.from({ length: 1 + Math.floor(random() * 4) }, () => target[i]));
    else target[i] = pick(HOSTILE_VALUES)();
  } else if (roll < 0.25) {
    delete target[key];
  } else if (roll < 0.5) {
    // An own property named like a hostile key, as JSON.parse would create it
    Object.assign(target, JSON.parse(`{${JSON.stringify(pick(HOSTILE_KEYS))}: ${JSON.stringify(pick(HOSTILE_VALUES)() ?? null)}}`));
  } else if (roll < 0.7 && typeof target[key] === 'number') {
    target[key] = String(target[key]);
  } else {
    target[key] = pick(HOSTILE_VALUES)();
  }
  return doc;
}

const prototypeKeys = () => [Object.prototype, Array.prototype, Function.prototype].map((p) => Object.getOwnPropertyNames(p).sort().join());

describe('project document fuzzing (P7.2, S-02)', () => {
  it(`survives ${ITERATIONS} mutated documents through validation and migration`, { timeout: 180_000 }, () => {
    const before = prototypeKeys();
    const random = rng(0x5eed);
    const options = {
      legacyToV3: (level: unknown) => LevelSerializer.migrateToV3(level),
      projectId: 'fuzz-migrated',
      now: '2026-11-15T00:00:00Z',
      editorVersion: '0.1.0',
    };
    let rejected = 0;
    for (let i = 0; i < ITERATIONS; i++) {
      const base = bases[i % bases.length];
      let doc = structuredClone(base);
      const mutations = 1 + Math.floor(random() * 3);
      for (let m = 0; m < mutations; m++) doc = mutate(doc, random);

      let validation: ReturnType<typeof validateProjectV4>;
      try {
        validation = validateProjectV4(doc);
      } catch (err) {
        assert.fail(`validation threw on iteration ${i}: ${String(err)}`);
      }
      if (!validation.valid) {
        rejected++;
        assert.ok(validation.errors.length > 0, `iteration ${i}: rejected without errors`);
        for (const e of validation.errors) assert.match(e.path, /^\$/, `iteration ${i}: error without a path`);
      }

      let migration: ReturnType<typeof migrateToV4>;
      try {
        migration = migrateToV4(doc, options);
      } catch (err) {
        assert.fail(`migration threw on iteration ${i}: ${String(err)}`);
      }
      if (!migration.ok) assert.ok(migration.error.length > 0, `iteration ${i}: migration failed without a message`);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined, 'Object.prototype was polluted');
    assert.deepEqual(prototypeKeys(), before, 'a prototype gained properties');
    assert.ok(rejected > ITERATIONS / 2, `most mutations should be rejected (${rejected})`);
  });
});
