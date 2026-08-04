/**
 * [Perf] RSS gegen die Tabelle docs/01 §4.
 *
 * WAS HIER EHRLICH MESSBAR IST -- UND WAS NICHT
 * ---------------------------------------------
 * MESSBAR: `yapaja-core`. Der Core dieser Suite ist ein echter, gebauter
 * Node-Prozess auf diesem Host; sein RSS wird ueber `/proc/<pid>/stat`
 * gelesen (derselbe Parser wie im Add-on-Watchdog, E09-T3). Der Wert wird
 * NACH der Last der uebrigen Specs erhoben -- deshalb laeuft diese Spec als
 * letzte (Dateiname `90-`, `workers: 1`, `fullyParallel: false`).
 *
 * NICHT MESSBAR: Valhalla, Photon, gpsd. In der per-PR-Pipeline laeuft keiner
 * dieser Dienste als langlebiger Container -- `.github/workflows/ci.yml`
 * betreibt in `valhalla-li-build` / `golden-routes-li` einen Valhalla nur fuer
 * die Dauer eines Routing-Smoke-Tests auf einem winzigen
 * Liechtenstein-Graphen, `photon-setup` startet Photon ohne echten Index, und
 * gpsd kommt ueberhaupt nicht vor. Selbst wo ein Container laeuft, waere sein
 * RSS auf einem LI-Extrakt keine Aussage ueber das Budget, das docs/01 §4
 * fuer den DEUTSCHLAND-Extrakt formuliert.
 *
 * Diese Werte werden deshalb als `not_measured` MIT GRUND ausgewiesen. Sie
 * werden nicht geschaetzt, nicht hochgerechnet und nicht als gruen gemeldet.
 * Ein Budget-Report mit erfundenen Zahlen waere schlechter als ein ehrlich
 * unvollstaendiger.
 *
 * Folgerichtig ist auch die SUMME der Server-Seite nicht messbar: sie ist die
 * Summe von vier Posten, von denen hier genau einer erhoben werden kann.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { PERF_CORE_BASE_URL, PERF_CORE_PID_FILE } from './support/constants.js';
import { procAvailable, sampleProcess } from './support/procRss.js';
import { recordAndAssert } from './support/measure.js';

/**
 * Warum diese Dienste hier nicht messbar sind -- je Metrik der konkrete
 * Grund, damit im Report niemand raten muss.
 */
const NOT_MEASURED_REASONS: Readonly<Record<string, string>> = {
  rss_valhalla_mb:
    'In der per-PR-Pipeline laeuft Valhalla nicht als Dienst. .github/workflows/ci.yml startet ' +
    'in `valhalla-li-build`/`golden-routes-li` nur kurzzeitig einen Container auf dem ' +
    'Liechtenstein-Graphen fuer einen Routing-Smoke-Test; docs/01 §4 budgetiert aber den ' +
    'Deutschland-Extrakt. Belastbar messbar ist das nur im nightly-DE-Job oder auf dem Zielgeraet.',
  rss_photon_mb:
    'Photon laeuft in der per-PR-Pipeline ohne echten Suchindex (`photon-setup` prueft nur ' +
    'Skript-Fixtures und die Xmx-Wirkung, siehe services/photon/README.md). Ein RSS ohne ' +
    'geladenen Index sagt nichts ueber das 1-GB-Budget aus. Der nightly-Job `photon-li-nightly` ' +
    'gibt `docker stats` unter Last aus -- dort, nicht hier, gehoert diese Zahl her.',
  rss_gpsd_mb:
    'gpsd kommt in CI ueberhaupt nicht vor (kein USB-Geraet, kein Container in ci.yml/nightly.yml). ' +
    'Diese Zahl ist nur auf echter Hardware erhebbar und steht auf der manuellen ' +
    'Hardware-Checkliste (docs/07 §7).',
  rss_server_total_mb:
    'Summe aus vier Posten, von denen in dieser Umgebung nur `yapaja-core` messbar ist. ' +
    'Eine Teilsumme als Gesamtsumme auszuweisen waere irrefuehrend.',
};

test('[Perf] RSS des Core-Prozesses gegen docs/01 §4', async ({ request }) => {
  expect(procAvailable(), '/proc ist nicht lesbar -- RSS waere hier nicht messbar').toBe(true);

  const pid = Number(readFileSync(PERF_CORE_PID_FILE, 'utf8').trim());
  expect(Number.isInteger(pid) && pid > 0).toBe(true);

  // Der Core soll noch antworten -- sonst waere ein niedriges RSS nur die
  // Folge eines toten Prozesses.
  const health = await request.get(`${PERF_CORE_BASE_URL}/api/v1/health`);
  expect(health.ok()).toBe(true);

  const sample = sampleProcess(pid);
  expect(sample, `kein /proc-Sample fuer PID ${pid}`).not.toBeNull();
  const measured = sample as NonNullable<typeof sample>;

  recordAndAssert({
    id: 'rss_core_mb',
    value: measured.rssMb,
    samples: [Math.round(measured.rssMb * 10) / 10],
    note:
      `gemessen nach der Last dieser Suite (Kaltstarts, fps-Laeufe, ${''}Reroutes, WS-Fixes); ` +
      `PID ${pid}, ${measured.fdCount} offene FDs davon ${measured.socketCount} Sockets` +
      (measured.fdReadable ? '' : ' (FD-Zaehlung nicht moeglich)'),
  });
});

test('[Perf] Valhalla/Photon/gpsd/Summe: in dieser Umgebung NICHT messbar', () => {
  for (const [id, reason] of Object.entries(NOT_MEASURED_REASONS)) {
    recordAndAssert({ id, value: null, notMeasuredReason: reason });
  }
});
