import { expect, test, waitForGcsEvent } from './fixtures';

// The editor uses one pinned version of the asset library from its Pages site (release plan P2.7)

// CI runners are about three times slower than a desktop, so these flows need more than 60 s there
test.describe.configure({ timeout: 180_000 });

const LIBRARY = 'https://neuraldrifter.github.io/Retro_FPS_GCS-assets/';

test('the pinned library loads, and the texture browser stays within 60 requests', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(LIBRARY)) requests.push(r.url().slice(LIBRARY.length));
  });
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 30_000 });

  // Only the pinned version's index and pack list, and content-named files, are ever requested
  for (const url of requests) expect(url).toMatch(/^(?:v\d+\.\d+\/(?:index|packs)\.json|(?:files|thumbs)\/[0-9a-f]{16}\.\w+)$/);

  const before = requests.length;
  await page.getByRole('button', { name: 'Asset Library' }).click();
  await page.waitForLoadState('networkidle');
  const opened = requests.slice(before);
  expect(opened.length).toBeLessThanOrEqual(60);
  // The grid shows thumbnails, not the full textures
  expect(opened.filter((u) => u.startsWith('files/') && u.endsWith('.webp'))).toEqual([]);
});

test('New from Sample opens the Proving Grounds campaign (P2.8)', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds' \(3 levels\)/)).toBeVisible();
  await expect(page.getByLabel('Select Gameplay Level').locator('option')).toHaveCount(3);
  const doc = await page.evaluate(() => window.__gcsProbes!.projectDocument!() as { id: string; meta: { title: string } });
  expect(doc.meta.title).toBe('Proving Grounds');
  expect(doc.id).not.toBe('proving-grounds');

  // Test Play starts on level 1
  await page.getByRole('button', { name: 'Test Play' }).click();
  await waitForGcsEvent(page, 'first-frame');
});
