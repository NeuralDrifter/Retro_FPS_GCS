/**
 * The pinned asset library (release plan P2.7, decision D4). The editor loads one published
 * version of the library from its GitHub Pages site: `index.json` lists every texture and model
 * with its SHA-256, and `packs.json` who made each pack and under which license. Moving to a newer
 * library is a change to LIBRARY_VERSION; pushes to the assets repository change nothing here.
 */
import type { Model3DAsset, TextureAsset } from '../../runtime';
import { recordLibraryFile } from '../../shared/libraryIntegrity';
import { buildAssetsFromRepoPaths } from '../engine/gitHubAssets';

export const LIBRARY_ID = 'retro-fps-gcs-assets';
export const LIBRARY_BASE_URL = 'https://neuraldrifter.github.io/Retro_FPS_GCS-assets/';
export const LIBRARY_VERSION = 'v1.0';

export interface LibraryIndexEntry {
  path: string;
  kind: 'texture' | 'model';
  pack: string;
  sha256: string;
  size: number;
  /** Published file, relative to the site */
  file: string;
  thumb?: string;
  sizeMeters?: { width: number; depth: number };
}

export interface LibraryPack {
  id: string;
  title: string;
  author: string;
  license: string;
  source: string;
  licenseFile: string;
}

export interface LibraryContents {
  version: string;
  textures: TextureAsset[];
  models: Model3DAsset[];
  packs: LibraryPack[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);
const SITE_PATH = /^(?:files|thumbs)\/[0-9a-f]{16}\.(?:webp|png|jpg|glb)$/;

/** Checks the shape of a downloaded index; returns its entries or throws with the reason */
export function readLibraryIndex(raw: unknown, version: string): LibraryIndexEntry[] {
  if (!isObject(raw) || raw.library !== LIBRARY_ID || raw.version !== version || !Array.isArray(raw.assets)) {
    throw new Error(`the library index for ${version} is not in the expected format`);
  }
  return raw.assets.map((a, i) => {
    if (
      !isObject(a) ||
      typeof a.path !== 'string' ||
      (a.kind !== 'texture' && a.kind !== 'model') ||
      typeof a.pack !== 'string' ||
      typeof a.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sha256) ||
      typeof a.size !== 'number' ||
      typeof a.file !== 'string' ||
      !SITE_PATH.test(a.file) ||
      (a.thumb !== undefined && (typeof a.thumb !== 'string' || !SITE_PATH.test(a.thumb)))
    ) {
      throw new Error(`entry ${i} of the library index is invalid`);
    }
    return a as unknown as LibraryIndexEntry;
  });
}

export function readLibraryPacks(raw: unknown): LibraryPack[] {
  if (!isObject(raw) || !Array.isArray(raw.packs)) throw new Error('the library pack list is not in the expected format');
  return raw.packs.filter(
    (p): p is LibraryPack =>
      isObject(p) && ['id', 'title', 'author', 'license', 'source', 'licenseFile'].every((k) => typeof p[k] === 'string')
  );
}

/** Catalog assets for a library version, with the same ids as the asset folders produce */
export function libraryContents(
  version: string,
  entries: LibraryIndexEntry[],
  packs: LibraryPack[],
  baseUrl = LIBRARY_BASE_URL
): LibraryContents {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const packById = new Map(packs.map((p) => [p.id, p]));
  const urlFor = (path: string) => baseUrl + byPath.get(path)!.file;
  const { textures, models } = buildAssetsFromRepoPaths({
    spec: { owner: 'NeuralDrifter', repo: 'Retro_FPS_GCS-assets', branch: version },
    paths: entries.map((e) => e.path),
    urlFor,
    thumbFor: (path) => {
      const thumb = byPath.get(path)?.thumb;
      return thumb ? baseUrl + thumb : undefined;
    },
    modelSizes: Object.fromEntries(
      entries.filter((e) => e.kind === 'model' && e.sizeMeters).map((e) => [e.path.replace(/^models\//, ''), e.sizeMeters!])
    ),
  });
  for (const entry of entries) {
    const pack = packById.get(entry.pack);
    recordLibraryFile(urlFor(entry.path), {
      sha256: entry.sha256,
      size: entry.size,
      path: entry.path,
      pack: pack
        ? { title: pack.title, author: pack.author, license: pack.license, source: pack.source }
        : { title: entry.pack, author: 'Unknown', license: 'Unknown', source: baseUrl },
    });
  }
  return { version, textures, models, packs };
}

/** Downloads the pinned library's index and pack list */
export async function fetchLibrary(version = LIBRARY_VERSION, baseUrl = LIBRARY_BASE_URL): Promise<LibraryContents> {
  const get = async (file: string) => {
    const res = await fetch(`${baseUrl}${version}/${file}`);
    if (!res.ok) throw new Error(`${file} returned HTTP ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  const [index, packs] = await Promise.all([get('index.json'), get('packs.json')]);
  return libraryContents(version, readLibraryIndex(index, version), readLibraryPacks(packs), baseUrl);
}
