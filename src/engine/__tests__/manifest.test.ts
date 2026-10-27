import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GameManifest,
  createGameManifest,
  migrateGameManifest,
  validateGameManifest,
  startGame,
} from '../../runtime';
import {
  createMinimalArenaTestLevel,
  createFullTestLevel,
  generateDeterministic3000TickInputs,
} from './determinismFixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(__dirname, 'determinismBaseline.json');

interface DeterminismBaselineFile {
  tickCount: number;
  minimalArenaHashes: string[];
  fullTestLevelHashes: string[];
}

describe('Phase 2 Acceptance: GameManifest wrapping LevelDataV3', () => {
  const baseline: DeterminismBaselineFile = JSON.parse(
    fs.readFileSync(baselinePath, 'utf-8')
  );
  const inputs3000 = generateDeterministic3000TickInputs(3000);

  it('creates a schemaVersion: 1 GameManifest conforming to specifications', () => {
    const level1 = createMinimalArenaTestLevel();
    const manifest = createGameManifest(level1, {
      title: 'Arena Alpha',
      author: 'Test Pilot',
      description: 'A test battleground',
    });

    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.meta.title, 'Arena Alpha');
    assert.equal(manifest.meta.author, 'Test Pilot');
    assert.equal(manifest.meta.description, 'A test battleground');
    assert.equal(typeof manifest.meta.createdAt, 'string');
    assert.equal(typeof manifest.meta.engineVersion, 'string');

    // No scripts or multiplayer in v1 schema
    assert.equal((manifest as any).scripts, undefined);
    assert.equal((manifest as any).multiplayer, undefined);

    // Assets arrays initialized
    assert.ok(Array.isArray(manifest.assets.textures));
    assert.ok(Array.isArray(manifest.assets.models));

    // Validates cleanly
    const validation = validateGameManifest(manifest);
    assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
  });

  it('handles schemaVersion migration hook and rejects unsupported versions', () => {
    const level = createMinimalArenaTestLevel();
    const validManifest = createGameManifest(level);

    // Round-trip valid v1 manifest
    const migratedV1 = migrateGameManifest(validManifest);
    assert.equal(migratedV1.schemaVersion, 1);

    // Unsupported future schemaVersion must throw
    assert.throws(
      () =>
        migrateGameManifest({
          ...validManifest,
          schemaVersion: 2,
        }),
      /Unsupported GameManifest schemaVersion: 2/
    );

    assert.throws(
      () =>
        migrateGameManifest({
          ...validManifest,
          schemaVersion: 99,
        }),
      /Unsupported GameManifest schemaVersion: 99/
    );
  });

  it('automatically migrates un-wrapped legacy levels to GameManifest', () => {
    const level = createMinimalArenaTestLevel();
    // Pass raw LevelDataV3 without manifest wrapper
    const wrapped = migrateGameManifest(level);
    assert.equal(wrapped.schemaVersion, 1);
    assert.ok(wrapped.level.grid.length > 0);
    assert.equal(wrapped.meta.title, level.metadata?.title ?? 'Minimal Arena');
  });

  it('validates manifest structures and catches missing or corrupted fields', () => {
    assert.equal(validateGameManifest(null).valid, false);
    assert.equal(validateGameManifest({}).valid, false);

    const badVersion = {
      schemaVersion: 2,
      meta: { title: 'T', author: 'A', description: '', createdAt: '', engineVersion: '2.0.0' },
      level: createMinimalArenaTestLevel(),
      assets: { textures: [], models: [] },
    };
    assert.equal(validateGameManifest(badVersion).valid, false);

    const missingAssets = {
      schemaVersion: 1,
      meta: { title: 'T', author: 'A', description: '', createdAt: '', engineVersion: '2.0.0' },
      level: createMinimalArenaTestLevel(),
      assets: null,
    };
    assert.equal(validateGameManifest(missingAssets).valid, false);
  });

  it('ACCEPTANCE: Serializes Test Level 1 to GameManifest, JSON round-trips it, and replays 3000 ticks matching baseline hashes exactly', () => {
    const level1 = createMinimalArenaTestLevel();
    const manifest = createGameManifest(level1, {
      title: 'Minimal Arena Game',
      author: 'Test Author',
    });

    // JSON round-trip
    const serializedJson = JSON.stringify(manifest);
    const parsedManifest = JSON.parse(serializedJson);

    // Feed parsed GameManifest directly to startGame
    const game = startGame(parsedManifest, null, {
      inputSource: inputs3000,
    });

    const activeManifest = game.getManifest();
    assert.equal(activeManifest.schemaVersion, 1);
    assert.equal(activeManifest.meta.title, 'Minimal Arena Game');

    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    assert.equal(baseline.minimalArenaHashes.length, 3000);

    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.minimalArenaHashes[i]) {
        assert.fail(
          `Test Level 1 GameManifest round-trip hash mismatch at tick ${i + 1}: expected ${
            baseline.minimalArenaHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });

  it('ACCEPTANCE: Serializes Test Level 2 to GameManifest, JSON round-trips it, and replays 3000 ticks matching baseline hashes exactly', () => {
    const level2 = createFullTestLevel();
    const manifest = createGameManifest(level2, {
      title: 'Full Featured Game',
      author: 'Engineer',
      description: 'Complete multi-room dungeon test level',
    });

    // JSON round-trip
    const serializedJson = JSON.stringify(manifest);
    const parsedManifest = JSON.parse(serializedJson);

    // Feed parsed GameManifest directly to startGame
    const game = startGame(parsedManifest, null, {
      inputSource: inputs3000,
    });

    const activeManifest = game.getManifest();
    assert.equal(activeManifest.schemaVersion, 1);
    assert.equal(activeManifest.meta.title, 'Full Featured Game');

    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    assert.equal(baseline.fullTestLevelHashes.length, 3000);

    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.fullTestLevelHashes[i]) {
        assert.fail(
          `Test Level 2 GameManifest round-trip hash mismatch at tick ${i + 1}: expected ${
            baseline.fullTestLevelHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });
});
