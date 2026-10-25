/**
 * ============================================================================
 * CANONICAL SIMULATION SERIALIZATION, FLOAT VERIFIER & STATE HASH
 * ============================================================================
 * Ensures cross-engine determinism verification:
 *  - Sorts all unordered set arrays (`collectedKeys`, `firedOnceEvents`,
 *    `foundSecretIds`, `player.items`) and object keys recursively.
 *  - Recursively verifies that no floating-point number (or `-0`, `NaN`, `Infinity`)
 *    exists anywhere in `SimulationState`.
 *  - Computes a deterministic 64-bit (dual-32-bit FNV-1a) hex hash using only
 *    `Math.imul` and `>>> 0` so Node and browser engines produce identical hashes.
 */

import { SimulationState } from './types';

/**
 * Recursively inspects `value` and returns the paths of any numbers that are
 * not safe integers (floats, NaN, Infinity, or -0).
 */
export function findFloatPaths(value: unknown, currentPath = '$'): string[] {
  const issues: string[] = [];

  if (typeof value === 'number') {
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      !Number.isSafeInteger(value) ||
      Object.is(value, -0)
    ) {
      issues.push(`${currentPath}=${String(value)}`);
    }
    return issues;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      issues.push(...findFloatPaths(value[i], `${currentPath}[${i}]`));
    }
    return issues;
  }

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    for (const k of keys) {
      issues.push(
        ...findFloatPaths(
          (value as Record<string, unknown>)[k],
          `${currentPath}.${k}`
        )
      );
    }
  }

  return issues;
}

/**
 * Throws a descriptive error if any non-integer number exists anywhere in `state`.
 */
export function assertNoFloatsInState(state: unknown): void {
  const badPaths = findFloatPaths(state);
  if (badPaths.length > 0) {
    throw new Error(
      `SimulationState contains non-integer values at: ${badPaths.join(', ')}`
    );
  }
}

/**
 * Recursively sorts all object keys alphabetically so `JSON.stringify` is canonical.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const sortedKeys = Object.keys(src).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      if (src[k] !== undefined) {
        out[k] = sortKeysDeep(src[k]);
      }
    }
    return out;
  }
  if (typeof value === 'number' && Object.is(value, -0)) {
    return 0;
  }
  return value;
}

/**
 * Produces a canonical JSON string from `SimulationState`, sorting all unordered
 * sets (`collectedKeys`, `firedOnceEvents`, `foundSecretIds`, player `items`),
 * `pendingContinuations`, and all record keys.
 */
export function canonicalizeSimulationState(state: SimulationState): string {
  const sortedPlayers: Record<string, unknown> = {};
  const playerIds = Object.keys(state.players)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  for (const pid of playerIds) {
    const p = state.players[pid];
    sortedPlayers[String(pid)] = {
      ...p,
      items: [...p.items].sort(),
    };
  }

  const normalized = {
    ...state,
    players: sortedPlayers,
    collectedKeys: [...state.collectedKeys].sort(),
    firedOnceEvents: [...state.firedOnceEvents].sort(),
    foundSecretIds: [...state.foundSecretIds].sort(),
    pendingContinuations: [...state.pendingContinuations].sort(
      (a, b) => a.id - b.id
    ),
    events: [...state.events].sort((a, b) => a.id.localeCompare(b.id)),
    regions: [...state.regions].sort((a, b) => a.id.localeCompare(b.id)),
  };

  return JSON.stringify(sortKeysDeep(normalized));
}

/**
 * Deterministic 64-bit hex digest (two independent 32-bit FNV-1a lanes using
 * `Math.imul` and `>>> 0`) for any string. Works identically in Node and browsers.
 */
export function fnv1a64Hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code & 0xff;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    if (code > 0xff) {
      h1 ^= (code >>> 8) & 0xff;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }

    h2 ^= (code * 31 + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

/**
 * Computes the canonical 16-char hex state hash for a `SimulationState`.
 */
export function hashSimulationState(state: SimulationState): string {
  const canonicalJson = canonicalizeSimulationState(state);
  return fnv1a64Hex(canonicalJson);
}
