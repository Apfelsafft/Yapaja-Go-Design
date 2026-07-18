import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the pre-installed Chromium binary under PLAYWRIGHT_BROWSERS_PATH.
 *
 * This environment ships a specific Chromium revision at
 * PLAYWRIGHT_BROWSERS_PATH (see repo README / task notes) that does not
 * necessarily match the revision `@playwright/test`'s own browser
 * auto-resolution expects, and `playwright install` must not be run here.
 * Pointing `executablePath` directly at the installed binary sidesteps that
 * mismatch. Falls back to Playwright's own resolution (`undefined`) if the
 * env var isn't set, e.g. on a machine with a normal `playwright install`.
 */
function resolvePreinstalledChromium(): string | undefined {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!browsersPath || !existsSync(browsersPath)) {
    return undefined;
  }
  const candidateDirs = readdirSync(browsersPath).filter(
    (name) => name.startsWith('chromium-') && !name.startsWith('chromium_headless_shell'),
  );
  for (const dir of candidateDirs) {
    const candidate = join(browsersPath, dir, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  timeout: 30_000,
  globalSetup: join(__dirname, 'e2e/support/globalSetup.ts'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Block the PWA Service Worker (E07-T5) by DEFAULT for every spec. The SW
    // is registered globally from `main.tsx`/`shell/main.tsx` with
    // `clientsClaim`, so without this it takes control of every spec's page
    // and routes all fetches (incl. live `/api/*`) through its worker thread.
    // Harmless in production, but the extra per-fetch hop + install/activate
    // work under CI's 2-worker contention tips the tight-budget specs
    // (search/favorites/gps-loss assert with 2 s timeouts) over the edge. The
    // specs that actually EXERCISE the SW opt back in with
    // `test.use({ serviceWorkers: 'allow' })` (`pwa.spec.ts`, and the single
    // W-19 recovery-with-SW test in `nav-control.spec.ts`).
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: resolvePreinstalledChromium(),
          // Headless Chromium needs software WebGL (SwiftShader) for
          // MapLibre's canvas to actually initialize a GL context.
          args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
