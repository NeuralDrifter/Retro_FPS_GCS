/**
 * Builds the single-player runtime that exports ship (release plan P3.2): src/runtime/entries/sp.ts
 * bundled by esbuild (minified, es2022) twice: as an ES module, public/runtime/game.<sha256-16>.js,
 * for the zip, and as a classic script, game-classic.<sha256-16>.js, that the single-HTML export
 * inlines (P3.9). The Draco decoder files go beside them in public/runtime/draco/, and
 * runtime-manifest.json lists every file's SHA-256 and size. The export worker (P3.3) copies
 * these files into each game.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BuildOptions, Plugin } from 'esbuild';
import { DRACO_LOADER_FILE, blankDefaultDracoUrls } from './dracoDefaults';
import { RUNTIME_MANIFEST_FILE } from '../src/export/runtimeFiles';
import type { RuntimeFileEntry, RuntimeManifest } from '../src/export/runtimeFiles';

export const RUNTIME_OUT_DIR = 'public/runtime';
/** three's glTF build of the Draco decoder, the one its DRACOLoader expects; the build copies it, so the repo keeps no copy (P3.6) */
const DRACO_SOURCE_DIR = 'node_modules/three/examples/jsm/libs/draco/gltf';

export { RUNTIME_MANIFEST_FILE };
export type { RuntimeFileEntry, RuntimeManifest };

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

export function readPackageVersion(root: string): string {
  return (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version: string }).version;
}

/** Blanks DRACOLoader's default decoder URLs (see scripts/dracoDefaults.ts) */
const noDefaultDracoUrls: Plugin = {
  name: 'no-default-draco-urls',
  setup(build) {
    build.onLoad({ filter: DRACO_LOADER_FILE }, (args) => ({
      contents: blankDefaultDracoUrls(fs.readFileSync(args.path, 'utf-8')),
      loader: 'js',
    }));
  },
};

type RuntimeFormat = 'esm' | 'iife';

function esbuildOptions(root: string, version: string, format: RuntimeFormat): BuildOptions {
  return {
    absWorkingDir: root,
    entryPoints: ['src/runtime/entries/sp.ts'],
    bundle: true,
    format,
    minify: true,
    target: 'es2022',
    platform: 'browser',
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
    define: { __GCS_RUNTIME_VERSION__: JSON.stringify(version) },
    plugins: [noDefaultDracoUrls],
  };
}

const RUNTIME_FILE = /^game(?:-classic)?\.[0-9a-f]{16}\.js$/;

/** Writes both bundles, the Draco files and the manifest; removes runtime files from older builds */
export function writeRuntimeOutput(root: string, version: string, code: Uint8Array, classicCode: Uint8Array): RuntimeManifest {
  const outDir = path.join(root, RUNTIME_OUT_DIR);
  fs.mkdirSync(path.join(outDir, 'draco'), { recursive: true });
  const entry = { file: `game.${sha256(code).slice(0, 16)}.js`, sha256: sha256(code), size: code.length };
  const classic = { file: `game-classic.${sha256(classicCode).slice(0, 16)}.js`, sha256: sha256(classicCode), size: classicCode.length };
  for (const old of fs.readdirSync(outDir)) {
    if (RUNTIME_FILE.test(old) && old !== entry.file && old !== classic.file) fs.rmSync(path.join(outDir, old));
  }
  fs.writeFileSync(path.join(outDir, entry.file), code);
  fs.writeFileSync(path.join(outDir, classic.file), classicCode);

  const draco: RuntimeFileEntry[] = [];
  for (const name of fs.readdirSync(path.join(root, DRACO_SOURCE_DIR)).sort()) {
    const bytes = fs.readFileSync(path.join(root, DRACO_SOURCE_DIR, name));
    fs.writeFileSync(path.join(outDir, 'draco', name), bytes);
    draco.push({ file: `draco/${name}`, sha256: sha256(bytes), size: bytes.length });
  }

  const manifest: RuntimeManifest = {
    runtimeVersion: version,
    entry,
    classic,
    draco,
  };
  fs.writeFileSync(path.join(outDir, RUNTIME_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function buildCode(root: string, version: string, format: RuntimeFormat): Promise<Uint8Array> {
  const esbuild = await import('esbuild');
  const out = (await esbuild.build(esbuildOptions(root, version, format))).outputFiles?.[0];
  if (!out) throw new Error(`esbuild produced no ${format} runtime bundle`);
  return out.contents;
}

/** Builds the runtime once, in both formats */
export async function buildRuntime(root: string): Promise<RuntimeManifest> {
  const version = readPackageVersion(root);
  const [code, classicCode] = await Promise.all([buildCode(root, version, 'esm'), buildCode(root, version, 'iife')]);
  return writeRuntimeOutput(root, version, code, classicCode);
}

/** Rebuilds the runtime whenever its sources change; returns a function that stops watching */
export async function watchRuntime(root: string, onBuilt: (manifest: RuntimeManifest) => void): Promise<() => Promise<void>> {
  const esbuild = await import('esbuild');
  const version = readPackageVersion(root);
  const writer: Plugin = {
    name: 'write-runtime-output',
    setup(build) {
      // The ES module rebuilds on change; the classic script follows it
      build.onEnd(async (result) => {
        const out = result.outputFiles?.[0];
        if (result.errors.length > 0 || !out) return;
        try {
          onBuilt(writeRuntimeOutput(root, version, out.contents, await buildCode(root, version, 'iife')));
        } catch (err) {
          console.error(`classic runtime build failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    },
  };
  const options = esbuildOptions(root, version, 'esm');
  const ctx = await esbuild.context({ ...options, plugins: [...(options.plugins ?? []), writer] });
  await ctx.watch();
  return () => ctx.dispose();
}
