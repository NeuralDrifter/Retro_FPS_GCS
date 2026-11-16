/**
 * Single-player entry of an exported game (release plan P3.1). A zip's `index.html` loads it as a
 * module and it fetches the game's files; a single-HTML game (P3.9) inlines it as a classic script
 * and it reads the files the page carries. Either way it boots from the page's `gcs:manifest` link
 * and starts the game. It never imports src/net.
 */
import { createBootScreen } from '../boot/bootScreen';
import { bootGame } from '../boot/bootGame';
import { pagePath, readEmbeddedFiles } from '../boot/embedded';
import type { EmbeddedFiles } from '../boot/embedded';
import { readManifestPath } from '../boot/urls';
import { debugReplaySource } from '../debugEvents';
import { startGame } from '../startGame';
import type { CampaignSettings, GameManifest } from '../types';
import type { MenuPackSpec } from '../menu/types';
import type { GameManifestV1 } from '../../shared/project/gameManifest';
import { RUNTIME_VERSION } from '../../shared/versions';

async function fetchBytes(url: string, onProgress: (loaded: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${new URL(url).pathname}`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const objectUrl = (bytes: Uint8Array, mimeType: string) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }));

/** The Draco decoder from the page's own copies, as object URLs */
function embeddedDracoDecoder(files: EmbeddedFiles): { js: string; wasm: string } {
  return {
    js: objectUrl(files.read('draco/draco_wasm_wrapper.js'), 'text/javascript'),
    wasm: objectUrl(files.read('draco/draco_decoder.wasm'), 'application/wasm'),
  };
}

/** The runtime's own manifest shape, with every asset path replaced by its loaded object URL */
function toRuntimeManifest(manifest: GameManifestV1, urls: Map<string, string>): GameManifest {
  const levels = manifest.levels.map((l) => l.data);
  const campaign: CampaignSettings = {
    carryOverHealth: manifest.campaign.carryOverHealth,
    carryOverAmmo: manifest.campaign.carryOverAmmo,
    ...(manifest.campaign.menus ? { menus: manifest.campaign.menus as unknown as MenuPackSpec } : {}),
  };
  return {
    schemaVersion: 1,
    meta: {
      title: manifest.meta.title,
      author: manifest.meta.author,
      description: manifest.meta.description,
      createdAt: '',
      engineVersion: manifest.runtimeVersion,
    },
    level: levels[0],
    levels,
    campaign,
    assets: {
      textures: manifest.assets
        .filter((a) => a.kind === 'texture')
        .map((a) => ({ id: a.id, path: urls.get(a.id)!, mimeType: 'image/*' })),
      models: manifest.assets
        .filter((a) => a.kind === 'model')
        .map((a) => ({ id: a.id, path: urls.get(a.id)!, draco: Boolean(a.draco) })),
    },
  };
}

function boot(): void {
  const container = document.getElementById('game') ?? document.body;
  const screen = createBootScreen(container, document.title);
  const embedded = readEmbeddedFiles(document);
  void bootGame({
    manifestPath: readManifestPath(document),
    baseURI: document.baseURI,
    fetchBytes: embedded
      ? async (url, onProgress) => {
          const bytes = embedded.read(pagePath(url, document.baseURI));
          onProgress(bytes.length);
          return bytes;
        }
      : fetchBytes,
    toObjectUrl: objectUrl,
    screen,
    runtimeVersion: RUNTIME_VERSION,
    start(manifest, urls, dracoPath) {
      const runtimeManifest = toRuntimeManifest(manifest, urls);
      const menus = runtimeManifest.campaign?.menus;
      const mainMenuFirst = Boolean(menus?.enableMainMenuOnBoot && Array.isArray(menus.screens) && menus.screens.length > 0);
      screen.hide();
      let game: ReturnType<typeof startGame> | null = null;
      const replay = debugReplaySource(() => game?.getCurrentLevelIndex() ?? 0);
      game = startGame(runtimeManifest, container, {
        hudRoot: container,
        autoLockPointerOnClick: !mainMenuFirst,
        assetBaseUrl: '',
        ...(dracoPath ? { dracoDecoderPath: embedded ? embeddedDracoDecoder(embedded) : dracoPath } : {}),
        ...(replay ? { inputSource: replay } : {}),
      });
    },
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
