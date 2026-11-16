import type { Page } from '@playwright/test';
import { expect, test, waitForGcsEvent } from './fixtures';

// A crash in one panel shows a recoverable error view, keeps the project, and offers a recovery
// download (release plan P6.1, E-08). The fault is injected through a debug-only flag.

test.describe.configure({ timeout: 180_000 });
// Firefox logs the injected error as just "Error", without its message
test.use({ expectedProblems: [/E2E fault|^console\.error: Error$/] });

type Doc = { id: string; levels: { data: { grid: number[][] } }[] };
const project = (page: Page) => page.evaluate(() => window.__gcsProbes!.projectDocument!() as Doc);

async function clickMapCell(page: Page, row: number, col: number) {
  const canvas = page.getByLabel(/^2D Grid Map \d+ by \d+$/);
  const size = Number(/(\d+) by/.exec((await canvas.getAttribute('aria-label'))!)![1]);
  const box = (await canvas.boundingBox())!;
  const cell = (box.width - 22) / size;
  await canvas.click({ position: { x: 22 + (col + 0.5) * cell, y: 22 + (row + 0.5) * cell } });
}

test('a crashed panel keeps the project, and its recovery file opens again', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await clickMapCell(page, 5, 5);
  const edited = await project(page);

  // The inspector throws on its next render
  await page.evaluate(() => {
    window.__gcsFault = 'inspector';
  });
  await clickMapCell(page, 6, 6);
  const alert = page.getByRole('alert').filter({ hasText: 'The inspector stopped working.' });
  await expect(alert).toBeVisible();

  // The rest of the editor works and the project is intact
  const afterCrash = await project(page);
  expect(afterCrash.id).toBe(edited.id);
  expect(afterCrash.levels[0].data.grid[5][5]).toBe(edited.levels[0].data.grid[5][5]);
  expect(afterCrash.levels[0].data.grid[6][6]).not.toBe(edited.levels[0].data.grid[6][6]);
  await expect(page.getByRole('button', { name: /^Problems: [1-9]/ })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await alert.getByRole('button', { name: 'Download recovery file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-recovery\.gcs\.json$/);
  const file = await download.path();

  // The panel comes back once the fault is gone
  await page.evaluate(() => {
    window.__gcsFault = undefined;
  });
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole('complementary', { name: 'Properties and Asset Library' })).toBeVisible();

  // The recovery file opens as a project
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New Blank Project' }).click();
  await page.getByLabel('Open project file').setInputFiles(file);
  await expect(page.getByText(/File: Opened '/)).toBeVisible();
  // The log line can appear before the opened project replaces the blank one
  await expect.poll(async () => (await project(page)).levels[0].data.grid).toEqual(afterCrash.levels[0].data.grid);
});

test('uncaught errors are listed under Problems', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('E2E fault in a timer');
    });
    void Promise.reject(new Error('E2E fault in a promise'));
  });
  await page.getByRole('button', { name: /^Problems: 2/ }).click();
  const panel = page.getByRole('dialog', { name: 'Problems' });
  await expect(panel.getByText('E2E fault in a timer')).toBeVisible();
  await expect(panel.getByText('E2E fault in a promise')).toBeVisible();
});
