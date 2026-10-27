/**
 * Regenerates public/single-html-runtime.js from src/runtime.
 * Runs before `dev` and `build`; run it by hand with `npm run build:runtime`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SINGLE_HTML_RUNTIME_OUTPUT,
  buildSingleHtmlRuntime,
} from '../src/engine/export/singleHtmlRuntimeBuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(projectRoot, SINGLE_HTML_RUNTIME_OUTPUT);

const bundle = await buildSingleHtmlRuntime(projectRoot);
const previous = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf-8') : null;

if (previous === bundle) {
  console.log(`${SINGLE_HTML_RUNTIME_OUTPUT} is up to date`);
} else {
  fs.writeFileSync(outPath, bundle);
  console.log(`${SINGLE_HTML_RUNTIME_OUTPUT} rebuilt (${Math.round(bundle.length / 1024)} kB)`);
}
