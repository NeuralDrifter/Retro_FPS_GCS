/**
 * Image dimensions read from the file header, without decoding (release plan P7.2). A small
 * file can declare an enormous image; checking the header first stops it before any decoder
 * allocates memory for it.
 */
import type { UserAssetMimeType } from '../../shared/project';

/** Largest side and pixel count the editor will decode at all (larger textures are scaled down after) */
export const MAX_DECODE_SIDE = 16384;
export const MAX_DECODE_PIXELS = 64_000_000;

export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/** Start-of-frame markers carry the size; DHT (C4), JPG (C8) and DAC (CC) do not */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (SOF.has(marker)) return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [b[21], b[22], b[23], b[24]];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** The declared size of a PNG, JPEG or WebP, or null when the header cannot be read */
export function imageHeaderSize(bytes: Uint8Array, mime: UserAssetMimeType): ImageSize | null {
  const size = mime === 'image/png' ? pngSize(bytes) : mime === 'image/jpeg' ? jpegSize(bytes) : mime === 'image/webp' ? webpSize(bytes) : null;
  return size && size.width > 0 && size.height > 0 ? size : null;
}

/** True when an image of this size is too large to decode safely */
export function exceedsDecodeLimits({ width, height }: ImageSize): boolean {
  return width > MAX_DECODE_SIDE || height > MAX_DECODE_SIDE || width * height > MAX_DECODE_PIXELS;
}
