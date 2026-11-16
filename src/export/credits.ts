/**
 * Credits for every asset an export bundles (release plan P3.5). The export worker builds them
 * from each asset's source: a library file credits its pack (title, author, license, source URL),
 * an upload its license and attribution. They go into the game manifest, where the runtime's
 * Credits screen reads them (P5.1), and into `CREDITS.txt`.
 */
import { isLicenseUnrecorded } from '../shared/project/schema';
import type { UserAssetLicense } from '../shared/project/schema';
import type { GameCredits } from '../shared/project/gameManifest';
import { ExportError } from './errors';

/** A library pack as the asset library's packs.json describes it */
export interface CreditPack {
  title: string;
  author: string;
  license: string;
  source: string;
}

/** What one bundled asset needs credited */
export type CreditSource =
  | { type: 'library'; path: string; pack?: CreditPack }
  | { type: 'user'; name: string; license?: UserAssetLicense; attribution?: string };

export interface CreditedAsset {
  id: string;
  kind: 'texture' | 'model';
  /** Its path in the game, e.g. `assets/0123456789abcdef.png` */
  path: string;
  source: CreditSource;
}

const UPLOAD_LICENSE_LABELS: Record<UserAssetLicense, string> = {
  'own-work': "The game author's own work",
  'CC0-1.0': 'CC0 1.0',
  'CC-BY-4.0': 'CC BY 4.0',
  other: 'Other (see attribution)',
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Throws `unlicensed-asset` when the source carries no license the export can credit */
export function checkCreditable(id: string, kind: 'texture' | 'model', source: CreditSource): void {
  if (source.type === 'library') {
    const pack = source.pack;
    if (!pack || !pack.title.trim() || !pack.author.trim() || !pack.license.trim() || pack.license === 'Unknown' || !pack.source.trim()) {
      throw new ExportError(
        'unlicensed-asset',
        `The library ${kind} '${source.path}' belongs to no pack in the asset library's license list, so the export cannot credit it. Replace it with another library ${kind}.`,
        id
      );
    }
  } else if (isLicenseUnrecorded(source)) {
    throw new ExportError(
      'unlicensed-asset',
      `The ${kind} '${source.name}' has no recorded license, so the export cannot credit it. Upload it again and choose its license.`,
      id
    );
  }
}

/** The credits for `assets`; the same assets always give the same credits, in a fixed order */
export function buildCredits(assets: readonly CreditedAsset[]): GameCredits {
  const packs = new Map<string, GameCredits['packs'][number]>();
  const uploads = new Map<string, GameCredits['uploads'][number]>();
  for (const asset of assets) {
    checkCreditable(asset.id, asset.kind, asset.source);
    const source = asset.source;
    if (source.type === 'library') {
      const pack = source.pack!;
      const key = JSON.stringify([pack.title, pack.author, pack.license, pack.source]);
      const entry = packs.get(key) ?? { ...pack, files: [] };
      if (!entry.files.some((f) => f.name === source.path && f.path === asset.path)) entry.files.push({ name: source.path, path: asset.path });
      packs.set(key, entry);
    } else {
      const license = UPLOAD_LICENSE_LABELS[source.license!];
      const attribution = source.attribution?.trim() ?? '';
      uploads.set(JSON.stringify([source.name, asset.path, license, attribution]), { name: source.name, path: asset.path, license, attribution });
    }
  }
  for (const pack of packs.values()) pack.files.sort((a, b) => byText(a.name, b.name) || byText(a.path, b.path));
  return {
    packs: [...packs.values()].sort((a, b) => byText(a.title, b.title) || byText(a.author, b.author) || byText(a.source, b.source)),
    uploads: [...uploads.values()].sort((a, b) => byText(a.name, b.name) || byText(a.path, b.path)),
  };
}

/** `CREDITS.txt` */
export function renderCreditsText(credits: GameCredits, meta: { title: string; author: string }): string {
  const lines: string[] = [`${meta.title}: credits`, ''];
  if (meta.author.trim()) lines.push(`Made by ${meta.author.trim()}.`);
  lines.push(
    'Made with Retro FPS GCS. The game runtime is under the MIT license (LICENSE-runtime.txt).',
    'The software it includes is listed in THIRD_PARTY_NOTICES.txt.',
    'Built-in textures and models are drawn by the runtime and are covered by its license.',
    ''
  );
  if (credits.packs.length > 0) {
    lines.push('ASSET LIBRARY PACKS', '');
    for (const pack of credits.packs) {
      lines.push(pack.title, `  Author: ${pack.author}`, `  License: ${pack.license}`, `  Source: ${pack.source}`, '  Files:');
      for (const file of pack.files) lines.push(`    ${file.name} (${file.path})`);
      lines.push('');
    }
  }
  if (credits.uploads.length > 0) {
    lines.push("ASSETS ADDED BY THE GAME'S AUTHOR", '');
    for (const upload of credits.uploads) {
      lines.push(upload.name, `  License: ${upload.license}`);
      if (upload.attribution) lines.push(`  Attribution: ${upload.attribution}`);
      lines.push(`  File: ${upload.path}`, '');
    }
  }
  if (credits.packs.length === 0 && credits.uploads.length === 0) lines.push('The game uses only built-in textures and models.', '');
  return lines.join('\n');
}
