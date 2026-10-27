/**
 * FORGECORE DETERMINISTIC FNV-1A 64-BIT HASH & CANONICAL JSON (/src/runtime/sim/hash.ts)
 */

import { SimulationState } from './types';

export function canonicalizeValue(val: any): any {
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  if (val !== null && typeof val === 'object') {
    const keys = Object.keys(val).sort();
    const result: Record<string, any> = {};
    for (const k of keys) {
      if (val[k] !== undefined) {
        result[k] = canonicalizeValue(val[k]);
      }
    }
    return result;
  }
  if (typeof val === 'number' && Object.is(val, -0)) {
    return 0;
  }
  return val;
}

export function canonicalJson(state: SimulationState): string {
  const players: Record<string, any> = {};
  const sortedPlayerIds = Object.keys(state.players)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of sortedPlayerIds) {
    const p = state.players[id];
    players[String(id)] = {
      ...p,
      items: [...p.items].sort(),
    };
  }

  const cleanState: any = {
    ...state,
    players,
    collectedKeys: [...state.collectedKeys].sort(),
    firedOnceEvents: [...state.firedOnceEvents].sort(),
    foundSecretIds: [...state.foundSecretIds].sort(),
    pendingContinuations: [...state.pendingContinuations].sort((a, b) => a.id - b.id),
    events: [...state.events].sort((a, b) => a.id.localeCompare(b.id)),
    regions: [...state.regions].sort((a, b) => a.id.localeCompare(b.id)),
  };

  if (state.entities && Object.keys(state.entities).length > 0) {
    const ents: Record<string, any> = {};
    const sortedKeys = Object.keys(state.entities).sort();
    for (const k of sortedKeys) {
      ents[k] = { ...state.entities[k] };
    }
    cleanState.entities = ents;
  } else {
    delete cleanState.entities;
  }

  if (state.earthquake && state.earthquake.remainingTicks > 0) {
    cleanState.earthquake = {
      intensity: state.earthquake.intensity,
      remainingTicks: state.earthquake.remainingTicks,
    };
  } else {
    delete cleanState.earthquake;
  }

  if (state.hazardRegions && Object.keys(state.hazardRegions).length > 0) {
    const haz: Record<string, any> = {};
    for (const k of Object.keys(state.hazardRegions).sort()) {
      haz[k] = { ...state.hazardRegions[k] };
    }
    cleanState.hazardRegions = haz;
  } else {
    delete cleanState.hazardRegions;
  }

  if (state.lightEffects && Object.keys(state.lightEffects).length > 0) {
    const lights: Record<string, any> = {};
    for (const k of Object.keys(state.lightEffects).sort()) {
      lights[k] = { ...state.lightEffects[k] };
    }
    cleanState.lightEffects = lights;
  } else {
    delete cleanState.lightEffects;
  }

  if (state.regionDwellTicks && Object.keys(state.regionDwellTicks).length > 0) {
    const dwells: Record<string, any> = {};
    for (const r of Object.keys(state.regionDwellTicks).sort()) {
      const pMap: Record<string, any> = {};
      for (const a of Object.keys(state.regionDwellTicks[r]).sort()) {
        pMap[a] = state.regionDwellTicks[r][Number(a)];
      }
      dwells[r] = pMap;
    }
    cleanState.regionDwellTicks = dwells;
  } else {
    delete cleanState.regionDwellTicks;
  }

  return JSON.stringify(canonicalizeValue(cleanState));
}

export function fnv1a64Hex(str: string): string {
  let h1 = 2166136261;
  let h2 = 84696351;
  for (let r = 0; r < str.length; r++) {
    const o = str.charCodeAt(r);
    h1 ^= o & 255;
    h1 = Math.imul(h1, 16777619) >>> 0;
    if (o > 255) {
      h1 ^= (o >>> 8) & 255;
      h1 = Math.imul(h1, 16777619) >>> 0;
    }
    h2 ^= (o * 31 + r) & 255;
    h2 = Math.imul(h2, 16777619) >>> 0;
  }
  const n = (h1 >>> 0).toString(16).padStart(8, '0');
  const i = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${n}${i}`;
}

export function hashSimulationState(state: SimulationState): string {
  const json = canonicalJson(state);
  return fnv1a64Hex(json);
}
