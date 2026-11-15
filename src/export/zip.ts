/**
 * Deterministic zip writing with fflate (release plan P3.3, section 3.4): entries sorted by path,
 * one fixed timestamp (1980-01-01 00:00:00, the earliest a zip can hold), fixed compression
 * levels per file type and no comments or extra fields. The same files always give the same bytes.
 */
import { zipSync } from 'fflate';
import type { Zippable } from 'fflate';

/** Local time, because zip timestamps carry no time zone and fflate reads the local fields */
const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0);
/** Formats that are compressed already; deflating them again costs time and saves nothing */
const STORED = /\.(?:png|jpe?g|webp|ogg|mp3)$/i;
const DEFLATE_LEVEL = 6;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._/-]+$/;

/** Zips `files` (path to bytes); throws on an unsafe or duplicate path */
export function buildZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const paths = [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const tree: Zippable = {};
  for (const path of paths) {
    if (!SAFE_PATH.test(path) || path.endsWith('/')) throw new Error(`unsafe zip path '${path}'`);
    tree[path] = [files.get(path)!, { level: STORED.test(path) ? 0 : DEFLATE_LEVEL, mtime: ZIP_EPOCH, os: 0, attrs: 0 }];
  }
  return zipSync(tree, { mtime: ZIP_EPOCH });
}
