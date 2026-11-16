import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test, waitForGcsEvent } from './fixtures';

// One-click export (release plan P3.4): Export Game starts at once, needs no further input, and
// downloads the zip; a project with problems lists them and downloads nothing.

test.describe.configure({ timeout: 360_000 });

// A 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('one click exports the sample with no further input', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds'/)).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('button', { name: 'Export Game' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^proving-grounds-\d+\.\d+\.\d+\.zip$/);

  const done = page.getByRole('dialog', { name: 'Game exported' });
  await expect(done).toBeVisible();
  await expect(done.getByText(download.suggestedFilename())).toBeVisible();
  const zipBytes = fs.readFileSync((await download.path())!);
  await expect(done.getByText(crypto.createHash('sha256').update(zipBytes).digest('hex'))).toBeVisible();
  await done.getByRole('button', { name: 'How to publish' }).click();
  await expect(done.getByText(/itch\.io/)).toBeVisible();

  const zip = unzipSync(new Uint8Array(zipBytes));
  expect(Object.keys(zip)).toContain('index.html');
  const data = Object.keys(zip).find((p) => p.startsWith('data/'))!;
  const manifest = JSON.parse(strFromU8(zip[data])) as { levels: unknown[]; assets: { path: string }[]; credits: { packs: unknown[] } };
  expect(manifest.levels).toHaveLength(3);
  // Every bundled file is credited to its library pack (P3.5)
  const credits = strFromU8(zip['CREDITS.txt']);
  expect(manifest.credits.packs.length).toBeGreaterThan(0);
  for (const asset of manifest.assets) expect(credits).toContain(`(${asset.path})`);
  expect(strFromU8(zip['THIRD_PARTY_NOTICES.txt'])).toContain('three.js');
  expect(strFromU8(zip['LICENSE-runtime.txt'])).toContain('MIT License');
  expect(strFromU8(zip['README.txt'])).toContain('PUBLISH ON ITCH.IO');
  await done.getByRole('button', { name: 'Close' }).click();
  await expect(done).toHaveCount(0);
});

test('a project with an unlicensed upload lists the problem and downloads nothing', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');

  // A project file with an upload from before the editor recorded licenses
  const doc = (await page.evaluate(() => window.__gcsProbes!.projectDocument!())) as {
    levels: { data: { floorTextures: string[][] } }[];
    userAssets: unknown[];
  };
  const sha = crypto.createHash('sha256').update(PNG).digest('hex');
  const id = `tex-${sha.slice(0, 16)}`;
  doc.levels[0].data.floorTextures[2][2] = id;
  doc.userAssets = [
    {
      id,
      name: 'Old Upload',
      mimeType: 'image/png',
      sha256: sha,
      size: PNG.length,
      license: 'other',
      attribution: 'Uploaded before the editor recorded licenses.',
      data: PNG.toString('base64'),
    },
  ];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-export-')), 'old-upload.gcs.json');
  fs.writeFileSync(file, JSON.stringify(doc));
  await page.getByLabel('Open project file').setInputFiles(file);
  await expect(page.getByText(/Opened '.*' \(1 levels\)/)).toBeVisible();

  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Export Game' }).click();
  const problems = page.getByRole('dialog', { name: 'Fix these before exporting' });
  await expect(problems).toBeVisible();
  await expect(problems.getByText('Old Upload')).toBeVisible();
  await expect(problems.getByText(/uploaded before the editor asked for a license/)).toBeVisible();
  await problems.getByRole('button', { name: 'Close' }).click();
  await expect(problems).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
});

test('Project Settings changes the title and the export file name, as one undo step', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /^Project Settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Project Settings' });
  await dialog.getByLabel('Title').fill('Night Shift');
  await dialog.getByLabel('Export file name').fill('');
  await expect(dialog.getByText(/Exports as night-shift-\d+\.\d+\.\d+\.zip/)).toBeVisible();
  await dialog.getByLabel('Export file name').fill('Bad Name');
  await expect(dialog.getByRole('alert')).toContainText('lowercase letters');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('Export file name').fill('night-shift');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);

  const read = () => page.evaluate(() => window.__gcsProbes!.projectDocument!() as { meta: { title: string }; export: { slug: string } });
  expect((await read()).meta.title).toBe('Night Shift');
  expect((await read()).export.slug).toBe('night-shift');
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await read()).meta.title).not.toBe('Night Shift');
  expect((await read()).export.slug).not.toBe('night-shift');
});
