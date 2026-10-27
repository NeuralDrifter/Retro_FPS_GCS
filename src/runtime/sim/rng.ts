/**
 * ============================================================================
 * DETERMINISTIC 32-BIT UNSIGNED INTEGER RNG (MULBERRY32)
 * ============================================================================
 * - State is stored as a single unsigned 32-bit integer (`0..4294967295`) on `SimulationState`.
 * - Uses only 32-bit integer arithmetic (`Math.imul`, `>>>`, `^`, `+`) so Node and
 *   every browser produce bit-identical sequences across platforms.
 * - Never calls `Math.random()`.
 */

export interface RngStepResult {
  value: number; // Unsigned 32-bit integer [0..4294967295]
  nextState: number; // Next unsigned 32-bit integer state [0..4294967295]
}

/**
 * Normalizes any numeric seed into an unsigned 32-bit integer [0..4294967295].
 */
export function normalizeRngSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

/**
 * Advances the Mulberry32 generator by one step and returns both the generated
 * uint32 value and the updated uint32 state.
 */
export function nextUint32(state: number): RngStepResult {
  const nextState = (Math.trunc(state) + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0;
  return { value, nextState };
}

/**
 * Generates a deterministic integer in [minInclusive, maxInclusive] using integer modulo.
 */
export function nextIntRange(
  state: number,
  minInclusive: number,
  maxInclusive: number
): RngStepResult {
  const min = Math.trunc(minInclusive);
  const max = Math.trunc(maxInclusive);
  const step = nextUint32(state);
  if (max <= min) {
    return { value: min, nextState: step.nextState };
  }
  const span = max - min + 1;
  const offset = step.value % span;
  return {
    value: min + offset,
    nextState: step.nextState,
  };
}

/**
 * Rolls a percentage chance (`percent` in `0..100`) using the seeded RNG.
 * Always advances the RNG state by 1 step for determinism unless percent <= 0 or >= 100?
 * Wait: advancing the RNG by 1 step whenever a `chance` condition is evaluated keeps
 * the RNG consumption count consistent.
 */
export function rollPercentChance(
  state: number,
  percent: number
): { passed: boolean; nextState: number } {
  const step = nextIntRange(state, 0, 99);
  const clamped = Math.max(0, Math.min(100, Math.trunc(percent)));
  return {
    passed: step.value < clamped,
    nextState: step.nextState,
  };
}
