import { expect, test, waitForGcsEvent } from './fixtures';

// The export worker (release plan P3.3) zips the sample in a Web Worker: none of the export's own
// work on the main thread takes 50 ms or more, and exporting twice gives the same bytes. P3.4 adds
// the menu item; until then the e2e suite starts the export through a debug probe.
//
// The page-wide Long Tasks API cannot measure this here: in headless Chromium the editor's 3D
// view renders with software WebGL, which alone logs long tasks several times a second.

test.describe.configure({ timeout: 360_000 });

interface ExportSummary {
  fileName: string;
  sha256: string;
  size: number;
  fileCount: number;
  runtimeVersion: string;
  files: { path: string; size: number }[];
  stages: string[];
  mainThreadMaxMs: number;
}

test('the export worker zips the sample off the main thread, the same way twice', async ({ page }) => {
  await page.goto('./');
  await waitForGcsEvent(page, 'editor-ready');
  await expect(page.getByText(/Asset library v\d+\.\d+: \d+ textures and \d+ models\./)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'New from Sample' }).click();
  await expect(page.getByText(/Started a new project from the sample 'Proving Grounds'/)).toBeVisible();

  // Opening the sample loads its models, measures them and records their heights in the
  // document; wait until that is done, so both exports see the same project
  const docJson = () => page.evaluate(() => JSON.stringify(window.__gcsProbes!.projectDocument!()));
  let last = '';
  await expect
    .poll(async () => {
      const now = await docJson();
      const settled = now === last;
      last = now;
      return settled;
    }, { intervals: [2000], timeout: 120_000 })
    .toBe(true);

  const run = () => page.evaluate(async () => (await window.__gcsProbes!.exportGame!()) as ExportSummary);

  const summary = await run();
  expect(summary.fileName).toMatch(/^proving-grounds-\d+\.\d+\.\d+\.zip$/);
  expect(summary.stages).toEqual(['collect', 'download', 'runtime', 'package', 'zip']);
  const paths = summary.files.map((f) => f.path);
  expect(paths).toContain('index.html');
  expect(paths.some((p) => /^game\.[0-9a-f]{16}\.js$/.test(p))).toBe(true);
  expect(paths.filter((p) => /^data\/game\.[0-9a-f]{16}\.json$/.test(p))).toHaveLength(1);
  expect(paths.filter((p) => p.startsWith('assets/')).length).toBeGreaterThan(5);
  expect(paths.every((p) => /^(?:index\.html|game\.[0-9a-f]{16}\.js|data\/game\.[0-9a-f]{16}\.json|assets\/[0-9a-f]{16}\.(?:png|jpg|webp|glb)|draco\/\w+\.(?:js|wasm)|CREDITS\.txt|THIRD_PARTY_NOTICES\.txt|LICENSE-runtime\.txt|README\.txt)$/.test(p))).toBe(true);
  expect(paths).toEqual(expect.arrayContaining(['CREDITS.txt', 'THIRD_PARTY_NOTICES.txt', 'LICENSE-runtime.txt', 'README.txt']));
  expect(summary.fileCount).toBe(paths.length);
  expect(summary.mainThreadMaxMs).toBeLessThan(50);

  expect(await docJson()).toBe(last);
  const second = await run();
  expect(second.sha256).toBe(summary.sha256);
  expect(second.mainThreadMaxMs).toBeLessThan(50);
});
