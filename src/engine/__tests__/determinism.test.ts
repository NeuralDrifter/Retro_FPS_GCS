import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGame } from '../../runtime/startGame';
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

describe('Phase 1 Acceptance: /src/runtime Determinism Harness & 3000-Tick Replay', () => {
  const baseline: DeterminismBaselineFile = JSON.parse(
    fs.readFileSync(baselinePath, 'utf-8')
  );
  const inputs3000 = generateDeterministic3000TickInputs(3000);

  it('replays 3000 ticks (~100 s) on Test Level 1 (Minimal Arena) through startGame and matches pre-refactor baseline hashes on every tick', () => {
    const level1 = createMinimalArenaTestLevel();
    const game = startGame(level1, null, {
      inputSource: inputs3000,
    });

    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    assert.equal(baseline.minimalArenaHashes.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.minimalArenaHashes[i]) {
        assert.fail(
          `Test Level 1 hash mismatch at tick ${i + 1}: expected ${
            baseline.minimalArenaHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });

  it('replays 3000 ticks (~100 s) on Test Level 2 (Full Test Level) through startGame and matches pre-refactor baseline hashes on every tick', () => {
    const level2 = createFullTestLevel();
    const game = startGame(level2, null, {
      inputSource: inputs3000,
    });

    const hashes = game.stepTicks(3000);
    game.dispose();

    assert.equal(hashes.length, 3000);
    assert.equal(baseline.fullTestLevelHashes.length, 3000);
    for (let i = 0; i < 3000; i++) {
      if (hashes[i] !== baseline.fullTestLevelHashes[i]) {
        assert.fail(
          `Test Level 2 hash mismatch at tick ${i + 1}: expected ${
            baseline.fullTestLevelHashes[i]
          }, got ${hashes[i]}`
        );
      }
    }
  });

  it('captures PlayerTickInput per tick in Record mode and reproduces identical state hashes in Replay mode', () => {
    const level = createFullTestLevel();
    const feedInputs = inputs3000.slice(0, 300);

    const recorderGame = startGame(level, null, {
      inputSource: feedInputs,
      recordInputs: true,
    });
    const recordedHashes = recorderGame.stepTicks(300);
    const recordedInputs = recorderGame.getRecordedInputs();
    recorderGame.dispose();

    assert.equal(recordedInputs.length, 300);
    assert.equal(recordedHashes.length, 300);

    const replayGame = startGame(level, null, {
      inputSource: recordedInputs,
    });
    const replayedHashes = replayGame.stepTicks(300);
    replayGame.dispose();

    assert.deepEqual(replayedHashes, recordedHashes);
  });
});
