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

type GcsEventName = 'first-frame' | 'editor-ready';

declare global {
  interface Window {
    __GCS_DEBUG__?: boolean;
    __gcsEvents?: string[];
    __gcsCspViolations?: string[];
    /** Debug runs only: names a panel that throws while rendering (src/editor/components/errors) */
    __gcsFault?: string;
  }
}

export const test = base.extend<{ page: Page; expectedProblems: RegExp[]; firstVisit: boolean }>({
  /** False (the default) marks the welcome screen as seen, so it does not cover the editor */
  firstVisit: [false, { option: true }],
  /** Errors a test causes on purpose (fault injection); matching problems are not failures */
  expectedProblems: [[], { option: true }],
  page: async ({ page, baseURL, expectedProblems, firstVisit }, use) => {
    const problems: string[] = [];
    const allowedOrigins = new Set([
      new URL(baseURL!).origin,
      ...ALLOWED_EXTERNAL_ORIGINS,
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

    if (!firstVisit) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('gcs:welcomed', '1');
        } catch {
          // Storage may be blocked; the welcome screen then shows
        }
      });
    }
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
    const unexpected = problems.filter((p) => !expectedProblems.some((re) => re.test(p)));
    expect(unexpected, 'browser problems recorded during the test').toEqual([]);
  },
});

/** Resolves once the page has dispatched `gcs:<name>` at least once since it loaded. */
export async function waitForGcsEvent(page: Page, name: GcsEventName): Promise<void> {
  await page.waitForFunction((eventName) => window.__gcsEvents?.includes(eventName), name);
}

export { expect };
