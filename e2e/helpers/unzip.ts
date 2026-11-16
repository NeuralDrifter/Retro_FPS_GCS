import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

/** Unzips `bytes` into `dir`, refusing any entry that would land outside it; returns the file paths */
export function unzipToFolder(bytes: Uint8Array, dir: string): string[] {
  const base = path.resolve(dir);
  const entries = unzipSync(bytes);
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const target = path.resolve(base, name);
    if (!target.startsWith(base + path.sep)) throw new Error(`zip entry outside the folder: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  return Object.keys(entries).filter((name) => !name.endsWith('/'));
}
