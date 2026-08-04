/**
 * Global-Teardown: aus den Einzelmessungen wird das ARTEFAKT.
 *
 * Erzeugt (Aufgabenstellung: "Ergebnisse als JSON-Artefakt + Trend-Kommentar"):
 *   e2e/perf/.tmp/perf-results.json   -- maschinenlesbar, mit Rohstichproben
 *   e2e/perf/.tmp/perf-trend.md       -- der Trend-Kommentar fuer den PR
 *
 * Und es GATET:
 *   - Budget-Gate: blockierende Metrik mit Verstoss > 10 % -> Fehler.
 *     (Redundanz mit den Specs ist Absicht: eine Spec, die ihre Messung gar
 *     nicht geschrieben hat, faellt hier auf.)
 *   - Regressions-Gate: nur wenn eine VERGLEICHBARE Referenz vorliegt
 *     (`PERF_BASELINE=<pfad>`), sonst wird der Trend nur berichtet.
 *
 * Ein Fehler in `globalTeardown` laesst den Playwright-Lauf mit Exit-Code != 0
 * enden -- genau das ist hier gewuenscht.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ALL_BUDGETS } from '../budgets.js';
import { evaluateReport, statusSymbol } from '../evaluate.js';
import {
  evaluateTrend,
  renderTrendComment,
  type EnvironmentSignature,
  type PerfReport,
} from '../trend.js';
import {
  PERF_ENVIRONMENT_FILE,
  PERF_RESULTS_FILE,
  PERF_TREND_FILE,
  soakEnabled,
} from './constants.js';
import { readMeasurements } from './measure.js';

interface EnvironmentFile {
  environment: EnvironmentSignature;
  gitSha: string | null;
}

function loadBaseline(): PerfReport | null {
  const path = process.env.PERF_BASELINE;
  if (!path) return null;
  if (!existsSync(path)) {
    console.warn(`[Perf] PERF_BASELINE="${path}" existiert nicht -- Trend wird ohne Referenz gebaut.`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as PerfReport;
}

export default async function globalTeardown(): Promise<void> {
  const measurements = readMeasurements();
  if (measurements.length === 0) {
    if (soakEnabled()) {
      // Reiner Soak-Lauf (`pnpm perf:soak`): der Soak schreibt keine
      // Budget-Messungen, er hat seinen eigenen Report. Kein Budget-Artefakt
      // zu erzeugen ist hier richtig -- eines mit leerer Tabelle waere
      // irrefuehrend.
      console.warn('[Perf] Reiner Soak-Lauf -- Report siehe e2e/perf/.tmp/soak-report.md');
      return;
    }
    // Sonst: kein Report ohne Messungen -- und kein stilles "gruen".
    throw new Error(
      '[Perf] Keine einzige Messung gefunden. Der Lauf hat nichts gemessen; ' +
        'ein Budget-Report waere hier eine Behauptung, keine Messung.',
    );
  }

  const envFile = JSON.parse(readFileSync(PERF_ENVIRONMENT_FILE, 'utf8')) as EnvironmentFile;

  // Bei einem gefilterten Lauf (`-g`) liegen nicht alle Messungen vor. Dann
  // wird nur ueber die tatsaechlich gemessenen Budgets berichtet -- statt zu
  // behaupten, die fehlenden waeren geprueft worden.
  const measuredIds = new Set(measurements.map((m) => m.id));
  const definitions = ALL_BUDGETS.filter((b) => measuredIds.has(b.id));
  const partial = definitions.length !== ALL_BUDGETS.length;

  const report: PerfReport = {
    schema: 'yapaja.perf.v1',
    generatedAt: new Date().toISOString(),
    gitSha: envFile.gitSha,
    environment: envFile.environment,
    evaluation: evaluateReport(definitions, measurements),
  };

  const baseline = loadBaseline();
  const trend = evaluateTrend(definitions, baseline, report, undefined);

  writeFileSync(PERF_RESULTS_FILE, JSON.stringify({ ...report, trend, partial }, null, 2), 'utf8');
  const comment = renderTrendComment(report, trend);
  writeFileSync(PERF_TREND_FILE, `${comment}\n`, 'utf8');

  console.warn(`\n${comment}\n`);
  if (partial) {
    console.warn(
      `[Perf] TEILLAUF: nur ${definitions.length} von ${ALL_BUDGETS.length} Budgets gemessen ` +
        `(${definitions.map((d) => d.id).join(', ')}).`,
    );
  }
  if (soakEnabled()) {
    console.warn('[Perf] Soak-Lauf war aktiv -- Report siehe e2e/perf/.tmp/soak-report.md');
  }
  console.warn(`[Perf] Artefakte: ${PERF_RESULTS_FILE} und ${PERF_TREND_FILE}`);

  const failures: string[] = [];
  if (report.evaluation.blockingRedIds.length > 0) {
    failures.push(
      `BUDGET-GATE ROT ${statusSymbol('red')}: ${report.evaluation.blockingRedIds.join(', ')}`,
    );
  }
  if (trend.red) {
    failures.push(`REGRESSIONS-GATE ROT ${statusSymbol('red')}: ${trend.regressedIds.join(', ')}`);
  }
  if (failures.length > 0) {
    throw new Error(`[Perf] ${failures.join(' | ')} -- Details in ${PERF_TREND_FILE}`);
  }
}
