/**
 * Release gates for the single-player runtime (release plan P3.2), for both builds: the ES module
 * a zip loads and the classic script a single HTML file inlines (P3.9):
 *   G-10  the runtime JavaScript is at most 300 KB gzip
 *   G-05  it contains none of the network APIs a single-player game must not use
 * Reads public/runtime/runtime-manifest.json, so run `npm run build:runtime` first.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { RUNTIME_MANIFEST_FILE, RUNTIME_OUT_DIR } from './runtimeBundle';
import type { RuntimeManifest } from './runtimeBundle';

export const GZIP_BUDGET_BYTES = 300 * 1024;
export const FORBIDDEN_IDENTIFIERS = [
  'WebSocket',
  'RTCPeerConnection',
  'RTCDataChannel',
  'WebTransport',
  'EventSource',
  'sendBeacon',
  'XMLHttpRequest',
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, RUNTIME_OUT_DIR);
const manifest = JSON.parse(fs.readFileSync(path.join(outDir, RUNTIME_MANIFEST_FILE), 'utf-8')) as RuntimeManifest;
const problems: string[] = [];
const summary: string[] = [];
for (const entry of [manifest.entry, manifest.classic]) {
  const code = fs.readFileSync(path.join(outDir, entry.file));
  const gzip = zlib.gzipSync(code, { level: 9 }).length;
  if (gzip > GZIP_BUDGET_BYTES) {
    problems.push(`G-10: ${entry.file} is ${(gzip / 1024).toFixed(1)} KB gzip, over the ${GZIP_BUDGET_BYTES / 1024} KB budget`);
  }
  const text = code.toString('utf-8');
  for (const name of FORBIDDEN_IDENTIFIERS) {
    if (new RegExp(`\\b${name}\\b`).test(text)) problems.push(`G-05: ${entry.file} contains ${name}`);
  }
  summary.push(`${entry.file} ${(gzip / 1024).toFixed(1)} KB gzip`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Runtime bundles OK: ${summary.join(', ')} (budget ${GZIP_BUDGET_BYTES / 1024} KB each), no network APIs`);
