/**
 * [Perf] Soak / Dauerlauf -- Simulator-Dauerfahrt, RSS-Drift < 5 %,
 * keine Verbindungs-/FD-Lecks.
 *
 * PARAMETRISIERT, und zwar bewusst:
 *   PERF_SOAK=1                   schaltet den Lauf ueberhaupt erst ein
 *   PERF_SOAK_DURATION_S=<sek>    Laufzeit (Default 120 s)
 *
 * Der 24-h-Lauf gehoert in den WOCHEN-Cron (`.github/workflows/nightly.yml`,
 * Job `perf-soak-24h`, `PERF_SOAK_DURATION_S=86400`). In einer PR-Pipeline
 * kann er nicht laufen -- deshalb beweist ein Kurzlauf von Minuten hier den
 * MECHANISMUS (Dauerfahrt, Abtastung, Auswertung, Report), und der lange Lauf
 * beweist dann die AUSSAGE. Was tatsaechlich ausgefuehrt wurde, steht im
 * Report (`geplant N s`), es wird nichts extrapoliert.
 *
 * Was der Lauf tut:
 *  - GPS-Simulator faehrt durchgehend; laeuft ein Track aus, wird er neu
 *    gestartet (Zaehler im Report).
 *  - Eine Browser-Sitzung haengt dauerhaft am WS; zusaetzlich werden
 *    regelmaessig weitere Kontexte geoeffnet und wieder geschlossen. Genau
 *    das erzeugt den Auf-/Abbau von WS-Verbindungen, an dem ein Leck
 *    ueberhaupt erst sichtbar wird -- ein Soak ohne Verbindungswechsel
 *    koennte ein Verbindungsleck gar nicht finden.
 *  - Alle `SAMPLE_INTERVAL` wird `/proc/<pid>` abgetastet (RSS, FDs, Sockets).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { encodePolyline6, type LatLon } from '../../apps/core/src/routing/polyline.js';
import {
  PERF_TMP_DIR,
  PERF_VIEWPORT,
  SOAK_CORE_BASE_URL,
  SOAK_REPORT_FILE,
  SOAK_RESULTS_FILE,
  soakDurationS,
  soakEnabled,
} from './support/constants.js';
import { sampleProcess } from './support/procRss.js';
import { waitForMapLoaded } from './support/page.js';
import { evaluateSoak, renderSoakReport, type SoakSample } from './soak.js';

/**
 * Rundkurs innerhalb der Fixture-Region; wird bei Track-Ende neu gestartet.
 *
 * Bewusst klein gehalten (~1,4 km Umfang, bei 16 m/s also ~90 s je Runde):
 * so wird der Neustart-Mechanismus der Dauerfahrt schon in einem
 * Minuten-Kurzlauf mehrfach durchlaufen und nicht erst nach Stunden. Im
 * 24-h-Lauf ergibt das entsprechend viele Runden -- genau das ist der Zweck.
 */
const LOOP: LatLon[] = Array.from({ length: 120 }, (_, i) => {
  const angle = (i / 120) * 2 * Math.PI;
  return { lat: 47.4 + 0.002 * Math.sin(angle), lon: 9.55 + 0.003 * Math.cos(angle) };
});

test.describe('[Perf] Soak', () => {
  test.skip(!soakEnabled(), 'Soak-Lauf nur mit PERF_SOAK=1 (gehoert in den nightly-Cron)');

  test('[Perf] Dauerfahrt: RSS-Drift < 5 %, keine FD-/Verbindungslecks', async ({
    browser,
    request,
  }) => {
    const durationS = soakDurationS();
    const durationMs = durationS * 1000;
    // Ziel: ~40 Stichproben, aber nie schneller als alle 2 s und nie
    // langsamer als alle 5 min -- bei 24 h ergibt das 288 Punkte.
    const sampleIntervalMs = Math.min(300_000, Math.max(2_000, Math.floor(durationMs / 40)));
    /** Verbindungswechsel etwa alle 10 Stichproben. */
    const sessionEveryMs = sampleIntervalMs * 10;

    test.setTimeout(durationMs + 300_000);

    const pid = Number(readFileSync(join(PERF_TMP_DIR, 'soak-core.pid'), 'utf8').trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);

    const track = { polyline6: encodePolyline6(LOOP), speedMs: 16 };
    const startPlayback = async (): Promise<void> => {
      const response = await request.post(`${SOAK_CORE_BASE_URL}/api/v1/simulator/play`, {
        data: { track, speed_factor: 1 },
      });
      expect(response.ok()).toBe(true);
    };

    const context = await browser.newContext({
      viewport: { ...PERF_VIEWPORT },
      serviceWorkers: 'block',
    });
    const samples: SoakSample[] = [];
    let simulatorRestarts = 0;
    let browserSessions = 0;
    const startedAt = new Date().toISOString();

    try {
      const page = await context.newPage();
      await page.goto(`${SOAK_CORE_BASE_URL}/`, { timeout: 120_000 });
      await waitForMapLoaded(page);
      await startPlayback();

      const t0 = Date.now();
      let nextSession = t0 + sessionEveryMs;
      while (Date.now() - t0 < durationMs) {
        await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));

        const sample = sampleProcess(pid);
        if (sample === null) {
          throw new Error(`Soak-Core (PID ${pid}) ist waehrend des Laufs verschwunden.`);
        }
        samples.push({
          atMs: Date.now() - t0,
          rssMb: sample.rssMb,
          fdCount: sample.fdCount,
          socketCount: sample.socketCount,
        });

        // Dauerfahrt: bei Track-Ende neu anwerfen.
        const status = await request.get(`${SOAK_CORE_BASE_URL}/api/v1/simulator/status`);
        const state = ((await status.json()) as { data: { state: string } }).data.state;
        if (state !== 'playing') {
          await startPlayback();
          simulatorRestarts += 1;
        }

        // Verbindungswechsel, damit ein Verbindungsleck ueberhaupt entstehen kann.
        if (Date.now() >= nextSession) {
          const transient = await browser.newContext({
            viewport: { ...PERF_VIEWPORT },
            serviceWorkers: 'block',
          });
          const transientPage = await transient.newPage();
          await transientPage.goto(`${SOAK_CORE_BASE_URL}/`, { timeout: 120_000 });
          await waitForMapLoaded(transientPage);
          await transient.close();
          browserSessions += 1;
          nextSession = Date.now() + sessionEveryMs;
        }
      }
    } finally {
      await request.post(`${SOAK_CORE_BASE_URL}/api/v1/simulator/stop`).catch(() => undefined);
      await context.close();
    }

    const evaluation = evaluateSoak(samples);
    const soakContext = {
      plannedDurationS: durationS,
      startedAt,
      simulatorRestarts,
      browserSessions,
      corePid: pid,
    };
    writeFileSync(
      SOAK_RESULTS_FILE,
      JSON.stringify({ schema: 'yapaja.soak.v1', context: soakContext, evaluation, samples }, null, 2),
      'utf8',
    );
    const report = renderSoakReport(soakContext, evaluation);
    writeFileSync(SOAK_REPORT_FILE, `${report}\n`, 'utf8');
    console.warn(`\n${report}\n`);

    expect(evaluation.failures, 'Soak-Kriterien gerissen').toEqual([]);
    expect(evaluation.passed).toBe(true);
  });
});
