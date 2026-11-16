/**
 * Node-only file sources for tests. The export pipeline has no Node code of its own,
 * so tests inject these through BundleOptions (`dracoFiles`, `readFile`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BundledDracoFiles } from '../export/collect';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DRACO_FILE_NAMES = ['draco_decoder.js', 'draco_wasm_wrapper.js', 'draco_decoder.wasm'] as const;

/** Reads the Draco decoder files the runtime build copies from three (P3.6). */
export function loadDracoFilesFromDisk(): BundledDracoFiles {
  const result: Partial<BundledDracoFiles> = {};
  for (const name of DRACO_FILE_NAMES) {
    const buf = fs.readFileSync(path.join(projectRoot, 'node_modules/three/examples/jsm/libs/draco/gltf', name));
    result[name] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return result as BundledDracoFiles;
}
