import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// E09-T6: the Chromium-binary resolution lives in `e2e/support/chromium.ts`
// so the dedicated security-suite config (`e2e/security/playwright.config.ts`)
// resolves the browser identically instead of duplicating it.
import { resolvePreinstalledChromium } from './e2e/support/chromium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
