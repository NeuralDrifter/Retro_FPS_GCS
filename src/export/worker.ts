/**
 * The export worker (release plan P3.3). It runs the export pipeline off the main thread, posts
 * progress, stops on cancel, and returns the zip bytes as a transfer, or a typed error.
 */
import { toExportErrorInfo } from './errors';
import { exportGame } from './exportGame';
import type { ExportWorkerMessage, ExportWorkerRequest } from './protocol';

interface WorkerScope {
  onmessage: ((e: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage(message: ExportWorkerMessage, transfer?: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let controller: AbortController | null = null;

scope.onmessage = async (e) => {
  if (e.data.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (controller) return; // one export per worker
  controller = new AbortController();
  try {
    const result = await exportGame(e.data.request, {
      fetch: (input, init) => fetch(input, init),
      signal: controller.signal,
      onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
    });
    scope.postMessage({ type: 'done', result }, [result.bytes.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', error: toExportErrorInfo(err) });
  }
};
