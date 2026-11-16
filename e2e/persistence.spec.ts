import type { Page } from '@playwright/test';
import { expect, test, waitForGcsEvent } from './fixtures';

// Browser storage, autosave, recovery and the one-editing-tab rule (release plan P2.5).

// Two editor pages and a real autosave wait need more than the default 60 s on CI
test.describe.configure({ timeout: 180_000 });

type Doc = { id: string; meta: { title: string }; levels: { data: { grid: number[][] } }[] };
const project = (page: Page) => page.evaluate(() => window.__gcsProbes!.projectDocument!() as Doc);

async function clickMapCell(page: Page, row: number, col: number) {
  const canvas = page.getByLabel(/^2D Grid Map \d+ by \d+$/);
  const size = Number(/(\d+) by/.exec((await canvas.getAttribute('aria-label'))!)![1]);
  const box = (await canvas.boundingBox())!;
  const cell = (box.width - 22) / size;
  await canvas.click({ position: { x: 22 + (col + 0.5) * cell, y: 22 + (row + 0.5) * cell } });
}

async function openEditor(page: Page) {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
}

test('recovery restores the last autosave after the page closes without unloading', async ({ page }) => {
  await openEditor(page);
  await clickMapCell(page, 5, 5);
  await clickMapCell(page, 6, 6);
  const edited = await project(page);
  // The autosave runs 5 s after the last change
  await page.waitForTimeout(6_500);
  await page.close({ runBeforeUnload: false });

  const reopened = await page.context().newPage();
  await reopened.addInitScript(() => {
    window.__GCS_DEBUG__ = true;
    window.__gcsEvents = [];
    window.addEventListener('gcs:editor-ready', () => window.__gcsEvents!.push('editor-ready'));
  });
  await openEditor(reopened);
  const dialog = reopened.getByRole('dialog', { name: 'Recover unsaved work?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recover' }).click();
  await expect(dialog).toBeHidden();
  const recovered = await project(reopened);
  expect(recovered.id).toBe(edited.id);
  expect(recovered.levels[0].data.grid).toEqual(edited.levels[0].data.grid);
  await reopened.close();
});

test('a second tab on the same project opens read-only', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Saved '.*' to browser storage/)).toBeVisible();
  const title = (await project(page)).meta.title;

  const second = await page.context().newPage();
  await second.addInitScript(() => {
    window.__GCS_DEBUG__ = true;
    window.__gcsEvents = [];
    window.addEventListener('gcs:editor-ready', () => window.__gcsEvents!.push('editor-ready'));
  });
  await openEditor(second);
  await second.getByRole('button', { name: 'File' }).click();
  await second.getByRole('menuitem', { name: title }).click();
  await expect(second.getByRole('status').filter({ hasText: 'Read-only' })).toBeVisible();

  // Edits are refused in the read-only tab
  const before = JSON.stringify(await project(second));
  await clickMapCell(second, 5, 5);
  expect(JSON.stringify(await project(second))).toBe(before);
  await expect(second.getByText(/Read-only: this project is open for editing in another tab/).first()).toBeVisible();
  await second.close();
});

test('a warning appears when browser storage passes 80% of the quota', async ({ page }) => {
  await page.addInitScript(() => {
    // On the prototype: WebKit ignores a property defined on the navigator.storage instance
    Object.defineProperty(StorageManager.prototype, 'estimate', {
      configurable: true,
      value: async () => ({ usage: 85_000_000, quota: 100_000_000 }),
    });
  });
  await openEditor(page);
  await expect(page.getByRole('status').filter({ hasText: 'Storage nearly full' })).toBeVisible();
});

test('a downloaded project file opens again with the same levels', async ({ page }) => {
  await openEditor(page);
  await clickMapCell(page, 5, 5);
  const before = await project(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Download Project File' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.gcs\.json$/);
  const file = await download.path();

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Blank Project' }).click();
  await expect.poll(async () => (await project(page)).id).not.toBe(before.id);

  await page.getByLabel('Open project file').setInputFiles(file);
  await expect(page.getByText(/Opened '.*' \(1 levels\)/)).toBeVisible();
  const reopened = await project(page);
  expect(reopened.levels[0].data.grid).toEqual(before.levels[0].data.grid);
});
