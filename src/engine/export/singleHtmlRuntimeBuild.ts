/**
 * Builds the self-contained runtime bundle that single HTML exports inline.
 *
 * The output is checked in as public/single-html-runtime.js so the browser editor can
 * fetch it. scripts/build-single-html-runtime.ts regenerates it before `dev` and `build`,
 * and a test fails if the checked-in copy no longer matches src/runtime.
 *
 * Node only: esbuild is imported dynamically so it never lands in the browser bundle.
 */

export const SINGLE_HTML_RUNTIME_ENTRY = 'src/runtime/singleHtmlLauncher.ts';
export const SINGLE_HTML_RUNTIME_OUTPUT = 'public/single-html-runtime.js';

export async function buildSingleHtmlRuntime(projectRoot: string): Promise<string> {
  // @vite-ignore keeps Vite from pulling esbuild's Node code into the editor's browser bundle
  const path: typeof import('node:path') = await import(/* @vite-ignore */ 'node:path');
  const esbuild: typeof import('esbuild') = await import(/* @vite-ignore */ 'esbuild');
  const res = await esbuild.build({
    entryPoints: [path.resolve(projectRoot, SINGLE_HTML_RUNTIME_ENTRY)],
    bundle: true,
    format: 'iife',
    write: false,
    platform: 'browser',
    target: 'es2020',
    minify: true,
    // An IIFE has no import.meta; without this, Three.js's DRACO loader builds
    // new URL(..., undefined) at load time and the whole page fails to start
    define: {
      'import.meta.url': 'document.baseURI',
    },
  });
  const out = res.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no output for the single HTML runtime');
  return out.text;
}
