/**
 * Ablage der Einzelmessungen + der gemeinsame "messen und gegen das Budget
 * asserten"-Weg fuer alle Specs dieser Suite.
 *
 * Jede Spec schreibt ihre Messung als eigene Datei nach
 * `e2e/perf/.tmp/measurements/<id>.json`; `globalTeardown.ts` liest sie ein
 * und baut daraus das JSON-Artefakt + den Trend-Kommentar. Der Umweg ueber
 * Dateien statt eines Prozess-Singletons ist Absicht: Playwright kann Specs
 * in eigenen Worker-Prozessen ausfuehren, ein geteiltes Modul-Objekt waere
 * dort schlicht leer.
 *
 * WICHTIG: Die Assertion laeuft ueber `assertBudget()` aus `evaluate.ts` --
 * dieselbe Funktion, aus der auch der Report seinen Status zieht. Es gibt
 * keine zweite Schwellenlogik in den Specs.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { budgetById } from '../budgets.js';
import {
  assertBudget,
  evaluateMeasurement,
  formatValue,
  statusSymbol,
  type Measurement,
  type MetricEvaluation,
} from '../evaluate.js';
import { PERF_MEASUREMENTS_DIR } from './constants.js';

export function resetMeasurements(): void {
  mkdirSync(PERF_MEASUREMENTS_DIR, { recursive: true });
  for (const file of readdirSync(PERF_MEASUREMENTS_DIR)) {
    if (file.endsWith('.json')) {
      writeFileSync(join(PERF_MEASUREMENTS_DIR, file), '');
    }
  }
  // Leere Dateien statt Loeschen: so bleibt sichtbar, wenn eine Spec ihre
  // Messung NICHT geschrieben hat (der Teardown meldet dann eine Luecke).
}

export function writeMeasurement(measurement: Measurement): void {
  mkdirSync(PERF_MEASUREMENTS_DIR, { recursive: true });
  writeFileSync(
    join(PERF_MEASUREMENTS_DIR, `${measurement.id}.json`),
    JSON.stringify(measurement, null, 2),
    'utf8',
  );
}

export function readMeasurements(): Measurement[] {
  let files: string[];
  try {
    files = readdirSync(PERF_MEASUREMENTS_DIR);
  } catch {
    return [];
  }
  const out: Measurement[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = readFileSync(join(PERF_MEASUREMENTS_DIR, file), 'utf8').trim();
    if (!raw) continue;
    out.push(JSON.parse(raw) as Measurement);
  }
  return out;
}

/**
 * Schreibt die Messung, loggt sie lesbar ins CI-Protokoll und asserted sie
 * gegen ihr Budget. Gelbe und advisory-rote Werte werden laut geloggt, aber
 * lassen die Spec nicht scheitern (siehe `evaluate.ts` fuer die Regel).
 */
export function recordAndAssert(measurement: Measurement): MetricEvaluation {
  const definition = budgetById(measurement.id);
  const evaluation = evaluateMeasurement(definition, measurement);
  writeMeasurement(measurement);

  const line =
    `${statusSymbol(evaluation.status)} [Perf] ${evaluation.label}: ` +
    `${formatValue(evaluation.value, evaluation.unit)} ` +
    `(Budget ${evaluation.direction === 'max' ? '<=' : '>='} ${formatValue(evaluation.budget, evaluation.unit)}` +
    `${evaluation.violationPct === null ? '' : `, Verstoß ${evaluation.violationPct.toFixed(1)} %`})` +
    `${evaluation.blocking ? '' : ' [nur Hinweis]'}` +
    `${measurement.note ? ` — ${measurement.note}` : ''}`;

  if (evaluation.status === 'green') {
    console.warn(line);
  } else {
    console.warn(line);
    if (evaluation.notMeasuredReason) console.warn(`   Grund: ${evaluation.notMeasuredReason}`);
    if (evaluation.advisoryReason) console.warn(`   Hinweis: ${evaluation.advisoryReason}`);
  }

  assertBudget(evaluation);
  return evaluation;
}
