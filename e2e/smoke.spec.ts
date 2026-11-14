import { expect, test, waitForGcsEvent } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
});

test('the editor loads', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Export Game' })).toBeVisible();
  await expect(page.getByLabel('Load Level Preset')).toBeVisible();
});

test('a preset opens', async ({ page }) => {
  await page.getByLabel('Load Level Preset').selectOption('techbase-outpost');
  await expect(page.getByLabel('Select Gameplay Level')).toContainText(
    'Techbase Outpost: Lifts and Ambushes'
  );
});

test('Test Play renders a first frame', async ({ page }) => {
  await page.getByRole('button', { name: 'Test Play' }).click();
  await waitForGcsEvent(page, 'first-frame');
  await expect(page.locator('canvas').first()).toBeVisible();
});

test('the export dialog opens', async ({ page }) => {
  await page.getByRole('button', { name: 'Export Game' }).click();
  await expect(page.getByRole('heading', { name: 'Export Standalone Game' })).toBeVisible();
});

// Proves the shared fixture catches problems: this test must fail.
test('a console error fails the test', async ({ page }) => {
  test.fail();
  await page.evaluate(() => console.error('planted error'));
});
