/**
 * Playwright-Config der E10-T2-Performance-Suite (`e2e/perf/`).
 *
 * Eigenes Projekt neben `apps/web/playwright.config.ts` -- aus denselben
 * Gruenden wie bei `e2e/security/playwright.config.ts`, plus einem, der hier
 * entscheidend ist:
 *
 *  - `retries: 0`. Eine wiederholte Messung ist keine Messung. Wuerde ein zu
 *    langsamer Kaltstart beim zweiten Versuch gruen werden, waere die Zahl im
 *    Report der beste statt der typische Wert -- genau die Sorte
 *    Schoenrechnen, die E10-T2 ausdruecklich verbietet.
 *  - `workers: 1`, `fullyParallel: false`. Zwei parallel messende Browser auf
 *    denselben vCPUs messen einander, nicht das Produkt.
 *  - Eigener Core auf Port 4350 statt der ~17 der Haupt-Harness: die
 *    RSS-Messung braucht genau EINEN Prozess, dem alle Last dieser Suite
 *    zuzuordnen ist.
 *
 * Wiederverwendet wird alles, was es schon gibt: Chromium-Aufloesung und
 * Core-Start kommen aus `apps/web/e2e/support/*`.
 */

import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolvePreinstalledChromium } from '../../apps/web/e2e/support/chromium.js';
import { PERF_VIEWPORT, soakDurationS, soakEnabled } from './support/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Der Soak-Lauf braucht seine ganze Laufzeit plus Aufbau/Abbau. */
const SOAK_TIMEOUT_MS = soakEnabled() ? (soakDurationS() + 300) * 1000 : 0;

export default defineConfig({
  testDir: __dirname,
  // NUR `*.spec.ts`. Playwrights Default-`testMatch` wuerde auch `*.test.ts`
  // einsammeln -- und das sind hier die VITEST-Unit-Tests der Auswertungslogik
  // (`evaluate.test.ts`, `statistics.test.ts`, `trend.test.ts`, `soak.test.ts`),
  // die im Wurzel-`npx vitest run` laufen. Beide Laeufe teilen sich dieses
  // Verzeichnis, nicht aber ihre Dateien.
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Eine Messung wird NIE wiederholt (siehe Kommentarkopf).
  retries: 0,
  reporter: 'list',
  timeout: Math.max(300_000, SOAK_TIMEOUT_MS),
  globalSetup: join(__dirname, 'support/globalSetup.ts'),
  globalTeardown: join(__dirname, 'support/globalTeardown.ts'),
  outputDir: join(__dirname, '.tmp', 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { ...PERF_VIEWPORT },
    // Wie in der Haupt-Harness: der PWA-Service-Worker wuerde jede Messung
    // durch seinen Worker-Thread umleiten und den Kaltstart je nach
    // Install-/Activate-Timing verfaelschen. Der Kaltstart, den docs/00
    // meint, ist der erste Aufruf ohne warmen Cache.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'perf',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { ...PERF_VIEWPORT },
        launchOptions: {
          executablePath: resolvePreinstalledChromium(),
          args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
