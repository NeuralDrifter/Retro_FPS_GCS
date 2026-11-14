import { expect, test, waitForGcsEvent } from './fixtures';

// Playtest must not feed the running game back into the editor (release plan P1.7): the world is
// built once, and walking around does not re-render App.

declare global {
  interface Window {
    __longTasks?: number[];
  }
}

const probe = (page: import('@playwright/test').Page, name: string) =>
  page.evaluate((key) => window.__gcsProbes?.[key]?.() as number | undefined, name);

test('a 10 s playtest walk builds the world once and barely re-renders the editor', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');

  // The default preset's start event locks a door and posts a message: a sim change at tick 1.
  await page.getByRole('button', { name: 'Test Play' }).click();
  await waitForGcsEvent(page, 'first-frame');
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks!.push(entry.duration);
    }).observe({ type: 'longtask' });
  });
  const statusBefore = await page.locator('footer, [class*="status"]').first().innerText();
  const rendersBefore = (await probe(page, 'appRenders'))!;

  const hold = async (key: string, ms: number) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
  };
  await hold('KeyW', 2000);
  await page.keyboard.press('KeyE');
  await hold('KeyD', 1000);
  await hold('KeyW', 2000);
  await page.keyboard.press('KeyE');
  await hold('KeyA', 1000);
  await hold('KeyS', 2000);
  await hold('KeyW', 2000);

  const renders = (await probe(page, 'appRenders'))! - rendersBefore;
  const worldBuilds = await probe(page, 'runtimeWorldBuilds');
  const longTasks = await page.evaluate(() => window.__longTasks ?? []);
  const statusAfter = await page.locator('footer, [class*="status"]').first().innerText();

  console.log(`App renders during walk: ${renders}; world builds: ${worldBuilds}; long tasks (ms): ${longTasks.map((d) => Math.round(d)).join(', ') || 'none'}`);
  expect(statusAfter, 'the player moved').not.toEqual(statusBefore);
  expect(worldBuilds, 'world builds').toBe(1);
  expect(renders, 'App renders during the walk').toBeLessThanOrEqual(5);
});
