/**
 * FORGECORE MULBERRY32 DETERMINISTIC RNG (/src/runtime/sim/rng.ts)
 */

export function sanitizeUint32(val: number): number {
  return Math.trunc(val) >>> 0;
}

export function nextUint32(state: number): { value: number; nextState: number } {
  const nextState = (Math.trunc(state) + 1831565813) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0);
  return { value, nextState };
}

export function randomInt(
  state: number,
  min: number,
  max: number
): { value: number; nextState: number } {
  const n = Math.trunc(min);
  const i = Math.trunc(max);
  const r = nextUint32(state);
  if (i <= n) return { value: n, nextState: r.nextState };
  const o = i - n + 1;
  const a = r.value % o;
  return { value: n + a, nextState: r.nextState };
}

export function randomPercent(
  state: number,
  chance: number
): { passed: boolean; nextState: number } {
  const t = randomInt(state, 0, 99);
  const n = Math.max(0, Math.min(100, Math.trunc(chance)));
  return { passed: t.value < n, nextState: t.nextState };
}
