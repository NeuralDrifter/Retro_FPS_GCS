import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SINGLE_HTML_RUNTIME_OUTPUT,
  buildSingleHtmlRuntime,
} from '../export/singleHtmlRuntimeBuild';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('public/single-html-runtime.js', () => {
  it('matches a fresh build of src/runtime (run `npm run build:runtime` if this fails)', async () => {
    const checkedIn = fs.readFileSync(path.join(projectRoot, SINGLE_HTML_RUNTIME_OUTPUT), 'utf-8');
    const fresh = await buildSingleHtmlRuntime(projectRoot);
    assert.ok(
      checkedIn === fresh,
      `${SINGLE_HTML_RUNTIME_OUTPUT} is stale: standalone exports would ship old runtime code`
    );
  });

  it('never references import.meta, which an IIFE bundle cannot provide', async () => {
    const fresh = await buildSingleHtmlRuntime(projectRoot);
    assert.ok(!fresh.includes('import.meta'));
    assert.match(fresh, /new URL\("\.\.\/libs\/draco\/draco_decoder\.wasm",document\.baseURI\)/);
  });
});
