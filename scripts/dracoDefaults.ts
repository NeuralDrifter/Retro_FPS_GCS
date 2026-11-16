/**
 * three's DRACOLoader points at its own copies of the Draco decoder through
 * `new URL('../libs/draco/...', import.meta.url)`. The editor and every game always set a decoder
 * path, so those defaults are never used. Both builds blank them (P3.6, P3.9):
 *
 * - Vite would otherwise emit five more decoder files into the editor build;
 * - the single-HTML runtime is a classic script, where `import.meta.url` does not exist and the
 *   defaults would throw as the bundle starts.
 *
 * The count check makes a three upgrade that changes this code fail the build instead of
 * slipping through.
 */

/** Matches three's DRACOLoader module, with either path separator */
export const DRACO_LOADER_FILE = /[\\/]three[\\/]examples[\\/]jsm[\\/]loaders[\\/]DRACOLoader\.js$/;

const DEFAULT_URL = /new URL\(\s*'\.\.\/libs\/draco\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g;
const EXPECTED_DEFAULTS = 5;

/** DRACOLoader's source with its default decoder URLs replaced by '' */
export function blankDefaultDracoUrls(code: string): string {
  const count = code.match(DEFAULT_URL)?.length ?? 0;
  if (count !== EXPECTED_DEFAULTS) {
    throw new Error(`DRACOLoader has ${count} default decoder URLs, expected ${EXPECTED_DEFAULTS}; check scripts/dracoDefaults.ts after a three upgrade`);
  }
  return code.replace(DEFAULT_URL, "''");
}
