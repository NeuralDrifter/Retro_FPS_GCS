import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, waitForGcsEvent } from './fixtures';
import { exportFromEditor, openGame, playLevel1ThroughToLevel2 } from './helpers/game-page';
import { serveFolder } from './helpers/static-server';

// The single-HTML export (release plan P3.9, G-19): with "Single HTML file" chosen in Project
// Settings, Export Game writes one .html that plays when opened from disk and when served over
// HTTP, makes no request beyond the page itself, loads a Draco model from its own copy of the
// decoder, and comes out byte-identical when exported again.

test.describe.configure({ timeout: 480_000 });

const DRACO_CUBE = fs.readFileSync(path.join(process.cwd(), 'e2e/assets/draco-cube.glb'));

type Doc = {
  levels: { data: { grid: number[][]; spawn: { row: number; col: number }; entities: { id: string; row: number; col: number }[]; nextEntityId: number } }[];
  userAssets: unknown[];
};

/** The sample with a CC0 Draco model placed next to the level 1 start */
function withDracoModel(doc: Doc): Doc {
  const sha = crypto.createHash('sha256').update(DRACO_CUBE).digest('hex');
  const id = `glb-${sha.slice(0, 16)}`;
  doc.userAssets.push({ id, name: 'Draco Cube', mimeType: 'model/gltf-binary', sha256: sha, size: DRACO_CUBE.length, license: 'CC0-1.0', data: DRACO_CUBE.toString('base64') });
  const level = doc.levels[0].data;
  const taken = new Set(level.entities.map((e) => `${e.row},${e.col}`));
  const cells = level.grid.flatMap((row, r) => row.map((cell, c) => ({ r, c, cell })));
  const near = cells
    .filter(({ r, c, cell }) => cell === 0 && !(r === level.spawn.row && c === level.spawn.col) && !taken.has(`${r},${c}`))
    .sort((a, b) => Math.hypot(a.r - level.spawn.row, a.c - level.spawn.col) - Math.hypot(b.r - level.spawn.row, b.c - level.spawn.col))[0];
  level.entities.push({
    id: `ent-${level.nextEntityId}`,
    row: near.r,
    col: near.c,
    blueprintId: 'custom-glb',
    modelAssetId: id,
    name: 'Draco Cube',
    yawBam: 0,
    scalePct: 100,
    isEnemy: false,
    maxHealth: 50,
    moveSpeedUnitsPerTick: 0,
    attackDamage: 0,
  } as Doc['levels'][number]['data']['entities'][number]);
  level.nextEntityId += 1;
  return doc;
}

test('the single HTML export plays from disk and over HTTP, with a Draco model and no requests', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds'/)).toBeVisible();

  // The sample, with an uploaded Draco model, opened as a project file
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-export-html-'));
  const projectFile = path.join(folder, 'proving-grounds-draco.gcs.json');
  const doc = withDracoModel((await page.evaluate(() => window.__gcsProbes!.projectDocument!())) as Doc);
  fs.writeFileSync(projectFile, JSON.stringify(doc));
  await page.getByLabel('Open project file').setInputFiles(projectFile);
  await expect(page.getByText(/Opened '.*' \(3 levels\)/)).toBeVisible();

  // Choose the format in Project Settings
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Project Settings/ }).click();
  const settings = page.getByRole('dialog', { name: 'Project Settings' });
  await settings.getByRole('radio', { name: /Single HTML file/ }).check();
  await expect(settings.getByText(/Exports as proving-grounds-\d+\.\d+\.\d+\.html/)).toBeVisible();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toHaveCount(0);

  const first = await exportFromEditor(page);
  expect(first.fileName).toMatch(/^proving-grounds-\d+\.\d+\.\d+\.html$/);
  const htmlFile = path.join(folder, first.fileName);
  fs.writeFileSync(htmlFile, first.bytes);

  const server = await serveFolder(folder, '/');
  try {
    // From disk, playing the level 1 recording through to level 2
    const fileUrl = pathToFileURL(htmlFile).href;
    const fromDisk = await openGame(page, fileUrl, { allowRequest: (url) => url === fileUrl, replay: true });
    await playLevel1ThroughToLevel2(fromDisk.game, 3);
    const a = await fromDisk.finish();
    expect(a.problems, 'problems in the game opened from disk').toEqual([]);
    expect(a.requests.filter((url) => url !== fileUrl), 'requests besides the page itself').toEqual([]);
    expect(a.workers, 'the Draco decoder worker started').toBeGreaterThan(0);

    // Over HTTP
    const pageUrl = `${server.url}${first.fileName}`;
    const overHttp = await openGame(page, pageUrl, { allowRequest: (url) => url === pageUrl });
    await expect.poll(() => overHttp.workers(), { timeout: 60_000 }).toBeGreaterThan(0);
    const b = await overHttp.finish();
    expect(b.problems, 'problems in the game served over HTTP').toEqual([]);
    expect(b.requests.filter((url) => url !== pageUrl), 'requests besides the page itself').toEqual([]);
  } finally {
    await server.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }

  const second = await exportFromEditor(page);
  expect(second.sha256).toBe(first.sha256);
});
