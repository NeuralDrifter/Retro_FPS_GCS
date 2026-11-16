import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { debugReplaySource } from '../runtime/debugEvents';
import type { DebugReplay } from '../runtime/debugEvents';

// The e2e suite's input replay in exported games (release plan P3.7)

const walk = { moveForward: 1 as const, moveRight: 0 as const, sprint: false, yawDeltaBam: 0, pitchDeltaBam: 0, use: false, shoot: false };
const use = { ...walk, moveForward: 0 as const, use: true };
const replay: DebugReplay = { segments: [{ ticks: 2, input: walk }, { ticks: 1, input: use }] };

const setWindow = (value: Record<string, unknown> | undefined) => {
  (globalThis as { window?: unknown }).window = value;
};

describe('debug input replay (P3.7)', () => {
  afterEach(() => setWindow(undefined));

  it('does nothing outside debug runs, or without a recording', () => {
    assert.equal(debugReplaySource(() => 0), undefined);
    setWindow({ __GCS_DEBUG_REPLAY__: replay });
    assert.equal(debugReplaySource(() => 0), undefined, 'a recording alone does not take over the keyboard');
    setWindow({ __GCS_DEBUG__: true });
    assert.equal(debugReplaySource(() => 0), undefined);
  });

  it('plays the recording tick by tick on the first level only', () => {
    setWindow({ __GCS_DEBUG__: true, __GCS_DEBUG_REPLAY__: replay });
    let level = 0;
    const source = debugReplaySource(() => level)!;
    assert.deepEqual([0, 1, 2, 3].map(source), [walk, walk, use, undefined]);
    level = 1;
    assert.equal(source(0), undefined);
  });
});
