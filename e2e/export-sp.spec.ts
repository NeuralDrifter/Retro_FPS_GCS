import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, waitForGcsEvent } from './fixtures';
import { serveFolder } from './helpers/static-server';
import type { StaticServer } from './helpers/static-server';
import { unzipToFolder } from './helpers/unzip';

// The exported sample plays from a static host (release plan P3.7): under a subfolder on one
// origin and at the root of another, with no console errors, no CSP violations and no request
// that leaves the game's own origin. The level 1 recording reaches the exit of a three-level
// campaign, and level 2 loads. Exporting again gives the same bytes.

test.describe.configure({ timeout: 480_000 });

const recording = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'samples/recordings/level1.json'), 'utf-8')) as {
  segments: unknown[];
};

async function exportSample(page: Page): Promise<{ bytes: Buffer; sha256: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('button', { name: 'Export Game' }).click();
  const download = await downloadPromise;
  const done = page.getByRole('dialog', { name: 'Game exported' });
  await expect(done).toBeVisible();
  const bytes = fs.readFileSync((await download.path())!);
  await done.getByRole('button', { name: 'Close' }).click();
  await expect(done).toHaveCount(0);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/** Opens the game at `server.url` in a new tab and records every problem the fixture would */
async function openGame(page: Page, server: StaticServer, replay: boolean) {
  const game = await page.context().newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  const pending = new Set<unknown>();
  game.on('requestfinished', (r) => pending.delete(r));
  game.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
  });
  game.on('pageerror', (e) => problems.push(`uncaught error: ${e.message}`));
  game.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    requests.push(r.url());
    pending.add(r);
    if (url.origin !== server.origin) problems.push(`request outside the game's origin: ${r.url()}`);
  });
  game.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  game.on('requestfailed', (r) => {
    pending.delete(r);
    // Chromium now and then reports a fetch whose body the game read as a stream (for its progress
    // bar) as aborted, after the full response arrived. HTTP errors are caught above and the boot
    // checks every file's size, so only a request that never got a response counts here.
    if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.timing().responseStart > 0) return;
    problems.push(`request failed (${r.failure()?.errorText}): ${r.url()}`);
  });
  await game.addInitScript((input) => {
    window.__GCS_DEBUG__ = true;
    window.__gcsEvents = [];
    window.__gcsCspViolations = [];
    window.addEventListener('gcs:first-frame', () => window.__gcsEvents!.push('first-frame'));
    document.addEventListener('securitypolicyviolation', (e) => window.__gcsCspViolations!.push(`${e.violatedDirective} blocked ${e.blockedURI}`));
    if (input) (window as unknown as { __GCS_DEBUG_REPLAY__: unknown }).__GCS_DEBUG_REPLAY__ = input;
  }, replay ? recording : null);

  await game.goto(server.url);
  await waitForGcsEvent(game, 'first-frame');
  /** Waits for the game's requests to settle, then closes it; closing first would abort them */
  const finish = async () => {
    await expect.poll(() => pending.size, { timeout: 60_000 }).toBe(0);
    const found = [...problems, ...(await game.evaluate(() => window.__gcsCspViolations ?? [])).map((v) => `CSP violation: ${v}`)];
    await game.close();
    return { problems: found, requests: [...requests] };
  };
  return { game, finish };
}

test('the exported sample plays from a subfolder and from a site root, and exports the same bytes twice', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds'/)).toBeVisible();

  const first = await exportSample(page);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-export-sp-'));
  const files = unzipToFolder(first.bytes, folder);
  expect(files).toContain('index.html');

  const subfolder = await serveFolder(folder, '/games/proving-grounds/');
  const root = await serveFolder(folder, '/');
  try {
    // A subfolder of one origin, playing the level 1 recording through to level 2
    const inSubfolder = await openGame(page, subfolder, true);
    const complete = inSubfolder.game.locator('[data-field="complete-title"]');
    await expect(complete).toHaveText('Level 1 / 3 Complete', { timeout: 60_000 });
    const buildsBefore = (await inSubfolder.game.evaluate(() => window.__gcsProbes?.runtimeWorldBuilds?.())) as number;
    await inSubfolder.game.locator('[data-action="next-level"]').click();
    await expect.poll(async () => inSubfolder.game.evaluate(() => window.__gcsProbes?.runtimeWorldBuilds?.()), { timeout: 60_000 }).toBeGreaterThan(buildsBefore);
    await expect(complete).toBeHidden();
    const a = await inSubfolder.finish();
    expect(a.problems, 'problems in the game served from a subfolder').toEqual([]);
    expect(a.requests.every((r) => r.startsWith(subfolder.url))).toBe(true);

    // The root of a second origin
    const atRoot = await openGame(page, root, false);
    const b = await atRoot.finish();
    expect(b.problems, 'problems in the game served from a site root').toEqual([]);
    expect(b.requests.length).toBeGreaterThan(files.length / 2);
  } finally {
    await subfolder.close();
    await root.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }

  const second = await exportSample(page);
  expect(second.sha256).toBe(first.sha256);
});
