/**
 * [Perf] Kaltstart bis interaktive Karte -- Budget < 5 s (docs/00).
 *
 * Gemessen wird ab Navigationsbeginn (`performance.timeOrigin`) bis MapLibre
 * `loaded() && isStyleLoaded()` meldet. Damit enthaelt der Wert Netzwerk,
 * Bundle-Parsing, App-Boot, Style-Laden und den ersten Kachel-Render -- also
 * das, was ein Nutzer als "bis die Karte da ist" erlebt.
 *
 * KALT heisst kalt: je Iteration ein frischer BrowserContext (leerer
 * HTTP-Cache, leerer localStorage) und ein blockierter Service-Worker.
 *
 * Kennzahl je Lauf: interquartiles Mittel ueber `ITERATIONS` Iterationen
 * (siehe `statistics.ts` fuer die Begruendung -- Robustheit gegen einzelne
 * Scheduler-Ausreisser, ohne den Bestwert zu nehmen).
 */

import { test } from '@playwright/test';
import { PERF_CORE_BASE_URL, PERF_VIEWPORT } from './support/constants.js';
import {
  installColdStartProbe,
  installDegradation,
  readColdStartMs,
  throttleCpu,
} from './support/page.js';
import { recordAndAssert } from './support/measure.js';
import { interquartileMean, median, percentile } from './statistics.js';

const ITERATIONS = 5;

test('[Perf] Kaltstart bis interaktive Karte < 5 s (N100-Profil)', async ({ browser }) => {
  const samples: number[] = [];

  for (let i = 0; i < ITERATIONS; i += 1) {
    const context = await browser.newContext({
      viewport: { ...PERF_VIEWPORT },
      serviceWorkers: 'block',
    });
    try {
      const page = await context.newPage();
      await throttleCpu(context, page);
      await installDegradation(page);
      await installColdStartProbe(page);
      await page.goto(`${PERF_CORE_BASE_URL}/`, { timeout: 120_000 });
      samples.push(await readColdStartMs(page));
    } finally {
      await context.close();
    }
  }

  const value = interquartileMean(samples);
  recordAndAssert({
    id: 'cold_start_ms',
    value,
    samples: samples.map((s) => Math.round(s * 10) / 10),
    note:
      `${ITERATIONS} Kaltstarts, interquartiles Mittel; ` +
      `Median ${median(samples).toFixed(0)} ms, p95 ${percentile(samples, 0.95).toFixed(0)} ms`,
  });
});
