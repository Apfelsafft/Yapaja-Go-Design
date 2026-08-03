/**
 * Playwright config for the E09-T6 Sandbox-Escape- & Sicherheits-Testsuite
 * (`e2e/security/`, Wargame W-10, docs/07 §7).
 *
 * SEPARATE from `apps/web/playwright.config.ts` on purpose:
 *  - the suite lives at `e2e/security/` per the task spec, not under
 *    `apps/web/e2e/`,
 *  - it boots exactly ONE dedicated Core (see `support/globalSetup.ts`)
 *    instead of the main harness's ~17, so the security CI job stays well
 *    under the E2E job's runtime,
 *  - it must never share a Core with another spec: it installs a hostile
 *    add-on, disables it and replays its token.
 *
 * Everything reusable IS reused (`apps/web/e2e/support/coreProcess.ts`,
 * `.../chromium.ts`) -- this is a second entry point, not a second harness.
 *
 * `fullyParallel: false` + one worker: every spec in this suite reads the
 * SHARED `GET /api/v1/security/events` ring buffer of the SAME Core and
 * asserts on what is (and is not) in it, so overlapping runs would make the
 * "…and nothing else fired" assertions meaningless.
 */

import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolvePreinstalledChromium } from '../../apps/web/e2e/support/chromium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A security assertion is NEVER retried into green (same rule the
  // Golden-Route safety gate follows, docs/07 §3b).
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  globalSetup: join(__dirname, 'support/globalSetup.ts'),
  outputDir: join(__dirname, '.tmp', 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // BLOCKED, and this is load-bearing: this suite's Core enforces
    // `API_AUTH_TOKEN`, so the browser-side specs inject the HOST's bearer
    // token with `page.route`. Playwright cannot intercept requests a
    // registered Service Worker makes on the page's behalf -- once the PWA SW
    // (E07-T5) claimed the page, `GET /api/v1/addons` went out unauthenticated
    // and 401'd, which made `AddonHost` drop the add-on mid-test. Blocking the
    // SW keeps every request interceptable. (The known side effect -- see
    // `apps/web/e2e/addon-ui.spec.ts` -- is that Playwright's SW
    // instrumentation script throws a `SecurityError` inside the opaque-origin
    // add-on iframe; this suite deliberately does not assert on `pageerror`,
    // and that exception is in an injected script, not in the fixture's own.)
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'security',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: resolvePreinstalledChromium(),
          args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
