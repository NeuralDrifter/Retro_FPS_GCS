/**
 * Decodes an uploaded image in a worker (release plan P2.6, P7.2): the worker reports its size
 * and, when a side exceeds `maxSide`, returns a scaled-down copy. Decoding off the page keeps a
 * large or hostile image from stalling the editor. Falls back to the page when workers or
 * OffscreenCanvas are missing.
 */
import type { UserAssetMimeType } from '../../shared/project';

export interface DecodeRequest {
  blob: Blob;
  maxSide: number;
  /** Type for a scaled copy */
  type: string;
}

export interface DecodeResult {
  width: number;
  height: number;
  /** Present when the image was larger than maxSide */
  scaled: Blob | null;
}

/** The output type of a scaled copy: JPEG stays JPEG, everything else becomes PNG (lossless) */
const outputType = (mime: UserAssetMimeType) => (mime === 'image/jpeg' ? 'image/jpeg' : 'image/png');

export function scaledSize(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decodeOnPage({ blob, maxSide, type }: DecodeRequest): Promise<DecodeResult> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  if (Math.max(width, height) <= maxSide) {
    bitmap.close();
    return { width, height, scaled: null };
  }
  const size = scaledSize(width, height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const scaled = await new Promise<Blob | null>((resolve) => canvas.toBlob((out) => resolve(out), type, 0.92));
  if (!scaled) throw new Error('scaling failed');
  return { width, height, scaled };
}

/** Decodes `blob`; rejects when it is not a readable image */
export async function decodeImage(blob: Blob, maxSide: number, mime: UserAssetMimeType): Promise<DecodeResult> {
  const request: DecodeRequest = { blob, maxSide, type: outputType(mime) };
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    const worker = new Worker(new URL('./imageDecode.worker.ts', import.meta.url), { type: 'module' });
    try {
      const result = await new Promise<DecodeResult | null>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<DecodeResult | null>) => resolve(e.data);
        worker.onerror = (e) => reject(e);
        worker.postMessage(request);
      });
      if (result) return result;
      throw new Error('the image could not be decoded');
    } finally {
      worker.terminate();
    }
  }
  return decodeOnPage(request);
}
