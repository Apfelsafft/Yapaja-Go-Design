/**
 * E10-T2 Pflicht-Test: "Unit fuer Auswertungs-/Schwellenlogik".
 *
 * Geprueft wird der Code, der gruen/rot entscheidet -- die 10-%-Regel, der
 * Vergleich gegen die Tabelle aus docs/01 §4, und die beiden Sonderzustaende
 * (`not_measured`, `advisory`), an denen die Ehrlichkeit des Reports haengt.
 *
 * Diese Datei laeuft im normalen Wurzel-Vitest-Lauf (`npx vitest run`) --
 * `vitest.config.ts` nimmt `e2e/perf/**` ausdruecklich auf, weil hier (anders
 * als bei `e2e/golden-routes`) reine Logik ohne laufenden Core getestet wird.
 */

import { describe, it, expect } from 'vitest';
import {
  RED_VIOLATION_PCT,
  assertBudget,
  evaluateMeasurement,
  evaluateReport,
  formatValue,
  statusForViolation,
  statusSymbol,
  violationPct,
  type Measurement,
} from './evaluate.js';
import { ALL_BUDGETS, RSS_BUDGETS, RUNTIME_BUDGETS, budgetById, type BudgetDefinition } from './budgets.js';

const COLD_START = budgetById('cold_start_ms');
const FPS = budgetById('fps_pan_zoom');
const RSS_CORE = budgetById('rss_core_mb');

function measurement(id: string, value: number | null, extra: Partial<Measurement> = {}): Measurement {
  return { id, value, ...extra };
}

describe('E10-T2 Budget-Tabelle (budgets.ts)', () => {
  it('bildet die docs/00-Erfolgskriterien wertgetreu ab', () => {
    expect(budgetById('cold_start_ms')).toMatchObject({ budget: 5_000, direction: 'max' });
    expect(budgetById('fps_pan_zoom')).toMatchObject({ budget: 30, direction: 'min' });
    expect(budgetById('fps_drive')).toMatchObject({ budget: 30, direction: 'min' });
    expect(budgetById('reroute_ms')).toMatchObject({ budget: 3_000, direction: 'max' });
    expect(budgetById('ws_latency_ms')).toMatchObject({ budget: 500, direction: 'max' });
  });

  it('bildet die RSS-Tabelle aus docs/01 §4 wertgetreu ab (1 GB = 1024 MB)', () => {
    expect(budgetById('rss_core_mb').budget).toBe(300);
    expect(budgetById('rss_valhalla_mb').budget).toBe(1536);
    expect(budgetById('rss_photon_mb').budget).toBe(1024);
    expect(budgetById('rss_gpsd_mb').budget).toBe(10);
    expect(budgetById('rss_server_total_mb').budget).toBe(2969.6);
  });

  it('nennt zu jedem Budget eine Doku-Fundstelle und benutzt eindeutige ids', () => {
    for (const b of ALL_BUDGETS) {
      expect(b.source, `Budget "${b.id}" ohne Quelle`).toMatch(/docs\//);
      expect(b.label.length).toBeGreaterThan(0);
    }
    const ids = ALL_BUDGETS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wirft bei unbekannter id statt still etwas zu erfinden', () => {
    expect(() => budgetById('gibt_es_nicht')).toThrow(/Unbekannte Budget-id/);
  });

  it('deckt mit RUNTIME_BUDGETS + RSS_BUDGETS genau ALL_BUDGETS ab', () => {
    expect([...RUNTIME_BUDGETS, ...RSS_BUDGETS].map((b) => b.id)).toEqual(ALL_BUDGETS.map((b) => b.id));
  });
});

describe('violationPct()', () => {
  it('rechnet max-Metriken (Latenz, RSS) korrekt', () => {
    expect(violationPct(COLD_START, 5_000)).toBe(0);
    expect(violationPct(COLD_START, 2_500)).toBe(-50);
    expect(violationPct(COLD_START, 5_500)).toBeCloseTo(10, 10);
    expect(violationPct(COLD_START, 6_000)).toBeCloseTo(20, 10);
  });

  it('rechnet min-Metriken (fps) korrekt -- weniger fps ist schlechter', () => {
    expect(violationPct(FPS, 30)).toBe(0);
    expect(violationPct(FPS, 60)).toBe(-100);
    expect(violationPct(FPS, 27)).toBeCloseTo(10, 10);
    expect(violationPct(FPS, 10)).toBeCloseTo(66.6667, 3);
  });

  it('vergleicht RSS gegen die Tabellenwerte aus docs/01 §4', () => {
    expect(violationPct(RSS_CORE, 300)).toBe(0);
    expect(violationPct(RSS_CORE, 97.4)).toBeCloseTo(-67.53, 2);
    expect(violationPct(RSS_CORE, 360)).toBeCloseTo(20, 10);
    expect(violationPct(budgetById('rss_valhalla_mb'), 1536)).toBe(0);
    expect(violationPct(budgetById('rss_gpsd_mb'), 12)).toBeCloseTo(20, 10);
  });

  it('weigert sich, nicht-endliche Messwerte oder ein Nullbudget auszuwerten', () => {
    expect(() => violationPct(COLD_START, Number.NaN)).toThrow(/endlichen Messwert/);
    expect(() => violationPct(COLD_START, Number.POSITIVE_INFINITY)).toThrow(/endlichen Messwert/);
    const zeroBudget: BudgetDefinition = { ...COLD_START, budget: 0 };
    expect(() => violationPct(zeroBudget, 1)).toThrow(/Budget 0/);
  });
});

describe('statusForViolation() -- die 10-%-Regel aus der Aufgabenstellung', () => {
  it('ist gruen, solange das Budget eingehalten ist', () => {
    expect(statusForViolation(-100)).toBe('green');
    expect(statusForViolation(-0.0001)).toBe('green');
    expect(statusForViolation(0)).toBe('green');
  });

  it('ist gelb bei einem Verstoss bis einschliesslich 10 %', () => {
    expect(statusForViolation(0.0001)).toBe('warn');
    expect(statusForViolation(5)).toBe('warn');
    expect(statusForViolation(RED_VIOLATION_PCT)).toBe('warn');
  });

  it('ist rot ERST oberhalb von 10 % -- die Grenze selbst ist noch nicht rot', () => {
    expect(statusForViolation(10.0001)).toBe('red');
    expect(statusForViolation(35)).toBe('red');
    expect(statusForViolation(1_000)).toBe('red');
  });
});

describe('evaluateMeasurement()', () => {
  it('bewertet einen gemessenen Wert innerhalb des Budgets als gruen und blockierend', () => {
    const result = evaluateMeasurement(COLD_START, measurement('cold_start_ms', 2_250));
    expect(result.status).toBe('green');
    expect(result.blocking).toBe(true);
    expect(result.violationPct).toBeCloseTo(-55, 10);
    expect(result.source).toContain('docs/00');
  });

  it('zieht 5.500 ms Kaltstart auf gelb und 5.501 ms auf rot', () => {
    expect(evaluateMeasurement(COLD_START, measurement('cold_start_ms', 5_500)).status).toBe('warn');
    expect(evaluateMeasurement(COLD_START, measurement('cold_start_ms', 5_501)).status).toBe('red');
  });

  it('behandelt einen fehlenden Wert als not_measured -- niemals als gruen', () => {
    const result = evaluateMeasurement(
      budgetById('rss_valhalla_mb'),
      measurement('rss_valhalla_mb', null, {
        notMeasuredReason: 'Valhalla laeuft in der per-PR-Pipeline nicht als Dienst.',
      }),
    );
    expect(result.status).toBe('not_measured');
    expect(result.value).toBeNull();
    expect(result.violationPct).toBeNull();
    expect(result.blocking).toBe(false);
    expect(result.notMeasuredReason).toMatch(/nicht als Dienst/);
  });

  it('verbietet eine unbegruendete Luecke', () => {
    expect(() =>
      evaluateMeasurement(budgetById('rss_photon_mb'), measurement('rss_photon_mb', null)),
    ).toThrow(/nennt aber keinen Grund/);
  });

  it('bewertet advisory-Metriken normal, laesst sie aber nicht blockieren', () => {
    const result = evaluateMeasurement(
      FPS,
      measurement('fps_pan_zoom', 10.4, {
        advisory: true,
        advisoryReason: 'SwiftShader-Softwarerasterung, keine GPU im Container.',
      }),
    );
    expect(result.status).toBe('red');
    expect(result.blocking).toBe(false);
    expect(result.violationPct).toBeCloseTo(65.33, 2);
  });

  it('verbietet advisory ohne Begruendung', () => {
    expect(() => evaluateMeasurement(FPS, measurement('fps_pan_zoom', 10, { advisory: true }))).toThrow(
      /advisory markiert, nennt aber keinen Grund/,
    );
  });

  it('verweigert die Auswertung, wenn Messung und Definition nicht zusammenpassen', () => {
    expect(() => evaluateMeasurement(COLD_START, measurement('ws_latency_ms', 5))).toThrow(
      /passt nicht zur Definition/,
    );
  });

  it('reicht Rohstichproben und Notiz unveraendert ins Ergebnis durch', () => {
    const samples = [5, 6, 7];
    const result = evaluateMeasurement(
      budgetById('ws_latency_ms'),
      measurement('ws_latency_ms', 6, { samples, note: 'p95 = 10 ms' }),
    );
    expect(result.samples).toEqual(samples);
    expect(result.note).toBe('p95 = 10 ms');
  });
});

describe('evaluateReport()', () => {
  const defs = [COLD_START, FPS, RSS_CORE];

  it('ist nur dann gruen, wenn JEDE Metrik gemessen wurde und im Budget liegt', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 2_250),
      measurement('fps_pan_zoom', 45),
      measurement('rss_core_mb', 97.4),
    ]);
    expect(report.overall).toBe('green');
    expect(report.counts).toEqual({ green: 3, warn: 0, red: 0, notMeasured: 0, advisory: 0 });
    expect(report.blockingRedIds).toEqual([]);
  });

  it('wird rot, sobald eine blockierende Metrik ihr Budget um > 10 % reisst', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 6_200),
      measurement('fps_pan_zoom', 45),
      measurement('rss_core_mb', 97.4),
    ]);
    expect(report.overall).toBe('red');
    expect(report.blockingRedIds).toEqual(['cold_start_ms']);
  });

  it('bleibt bei einem Verstoss <= 10 % gelb statt rot', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 5_400),
      measurement('fps_pan_zoom', 45),
      measurement('rss_core_mb', 97.4),
    ]);
    expect(report.overall).toBe('warn');
    expect(report.counts.warn).toBe(1);
    expect(report.blockingRedIds).toEqual([]);
  });

  it('faerbt gelb (nicht gruen), wenn etwas gar nicht gemessen wurde', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 2_250),
      measurement('fps_pan_zoom', 45),
      measurement('rss_core_mb', null, { notMeasuredReason: 'Core-PID nicht ermittelbar' }),
    ]);
    expect(report.overall).toBe('warn');
    expect(report.counts.notMeasured).toBe(1);
  });

  it('laesst eine rote advisory-Metrik gelb faerben, aber nicht blockieren', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 2_250),
      measurement('fps_pan_zoom', 10.4, {
        advisory: true,
        advisoryReason: 'Softwarerasterung',
      }),
      measurement('rss_core_mb', 97.4),
    ]);
    expect(report.overall).toBe('warn');
    expect(report.counts.red).toBe(1);
    expect(report.counts.advisory).toBe(1);
    expect(report.blockingRedIds).toEqual([]);
  });

  it('wirft, wenn zu einem Budget ueberhaupt keine Messung geliefert wurde', () => {
    expect(() =>
      evaluateReport(defs, [measurement('cold_start_ms', 2_250), measurement('fps_pan_zoom', 45)]),
    ).toThrow(/fehlt jede Messung/);
  });

  it('meldet mehrere blockierende Rotmeldungen vollstaendig', () => {
    const report = evaluateReport(defs, [
      measurement('cold_start_ms', 9_000),
      measurement('fps_pan_zoom', 5),
      measurement('rss_core_mb', 900),
    ]);
    expect(report.overall).toBe('red');
    expect(report.blockingRedIds).toEqual(['cold_start_ms', 'fps_pan_zoom', 'rss_core_mb']);
  });
});

describe('assertBudget()', () => {
  it('wirft bei blockierendem Rot mit Messwert, Budget und Verstoss im Text', () => {
    const evaluation = evaluateMeasurement(COLD_START, measurement('cold_start_ms', 6_200));
    expect(() => assertBudget(evaluation)).toThrow(/BUDGET ROT/);
    expect(() => assertBudget(evaluation)).toThrow(/6200\.0 ms/);
    expect(() => assertBudget(evaluation)).toThrow(/24\.0 %/);
  });

  it('wirft NICHT bei gelb, gruen, not_measured oder advisory-Rot', () => {
    expect(() => assertBudget(evaluateMeasurement(COLD_START, measurement('cold_start_ms', 5_400)))).not.toThrow();
    expect(() => assertBudget(evaluateMeasurement(COLD_START, measurement('cold_start_ms', 100)))).not.toThrow();
    expect(() =>
      assertBudget(
        evaluateMeasurement(
          budgetById('rss_gpsd_mb'),
          measurement('rss_gpsd_mb', null, { notMeasuredReason: 'kein gpsd-Container in CI' }),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      assertBudget(
        evaluateMeasurement(
          FPS,
          measurement('fps_pan_zoom', 10, { advisory: true, advisoryReason: 'Softwarerasterung' }),
        ),
      ),
    ).not.toThrow();
  });
});

describe('Darstellungshelfer', () => {
  it('formatValue kennt den Nicht-gemessen-Fall', () => {
    expect(formatValue(null, 'ms')).toBe('— ms');
    expect(formatValue(2_250, 'ms')).toBe('2250.0 ms');
    expect(formatValue(10.44, 'fps')).toBe('10.4 fps');
    expect(formatValue(97.42, 'MB')).toBe('97.4 MB');
  });

  it('statusSymbol deckt alle vier Zustaende ab', () => {
    expect(statusSymbol('green')).toBe('🟢');
    expect(statusSymbol('warn')).toBe('🟡');
    expect(statusSymbol('red')).toBe('🔴');
    expect(statusSymbol('not_measured')).toBe('⚪');
  });
});
