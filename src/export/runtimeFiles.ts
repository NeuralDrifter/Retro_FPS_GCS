/**
 * The prebuilt runtime an export copies into each game (release plan P3.2, P3.3).
 * `scripts/build-runtime.ts` writes `runtime/runtime-manifest.json` next to the files; the export
 * reads it, downloads the files it lists and checks each against its SHA-256.
 */

export const RUNTIME_MANIFEST_FILE = 'runtime-manifest.json';

export interface RuntimeFileEntry {
  /** Relative to the runtime folder */
  file: string;
  sha256: string;
  size: number;
}

export interface RuntimeManifest {
  runtimeVersion: string;
  entry: RuntimeFileEntry;
  draco: RuntimeFileEntry[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const ENTRY_FILE = /^game\.[0-9a-f]{16}\.js$/;
const DRACO_FILE = /^draco\/[a-z0-9_]+\.(?:js|wasm)$/;

const isEntry = (v: unknown, file: RegExp): v is RuntimeFileEntry =>
  isObject(v) &&
  typeof v.file === 'string' &&
  file.test(v.file) &&
  typeof v.sha256 === 'string' &&
  /^[0-9a-f]{64}$/.test(v.sha256) &&
  typeof v.size === 'number' &&
  Number.isInteger(v.size) &&
  v.size > 0;

/** Checks a downloaded runtime manifest; returns null when it is not one */
export function readRuntimeManifest(raw: unknown): RuntimeManifest | null {
  if (!isObject(raw) || typeof raw.runtimeVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(raw.runtimeVersion)) return null;
  if (!isEntry(raw.entry, ENTRY_FILE) || !Array.isArray(raw.draco) || !raw.draco.every((d) => isEntry(d, DRACO_FILE))) return null;
  return { runtimeVersion: raw.runtimeVersion, entry: raw.entry, draco: raw.draco as RuntimeFileEntry[] };
}
