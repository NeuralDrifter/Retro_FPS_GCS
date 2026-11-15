/**
 * Worker half of imageDecode.ts: decodes the image, reports its size, and draws a smaller copy
 * on an OffscreenCanvas when it is too large. Posts null when the image cannot be decoded.
 */
import { scaledSize } from './imageDecode';
import type { DecodeRequest, DecodeResult } from './imageDecode';

interface WorkerScope {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeResult | null): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  try {
    const { blob, maxSide, type } = e.data;
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    if (Math.max(width, height) <= maxSide) {
      bitmap.close();
      scope.postMessage({ width, height, scaled: null });
      return;
    }
    const size = scaledSize(width, height, maxSide);
    const canvas = new OffscreenCanvas(size.width, size.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    scope.postMessage({ width, height, scaled: await canvas.convertToBlob({ type, quality: 0.92 }) });
  } catch {
    scope.postMessage(null);
  }
};
