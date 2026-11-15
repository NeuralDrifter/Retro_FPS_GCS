/**
 * Builds the game manifest and the page an export ships (release plan P3.3, step 6). The manifest
 * is written as compact JSON with sorted keys, so a project always produces the same file, and is
 * named after its own hash: `data/game.<sha256-16>.json`.
 */
import { sortKeysDeep } from '../shared/hash';
import type { ProjectDocV4 } from '../shared/project';
import { GAME_MANIFEST_FORMAT, GAME_MANIFEST_SCHEMA_VERSION, checkGameManifest } from '../shared/project/gameManifest';
import type { GameAssetEntry, GameManifestV1 } from '../shared/project/gameManifest';
import { ExportError } from './errors';
import { sha256 } from './hash';

/** The game manifest for a project whose asset files are already named */
export function buildGameManifest(doc: ProjectDocV4, assets: readonly GameAssetEntry[], runtimeVersion: string): GameManifestV1 {
  const manifest: GameManifestV1 = {
    format: GAME_MANIFEST_FORMAT,
    schemaVersion: GAME_MANIFEST_SCHEMA_VERSION,
    runtimeVersion,
    meta: {
      title: doc.meta.title,
      author: doc.meta.author,
      description: doc.meta.description,
      version: doc.meta.version,
    },
    levels: doc.levels.map((l) => ({ id: l.id, title: l.title, data: l.data })),
    campaign: doc.campaign,
    gameData: doc.gameData,
    assets: [...assets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  // The export refuses to write a game the runtime would refuse to start
  const checked = checkGameManifest(JSON.parse(JSON.stringify(manifest)), runtimeVersion);
  if (!checked.ok) throw new ExportError('invalid-project', 'The project cannot be exported as it is.', checked.message);
  return manifest;
}

/** The manifest's file: compact sorted JSON, named after its hash */
export async function gameDataFile(manifest: GameManifestV1): Promise<{ path: string; bytes: Uint8Array }> {
  const bytes = new TextEncoder().encode(JSON.stringify(sortKeysDeep(manifest)));
  return { path: `data/game.${(await sha256(bytes)).slice(0, 16)}.json`, bytes };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Fills the page template; every value is HTML-escaped */
export function renderIndexHtml(template: string, values: { title: string; manifestPath: string; runtimePath: string }): string {
  const fields: Record<string, string> = {
    TITLE: values.title,
    MANIFEST_PATH: values.manifestPath,
    RUNTIME_PATH: values.runtimePath,
  };
  const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => (key in fields ? escapeHtml(fields[key]) : match));
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new ExportError('runtime', 'The game page template has an unknown field.');
  return html;
}
