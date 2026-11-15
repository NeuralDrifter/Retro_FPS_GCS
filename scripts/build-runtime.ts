/**
 * Builds the single-player runtime into public/runtime/ (release plan P3.2).
 * Runs before `build`; `npm run dev` rebuilds it on change through the Vite plugin in vite.config.ts.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRuntime } from './runtimeBundle';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = await buildRuntime(root);
console.log(
  `public/runtime/${manifest.entry.file} built (${Math.round(manifest.entry.size / 1024)} kB, runtime ${manifest.runtimeVersion}, ${manifest.draco.length} Draco files)`
);
