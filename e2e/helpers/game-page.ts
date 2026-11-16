import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, waitForGcsEvent } from '../fixtures';

/**
 * Shared steps of the export specs (release plan P3.7, P3.9): exporting from the editor, and
 * opening an exported game in a new tab with the same checks the editor fixture makes.
 */

const recording = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'samples/recordings/level1.json'), 'utf-8')) as {
  segments: unknown[];
};

/** Clicks Export Game, closes the Game exported panel, and returns the downloaded file */
export async function exportFromEditor(page: Page): Promise<{ bytes: Buffer; sha256: string; fileName: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('button', { name: 'Export Game' }).click();
  const download = await downloadPromise;
  const done = page.getByRole('dialog', { name: 'Game exported' });
  await expect(done).toBeVisible();
  const bytes = fs.readFileSync((await download.path())!);
  await done.getByRole('button', { name: 'Close' }).click();
  await expect(done).toHaveCount(0);
  return { bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), fileName: download.suggestedFilename() };
}

export interface GamePageOptions {
  /** True for each address the game may request; data: and blob: URLs are always allowed */
  allowRequest: (url: string) => boolean;
  /** Plays the level 1 recording instead of the keyboard */
  replay?: boolean;
}

/**
 * Opens the game at `url` in a new tab, waits for its first frame, and records every console
 * error, uncaught error, model load failure, CSP violation and disallowed request
 */
export async function openGame(page: Page, url: string, options: GamePageOptions) {
  const game = await page.context().newPage();
  const problems: string[] = [];
  const requests: string[] = [];
  const pending = new Set<unknown>();
  let workers = 0;
  game.on('worker', () => workers++);
  game.on('requestfinished', (r) => pending.delete(r));
  game.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    // A model that fails to load falls back to a built-in one with only a warning
    if (m.type() === 'warning' && /Failed to load/.test(m.text())) problems.push(`console.warn: ${m.text()}`);
  });
  game.on('pageerror', (e) => problems.push(`uncaught error: ${e.message}`));
  game.on('request', (r) => {
    const protocol = new URL(r.url()).protocol;
    if (protocol === 'data:' || protocol === 'blob:') return;
    requests.push(r.url());
    pending.add(r);
    if (!options.allowRequest(r.url())) problems.push(`request not allowed: ${r.url()}`);
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
  }, options.replay ? recording : null);

  await game.goto(url);
  await waitForGcsEvent(game, 'first-frame');

  /** Waits for the game's requests to settle, then closes it; closing first would abort them */
  const finish = async () => {
    await expect.poll(() => pending.size, { timeout: 60_000 }).toBe(0);
    const found = [...problems, ...(await game.evaluate(() => window.__gcsCspViolations ?? [])).map((v) => `CSP violation: ${v}`)];
    await game.close();
    return { problems: found, requests: [...requests], workers };
  };
  return { game, finish, workers: () => workers };
}

/**
 * With the level 1 recording playing: waits for the level's exit, then loads level 2. The game
 * advances at most 0.1 s per drawn frame, and software WebGL on a loaded CI runner can take a
 * second or more per frame, so the 143-tick route can take minutes there.
 */
export async function playLevel1ThroughToLevel2(game: Page, levels: number): Promise<void> {
  const complete = game.locator('[data-field="complete-title"]');
  await expect(complete).toHaveText(`Level 1 / ${levels} Complete`, { timeout: 240_000 });
  const buildsBefore = (await game.evaluate(() => window.__gcsProbes?.runtimeWorldBuilds?.())) as number;
  await game.locator('[data-action="next-level"]').click();
  await expect.poll(async () => game.evaluate(() => window.__gcsProbes?.runtimeWorldBuilds?.()), { timeout: 120_000 }).toBeGreaterThan(buildsBefore);
  await expect(complete).toBeHidden();
}
