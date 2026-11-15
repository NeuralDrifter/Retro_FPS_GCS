import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalStringify, migrateToV4, validateProjectV4 } from '../shared/project';
import type { ProjectDocV4 } from '../shared/project';
import { createInitialSimulationState, step } from '../sim';
import type { PlayerTickInput } from '../sim';
import { buildProject } from '../../scripts/build-sample';
import type { InputRecording } from '../../scripts/build-sample';
import { actionCoverage } from '../../scripts/action-coverage';

// The sample project "Proving Grounds" (release plan P2.8)

const root = process.cwd();
const sample = JSON.parse(fs.readFileSync(path.join(root, 'samples/proving-grounds.gcs.json'), 'utf-8')) as ProjectDocV4;
const recording = JSON.parse(fs.readFileSync(path.join(root, 'samples/recordings/level1.json'), 'utf-8')) as InputRecording;
const IDLE: PlayerTickInput = { moveForward: 0, moveRight: 0, sprint: false, yawDeltaBam: 0, pitchDeltaBam: 0, use: false, shoot: false };

describe('sample project Proving Grounds (P2.8)', () => {
  it('is a valid v4 project that opens as is, with three levels', () => {
    const result = validateProjectV4(sample);
    assert.deepEqual(result.valid ? [] : result.errors.slice(0, 5), []);
    const opened = migrateToV4(sample, { projectId: 'unused', now: '2026-11-15T00:00:00Z', editorVersion: '0.1.0' });
    assert.equal(opened.ok, true);
    assert.equal(opened.ok && opened.from, 'v4');
    assert.deepEqual(sample.levels.map((l) => l.title), ['Intake Hall', 'Pump Station', 'Command Core']);
  });

  it('matches what scripts/build-sample.ts generates (run `npm run build:sample` after changing it)', () => {
    assert.equal(canonicalStringify(buildProject()), canonicalStringify(sample));
  });

  it('has an input recording that reaches the level 1 exit in a headless run', () => {
    let state = createInitialSimulationState(sample.levels[0].data, [0]);
    for (const segment of recording.segments) {
      for (let t = 0; t < segment.ticks && !state.levelEnded; t++) state = step(state, { 0: segment.input });
    }
    assert.equal(state.levelEnded, true);
    assert.equal(state.secretExitTriggered ?? false, false);
  });

  it('runs every level for 15 seconds without a sim error', () => {
    for (const level of sample.levels) {
      let state = createInitialSimulationState(level.data, [0]);
      for (let t = 0; t < 450; t++) state = step(state, { 0: IDLE });
      const errors = state.logs.filter((l) => l.level === 'error');
      assert.deepEqual(errors, [], level.title);
    }
  });

  it('uses most event actions, every enemy type, and the library', () => {
    const coverage = actionCoverage(sample);
    assert.ok(coverage.actions.unused.length <= 4, `unused actions: ${coverage.actions.unused.join(', ')}`);
    const entities = sample.levels.flatMap((l) => l.data.entities);
    for (const blueprint of ['sentinel-bot', 'turret-guardian', 'supply-crate', 'custom-glb']) {
      assert.ok(entities.some((e) => e.blueprintId === blueprint), blueprint);
    }
    assert.ok(entities.some((e) => e.blueprintId === 'custom-glb' && e.isEnemy), 'a library monster');
    const textures = new Set(sample.levels.flatMap((l) => [...l.data.wallTextures.flat(), ...l.data.floorTextures.flat()]));
    assert.ok([...textures].some((t) => t.startsWith('folder-tex-')), 'library textures');
    const grids = sample.levels.map((l) => l.data.grid.flat());
    for (const [cell, name] of [[2, 'door'], [3, 'key'], [4, 'hole']] as const) {
      assert.ok(grids.some((g) => g.includes(cell)), name);
    }
  });
});
