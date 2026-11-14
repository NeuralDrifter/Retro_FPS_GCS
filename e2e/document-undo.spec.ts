import type { Page } from '@playwright/test';
import { expect, test, waitForGcsEvent } from './fixtures';

// Every kind of project edit goes through the document store, so one undo history covers the
// map, events, world settings and campaign (release plan P2.4).

/** The project document, as canonical text to compare */
const project = (page: Page) => page.evaluate(() => JSON.stringify(window.__gcsProbes?.projectDocument?.()));
const activeLevelId = (page: Page) => page.evaluate(() => window.__gcsProbes?.activeLevelId?.() as string);

/** Clicks the center of one cell of the 2D map */
async function clickMapCell(page: Page, row: number, col: number) {
  const canvas = page.getByLabel(/^2D Grid Map \d+ by \d+$/);
  const label = (await canvas.getAttribute('aria-label'))!;
  const size = Number(/(\d+) by/.exec(label)![1]);
  const box = (await canvas.boundingBox())!;
  const ruler = 22; // RULER_PX in MapEditor2D
  const cell = (box.width - ruler) / size;
  await canvas.click({ position: { x: ruler + (col + 0.5) * cell, y: ruler + (row + 0.5) * cell } });
}

test('edit, undo and redo across map, events, world settings and campaign', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  const inspector = page.getByRole('complementary', { name: 'Properties and Asset Library' });
  const levelSelect = page.getByLabel('Select Gameplay Level');
  const states = [await project(page)];

  // Map: the toggle tool turns an empty cell into a wall (or a wall into an empty cell)
  await clickMapCell(page, 5, 5);
  await expect.poll(() => project(page)).not.toBe(states[0]);
  states.push(await project(page));

  // Events: make the selected cell the level exit
  await inspector.getByRole('button', { name: 'World' }).click();
  await inspector.getByRole('button', { name: /as Level Exit/ }).click();
  await expect.poll(() => project(page)).not.toBe(states[1]);
  states.push(await project(page));
  expect(states[1]).not.toContain('evt_exit_');
  expect(states[2]).toContain('evt_exit_');

  // World settings: another skybox theme
  await inspector.getByRole('button', { name: /Crimson Dusk/ }).click();
  await expect.poll(() => project(page)).not.toBe(states[2]);
  states.push(await project(page));
  expect(states[3]).toContain('crimson-dusk');

  // Campaign: a second level, which the editor switches to
  const firstLevel = await activeLevelId(page);
  await inspector.getByRole('button', { name: 'Add Level' }).click();
  await expect(levelSelect.locator('option')).toHaveCount(2);
  states.push(await project(page));
  expect(await activeLevelId(page)).not.toBe(firstLevel);

  // Undo all four, newest first; each step restores the document exactly
  for (let i = states.length - 2; i >= 0; i--) {
    await page.keyboard.press('Control+z');
    await expect.poll(() => project(page)).toBe(states[i]);
  }
  await expect(levelSelect.locator('option')).toHaveCount(1);
  expect(await activeLevelId(page)).toBe(firstLevel);
  await expect(page.getByRole('banner').getByRole('button', { name: /^Undo/ })).toBeDisabled();

  // Redo all four
  for (let i = 1; i < states.length; i++) {
    await page.keyboard.press('Control+y');
    await expect.poll(() => project(page)).toBe(states[i]);
  }
  await expect(levelSelect.locator('option')).toHaveCount(2);
});

test('a drag of a map tool is one undo step, and play starts from the edited level', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  const undoDepth = () => page.evaluate(() => window.__gcsProbes?.undoDepth?.() as number);
  const before = await project(page);

  // Drag the wall tool along row 7, from column 1 to column 5
  await page.getByRole('button', { name: 'Draw Solid Wall Block' }).click();
  const canvas = page.getByLabel(/^2D Grid Map \d+ by \d+$/);
  const size = Number(/(\d+) by/.exec((await canvas.getAttribute('aria-label'))!)![1]);
  const box = (await canvas.boundingBox())!;
  const cell = (box.width - 22) / size;
  const at = (row: number, col: number) => ({ x: box.x + 22 + (col + 0.5) * cell, y: box.y + 22 + (row + 0.5) * cell });
  await page.mouse.move(at(7, 1).x, at(7, 1).y);
  await page.mouse.down();
  for (let col = 2; col <= 5; col++) await page.mouse.move(at(7, col).x, at(7, col).y, { steps: 3 });
  await page.mouse.up();

  await expect.poll(undoDepth).toBe(1);
  const grid = await page.evaluate(() => {
    const doc = window.__gcsProbes!.projectDocument!() as { levels: { data: { grid: number[][] } }[] };
    return doc.levels[0].data.grid[7];
  });
  expect(grid.slice(1, 6)).toEqual([1, 1, 1, 1, 1]);

  await page.keyboard.press('Control+z');
  await expect.poll(() => project(page)).toBe(before);

  await page.keyboard.press('Control+y');
  await page.getByRole('button', { name: 'Test Play' }).click();
  await waitForGcsEvent(page, 'first-frame');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(canvas).toBeVisible();
  expect(await undoDepth()).toBe(1);
});
