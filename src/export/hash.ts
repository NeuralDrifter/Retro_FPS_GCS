/**
 * Content hashing for exports (release plan P3.3, step 4): SHA-256 through `crypto.subtle` where
 * the platform has it (browsers, workers, Node), with the dependency-free fallback otherwise.
 * Exported files are named after the first 16 hex digits of their SHA-256.
 */
import { sha256Hex } from '../shared/bytes';

export async function sha256(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    let hex = '';
    for (const b of digest) hex += b.toString(16).padStart(2, '0');
    return hex;
  }
  return sha256Hex(bytes);
}

/** `<first 16 hex of the SHA-256>.<ext>`, the name every exported asset gets */
export function contentName(sha: string, ext: string): string {
  return `${sha.slice(0, 16)}.${ext}`;
}
