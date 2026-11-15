/**
 * Builds the single-player runtime that exports ship (release plan P3.2): src/runtime/entries/sp.ts
 * bundled by esbuild (ES module, minified, es2022) into public/runtime/game.<sha256-16>.js, with
 * the Draco decoder files beside it in public/runtime/draco/ and a runtime-manifest.json listing
 * every file's SHA-256 and size. The export worker (P3.3) copies these files into each game.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BuildOptions, Plugin } from 'esbuild';

export const RUNTIME_OUT_DIR = 'public/runtime';
export const RUNTIME_MANIFEST_FILE = 'runtime-manifest.json';
const DRACO_SOURCE_DIR = 'public/draco';

export interface RuntimeFileEntry {
  /** Relative to public/runtime/ */
  file: string;
  sha256: string;
  size: number;
}

export interface RuntimeManifest {
  runtimeVersion: string;
  entry: RuntimeFileEntry;
  draco: RuntimeFileEntry[];
}

const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

export function readPackageVersion(root: string): string {
  return (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { version: string }).version;
}

function esbuildOptions(root: string, version: string): BuildOptions {
  return {
    absWorkingDir: root,
    entryPoints: ['src/runtime/entries/sp.ts'],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2022',
    platform: 'browser',
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
    define: { __GCS_RUNTIME_VERSION__: JSON.stringify(version) },
  };
}

/** Writes the bundle, the Draco files and the manifest; removes runtime files from older builds */
export function writeRuntimeOutput(root: string, version: string, code: Uint8Array): RuntimeManifest {
  const outDir = path.join(root, RUNTIME_OUT_DIR);
  fs.mkdirSync(path.join(outDir, 'draco'), { recursive: true });
  const hash = sha256(code);
  const entryFile = `game.${hash.slice(0, 16)}.js`;
  for (const old of fs.readdirSync(outDir)) {
    if (/^game\.[0-9a-f]{16}\.js$/.test(old) && old !== entryFile) fs.rmSync(path.join(outDir, old));
  }
  fs.writeFileSync(path.join(outDir, entryFile), code);

  const draco: RuntimeFileEntry[] = [];
  for (const name of fs.readdirSync(path.join(root, DRACO_SOURCE_DIR)).sort()) {
    const bytes = fs.readFileSync(path.join(root, DRACO_SOURCE_DIR, name));
    fs.writeFileSync(path.join(outDir, 'draco', name), bytes);
    draco.push({ file: `draco/${name}`, sha256: sha256(bytes), size: bytes.length });
  }

  const manifest: RuntimeManifest = {
    runtimeVersion: version,
    entry: { file: entryFile, sha256: hash, size: code.length },
    draco,
  };
  fs.writeFileSync(path.join(outDir, RUNTIME_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Builds the runtime once */
export async function buildRuntime(root: string): Promise<RuntimeManifest> {
  const esbuild = await import('esbuild');
  const version = readPackageVersion(root);
  const result = await esbuild.build(esbuildOptions(root, version));
  const out = result.outputFiles?.[0];
  if (!out) throw new Error('esbuild produced no runtime bundle');
  return writeRuntimeOutput(root, version, out.contents);
}

/** Rebuilds the runtime whenever its sources change; returns a function that stops watching */
export async function watchRuntime(root: string, onBuilt: (manifest: RuntimeManifest) => void): Promise<() => Promise<void>> {
  const esbuild = await import('esbuild');
  const version = readPackageVersion(root);
  const writer: Plugin = {
    name: 'write-runtime-output',
    setup(build) {
      build.onEnd((result) => {
        const out = result.outputFiles?.[0];
        if (result.errors.length === 0 && out) onBuilt(writeRuntimeOutput(root, version, out.contents));
      });
    },
  };
  const ctx = await esbuild.context({ ...esbuildOptions(root, version), plugins: [writer] });
  await ctx.watch();
  return () => ctx.dispose();
}
