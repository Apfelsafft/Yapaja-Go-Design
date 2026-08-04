/**
 * [Perf] WS-Latenz Position -> UI -- Budget < 500 ms (docs/00).
 *
 * Gemessen wird der VOLLE Weg, den docs/00 meint ("GPS-Update -> UI"):
 * vom Absenden eines Fixes an `POST /api/v1/position/browser` bis zu dem
 * Moment, in dem GENAU DIESE Position im UI-Store der Seite steht
 * (`window.__yapajaPositionStore`). Dazwischen liegen HTTP-Annahme,
 * `PositionService`, der Event-Bus, die WS-Verteilung und der
 * Store-Update -- also alles ausser dem GPS-Empfaenger selbst.
 *
 * Vier Dinge am Messaufbau sind wichtig und wurden beim Bauen dieser Spec
 * gelernt statt geraten:
 *
 *  1. Der Core drosselt die Positions-Veroeffentlichung auf 1 Hz
 *     (`apps/web/e2e/drive.spec.ts` dokumentiert das ebenfalls). Fixes duerfen
 *     deshalb nicht schneller als ~1,2 s aufeinander folgen -- sonst misst man
 *     das Drosselfenster und nicht die Latenz.
 *  2. Jeder Fix traegt eine EINDEUTIGE Breite. Der Store-Abgleich erfolgt
 *     gegen genau diesen Wert; eine Coalescing- oder Reihenfolgeverschiebung
 *     kann die Messung damit nicht unbemerkt guenstiger machen.
 *  3. Die Fixes liegen nur MILLIMETER auseinander (`LAT_STEP`), nicht
 *     hunderte Meter. Grund, real gemessen: bei ~145 m Sprung je Fix
 *     zentriert Follow-Me die Karte neu, MapLibre laedt und rastert neue
 *     Kacheln -- und weil dieser Container in Software rastert, dauert ein
 *     Frame ~110 ms. Genau diese ~110 ms tauchten dann in 5 von 20
 *     Stichproben als Ausreisser auf (p95 sprang von 8 ms auf 113 ms), und
 *     die Laufstreuung lag bei 35 %. Gemessen wurde damit die Rasterzeit des
 *     Messcontainers, nicht der Datenweg Position -> UI, den docs/00 meint.
 *     Repariert wurde der MESSAUFBAU: die Position aendert sich weiterhin bei
 *     jedem Fix (die Messung bleibt korrelierbar), aber so wenig, dass kein
 *     Kachelwechsel ausgeloest wird.
 *  4. `WARMUP` Fixes vorab, die NICHT gezaehlt werden: der erste Fix nach
 *     dem Laden trifft eine Seite, die noch Kacheln nachlaedt.
 *
 * Kennzahl je Lauf: interquartiles Mittel (siehe `statistics.ts`). p95 und
 * Maximum werden BERICHTET, aber nicht gegatet -- ein p95 aus 25 Stichproben
 * traegt die 15-%-Streuungszusage nicht, und das offen zu sagen ist besser,
 * als eine wackelige Zahl zum Merge-Gate zu machen.
 */

import { test } from '@playwright/test';
import { PERF_CORE_BASE_URL, PERF_VIEWPORT } from './support/constants.js';
import {
  installDegradation,
  releasePositionSource,
  throttleCpu,
  waitForMapLoaded,
} from './support/page.js';
import { recordAndAssert } from './support/measure.js';
import { interquartileMean, median, percentile } from './statistics.js';

const SAMPLES = 25;
/** Nicht gezaehlte Anlaufmessungen (siehe Kopfkommentar, Punkt 4). */
const WARMUP = 3;
/** > 1 s, damit die 1-Hz-Drossel des Cores nie im Messfenster liegt. */
const SPACING_MS = 1_200;
/** ~0,2 mm je Fix: eindeutig unterscheidbar, aber ohne Kachelwechsel (Punkt 3). */
const LAT_STEP = 0.000002;

test('[Perf] WS-Latenz Position -> UI < 500 ms', async ({ browser, request }) => {
  // Vorherige Specs haben den Simulator laufen lassen; ohne Freigabe der
  // Quelle antwortet `POST /position/browser` mit 409 und es kaeme nie eine
  // Position an (real passiert im ersten Lauf dieser Suite).
  await releasePositionSource(request, PERF_CORE_BASE_URL);

  const context = await browser.newContext({
    viewport: { ...PERF_VIEWPORT },
    serviceWorkers: 'block',
  });
  let samples: number[];
  try {
    const page = await context.newPage();
    await throttleCpu(context, page);
    await installDegradation(page);
    await page.goto(`${PERF_CORE_BASE_URL}/`, { timeout: 120_000 });
    await waitForMapLoaded(page);
    await page.waitForFunction(
      () => window.__yapajaPositionStore?.getState().isConnected === true,
      undefined,
      { timeout: 60_000 },
    );

    samples = await page.evaluate(
      async ({
        count,
        warmup,
        spacingMs,
        latStep,
      }: {
        count: number;
        warmup: number;
        spacingMs: number;
        latStep: number;
      }) => {
        const store = window.__yapajaPositionStore;
        if (!store) throw new Error('Position-Store nicht verfuegbar');
        const out: number[] = [];
        for (let i = 0; i < count + warmup; i += 1) {
          const lat = 48 + i * latStep;
          const arrived = new Promise<number>((resolve) => {
            const unsubscribe = store.subscribe((state) => {
              const position = state.position;
              if (position && Math.abs(position.lat - lat) < 1e-9) {
                unsubscribe();
                resolve(performance.now());
              }
            });
          });
          const sentAt = performance.now();
          await fetch('/api/v1/position/browser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat,
              lon: 9.55,
              alt: null,
              speed: 12,
              heading: 0,
              accuracy: 5,
              fix: '3d',
              ts: new Date().toISOString(),
            }),
          });
          const latencyMs = (await arrived) - sentAt;
          if (i >= warmup) out.push(latencyMs);
          await new Promise((resolve) => setTimeout(resolve, spacingMs));
        }
        return out;
      },
      { count: SAMPLES, warmup: WARMUP, spacingMs: SPACING_MS, latStep: LAT_STEP },
    );
  } finally {
    await context.close();
  }

  recordAndAssert({
    id: 'ws_latency_ms',
    value: interquartileMean(samples),
    samples: samples.map((s) => Math.round(s * 100) / 100),
    note:
      `${SAMPLES} gewertete Fixes (+${WARMUP} Anlauf) im Abstand von ${SPACING_MS} ms, ` +
      'interquartiles Mittel; ' +
      `Median ${median(samples).toFixed(1)} ms, p95 ${percentile(samples, 0.95).toFixed(1)} ms, ` +
      `max ${Math.max(...samples).toFixed(1)} ms (p95/max informativ, nicht gegatet)`,
  });
});
