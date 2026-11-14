/**
 * Canonical JSON and a deterministic string digest, shared by the sim, the runtime,
 * the editor and export. No DOM, no Node and no Three.js: this module must run anywhere.
 */

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
