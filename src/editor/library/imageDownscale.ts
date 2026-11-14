/**
 * Scales an image down so neither side exceeds `maxSide` (release plan P2.6). Runs in a worker
 * so a large upload does not stall the editor; falls back to the page when workers or
 * OffscreenCanvas are missing.
 */
import type { UserAssetMimeType } from '../../shared/project';

export interface DownscaleRequest {
  blob: Blob;
  maxSide: number;
  type: string;
}

/** The output type: JPEG stays JPEG, everything else becomes PNG (lossless) */
const outputType = (mime: UserAssetMimeType) => (mime === 'image/jpeg' ? 'image/jpeg' : 'image/png');

export function scaledSize(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function downscaleOnPage({ blob, maxSide, type }: DownscaleRequest): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = scaledSize(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((out) => resolve(out), type, 0.92));
}

export async function downscaleImage(blob: Blob, maxSide: number, mime: UserAssetMimeType): Promise<Blob | null> {
  const request: DownscaleRequest = { blob, maxSide, type: outputType(mime) };
  try {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      const worker = new Worker(new URL('./imageDownscale.worker.ts', import.meta.url), { type: 'module' });
      try {
        return await new Promise<Blob | null>((resolve, reject) => {
          worker.onmessage = (e: MessageEvent<Blob | null>) => resolve(e.data);
          worker.onerror = (e) => reject(e);
          worker.postMessage(request);
        });
      } finally {
        worker.terminate();
      }
    }
    return await downscaleOnPage(request);
  } catch {
    try {
      return await downscaleOnPage(request);
    } catch {
      return null;
    }
  }
}
