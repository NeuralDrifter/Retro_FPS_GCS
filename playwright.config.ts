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

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // Each worker renders WebGL in software (SwiftShader), which is CPU-bound;
  // more than two workers slows every test instead of finishing sooner.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `${ORIGIN}${BASE_PATH}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
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
              // Headless Firefox cannot create a WebGL context on GPU-less CI machines.
              // CI runs it headed inside xvfb (E2E_FIREFOX_HEADED=1), where Mesa provides software GL.
              headless: process.env.E2E_FIREFOX_HEADED !== '1',
              launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
            },
          },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: {
    command: `npx vite preview --base=${BASE_PATH} --port=${PORT} --strictPort --host=127.0.0.1`,
    url: `${ORIGIN}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
  },
});
