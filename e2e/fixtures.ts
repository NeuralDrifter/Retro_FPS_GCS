import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared fixtures for every e2e spec.
 *
 * The `page` fixture fails the test if, at any point, the page logs a console
 * error, throws an uncaught error, reports a CSP violation, or requests an
 * origin outside ALLOWED_EXTERNAL_ORIGINS. It also turns on the runtime's debug
 * events (`src/runtime/debugEvents.ts`) and records them for `waitForGcsEvent`.
 */

/** Origins other than the preview server that pages may contact. */
const ALLOWED_EXTERNAL_ORIGINS: readonly string[] = [
  // The asset library. P2.7 pins it and decides where it is served from.
  'https://raw.githubusercontent.com',
];

/**
 * Known problems that P0.5 fixes. P0.5 deletes this block; nothing else may be added to it.
 * - Google Fonts load from index.html.
 * - AssetFolderLoader fetches '/assets/manifest.json', which misses the Pages base path.
 */
const UNTIL_P0_5_ORIGINS: readonly string[] = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];
const UNTIL_P0_5_PROBLEMS: readonly RegExp[] = [/^HTTP 404: https?:\/\/[^/]+\/assets\/manifest\.json$/];

type GcsEventName = 'first-frame' | 'editor-ready';

declare global {
  interface Window {
    __GCS_DEBUG__?: boolean;
    __gcsEvents?: string[];
    __gcsCspViolations?: string[];
  }
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    const allowedOrigins = new Set([
      new URL(baseURL!).origin,
      ...ALLOWED_EXTERNAL_ORIGINS,
      ...UNTIL_P0_5_ORIGINS,
    ]);

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Load failures are reported with their URL by the response and requestfailed handlers.
      if (message.text().startsWith('Failed to load resource')) return;
      problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') return;
      if (!allowedOrigins.has(url.origin)) problems.push(`request outside allowlist: ${request.url()}`);
    });
    // The console only says "Failed to load resource"; this names the URL.
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('requestfailed', (request) => {
      problems.push(`request failed (${request.failure()?.errorText}): ${request.url()}`);
    });

    await page.addInitScript(() => {
      window.__GCS_DEBUG__ = true;
      window.__gcsEvents = [];
      window.__gcsCspViolations = [];
      for (const name of ['first-frame', 'editor-ready']) {
        window.addEventListener(`gcs:${name}`, () => window.__gcsEvents!.push(name));
      }
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__gcsCspViolations!.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
      });
    });

    await use(page);

    const cspViolations = await page
      .evaluate(() => window.__gcsCspViolations ?? [])
      .catch(() => [] as string[]);
    problems.push(...cspViolations.map((violation) => `CSP violation: ${violation}`));
    const unexpected = problems.filter((problem) => !UNTIL_P0_5_PROBLEMS.some((known) => known.test(problem)));
    expect(unexpected, 'browser problems recorded during the test').toEqual([]);
  },
});

/** Resolves once the page has dispatched `gcs:<name>` at least once since it loaded. */
export async function waitForGcsEvent(page: Page, name: GcsEventName): Promise<void> {
  await page.waitForFunction((eventName) => window.__gcsEvents?.includes(eventName), name);
}

export { expect };
