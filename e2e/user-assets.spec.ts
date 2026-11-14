import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { expect, test, waitForGcsEvent } from './fixtures';

// Uploads are project files: checked, licensed, kept with the project, and portable to another
// browser profile (release plan P2.6).

// Two editor profiles, uploads and a Draco model: CI's two workers on software rendering need
// about three times the local run time
test.describe.configure({ timeout: 360_000 });

const DRACO_CUBE = fileURLToPath(new URL('./assets/draco-cube.glb', import.meta.url));
// A 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

type Doc = { id: string; userAssets: { id: string; license: string }[] };
const project = (page: Page) => page.evaluate(() => window.__gcsProbes!.projectDocument!() as Doc);
const assetStatus = (page: Page) =>
  page.evaluate(() => window.__gcsProbes!.userAssetStatus!() as { id: string; ready: boolean }[]);

async function openEditor(page: Page) {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
}

async function clickMapCell(page: Page, row: number, col: number) {
  const canvas = page.getByLabel(/^2D Grid Map \d+ by \d+$/);
  const size = Number(/(\d+) by/.exec((await canvas.getAttribute('aria-label'))!)![1]);
  const box = (await canvas.boundingBox())!;
  const cell = (box.width - 22) / size;
  await canvas.click({ position: { x: 22 + (col + 0.5) * cell, y: 22 + (row + 0.5) * cell } });
}

async function chooseLicense(page: Page, label: RegExp, button: RegExp) {
  const dialog = page.getByRole('dialog', { name: /^License for/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(label).check();
  await dialog.getByRole('button', { name: button }).click();
  await expect(dialog).toBeHidden();
}

test('a project with an uploaded texture and model opens in another browser profile with no stand-ins', async ({ page, browser }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Asset Library' }).click();

  await page.getByLabel('Upload texture files').setInputFiles({ name: 'bricks.png', mimeType: 'image/png', buffer: PNG });
  await chooseLicense(page, /I made it/, /Add texture/);
  // The uploaded texture is selected and the paint tool is on: paint it onto an empty cell
  await clickMapCell(page, 5, 5);

  await page.getByLabel('Upload model files').setInputFiles(DRACO_CUBE);
  await chooseLicense(page, /CC0/, /Add model/);
  await clickMapCell(page, 7, 7);

  const doc = await project(page);
  expect(doc.userAssets.map((a) => a.license).sort()).toEqual(['CC0-1.0', 'own-work']);
  expect(await assetStatus(page)).toEqual(doc.userAssets.map((a) => ({ id: a.id, ready: true })));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Download Project File' }).click();
  const file = await (await downloadPromise).path();

  // Profile B: a separate browser context with its own empty storage
  const other = await browser.newContext();
  try {
    const pageB = await other.newPage();
    await pageB.addInitScript(() => {
      window.__GCS_DEBUG__ = true;
      window.__gcsEvents = [];
      window.addEventListener('gcs:editor-ready', () => window.__gcsEvents!.push('editor-ready'));
    });
    await openEditor(pageB);
    await pageB.getByLabel('Open project file').setInputFiles(file);
    await expect(pageB.getByText(/File: Opened '/)).toBeVisible();
    await expect(pageB.getByText(/stand-in/)).toHaveCount(0);
    const docB = await project(pageB);
    expect(docB.userAssets.map((a) => a.id).sort()).toEqual(doc.userAssets.map((a) => a.id).sort());
    expect(await assetStatus(pageB)).toEqual(docB.userAssets.map((a) => ({ id: a.id, ready: true })));
  } finally {
    await other.close();
  }
});

test('uploads that are too large or not the claimed type are refused with a message', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Asset Library' }).click();
  const input = page.getByLabel('Upload texture files');

  await input.setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('<html>hello</html>') });
  await expect(page.getByText(/'notes\.png' is not a PNG, JPEG or WebP image/)).toBeVisible();

  await input.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(16 * 1024 * 1024 + 1) });
  await expect(page.getByText(/'huge\.png' is 16\.0 MB; uploads can be at most 16\.0 MB/)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await project(page)).userAssets).toEqual([]);
});
