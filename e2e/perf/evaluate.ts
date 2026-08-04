/**
 * E10-T2 -- die Auswertungs-/Schwellenlogik. PUR, unit-getestet (`evaluate.test.ts`).
 *
 * Hier faellt die Entscheidung gruen/gelb/rot. Genau EINE Implementierung:
 * die Playwright-Specs asserten ueber `assertBudget()` gegen dieselben
 * Funktionen, aus denen auch das JSON-Artefakt und der Trend-Kommentar
 * entstehen -- sonst koennte die Suite gruen sein, waehrend der Report rot
 * meldet (oder umgekehrt).
 *
 * Regel aus der Aufgabenstellung, woertlich: "Budget-Verstoss > 10 % = rot".
 * Daraus folgt die dreistufige Bewertung:
 *
 *   Verstoss <= 0 %          -> gruen  (Budget eingehalten)
 *   0 % < Verstoss <= 10 %   -> gelb   (Budget gerissen, aber innerhalb der
 *                                       in der Aufgabe genannten 10-%-Zone --
 *                                       laut und sichtbar, aber kein Merge-Stopp)
 *   Verstoss > 10 %          -> ROT    (blockiert)
 *
 * Zwei Sonderzustaende, die es geben MUSS, damit der Report ehrlich bleibt:
 *
 *  - `not_measured`: der Wert konnte in dieser Umgebung gar nicht erhoben
 *    werden (Valhalla/Photon/gpsd laufen in der per-PR-Pipeline nicht als
 *    Dienste). Solche Metriken zaehlen NIE als gruen. Ein Budget als "gruen"
 *    zu melden, das niemand gemessen hat, waere die schlimmste Variante
 *    dieses Reports.
 *  - `advisory`: der Wert WURDE gemessen, aber die Umgebung kann ihn nicht
 *    zertifizieren (fps ohne GPU: der Container rastert per SwiftShader in
 *    Software, der Zielrechner N100 hat eine iGPU). Der Messwert wird voll
 *    ausgewiesen und normal bewertet -- er blockiert nur nicht, weil das
 *    Ergebnis eine Aussage ueber den Messstand waere, nicht ueber das Produkt.
 *    Die SCHWELLE bleibt dabei unangetastet bei 30 fps.
 */

import type { BudgetDefinition } from './budgets.js';

/** "Budget-Verstoss > 10 % = rot" (Aufgabenstellung E10-T2). */
export const RED_VIOLATION_PCT = 10;

export type MetricStatus = 'green' | 'warn' | 'red' | 'not_measured';
export type OverallStatus = 'green' | 'warn' | 'red';

export interface Measurement {
  readonly id: string;
  /** `null` = nicht gemessen; dann ist `notMeasuredReason` Pflicht. */
  readonly value: number | null;
  /** Rohstichproben, falls vorhanden -- landen unveraendert im Artefakt. */
  readonly samples?: readonly number[];
  /** Freitext fuer den Report (z. B. p95 zusaetzlich zum Gate-Wert). */
  readonly note?: string;
  /** Pflicht, wenn `value === null`. */
  readonly notMeasuredReason?: string;
  /** Gemessen, aber in dieser Umgebung nicht zertifizierbar -> blockiert nicht. */
  readonly advisory?: boolean;
  /** Pflicht, wenn `advisory === true`. */
  readonly advisoryReason?: string;
}

export interface MetricEvaluation {
  readonly id: string;
  readonly label: string;
  readonly unit: BudgetDefinition['unit'];
  readonly budget: number;
  readonly direction: BudgetDefinition['direction'];
  readonly scope: BudgetDefinition['scope'];
  readonly source: string;
  readonly value: number | null;
  readonly samples?: readonly number[];
  /** > 0 = ueber Budget, <= 0 = innerhalb. `null`, wenn nicht gemessen. */
  readonly violationPct: number | null;
  readonly status: MetricStatus;
  /** false = zaehlt nicht in den blockierenden Gesamtstatus. */
  readonly blocking: boolean;
  readonly note?: string;
  readonly notMeasuredReason?: string;
  readonly advisoryReason?: string;
}

export interface ReportEvaluation {
  readonly overall: OverallStatus;
  readonly metrics: readonly MetricEvaluation[];
  readonly counts: {
    readonly green: number;
    readonly warn: number;
    readonly red: number;
    readonly notMeasured: number;
    readonly advisory: number;
  };
  /** ids, die den Gesamtstatus auf rot ziehen. */
  readonly blockingRedIds: readonly string[];
}

/**
 * Verstoss in Prozent des Budgets. Positiv = schlechter als das Budget.
 *
 * `max`-Metriken (Latenzen, RSS): (wert - budget) / budget * 100.
 * `min`-Metriken (fps):           (budget - wert) / budget * 100.
 */
export function violationPct(definition: BudgetDefinition, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`violationPct(): "${definition.id}" hat keinen endlichen Messwert (${value})`);
  }
  if (definition.budget === 0) {
    throw new Error(`violationPct(): Budget 0 fuer "${definition.id}" ist nicht auswertbar`);
  }
  const raw =
    definition.direction === 'max'
      ? (value - definition.budget) / definition.budget
      : (definition.budget - value) / definition.budget;
  return raw * 100;
}

/** Die 10-%-Regel als eigene, direkt testbare Funktion. */
export function statusForViolation(pct: number): Exclude<MetricStatus, 'not_measured'> {
  if (pct <= 0) return 'green';
  if (pct <= RED_VIOLATION_PCT) return 'warn';
  return 'red';
}

export function evaluateMeasurement(
  definition: BudgetDefinition,
  measurement: Measurement,
): MetricEvaluation {
  if (measurement.id !== definition.id) {
    throw new Error(
      `evaluateMeasurement(): Messung "${measurement.id}" passt nicht zur Definition "${definition.id}"`,
    );
  }

  const base = {
    id: definition.id,
    label: definition.label,
    unit: definition.unit,
    budget: definition.budget,
    direction: definition.direction,
    scope: definition.scope,
    source: definition.source,
    samples: measurement.samples,
    note: measurement.note,
  };

  if (measurement.value === null) {
    if (!measurement.notMeasuredReason) {
      throw new Error(
        `evaluateMeasurement(): "${definition.id}" ist nicht gemessen, nennt aber keinen Grund. ` +
          'Eine unbegruendete Luecke im Budget-Report ist nicht zulaessig.',
      );
    }
    return {
      ...base,
      value: null,
      violationPct: null,
      status: 'not_measured',
      blocking: false,
      notMeasuredReason: measurement.notMeasuredReason,
    };
  }

  if (measurement.advisory && !measurement.advisoryReason) {
    throw new Error(
      `evaluateMeasurement(): "${definition.id}" ist als advisory markiert, nennt aber keinen Grund.`,
    );
  }

  const pct = violationPct(definition, measurement.value);
  return {
    ...base,
    value: measurement.value,
    violationPct: pct,
    status: statusForViolation(pct),
    blocking: measurement.advisory !== true,
    advisoryReason: measurement.advisoryReason,
  };
}

/**
 * Wertet den ganzen Report aus.
 *
 * Gesamtstatus:
 *   rot   -> mindestens eine BLOCKIERENDE Metrik ist rot
 *   gelb  -> keine blockierende rote, aber mindestens eine gelbe/rote
 *            (auch eine rote advisory-Metrik faerbt gelb -- sie verschwindet
 *            nicht stillschweigend) oder mindestens eine nicht gemessene
 *   gruen -> jede definierte Metrik wurde gemessen und liegt im Budget
 *
 * Fehlt zu einer Definition ganz die Messung, ist das ein Fehler und kein
 * "gruen": die Suite hat dann etwas nicht ausgefuehrt.
 */
export function evaluateReport(
  definitions: readonly BudgetDefinition[],
  measurements: readonly Measurement[],
): ReportEvaluation {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  const metrics = definitions.map((definition) => {
    const measurement = byId.get(definition.id);
    if (!measurement) {
      throw new Error(
        `evaluateReport(): zu Budget "${definition.id}" fehlt jede Messung. ` +
          'Fehlende Messungen werden nicht als gruen gewertet.',
      );
    }
    return evaluateMeasurement(definition, measurement);
  });

  const counts = {
    green: metrics.filter((m) => m.status === 'green').length,
    warn: metrics.filter((m) => m.status === 'warn').length,
    red: metrics.filter((m) => m.status === 'red').length,
    notMeasured: metrics.filter((m) => m.status === 'not_measured').length,
    advisory: metrics.filter((m) => !m.blocking && m.status !== 'not_measured').length,
  };

  const blockingRedIds = metrics.filter((m) => m.blocking && m.status === 'red').map((m) => m.id);

  let overall: OverallStatus;
  if (blockingRedIds.length > 0) {
    overall = 'red';
  } else if (counts.warn > 0 || counts.red > 0 || counts.notMeasured > 0) {
    overall = 'warn';
  } else {
    overall = 'green';
  }

  return { overall, metrics, counts, blockingRedIds };
}

/**
 * Assertion-Helfer fuer die Specs: wirft mit einem Text, der Messwert,
 * Budget UND Verstoss in Prozent nennt -- damit ein rotes CI-Log allein
 * schon erklaert, was passiert ist.
 *
 * Wirft NUR bei blockierendem Rot; gelb und advisory-Rot melden die Specs
 * ueber `console.warn`, damit sie im Log auffallen, ohne den Merge zu stoppen.
 */
export function assertBudget(evaluation: MetricEvaluation): void {
  if (evaluation.blocking && evaluation.status === 'red') {
    throw new Error(
      `BUDGET ROT -- ${evaluation.label} (${evaluation.id}): gemessen ${formatValue(
        evaluation.value,
        evaluation.unit,
      )}, Budget ${evaluation.direction === 'max' ? '<=' : '>='} ${formatValue(
        evaluation.budget,
        evaluation.unit,
      )}, Verstoss ${(evaluation.violationPct ?? 0).toFixed(1)} % (> ${RED_VIOLATION_PCT} % = rot). ` +
        `Quelle: ${evaluation.source}`,
    );
  }
}

export function formatValue(value: number | null, unit: BudgetDefinition['unit']): string {
  if (value === null) return `— ${unit}`;
  const digits = unit === 'ms' ? 1 : unit === 'fps' ? 1 : 1;
  return `${value.toFixed(digits)} ${unit}`;
}

/** Symbol fuer Markdown-Tabellen/Logs. */
export function statusSymbol(status: MetricStatus): string {
  switch (status) {
    case 'green':
      return '🟢';
    case 'warn':
      return '🟡';
    case 'red':
      return '🔴';
    case 'not_measured':
      return '⚪';
  }
}
