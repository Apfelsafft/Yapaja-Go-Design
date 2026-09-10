/**
 * Eigener Playwright-Lauf NUR fuer die Bilder und Filme der Dokumentation.
 *
 * Getrennt von `playwright.config.ts`, weil das hier nichts prueft, sondern
 * aufnimmt: es gehoert nicht in die CI, wo es bei jedem Pull Request neue
 * Binaerdateien erzeugen wuerde. Aufruf von Hand:
 *
 *     pnpm --filter @yapaia/web exec playwright test -c docs-media.config.ts
 *
 * Der `globalSetup` ist derselbe wie fuer die Testsuite -- er baut die App
 * und startet die Core-Prozesse. Aufgenommen wird also die ECHTE Anwendung.
 */

import { defineConfig, devices } from '@playwright/test';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { resolvePreinstalledChromium } from './e2e/support/chromium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e-docs',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
  globalSetup: join(__dirname, 'e2e/support/globalSetup.ts'),
  use: {
    serviceWorkers: 'block',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
  },
  projects: [
    {
      name: 'chromium',
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
