import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, waitForGcsEvent } from './fixtures';
import { exportFromEditor, openGame, playLevel1ThroughToLevel2 } from './helpers/game-page';
import { serveFolder } from './helpers/static-server';
import { unzipToFolder } from './helpers/unzip';

// The exported sample plays from a static host (release plan P3.7): under a subfolder on one
// origin and at the root of another, with no console errors, no CSP violations and no request
// that leaves the game's own origin. The level 1 recording reaches the exit of a three-level
// campaign, and level 2 loads. Exporting again gives the same bytes.

test.describe.configure({ timeout: 480_000 });

test('the exported sample plays from a subfolder and from a site root, and exports the same bytes twice', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds'/)).toBeVisible();

  const first = await exportFromEditor(page);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-export-sp-'));
  const files = unzipToFolder(first.bytes, folder);
  expect(files).toContain('index.html');

  const subfolder = await serveFolder(folder, '/games/proving-grounds/');
  const root = await serveFolder(folder, '/');
  try {
    // A subfolder of one origin, playing the level 1 recording through to level 2
    const inSubfolder = await openGame(page, subfolder.url, { allowRequest: (url) => url.startsWith(subfolder.url), replay: true });
    await playLevel1ThroughToLevel2(inSubfolder.game, 3);
    const a = await inSubfolder.finish();
    expect(a.problems, 'problems in the game served from a subfolder').toEqual([]);

    // The root of a second origin
    const atRoot = await openGame(page, root.url, { allowRequest: (url) => new URL(url).origin === root.origin });
    const b = await atRoot.finish();
    expect(b.problems, 'problems in the game served from a site root').toEqual([]);
    expect(b.requests.length).toBeGreaterThan(files.length / 2);
  } finally {
    await subfolder.close();
    await root.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }

  const second = await exportFromEditor(page);
  expect(second.sha256).toBe(first.sha256);
});
