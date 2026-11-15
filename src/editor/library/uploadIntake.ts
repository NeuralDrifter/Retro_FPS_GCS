/**
 * Checks for files the creator uploads (release plan P2.6): type by content, not by name;
 * at most 16 MB; textures at most 2048 px per side (larger ones are scaled down in a worker).
 * Accepted files get a content id from their SHA-256.
 */
import { sha256Hex } from '../../shared/bytes';
import { PROJECT_LIMITS } from '../../shared/project';
import type { UserAssetMimeType } from '../../shared/project';
import { decodeImage } from './imageDecode';
import { checkGlb } from './gltfSanitizer';
import { exceedsDecodeLimits, imageHeaderSize } from './imageHeader';

export const MAX_TEXTURE_SIDE = 2048;
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024;

export type UploadKind = 'texture' | 'model';

export interface AcceptedUpload {
  kind: UploadKind;
  /** The file to keep: the upload itself, or its scaled-down copy */
  file: Blob;
  name: string;
  mimeType: UserAssetMimeType;
  bytes: Uint8Array;
  sha256: string;
  /** `tex-` or `glb-` plus the first 16 hex digits of the SHA-256 */
  id: string;
  /** Set when a texture was larger than MAX_TEXTURE_SIDE and was scaled down */
  scaledFrom?: { width: number; height: number };
}

export type IntakeResult = { ok: true; upload: AcceptedUpload } | { ok: false; error: string };

export const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The file type by its first bytes; null for anything but PNG, JPEG, WebP and GLB */
export function sniffMimeType(bytes: Uint8Array): UserAssetMimeType | null {
  const at = (i: number, ...values: number[]) => values.every((v, k) => bytes[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x67, 0x6c, 0x54, 0x46)) return 'model/gltf-binary'; // "glTF"
  return null;
}

/** SHA-256 in hex, with the browser's implementation when the page has one */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export const contentId = (kind: UploadKind, sha256: string) => `${kind === 'texture' ? 'tex' : 'glb'}-${sha256.slice(0, 16)}`;

/** Checks one uploaded file; textures larger than MAX_TEXTURE_SIDE come back scaled down */
export async function intakeUpload(file: File, kind: UploadKind): Promise<IntakeResult> {
  const max = PROJECT_LIMITS.MAX_ASSET_BYTES;
  if (file.size > max) {
    return { ok: false, error: `'${file.name}' is ${formatMB(file.size)}; uploads can be at most ${formatMB(max)}.` };
  }
  let bytes = new Uint8Array(await file.arrayBuffer());
  let mimeType = sniffMimeType(bytes);
  if (kind === 'texture' && (!mimeType || !mimeType.startsWith('image/'))) {
    return { ok: false, error: `'${file.name}' is not a PNG, JPEG or WebP image, so it was not added.` };
  }
  if (kind === 'model' && mimeType !== 'model/gltf-binary') {
    return { ok: false, error: `'${file.name}' is not a GLB model (binary glTF), so it was not added.` };
  }

  if (kind === 'model') {
    const glb = checkGlb(bytes, file.name);
    if (!glb.ok) return { ok: false, error: glb.error };
  }

  let kept: Blob = file;
  let scaledFrom: AcceptedUpload['scaledFrom'];
  if (kind === 'texture') {
    // The header's size is checked before anything decodes the image (P7.2)
    const declared = imageHeaderSize(bytes, mimeType!);
    if (!declared) return { ok: false, error: `'${file.name}' could not be read as an image.` };
    if (exceedsDecodeLimits(declared)) {
      return { ok: false, error: `'${file.name}' is ${declared.width}x${declared.height}, too large to open; textures can be at most ${MAX_TEXTURE_SIDE} px per side.` };
    }
    let decoded;
    try {
      decoded = await decodeImage(file, MAX_TEXTURE_SIDE, mimeType!);
    } catch {
      return { ok: false, error: `'${file.name}' could not be read as an image.` };
    }
    if (decoded.scaled) {
      kept = decoded.scaled;
      bytes = new Uint8Array(await decoded.scaled.arrayBuffer());
      mimeType = sniffMimeType(bytes) ?? 'image/png';
      scaledFrom = { width: decoded.width, height: decoded.height };
      if (bytes.length > max) return { ok: false, error: `'${file.name}' is still over ${formatMB(max)} after scaling it down.` };
    }
  }

  const sha256 = await sha256OfBytes(bytes);
  return {
    ok: true,
    upload: { kind, file: kept, name: file.name, mimeType: mimeType!, bytes, sha256, id: contentId(kind, sha256), ...(scaledFrom ? { scaledFrom } : {}) },
  };
}
