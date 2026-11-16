/**
 * The single-HTML packager (release plan P3.9, Q7). It writes one page holding everything a zip
 * holds: the classic-script runtime inline, every game file (the manifest, assets and, when a
 * model needs it, the Draco decoder) as base64 in `<script type="application/octet-stream">`
 * elements the runtime reads instead of fetching, and the credits and license notices in a
 * `<template>`. The page allows no network use at all (G-05): its policy permits only the inline
 * runtime, by hash, and data: and blob: URLs. The same input always gives the same bytes.
 */
import { bytesToBase64 } from '../shared/bytes';
import { EMBEDDED_FILE_ATTRIBUTE } from '../shared/project/gameManifest';
import { escapeHtml } from './manifestBuilder';

export interface SingleHtmlInput {
  title: string;
  /** The manifest's path among `files`, e.g. `data/game.<hash>.json` */
  manifestPath: string;
  /** The classic-script runtime */
  runtime: Uint8Array;
  /** Every file the game reads, by path */
  files: ReadonlyMap<string, Uint8Array>;
  /** Text files kept with the game, e.g. CREDITS.txt */
  notices: ReadonlyMap<string, string>;
}

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Makes script text safe to inline: `</script` would end the element early and `<!--` would
 * change how the parser reads it. Both can appear only inside strings and regular expressions,
 * where `<\/` and `<\!` mean the same characters.
 */
export function inlineScriptText(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return bytesToBase64(digest);
}

/** The page's Content-Security-Policy; `scriptHash` is the inline runtime's SHA-256, base64 */
export function singleHtmlPolicy(scriptHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}' 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'connect-src data: blob:',
    'worker-src blob:',
    'media-src data: blob:',
    'font-src data:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** Writes the page */
export async function renderSingleHtml(input: SingleHtmlInput): Promise<Uint8Array> {
  if (!input.files.has(input.manifestPath)) throw new Error(`the game files lack the manifest '${input.manifestPath}'`);
  const script = inlineScriptText(new TextDecoder().decode(input.runtime));
  const policy = singleHtmlPolicy(await sha256Base64(script));

  const files = [...input.files.keys()].sort(byPath).map((path) => {
    if (!SAFE_PATH.test(path)) throw new Error(`unsafe game file path '${path}'`);
    return `<script type="application/octet-stream" ${EMBEDDED_FILE_ATTRIBUTE}="${path}">${bytesToBase64(input.files.get(path)!)}</script>`;
  });
  const notices = [...input.notices.keys()]
    .sort(byPath)
    .map((name) => `<pre data-file="${escapeHtml(name)}">${escapeHtml(input.notices.get(name)!)}</pre>`);

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<!-- Single-player policy, release plan section 3.6: the game uses nothing outside this file. -->',
    `<meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    `<meta name="gcs:manifest" content="${escapeHtml(input.manifestPath)}" />`,
    `<title>${escapeHtml(input.title)}</title>`,
    // An empty icon, so the browser does not ask the host for /favicon.ico
    '<link rel="icon" href="data:," />',
    '<style>html, body, #game { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0b0b10; } noscript p { color: #d4d4d4; font: 16px system-ui, sans-serif; padding: 24px; }</style>',
    '</head>',
    '<body>',
    '<div id="game"></div>',
    '<noscript><p>This game needs JavaScript. Turn it on for this page and reload.</p></noscript>',
    '<!-- Credits and license notices; view the page source to read them. -->',
    `<template id="gcs-notices">${notices.join('')}</template>`,
    ...files,
    `<script>${script}</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  return new TextEncoder().encode(html);
}
