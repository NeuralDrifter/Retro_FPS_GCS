import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { HOST_LIMITS, hostLimitWarnings } from '../export/hostLimits';

// Host limit warnings after an export (release plan P3.8)

const MB = 1_000_000;
const file = (path: string, size: number) => ({ path, size });

describe('host limit warnings (P3.8)', () => {
  it('says nothing for a game every host takes', () => {
    assert.deepEqual(hostLimitWarnings([file('index.html', 1000), file('assets/a.png', 5 * MB)]), []);
  });

  it('warns about too many files for itch.io', () => {
    const files = Array.from({ length: 1001 }, (_, i) => file(`assets/${i}.png`, 10));
    const warnings = hostLimitWarnings(files);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^itch\.io accepts at most 1000 files; this game has 1001\.$/);
  });

  it('names the largest file over a per-file limit, and counts the others', () => {
    const warnings = hostLimitWarnings([file('assets/big.glb', 150 * MB), file('assets/also.glb', 120 * MB), file('index.html', 10)]);
    assert.deepEqual(warnings, [
      'GitHub Pages accepts files up to 100 MB; assets/big.glb is 150 MB, and 1 more file is too large.',
    ]);
  });

  it('warns about the unzipped total for each host it passes', () => {
    const files = Array.from({ length: 6 }, (_, i) => file(`assets/${i}.glb`, 90 * MB));
    assert.deepEqual(hostLimitWarnings(files), ['itch.io accepts games up to 500 MB in total; this one is 540 MB unzipped.']);
  });

  it('lists the limits the plan names', () => {
    const itch = HOST_LIMITS.find((l) => l.host === 'itch.io')!;
    assert.deepEqual([itch.maxFiles, itch.maxFileBytes, itch.maxTotalBytes], [1000, 200 * MB, 500 * MB]);
    assert.equal(HOST_LIMITS.find((l) => l.host === 'GitHub Pages')!.maxFileBytes, 100 * MB);
  });
});
