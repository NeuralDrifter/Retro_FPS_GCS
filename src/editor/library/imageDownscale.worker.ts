/**
 * Worker half of imageDownscale.ts: decodes the image, draws it smaller on an OffscreenCanvas,
 * and posts the encoded result back (null on failure).
 */
import { scaledSize } from './imageDownscale';
import type { DownscaleRequest } from './imageDownscale';

interface WorkerScope {
  onmessage: ((e: MessageEvent<DownscaleRequest>) => void) | null;
  postMessage(message: Blob | null): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  try {
    const { blob, maxSide, type } = e.data;
    const bitmap = await createImageBitmap(blob);
    const { width, height } = scaledSize(bitmap.width, bitmap.height, maxSide);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    scope.postMessage(await canvas.convertToBlob({ type, quality: 0.92 }));
  } catch {
    scope.postMessage(null);
  }
};
