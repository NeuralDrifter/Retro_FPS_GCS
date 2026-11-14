import { expect, test, waitForGcsEvent } from './fixtures';

// Switching between the 3D editor and Test Play creates and destroys a WebGL renderer each time.
// Ten round trips must not pile up contexts, textures or heap (release plan P1.8).

const CYCLES = 10;
const MAX_HEAP_GROWTH_BYTES = 30 * 1024 * 1024;

test('ten Edit, Play, Edit cycles release WebGL contexts, textures and memory', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'heap is read through the Chrome DevTools Protocol');
  // Ten playtests on software rendering, sharing CI's CPU with another heavy spec
  test.setTimeout(360_000);

  const contextWarnings: string[] = [];
  page.on('console', (message) => {
    if (/too many active webgl contexts/i.test(message.text())) contextWarnings.push(message.text());
  });

  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  const editorTextures = () =>
    page.evaluate(() => (window.__gcsProbes?.editorRenderer?.() as { textures: number } | undefined)?.textures);
  await expect.poll(editorTextures).toBeGreaterThan(0);
  // Let the first editor world finish loading its textures before taking the baseline
  await page.waitForTimeout(2000);
  const startTextures = (await editorTextures())!;

  const cdp = await page.context().newCDPSession(page);
  const heapUsed = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  const startHeap = await heapUsed();

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    await page.getByRole('button', { name: 'Test Play' }).click();
    await page.waitForFunction(
      (count) => (window.__gcsEvents ?? []).filter((e) => e === 'first-frame').length >= count,
      cycle
    );
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Test Play' })).toBeVisible();
    await expect.poll(editorTextures).toBeGreaterThan(0);
  }
  await page.waitForTimeout(2000);

  expect(contextWarnings, 'WebGL context warnings').toEqual([]);
  const endTextures = (await editorTextures())!;
  expect(Math.abs(endTextures - startTextures), `editor textures ${startTextures} -> ${endTextures}`).toBeLessThanOrEqual(2);
  const growth = (await heapUsed()) - startHeap;
  expect(growth, `heap grew ${(growth / 1024 / 1024).toFixed(1)} MB`).toBeLessThan(MAX_HEAP_GROWTH_BYTES);
});
