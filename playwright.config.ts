import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build, served under the same
 * subpath GitHub Pages uses. Build first with `npm run build:pages`
 * (`npm run test:e2e` does both).
 *
 * Chromium runs on every push. Set E2E_ALL_BROWSERS=1 to add Firefox and WebKit
 * (the nightly job does this).
 */

const PORT = 4173;
const BASE_PATH = '/Retro_FPS_GCS/';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';
/**
 * The functional tests' window: smaller than the 1280x720 desktop default, since every frame is
 * rendered in software and its cost grows with the pixel count. No test compares images; a visual
 * check would set its own representative size.
 */
const VIEWPORT = { width: 1024, height: 640 };
/** E2E_MEMORY_REPORT=1 adds the process-tree memory report (e2e/reporters/memory-reporter.ts) */
const memoryReport = process.env.E2E_MEMORY_REPORT === '1' ? [['./e2e/reporters/memory-reporter.ts'] as const] : [];

export default defineConfig({
  testDir: 'e2e',
  // Refuses to start while another e2e run is active (see e2e/global-setup.ts)
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // Each worker runs a browser rendering WebGL in software (SwiftShader), which costs about a
  // gigabyte at its peak. CI runners have 16 GB to themselves; a desktop shares its memory with
  // everything else, so local runs use one worker unless E2E_WORKERS says otherwise.
  workers: process.env.CI ? 2 : Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ...memoryReport] : [['list'], ...memoryReport],
  use: {
    baseURL: `${ORIGIN}${BASE_PATH}`,
    // Traces keep a snapshot of every step in memory until the test ends; CI keeps them for
    // failures, local runs only when E2E_TRACE=1
    trace: process.env.CI || process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: VIEWPORT,
        // CI runners have no GPU; SwiftShader gives headless Chromium a software WebGL.
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
    ...(allBrowsers
      ? [
          {
            name: 'firefox',
            use: {
              ...devices['Desktop Firefox'],
              viewport: VIEWPORT,
              // Headless Firefox cannot create a WebGL context on GPU-less CI machines.
              // CI runs it headed inside xvfb (E2E_FIREFOX_HEADED=1), where Mesa provides software GL.
              headless: process.env.E2E_FIREFOX_HEADED !== '1',
              launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
            },
          },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
        ]
      : []),
  ],
  webServer: {
    // A small static server (e2e/serve-dist.ts) instead of `vite preview`, which costs about 220 MB
    command: 'node e2e/serve-dist.ts',
    url: `${ORIGIN}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
  },
});
