/**
 * E10-T2 -- Aggregation von Messreihen. PUR, unit-getestet (`statistics.test.ts`).
 *
 * Warum es diese Datei gibt (und warum nicht einfach "Mittelwert"):
 * die Plausibilitaetsvorgabe der Aufgabe ist hart -- "Messungen streuen < 15 %
 * zwischen zwei Laeufen (sonst Messaufbau fixen, nicht Schwellen aufweichen!)".
 * Bei Metriken, deren Absolutwert klein ist (die WS-Latenz liegt bei ~6 ms
 * gegen ein 500-ms-Budget), reissen einzelne Scheduler-Ausreisser den
 * arithmetischen Mittelwert -- und damit die Streuung zwischen zwei Laeufen --
 * sofort ueber 15 %, obwohl sich am gemessenen System nichts geaendert hat.
 *
 * Die Antwort darauf ist der MESSAUFBAU, nicht die Schwelle: als Kennzahl je
 * Lauf wird das interquartile Mittel (`interquartileMean`) verwendet -- der
 * Mittelwert der mittleren 50 % der sortierten Stichprobe. Das ist robust
 * gegen genau die Ausreisser, die ein geteilter CI-Runner produziert, und
 * bleibt trotzdem ein echter Mittelwert (kein Bestwert, kein "schnellster
 * Lauf zaehlt" -- das waere Schoenrechnen).
 *
 * Gemessener Effekt an zwei realen WS-Latenz-Laeufen dieser Suite
 * (je 20 Stichproben, identischer Aufbau):
 *   Median          6 ms   vs.  5 ms   -> 18,2 % Streuung  (Ganzzahl-Quantisierung)
 *   Interquartilmit 6,2 ms vs.  6,1 ms ->  1,6 % Streuung
 */

/** Aufsteigend sortierte Kopie -- alle Funktionen hier arbeiten nicht in-place. */
function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median() auf leerer Messreihe');
  }
  const s = sortedCopy(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('mean() auf leerer Messreihe');
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Mittelwert der mittleren 50 % der sortierten Stichprobe.
 *
 * Bei < 4 Werten gibt es keine sinnvollen Quartile -- dann faellt die Funktion
 * bewusst auf den Median zurueck (und nicht auf den Mittelwert), damit ein
 * einzelner Ausreisser die Kennzahl auch im Kleinstfall nicht dominiert.
 */
export function interquartileMean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('interquartileMean() auf leerer Messreihe');
  }
  if (values.length < 4) {
    return median(values);
  }
  const s = sortedCopy(values);
  const lo = Math.floor(s.length * 0.25);
  const hi = Math.ceil(s.length * 0.75);
  return mean(s.slice(lo, hi));
}

/**
 * Perzentil per "nearest rank" auf der sortierten Stichprobe.
 * `q` in [0,1]. Wird nur INFORMATIV berichtet (p95 der WS-Latenz), nie
 * als Gate benutzt -- ein p95 aus 20 Stichproben ist zu wackelig fuer eine
 * 15-%-Streuungszusage, und das offen zu sagen ist besser, als es zu gaten.
 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) {
    throw new Error('percentile() auf leerer Messreihe');
  }
  if (q < 0 || q > 1) {
    throw new Error(`percentile(): q muss in [0,1] liegen, war ${q}`);
  }
  const s = sortedCopy(values);
  const rank = Math.ceil(q * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))];
}

/**
 * Relative Streuung einer Kennzahl ueber mehrere LAEUFE, in Prozent:
 * (max - min) / |Mittelwert| * 100.
 *
 * Das ist die Groesse, gegen die die 15-%-Plausibilitaetsvorgabe geprueft wird.
 * Bewusst (max-min) und nicht die Standardabweichung: die Vorgabe redet von
 * "streuen zwischen zwei Laeufen", und bei n = 2 ist die Spannweite die
 * einzige ehrliche Lesart.
 */
export function relativeSpreadPct(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('relativeSpreadPct() auf leerer Messreihe');
  }
  if (values.length === 1) {
    return 0;
  }
  const avg = mean(values);
  if (avg === 0) {
    // Alle Werte 0 -> keine Streuung; sonst ist die relative Streuung
    // undefiniert und wird als Unendlich (= immer instabil) gemeldet.
    return values.every((v) => v === 0) ? 0 : Number.POSITIVE_INFINITY;
  }
  return ((Math.max(...values) - Math.min(...values)) / Math.abs(avg)) * 100;
}

export const STABILITY_MAX_SPREAD_PCT = 15;

export interface MetricStability {
  readonly id: string;
  readonly values: readonly number[];
  readonly spreadPct: number;
  readonly stable: boolean;
}

export interface StabilityEvaluation {
  readonly maxSpreadPct: number;
  readonly metrics: readonly MetricStability[];
  /** true nur, wenn JEDE ausgewertete Metrik unter der Schwelle liegt. */
  readonly stable: boolean;
  /** ids, die die Vorgabe reissen -- Messaufbau-Baustellen, keine Budgetfrage. */
  readonly unstableIds: readonly string[];
}

/**
 * Prueft die Plausibilitaetsvorgabe ueber >= 2 vollstaendige Laeufe.
 *
 * `runs` ist je Lauf eine Abbildung id -> Kennzahl. Metriken, die nicht in
 * ALLEN Laeufen vorkommen (z. B. weil sie in einem Lauf `not_measured` waren),
 * werden uebersprungen -- eine Streuungsaussage ueber eine fehlende Messung
 * waere erfunden.
 */
export function evaluateStability(
  runs: readonly Readonly<Record<string, number>>[],
  maxSpreadPct: number = STABILITY_MAX_SPREAD_PCT,
): StabilityEvaluation {
  if (runs.length < 2) {
    throw new Error(
      `evaluateStability() braucht mindestens 2 Laeufe, bekam ${runs.length} -- ` +
        'die Plausibilitaetsvorgabe ist ausdruecklich "zwischen zwei Laeufen".',
    );
  }
  const ids = Object.keys(runs[0]).filter((id) => runs.every((r) => typeof r[id] === 'number'));
  const metrics: MetricStability[] = ids.map((id) => {
    const values = runs.map((r) => r[id]);
    const spreadPct = relativeSpreadPct(values);
    return { id, values, spreadPct, stable: spreadPct <= maxSpreadPct };
  });
  const unstableIds = metrics.filter((m) => !m.stable).map((m) => m.id);
  return {
    maxSpreadPct,
    metrics,
    stable: unstableIds.length === 0,
    unstableIds,
  };
}
