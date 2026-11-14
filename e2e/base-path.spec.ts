import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, waitForGcsEvent } from './fixtures';

// The preview serves the editor under /Retro_FPS_GCS/, as GitHub Pages does.
// These specs catch fetches that ignore that base path.

const DRACO_CUBE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'draco-cube.glb');
const DRACO_MODEL_ID = 'e2e-draco-cube';

test('single-HTML export works from the Pages base path', async ({ page }) => {
  // The export downloads every referenced texture from the asset library.
  test.slow();
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');

  await page.getByRole('button', { name: 'Export Game' }).click();
  await page.getByRole('button', { name: /Single Offline HTML/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Single HTML' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
});

test('a Draco model loads its decoder from the base path', async ({ page, baseURL }) => {
  // Register a Draco-compressed cube through the public asset manifest.
  await page.route('**/assets/manifest.json', (route) =>
    route.fulfill({
      json: {
        textures: [],
        models: [
          {
            id: DRACO_MODEL_ID,
            name: 'E2E Draco Cube',
            file: 'assets/models/e2e-draco-cube.glb',
            category: 'decorations',
            isEnemy: false,
          },
        ],
      },
    })
  );
  await page.route('**/assets/models/e2e-draco-cube.glb', (route) =>
    route.fulfill({ path: DRACO_CUBE, contentType: 'model/gltf-binary' })
  );

  // Listen from the start: the editor may load a newly registered model before it is placed.
  const decoderUrl = new URL('draco/draco_decoder.wasm', baseURL).href;
  const decoderLoaded = page.waitForResponse((response) => response.url() === decoderUrl);
  const manifestLoaded = page.waitForResponse((response) => response.url().endsWith('/assets/manifest.json'));
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await manifestLoaded;

  // Save the current level, place the cube next to the spawn point, and load it back.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save JSON' }).click();
  const saved = JSON.parse(await streamToString(await (await downloadPromise).createReadStream()));
  const placed = addEntityToEveryLevel(saved, {
    id: 'e2e-draco-entity',
    row: 1,
    col: 2,
    blueprintId: 'supply-crate',
    modelAssetId: DRACO_MODEL_ID,
    name: 'E2E Draco Cube',
    yaw: 0,
    scale: 1,
    isEnemy: false,
  });
  expect(placed).toBeGreaterThan(0);

  await page.getByRole('banner').locator('input[type="file"]').setInputFiles({
    name: 'draco-level.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });

  await expect(page.getByText('Loaded Campaign JSON')).toBeVisible();
  const decoderResponse = await decoderLoaded;
  expect(decoderResponse.status()).toBe(200);
});

/** Adds the entity to every level object in a saved file; returns how many it changed. */
function addEntityToEveryLevel(node: unknown, entity: Record<string, unknown>): number {
  if (Array.isArray(node)) return node.reduce((sum, item) => sum + addEntityToEveryLevel(item, entity), 0);
  if (!node || typeof node !== 'object') return 0;
  const record = node as Record<string, unknown>;
  let count = 0;
  if (Array.isArray(record.grid) && Array.isArray(record.entities)) {
    record.entities.push({ ...entity });
    count += 1;
  }
  for (const value of Object.values(record)) count += addEntityToEveryLevel(value, entity);
  return count;
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}
