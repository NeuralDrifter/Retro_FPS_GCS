/**
 * Checks a GLB before anything loads it (release plan P7.2). A model may only use what is inside
 * the file: buffers and images that point anywhere else (a web address, a relative file) would
 * make the editor or an exported game request it, so they are refused, as are sizes that do not
 * add up and required extensions three.js cannot load.
 *
 * Reads the binary layout directly; nothing is decoded or fetched.
 */
import { PROJECT_LIMITS } from '../../shared/project';

const MAGIC_GLTF = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"
const MAX_JSON_BYTES = 4 * 1024 * 1024;

/** Extensions three.js's GLTFLoader handles (it ignores optional ones it does not know) */
const SUPPORTED_REQUIRED_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
  'KHR_texture_basisu',
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'EXT_meshopt_compression',
  'EXT_texture_webp',
]);

/** Embedded data only: base64 data URIs of binary data or images */
const EMBEDDED_URI = /^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp));base64,/i;

export type GlbCheck = { ok: true } | { ok: false; error: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validates a GLB's container and the references in its JSON; `name` is used in messages */
export function checkGlb(bytes: Uint8Array, name = 'The model'): GlbCheck {
  const fail = (why: string): GlbCheck => ({ ok: false, error: `'${name}' ${why}` });
  if (bytes.length < 20) return fail('is too short to be a GLB model.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC_GLTF) return fail('is not a GLB model.');
  if (view.getUint32(4, true) !== 2) return fail('is not a glTF 2.0 model.');
  const declared = view.getUint32(8, true);
  if (declared !== bytes.length) return fail(`says it is ${declared} bytes long but is ${bytes.length}.`);

  // Chunks: [length, type, data]; the first must be JSON, an optional second BIN
  let offset = 12;
  let json: unknown;
  let binLength: number | null = null;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return fail('ends in the middle of a chunk.');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.length) return fail('has a chunk that runs past the end of the file.');
    if (chunkIndex === 0) {
      if (type !== CHUNK_JSON) return fail('does not start with a JSON chunk.');
      if (length > MAX_JSON_BYTES) return fail('has an oversized JSON chunk.');
      try {
        json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
      } catch {
        return fail('has a JSON chunk that cannot be read.');
      }
    } else if (type === CHUNK_BIN) {
      if (binLength !== null) return fail('has more than one binary chunk.');
      binLength = length;
    }
    offset = start + length + ((4 - (length % 4)) % 4);
    chunkIndex++;
  }
  if (!isObject(json)) return fail('has no glTF description.');

  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  for (const ext of required) {
    if (typeof ext !== 'string' || !SUPPORTED_REQUIRED_EXTENSIONS.has(ext)) {
      return fail(`requires the glTF extension '${String(ext).slice(0, 60)}', which the game cannot load.`);
    }
  }

  const buffers = Array.isArray(json.buffers) ? json.buffers : [];
  let total = 0;
  for (const [i, buffer] of buffers.entries()) {
    if (!isObject(buffer) || typeof buffer.byteLength !== 'number' || !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0) {
      return fail(`has an invalid buffer ${i}.`);
    }
    total += buffer.byteLength;
    if (buffer.byteLength > PROJECT_LIMITS.MAX_ASSET_BYTES || total > PROJECT_LIMITS.MAX_ASSET_BYTES) {
      return fail('declares buffers larger than an upload may be.');
    }
    if (buffer.uri === undefined) {
      // Only the first buffer may live in the file's binary chunk, and it must fit there
      if (i !== 0 || binLength === null) return fail(`has buffer ${i} with no data.`);
      if (buffer.byteLength > binLength) return fail('declares more binary data than the file holds.');
    } else if (typeof buffer.uri !== 'string' || !EMBEDDED_URI.test(buffer.uri)) {
      return fail(`refers to an outside file (${describeUri(buffer.uri)}); only models with everything embedded can be used.`);
    }
  }

  const images = Array.isArray(json.images) ? json.images : [];
  for (const [i, image] of images.entries()) {
    if (!isObject(image)) return fail(`has an invalid image ${i}.`);
    if (image.uri !== undefined && (typeof image.uri !== 'string' || !EMBEDDED_URI.test(image.uri))) {
      return fail(`refers to an outside image (${describeUri(image.uri)}); only models with everything embedded can be used.`);
    }
  }
  return { ok: true };
}

function describeUri(uri: unknown): string {
  return typeof uri === 'string' ? `'${uri.slice(0, 80)}'` : 'an invalid address';
}

/** Builds a minimal GLB from a glTF JSON object and binary data (tests and fixtures) */
export function buildGlb(json: object, bin: Uint8Array = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = jsonBytes.length + pad(jsonBytes.length);
  const binLength = bin.length + pad(bin.length);
  const total = 12 + 8 + jsonLength + (bin.length > 0 ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC_GLTF, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  if (bin.length > 0) {
    const at = 20 + jsonLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}
