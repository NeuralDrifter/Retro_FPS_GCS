/**
 * The export pipeline (release plan P3.3, section 3.4). It runs in the export worker, and in
 * tests with injected `fetch`:
 *
 * 1. collects the textures and models the project uses;
 * 2. downloads library files six at a time (30 s timeout, 2 retries), checking each SHA-256;
 * 3. reads the creator's uploads, checking each SHA-256;
 * 4. stores each unique file once;
 * 5. names it `assets/<first 16 hex of SHA-256>.<ext>`;
 * 6. builds the game manifest, the page, the credits and the license notices (P3.5);
 * 7. zips everything under the determinism rules.
 *
 * An asset with no file, or one the export cannot credit (no pack in the library's license list,
 * or an upload with no recorded license), stops it before any download.
 *
 * The same project and runtime always give the same zip bytes.
 */
import { base64ToBytes } from '../shared/bytes';
import type { ProjectDocV4, UserAssetLicense, UserAssetMimeType } from '../shared/project';
import { GAME_ASSET_PATH } from '../shared/project/gameManifest';
import type { GameAssetEntry } from '../shared/project/gameManifest';
import { buildCredits, checkCreditable, renderCreditsText } from './credits';
import type { CreditPack, CreditedAsset } from './credits';
import { ExportError } from './errors';
import { detectDracoCompression } from './glb';
import { contentName, sha256 } from './hash';
import { buildGameManifest, gameDataFile, renderIndexHtml } from './manifestBuilder';
import { renderReadme, renderRuntimeLicense, renderThirdPartyNotices } from './notices';
import { scanExportPayload } from './safetyScanner';
import { projectAssetIds } from './references';
import { RUNTIME_MANIFEST_FILE, readRuntimeManifest } from './runtimeFiles';
import type { RuntimeFileEntry } from './runtimeFiles';
import indexTemplate from './templates/index.html?raw';
import { buildZip } from './zip';

/** Where an asset's bytes come from; the editor fills this in for every id the project uses */
export type AssetSource =
  /** A file of the pinned asset library, checked against the index's SHA-256 and size, credited to its pack */
  | { type: 'library'; url: string; sha256: string; size: number; path: string; pack?: CreditPack }
  /** A creator upload: bytes, a stored blob or base64, checked against the recorded SHA-256 */
  | {
      type: 'user';
      name: string;
      mimeType: UserAssetMimeType;
      sha256: string;
      size: number;
      bytes?: Uint8Array;
      blob?: Blob;
      base64?: string;
      /** Missing for a texture embedded before uploads recorded licenses; the export refuses it */
      license?: UserAssetLicense;
      attribution?: string;
    }
  /** A file with no license the export can credit (a repository without a packs.json) */
  | { type: 'unlicensed'; name: string; url: string };

export interface ExportRequest {
  doc: ProjectDocV4;
  /** Absolute URL of the editor's prebuilt runtime folder, ending in `/` */
  runtimeBaseUrl: string;
  /** Source of every texture and model id the project uses, built-ins excepted */
  sources: Record<string, AssetSource>;
}

export type ExportStage = 'collect' | 'download' | 'runtime' | 'package' | 'zip';

export interface ExportProgress {
  stage: ExportStage;
  done: number;
  total: number;
}

export interface ExportResult {
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  size: number;
  fileCount: number;
  runtimeVersion: string;
  /** Every file in the zip, sorted by path */
  files: { path: string; size: number }[];
}

export interface ExportDeps {
  fetch: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
  /** Per request; 30 s by default */
  timeoutMs?: number;
  /** Retries after a failed download; 2 by default */
  retries?: number;
  /** Wait before the first retry, doubled after; 500 ms by default */
  retryDelayMs?: number;
  /** Downloads at a time; 6 by default */
  concurrency?: number;
}

const EXT_BY_MIME: Record<UserAssetMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'model/gltf-binary': 'glb',
};
const TEXTURE_EXT = new Set(['png', 'jpg', 'webp']);

const cancelled = () => new ExportError('cancelled', 'The export was cancelled.');

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelled();
}

const wait = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Downloads `url` with a timeout and retries; cancelling stops at once */
async function download(url: string, label: string, deps: ExportDeps): Promise<Uint8Array> {
  const retries = deps.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    throwIfCancelled(deps.signal);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    deps.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 30_000);
    try {
      const response = await deps.fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      if (deps.signal?.aborted) throw cancelled();
      if (attempt >= retries) {
        const reason = controller.signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err);
        throw new ExportError('network', `${label} could not be downloaded. Check your connection and try again.`, `${url}: ${reason}`);
      }
    } finally {
      clearTimeout(timer);
      deps.signal?.removeEventListener('abort', onAbort);
    }
    await wait((deps.retryDelayMs ?? 500) * 2 ** attempt, deps.signal);
  }
}

/** Runs `task` over `items`, `limit` at a time, in order of start */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const run = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, run));
}

const extOf = (url: string) => {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
};

interface LoadedAsset {
  id: string;
  kind: 'texture' | 'model';
  bytes: Uint8Array;
  sha256: string;
  ext: string;
  credit: CreditedAsset['source'];
}

type CreditableSource = Exclude<AssetSource, { type: 'unlicensed' }>;

/** Checks that `source` exists and can be credited; returns its credit */
function creditFor(id: string, kind: 'texture' | 'model', source: AssetSource | undefined): { source: CreditableSource; credit: CreditedAsset['source'] } {
  if (!source) {
    throw new ExportError('missing-asset', `The ${kind} '${id}' is used in the project, but the editor has no file for it.`);
  }
  if (source.type === 'unlicensed') {
    throw new ExportError(
      'unlicensed-asset',
      `The ${kind} '${source.name}' has no license the export can credit. Replace it, or use a repository that publishes a packs.json.`,
      source.url
    );
  }
  const credit: CreditedAsset['source'] =
    source.type === 'library'
      ? { type: 'library', path: source.path, pack: source.pack }
      : { type: 'user', name: source.name, license: source.license, attribution: source.attribution };
  checkCreditable(id, kind, credit);
  return { source, credit };
}

async function loadAsset(id: string, kind: 'texture' | 'model', input: AssetSource | undefined, deps: ExportDeps): Promise<LoadedAsset> {
  const { source, credit } = creditFor(id, kind, input);

  let bytes: Uint8Array;
  let ext: string;
  if (source.type === 'library') {
    bytes = await download(source.url, `The library file '${source.path}'`, deps);
    ext = extOf(source.url);
  } else {
    if (source.bytes) bytes = source.bytes;
    else if (source.blob) bytes = new Uint8Array(await source.blob.arrayBuffer());
    else if (source.base64) bytes = base64ToBytes(source.base64) ?? new Uint8Array(0);
    else throw new ExportError('missing-asset', `The upload '${source.name}' has no stored bytes.`);
    ext = EXT_BY_MIME[source.mimeType];
  }

  const sha = await sha256(bytes);
  if (bytes.length !== source.size || sha !== source.sha256) {
    if (source.type === 'library') {
      throw new ExportError(
        'integrity',
        `The library file '${source.path}' does not match the asset library's published SHA-256, so the export stopped. Check your connection and try again.`,
        `${source.url}: expected ${source.sha256} (${source.size} bytes), got ${sha} (${bytes.length} bytes)`
      );
    }
    throw new ExportError('missing-asset', `The stored bytes of the upload '${source.name}' are damaged. Upload it again.`, `expected ${source.sha256}, got ${sha}`);
  }
  if (kind === 'texture' ? !TEXTURE_EXT.has(ext) : ext !== 'glb') {
    throw new ExportError('invalid-project', `The ${kind} '${id}' is not a file type a game can use (.${ext || '?'}).`);
  }
  return { id, kind, bytes, sha256: sha, ext, credit };
}

async function runtimeFile(base: string, entry: RuntimeFileEntry, deps: ExportDeps): Promise<Uint8Array> {
  const bytes = await download(base + entry.file, `The game runtime file '${entry.file}'`, deps);
  if (bytes.length !== entry.size || (await sha256(bytes)) !== entry.sha256) {
    throw new ExportError('runtime', `The editor's game runtime file '${entry.file}' does not match its manifest. Reload the editor and try again.`);
  }
  return bytes;
}

const safeFilePart = (text: string, fallback: string) => text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || fallback;

/** Exports a project as a single-player game zip */
export async function exportGame(request: ExportRequest, deps: ExportDeps): Promise<ExportResult> {
  const { doc } = request;
  const report = (stage: ExportStage, done: number, total: number) => deps.onProgress?.({ stage, done, total });
  throwIfCancelled(deps.signal);

  // 1. What the project uses
  report('collect', 0, 1);
  const used = projectAssetIds(doc);
  const wanted: { id: string; kind: 'texture' | 'model' }[] = [
    ...used.textures.map((id) => ({ id, kind: 'texture' as const })),
    ...used.models.map((id) => ({ id, kind: 'model' as const })),
  ];
  // Every asset needs a file and a license before anything downloads
  for (const { id, kind } of wanted) creditFor(id, kind, request.sources[id]);
  report('collect', 1, 1);

  // 2-3. Library downloads and uploads, six at a time
  const loaded: LoadedAsset[] = [];
  let done = 0;
  report('download', 0, wanted.length);
  await pool(wanted, deps.concurrency ?? 6, async ({ id, kind }) => {
    loaded.push(await loadAsset(id, kind, request.sources[id], deps));
    report('download', ++done, wanted.length);
  });
  throwIfCancelled(deps.signal);

  // 4-5. One file per unique content, named after its hash
  const files = new Map<string, Uint8Array>();
  const entries: GameAssetEntry[] = [];
  const credited: CreditedAsset[] = [];
  let needsDraco = false;
  for (const asset of loaded) {
    const path = `assets/${contentName(asset.sha256, asset.ext)}`;
    if (!GAME_ASSET_PATH.test(path)) throw new ExportError('invalid-project', `The asset '${asset.id}' has an unsupported file type.`);
    files.set(path, asset.bytes);
    const draco = asset.kind === 'model' && detectDracoCompression(asset.bytes);
    needsDraco ||= draco;
    entries.push({ id: asset.id, kind: asset.kind, path, sha256: asset.sha256, size: asset.bytes.length, ...(draco ? { draco: true } : {}) });
    credited.push({ id: asset.id, kind: asset.kind, path, source: asset.credit });
  }
  const credits = buildCredits(credited);

  // The runtime, and the Draco decoder only when a model needs it
  report('runtime', 0, 1);
  const runtimeBase = request.runtimeBaseUrl.endsWith('/') ? request.runtimeBaseUrl : `${request.runtimeBaseUrl}/`;
  let runtimeManifestRaw: unknown;
  try {
    runtimeManifestRaw = JSON.parse(new TextDecoder().decode(await download(runtimeBase + RUNTIME_MANIFEST_FILE, 'The game runtime', deps)));
  } catch (err) {
    if (err instanceof ExportError) throw err;
    runtimeManifestRaw = null;
  }
  const runtime = readRuntimeManifest(runtimeManifestRaw);
  if (!runtime) throw new ExportError('runtime', "The editor's game runtime is missing or damaged. Reload the editor and try again.");
  const runtimeEntries = [runtime.entry, ...(needsDraco ? runtime.draco : [])];
  for (const [i, entry] of runtimeEntries.entries()) {
    files.set(entry.file, await runtimeFile(runtimeBase, entry, deps));
    report('runtime', i + 1, runtimeEntries.length);
  }
  throwIfCancelled(deps.signal);

  // 6. Manifest, page, credits and notices
  report('package', 0, 1);
  const manifest = buildGameManifest(doc, entries, runtime.runtimeVersion, credits);
  const data = await gameDataFile(manifest);
  files.set(data.path, data.bytes);
  const html = renderIndexHtml(indexTemplate, { title: doc.meta.title, manifestPath: data.path, runtimePath: runtime.entry.file });
  const text = (s: string) => new TextEncoder().encode(s);
  files.set('index.html', text(html));
  files.set('CREDITS.txt', text(renderCreditsText(credits, doc.meta)));
  files.set('THIRD_PARTY_NOTICES.txt', text(renderThirdPartyNotices({ runtimeFile: runtime.entry.file, draco: needsDraco })));
  files.set('LICENSE-runtime.txt', text(renderRuntimeLicense()));
  files.set('README.txt', text(renderReadme(doc.meta.title)));
  // A key or password typed into the project would ship to every player; the text files carry
  // everything the creator wrote (P3.6)
  const textFiles = Object.fromEntries([...files].filter(([p]) => /\.(?:html|json|txt)$/.test(p)));
  const scan = scanExportPayload(textFiles);
  if (!scan.safe) {
    const where = [...new Set(scan.violations.map((v) => v.file))].join(', ');
    throw new ExportError(
      'invalid-project',
      `The project contains text that looks like an API key or password (in ${where}). Remove it from the project and export again.`,
      scan.violations.map((v) => `${v.file}: ${v.pattern}`).join('; ')
    );
  }
  report('package', 1, 1);
  throwIfCancelled(deps.signal);

  // 7. The zip
  report('zip', 0, 1);
  const bytes = buildZip(files);
  report('zip', 1, 1);
  throwIfCancelled(deps.signal);

  return {
    fileName: `${safeFilePart(doc.export.slug, 'game')}-${safeFilePart(doc.meta.version, '1.0.0')}.zip`,
    bytes,
    sha256: await sha256(bytes),
    size: bytes.length,
    fileCount: files.size,
    runtimeVersion: runtime.runtimeVersion,
    files: [...files.entries()].map(([path, b]) => ({ path, size: b.length })).sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}
