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
import { fnv1a64Hex, sortKeysDeep } from '../shared/hash';

// Canonical JSON and the FNV digest live in src/shared; re-exported for existing callers.
export { fnv1a64Hex, sortKeysDeep };

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

  const normalized: Record<string, unknown> = {
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

  if (state.entities && Object.keys(state.entities).length > 0) {
    const sortedEntities: Record<string, unknown> = {};
    const entKeys = Object.keys(state.entities).sort();
    for (const k of entKeys) {
      sortedEntities[k] = { ...state.entities[k] };
    }
    normalized.entities = sortedEntities;
  } else {
    delete normalized.entities;
  }

  if (state.earthquake && state.earthquake.remainingTicks > 0) {
    normalized.earthquake = {
      intensity: state.earthquake.intensity,
      remainingTicks: state.earthquake.remainingTicks,
    };
  } else {
    delete normalized.earthquake;
  }

  if (state.hazardRegions && Object.keys(state.hazardRegions).length > 0) {
    const sortedHazards: Record<string, unknown> = {};
    for (const k of Object.keys(state.hazardRegions).sort()) {
      sortedHazards[k] = { ...state.hazardRegions[k] };
    }
    normalized.hazardRegions = sortedHazards;
  } else {
    delete normalized.hazardRegions;
  }

  if (state.lightEffects && Object.keys(state.lightEffects).length > 0) {
    const sortedLights: Record<string, unknown> = {};
    for (const k of Object.keys(state.lightEffects).sort()) {
      sortedLights[k] = { ...state.lightEffects[k] };
    }
    normalized.lightEffects = sortedLights;
  } else {
    delete normalized.lightEffects;
  }

  if (state.regionDwellTicks && Object.keys(state.regionDwellTicks).length > 0) {
    const sortedDwell: Record<string, unknown> = {};
    for (const rk of Object.keys(state.regionDwellTicks).sort()) {
      const pDwell: Record<string, number> = {};
      for (const pk of Object.keys(state.regionDwellTicks[rk]).sort()) {
        pDwell[pk] = state.regionDwellTicks[rk][Number(pk)];
      }
      sortedDwell[rk] = pDwell;
    }
    normalized.regionDwellTicks = sortedDwell;
  } else {
    delete normalized.regionDwellTicks;
  }

  return JSON.stringify(sortKeysDeep(normalized));
}

/**
 * Computes the canonical 16-char hex state hash for a `SimulationState`.
 */
export function hashSimulationState(state: SimulationState): string {
  const canonicalJson = canonicalizeSimulationState(state);
  return fnv1a64Hex(canonicalJson);
}
