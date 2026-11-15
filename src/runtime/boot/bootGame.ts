/**
 * The single-player boot sequence (release plan P3.1, section 3.4): read the manifest path from
 * the page, fetch the manifest relative to it, check its schema and runtime versions, load every
 * asset with progress, then start the game. The browser pieces are passed in, so the sequence
 * runs in unit tests without a DOM.
 */
import { checkGameManifest } from '../../shared/project/gameManifest';
import type { GameAssetEntry, GameManifestV1 } from '../../shared/project/gameManifest';
import type { BootScreen } from './bootScreen';
import { resolveGameUrl } from './urls';

export interface BootDeps {
  manifestPath: string | null;
  baseURI: string;
  /** Fetches a URL's bytes, reporting bytes received (and the total when known) */
  fetchBytes(url: string, onProgress: (loaded: number) => void): Promise<Uint8Array>;
  /** Makes a URL for loaded bytes (an object URL in the browser) */
  toObjectUrl(bytes: Uint8Array, mimeType: string): string;
  screen: BootScreen;
  start(manifest: GameManifestV1, assetUrls: Map<string, string>, dracoPath: string | null): void;
  runtimeVersion?: string;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
};
const mimeOf = (path: string) => MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

const ASSET_CONCURRENCY = 4;
const CANNOT_START = "This game can't start";

/** Runs the boot sequence; resolves true when the game started */
export async function bootGame(deps: BootDeps): Promise<boolean> {
  const { screen } = deps;
  const fail = (detail: string) => {
    screen.error(CANNOT_START, detail);
    return false;
  };

  if (!deps.manifestPath) return fail('The page does not say where the game data is (gcs:manifest).');
  let manifestUrl: string;
  try {
    manifestUrl = resolveGameUrl(deps.manifestPath, deps.baseURI);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  screen.progress('Loading game data', null);
  let raw: unknown;
  try {
    const bytes = await deps.fetchBytes(manifestUrl, (loaded) => screen.progress(`Loading game data (${kb(loaded)})`, null));
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return fail('The game data could not be loaded. If you opened index.html from a folder, serve the folder from a web server.');
  }

  const checked = checkGameManifest(raw, deps.runtimeVersion);
  if (!checked.ok) return fail(checked.message);
  const manifest = checked.manifest;

  const total = manifest.assets.reduce((sum, a) => sum + a.size, 0);
  const loadedBy = new Map<string, number>();
  let done = 0;
  const report = () => {
    const loaded = [...loadedBy.values()].reduce((s, n) => s + n, 0);
    screen.progress(
      `Loading assets (${done} of ${manifest.assets.length}, ${kb(loaded)} of ${kb(total)})`,
      total > 0 ? loaded / total : 1
    );
  };
  report();

  const urls = new Map<string, string>();
  const queue = [...manifest.assets];
  const loadOne = async (asset: GameAssetEntry) => {
    const bytes = await deps.fetchBytes(resolveGameUrl(asset.path, deps.baseURI), (loaded) => {
      loadedBy.set(asset.id, loaded);
      report();
    });
    if (bytes.length !== asset.size) throw new Error(`'${asset.path}' has ${bytes.length} bytes, not ${asset.size}.`);
    urls.set(asset.id, deps.toObjectUrl(bytes, mimeOf(asset.path)));
    loadedBy.set(asset.id, asset.size);
    done++;
    report();
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(ASSET_CONCURRENCY, queue.length) }, async () => {
        for (let asset = queue.shift(); asset; asset = queue.shift()) await loadOne(asset);
      })
    );
  } catch (err) {
    return fail(`A game file could not be loaded: ${err instanceof Error ? err.message : String(err)}`);
  }

  const dracoPath = manifest.assets.some((a) => a.draco) ? resolveGameUrl('draco/', deps.baseURI) : null;
  deps.start(manifest, urls, dracoPath);
  return true;
}

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);
