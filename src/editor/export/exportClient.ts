/**
 * The editor's side of the export (release plan P3.3). It works out where each asset the project
 * uses comes from, hands that to the export worker, relays progress, and cancels on request.
 * All downloading, hashing and zipping happens in the worker, so the editor stays responsive.
 */
import { ExportError } from '../../export/errors';
import type { AssetSource, ExportProgress, ExportRequest, ExportResult } from '../../export/exportGame';
import type { ExportWorkerMessage, ExportWorkerRequest } from '../../export/protocol';
import { projectAssetIds } from '../../export/references';
import { base64ToBytes } from '../../shared/bytes';
import { libraryFileRecord } from '../../shared/libraryIntegrity';
import type { ProjectDocV4, UserAsset, UserAssetMimeType } from '../../shared/project';
import { AssetRegistry } from '../engine/AssetRegistry';
import { sha256OfBytes } from '../library/uploadIntake';
import { getAssetBlob } from '../persistence/db';

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,(.*)$/s;

/**
 * The longest stretch of export work that ran on the main thread since the last
 * `buildExportRequest`, in milliseconds. The e2e suite checks it stays under 50 ms (one frame
 * budget for a long task), so the export never makes the editor stutter.
 */
let mainThreadMaxMs = 0;
export const exportMainThreadMaxMs = () => mainThreadMaxMs;

function timed<T>(work: () => T): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    mainThreadMaxMs = Math.max(mainThreadMaxMs, performance.now() - start);
  }
}

/** An upload's bytes: the stored blob, the document's base64, or what the editor holds in memory */
async function userSource(asset: UserAsset): Promise<AssetSource> {
  const base = {
    type: 'user' as const,
    name: asset.name,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    size: asset.size,
    license: asset.license,
    ...(asset.attribution !== undefined ? { attribution: asset.attribution } : {}),
  };
  const blob = await getAssetBlob(asset.sha256).catch(() => undefined);
  if (blob) return { ...base, blob };
  if (asset.data) return { ...base, base64: asset.data };
  const file = AssetRegistry.getModelFile(asset.id);
  if (file) return { ...base, blob: file };
  const match = DATA_URL.exec(AssetRegistry.getTexture(asset.id)?.previewUrl ?? '');
  return match ? { ...base, base64: match[2].replace(/\s+/g, '') } : base;
}

/** A texture embedded as a data URL before uploads were recorded in the project (pre-P2.6 files); it has no license */
async function dataUrlSource(id: string, url: string): Promise<AssetSource | undefined> {
  const match = DATA_URL.exec(url);
  const bytes = match ? timed(() => base64ToBytes(match[2].replace(/\s+/g, ''))) : null;
  if (!match || !bytes) return undefined;
  return { type: 'user', name: id, mimeType: match[1] as UserAssetMimeType, sha256: await sha256OfBytes(bytes), size: bytes.length, bytes };
}

async function catalogSource(id: string, kind: 'texture' | 'model'): Promise<AssetSource | undefined> {
  const texture = kind === 'texture' ? AssetRegistry.getTexture(id) : undefined;
  const model = kind === 'model' ? AssetRegistry.getModel(id) : undefined;
  const url = texture?.previewUrl ?? model?.customGlbUrl;
  if (!url) return undefined;
  if (url.startsWith('data:')) return dataUrlSource(id, url);
  const record = libraryFileRecord(url);
  if (record) return { type: 'library', url, sha256: record.sha256, size: record.size, path: record.path, pack: record.pack };
  return { type: 'unlicensed', name: texture?.name || model?.name || id, url };
}

/** The worker's input for `doc`: every asset it uses, with where its bytes come from */
export async function buildExportRequest(doc: ProjectDocV4, baseURI = document.baseURI): Promise<ExportRequest> {
  mainThreadMaxMs = 0;
  const used = timed(() => projectAssetIds(doc));
  const uploads = new Map(doc.userAssets.map((a) => [a.id, a]));
  const sources: Record<string, AssetSource> = {};
  const add = async (id: string, kind: 'texture' | 'model') => {
    const upload = uploads.get(id);
    const source = upload ? await userSource(upload) : await catalogSource(id, kind);
    if (source) sources[id] = source;
  };
  await Promise.all([...used.textures.map((id) => add(id, 'texture')), ...used.models.map((id) => add(id, 'model'))]);
  return { doc, runtimeBaseUrl: new URL('runtime/', baseURI).href, sources };
}

export interface RunningExport {
  /** Resolves with the zip, or rejects with an `ExportError` (code `cancelled` after cancel) */
  result: Promise<ExportResult>;
  cancel(): void;
}

/** Runs one export in a new worker; the worker ends when the export does */
export function runExport(request: ExportRequest, onProgress?: (progress: ExportProgress) => void): RunningExport {
  const worker = timed(() => new Worker(new URL('../../export/worker.ts', import.meta.url), { type: 'module' }));
  const post = (message: ExportWorkerRequest) => timed(() => worker.postMessage(message));
  let settle: { resolve: (r: ExportResult) => void; reject: (e: ExportError) => void } | null = null;
  const finish = () => {
    settle = null;
    worker.terminate();
  };
  const result = new Promise<ExportResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  worker.onmessage = (e: MessageEvent<ExportWorkerMessage>) => timed(() => {
    const message = e.data;
    if (message.type === 'progress') {
      onProgress?.(message.progress);
    } else if (message.type === 'done') {
      settle?.resolve(message.result);
      finish();
    } else {
      settle?.reject(new ExportError(message.error.code, message.error.message, message.error.detail));
      finish();
    }
  });
  worker.onerror = (e) => {
    settle?.reject(new ExportError('invalid-project', 'The export stopped because of an unexpected error.', e.message));
    finish();
  };
  post({ type: 'start', request });
  return {
    result,
    cancel() {
      if (!settle) return;
      post({ type: 'cancel' });
      // The worker answers with a cancelled error; stop waiting for it after a moment either way
      const pending = settle;
      setTimeout(() => {
        if (settle === pending) {
          pending.reject(new ExportError('cancelled', 'The export was cancelled.'));
          finish();
        }
      }, 2000);
    },
  };
}
