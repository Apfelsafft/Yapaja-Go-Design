/**
 * Konstanten der E10-T2-Performance-Suite.
 *
 * Ports im 435x-Block: die Haupt-Harness (`apps/web/e2e/support/constants.ts`)
 * endet bei 4341, die Sicherheits-Suite belegt 4340. 4350+ kollidiert mit
 * keiner davon, auch wenn zwei Suiten versehentlich parallel laufen.
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// e2e/perf/support -> e2e/perf
export const PERF_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// e2e/perf -> e2e -> <repo root>
export const REPO_ROOT = join(PERF_ROOT, '..', '..');

export const PERF_TMP_DIR = join(PERF_ROOT, '.tmp');
export const PERF_TILES_DIR = join(PERF_TMP_DIR, 'tiles');
export const PERF_SOAK_TILES_DIR = join(PERF_TMP_DIR, 'tiles-soak');
/** Eine Datei je Metrik; `globalTeardown` fasst sie zum Artefakt zusammen. */
export const PERF_MEASUREMENTS_DIR = join(PERF_TMP_DIR, 'measurements');
/** Das JSON-Artefakt (Aufgabenstellung: "Ergebnisse als JSON-Artefakt"). */
export const PERF_RESULTS_FILE = join(PERF_TMP_DIR, 'perf-results.json');
/** Der Trend-Kommentar als Markdown. */
export const PERF_TREND_FILE = join(PERF_TMP_DIR, 'perf-trend.md');
/** Umgebungssignatur, von `globalSetup` geschrieben. */
export const PERF_ENVIRONMENT_FILE = join(PERF_TMP_DIR, 'environment.json');
/** PID des gemessenen Core-Prozesses, von `globalSetup` geschrieben. */
export const PERF_CORE_PID_FILE = join(PERF_TMP_DIR, 'core.pid');
/** Soak-Report (JSON + lesbares Markdown). */
export const SOAK_RESULTS_FILE = join(PERF_TMP_DIR, 'soak-results.json');
export const SOAK_REPORT_FILE = join(PERF_TMP_DIR, 'soak-report.md');

export const PERF_CORE_PORT = 4350;
export const PERF_CORE_BASE_URL = `http://127.0.0.1:${PERF_CORE_PORT}`;
/** Stub-Valhalla fuer die Reroute-Messung (gleiche Mechanik wie flow-03). */
export const PERF_VALHALLA_PORT = 4351;
export const PERF_VALHALLA_BASE_URL = `http://127.0.0.1:${PERF_VALHALLA_PORT}`;
/** Eigener Core fuer den Soak-Lauf, damit die RSS-Messung der Suite sauber bleibt. */
export const SOAK_CORE_PORT = 4352;
export const SOAK_CORE_BASE_URL = `http://127.0.0.1:${SOAK_CORE_PORT}`;

/**
 * "N100-Profil" (Aufgabenstellung): Playwright-CPU-Throttle 4x.
 * Der Container laeuft zusaetzlich unter 2 vCPU/4 GB Limits -- das setzt die
 * Compose-/CI-Seite, nicht der Browser (siehe README).
 */
export const CPU_THROTTLE_RATE = 4;

/**
 * Viewport der Messung: docs/00 nennt als Anzeige "1280x800 aufwaerts".
 * Bewusst NICHT kleiner gewaehlt -- eine kleinere Flaeche wuerde die
 * fps-Messung guenstiger machen, ohne dass sich am Produkt etwas aendert.
 */
export const PERF_VIEWPORT = { width: 1280, height: 800 } as const;
export const PERF_VIEWPORT_LABEL = `${PERF_VIEWPORT.width}x${PERF_VIEWPORT.height}`;

/**
 * Kuenstliche Verschlechterung (Akzeptanzkriterium 2). 0 = aus.
 * Gesetzt ausschliesslich von `scripts/perf-degradation-proof.sh`.
 */
export function degradeDelayMs(): number {
  const raw = process.env.PERF_DEGRADE_DELAY_MS;
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`PERF_DEGRADE_DELAY_MS muss eine nicht-negative Zahl sein, war "${raw}"`);
  }
  return parsed;
}

/** Soak-Laufzeit in Sekunden. Kurzlauf per Default, 24 h im Wochen-Cron. */
export function soakDurationS(): number {
  const raw = process.env.PERF_SOAK_DURATION_S;
  const parsed = raw ? Number(raw) : 120;
  if (!Number.isFinite(parsed) || parsed < 30) {
    throw new Error(`PERF_SOAK_DURATION_S muss >= 30 sein, war "${raw}"`);
  }
  return parsed;
}

/** Der Soak-Lauf ist per Default AUS -- er gehoert in den nightly-Cron. */
export function soakEnabled(): boolean {
  return process.env.PERF_SOAK === '1';
}
