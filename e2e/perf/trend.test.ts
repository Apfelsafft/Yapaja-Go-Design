/**
 * E10-T2 Pflicht-Test: Trend-/Regressionslogik.
 *
 * Der interessanteste Fall steht ganz unten: die in der Aufgabenstellung
 * geforderte "kuenstliche Verschlechterung (Test-Fixture mit 200 ms-Delay)"
 * bleibt UNTER allen absoluten Budgets -- das Regressions-Gate ist der Grund,
 * warum die Pipeline sie trotzdem sieht. Die Zahlen in diesem Test sind die
 * real gemessenen Werte aus `scripts/perf-degradation-proof.sh`.
 */

import { describe, it, expect } from 'vitest';
import { RUNTIME_BUDGETS, budgetById } from './budgets.js';
import { evaluateReport, type Measurement } from './evaluate.js';
import {
  REGRESSION_NOISE_FLOOR_BUDGET_PCT,
  REGRESSION_TOLERANCE_PCT,
  regressionNoiseFloor,
  describeEnvironment,
  evaluateTrend,
  regressionPct,
  renderTrendComment,
  sameEnvironment,
  type EnvironmentSignature,
  type PerfReport,
} from './trend.js';

const ENV: EnvironmentSignature = {
  cpuThrottleRate: 4,
  viewport: '1280x800',
  glRenderer: 'SwiftShader',
  cpuCount: 4,
};

const DEFS = [budgetById('cold_start_ms'), budgetById('ws_latency_ms'), budgetById('fps_pan_zoom')];

function report(values: Record<string, number>, overrides: Partial<Measurement>[] = []): PerfReport {
  const measurements: Measurement[] = DEFS.map((d) => {
    const override = overrides.find((o) => o.id === d.id);
    return { id: d.id, value: values[d.id], ...override };
  });
  return {
    schema: 'yapaja.perf.v1',
    generatedAt: '2026-08-03T00:00:00.000Z',
    gitSha: 'deadbeef',
    environment: ENV,
    evaluation: evaluateReport(DEFS, measurements),
  };
}

describe('regressionPct()', () => {
  it('rechnet max-Metriken: groesser ist schlechter', () => {
    expect(regressionPct(budgetById('cold_start_ms'), 2000, 2200)).toBeCloseTo(10, 10);
    expect(regressionPct(budgetById('cold_start_ms'), 2000, 1800)).toBeCloseTo(-10, 10);
    expect(regressionPct(budgetById('cold_start_ms'), 2000, 2000)).toBe(0);
  });

  it('rechnet min-Metriken: kleiner ist schlechter', () => {
    expect(regressionPct(budgetById('fps_pan_zoom'), 40, 36)).toBeCloseTo(10, 10);
    expect(regressionPct(budgetById('fps_pan_zoom'), 40, 44)).toBeCloseTo(-10, 10);
  });

  it('weigert sich, gegen einen Referenzwert 0 zu vergleichen', () => {
    expect(() => regressionPct(budgetById('cold_start_ms'), 0, 100)).toThrow(/nicht vergleichbar/);
  });
});

describe('sameEnvironment() / describeEnvironment()', () => {
  it('erkennt identische Messumgebungen', () => {
    expect(sameEnvironment(ENV, { ...ENV })).toBe(true);
  });

  it('erkennt jede einzelne Abweichung', () => {
    expect(sameEnvironment(ENV, { ...ENV, cpuThrottleRate: 1 })).toBe(false);
    expect(sameEnvironment(ENV, { ...ENV, viewport: '1024x600' })).toBe(false);
    expect(sameEnvironment(ENV, { ...ENV, glRenderer: 'Intel UHD' })).toBe(false);
    expect(sameEnvironment(ENV, { ...ENV, cpuCount: 8 })).toBe(false);
  });

  it('beschreibt die Umgebung fuer den Kommentar lesbar', () => {
    expect(describeEnvironment(ENV)).toContain('CPU-Throttle 4x');
    expect(describeEnvironment(ENV)).toContain('4 vCPU');
  });
});

describe('evaluateTrend()', () => {
  const baseline = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 });

  it('gatet ohne Referenz nicht und sagt das auch', () => {
    const trend = evaluateTrend(DEFS, null, baseline);
    expect(trend.comparable).toBe(false);
    expect(trend.red).toBe(false);
    expect(trend.incomparableReason).toMatch(/erster Lauf/i);
  });

  it('meldet keine Regression bei praktisch identischen Laeufen', () => {
    const current = report({ cold_start_ms: 2300, ws_latency_ms: 6.3, fps_pan_zoom: 10.5 });
    const trend = evaluateTrend(DEFS, baseline, current);
    expect(trend.comparable).toBe(true);
    expect(trend.red).toBe(false);
    expect(trend.regressedIds).toEqual([]);
  });

  it('wird rot, sobald eine blockierende Metrik um > 10 % schlechter wird', () => {
    const current = report({ cold_start_ms: 2600, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 });
    const trend = evaluateTrend(DEFS, baseline, current);
    expect(trend.red).toBe(true);
    expect(trend.regressedIds).toEqual(['cold_start_ms']);
    expect(trend.metrics.find((m) => m.id === 'cold_start_ms')?.regressionPct).toBeCloseTo(15.6, 1);
  });

  it('gatet nicht auf Rauschen unterhalb von 5 % des Budgets', () => {
    // +4 ms auf 4 ms waeren +100 % -- aber 4 ms liegen unter 5 % des
    // 500-ms-Budgets (= 25 ms), also keine Regression. Genau dieser Fehlalarm
    // ist real aufgetreten (Reroute 10,0 -> 12,0 ms).
    const noisyBase = report({ cold_start_ms: 2250, ws_latency_ms: 4.0, fps_pan_zoom: 10.4 });
    const noisyCurr = report({ cold_start_ms: 2250, ws_latency_ms: 8.0, fps_pan_zoom: 10.4 });
    const trend = evaluateTrend(DEFS, noisyBase, noisyCurr);
    expect(trend.red).toBe(false);
  });

  it('rechnet die Rauschgrenze je Metrik aus dem Budget', () => {
    expect(REGRESSION_NOISE_FLOOR_BUDGET_PCT).toBe(5);
    expect(regressionNoiseFloor(budgetById('cold_start_ms'))).toBe(250);
    expect(regressionNoiseFloor(budgetById('ws_latency_ms'))).toBe(25);
    expect(regressionNoiseFloor(budgetById('reroute_ms'))).toBe(150);
    expect(regressionNoiseFloor(budgetById('fps_pan_zoom'))).toBeCloseTo(1.5, 10);
    expect(regressionNoiseFloor(budgetById('rss_core_mb'))).toBe(15);
  });

  /**
   * Die Rauschgrenze darf das Gate nicht zahnlos machen: die in E10-T2
   * geforderte kuenstliche 200-ms-Verschlechterung muss auch mit 5 %
   * zuverlaessig ROT werden. Real gemessen verschiebt das Fixture die
   * WS-Latenz von ~6,5 ms auf ~212 ms und den Kaltstart von ~2,3 s auf ~3,2 s.
   */
  it('faengt die 200-ms-Verschlechterung trotz angehobener Rauschgrenze', () => {
    // Die echten Zahlen aus dem Nachweislauf: das Fixture schiebt die
    // WS-Latenz von ~6,5 ms auf ~212 ms und den Kaltstart von ~2,3 s auf
    // ~3,2 s -- beides weit ueber der 5-%-Rauschgrenze (25 ms bzw. 250 ms).
    const base = report({ cold_start_ms: 2300, ws_latency_ms: 6.5, fps_pan_zoom: 10.4 });
    const degraded = report({ cold_start_ms: 3200, ws_latency_ms: 212, fps_pan_zoom: 10.4 });
    expect(evaluateTrend(DEFS, base, degraded).regressedIds).toEqual([
      'cold_start_ms',
      'ws_latency_ms',
    ]);
  });

  it('gatet oberhalb der Rauschgrenze weiterhin', () => {
    // +36 ms auf 4 ms: ueber der 25-ms-Grenze und weit ueber 10 % -> rot.
    const base = report({ cold_start_ms: 2250, ws_latency_ms: 4.0, fps_pan_zoom: 10.4 });
    const curr = report({ cold_start_ms: 2250, ws_latency_ms: 40.0, fps_pan_zoom: 10.4 });
    expect(evaluateTrend(DEFS, base, curr).regressedIds).toEqual(['ws_latency_ms']);
  });

  it('unterdrueckt den real beobachteten Fehlalarm (6,5 -> 17,2 ms unter Maschinenlast)', () => {
    // Genau der Lauf, der den Erholungsschritt des Nachweisskripts hat
    // scheitern lassen, obwohl gar nichts verschlechtert war.
    const base = report({ cold_start_ms: 2300, ws_latency_ms: 6.5, fps_pan_zoom: 10.4 });
    const curr = report({ cold_start_ms: 2300, ws_latency_ms: 17.2, fps_pan_zoom: 10.4 });
    expect(evaluateTrend(DEFS, base, curr).regressedIds).toEqual([]);
  });

  it('laesst advisory-Metriken auch im Trend nicht blockieren', () => {
    const advisoryBase = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 }, [
      { id: 'fps_pan_zoom', advisory: true, advisoryReason: 'Softwarerasterung' },
    ]);
    const advisoryCurr = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 4.0 }, [
      { id: 'fps_pan_zoom', advisory: true, advisoryReason: 'Softwarerasterung' },
    ]);
    const trend = evaluateTrend(DEFS, advisoryBase, advisoryCurr);
    expect(trend.metrics.find((m) => m.id === 'fps_pan_zoom')?.regressionPct).toBeCloseTo(61.5, 1);
    expect(trend.red).toBe(false);
  });

  it('vergleicht nicht ueber Umgebungsgrenzen hinweg', () => {
    const other: PerfReport = {
      ...report({ cold_start_ms: 9000, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 }),
      environment: { ...ENV, cpuThrottleRate: 1 },
    };
    const trend = evaluateTrend(DEFS, baseline, other);
    expect(trend.comparable).toBe(false);
    expect(trend.red).toBe(false);
    expect(trend.incomparableReason).toMatch(/unterschiedlichen Messumgebungen/);
  });

  it('markiert deutliche Verbesserungen als solche', () => {
    const current = report({ cold_start_ms: 1500, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 });
    const trend = evaluateTrend(DEFS, baseline, current);
    expect(trend.metrics.find((m) => m.id === 'cold_start_ms')?.improved).toBe(true);
    expect(trend.red).toBe(false);
  });

  it('DER FALL AUS DER AUFGABENSTELLUNG: 200-ms-Fixture reisst kein absolutes Budget, aber das Regressions-Gate', () => {
    // Real gemessen (siehe scripts/perf-degradation-proof.sh):
    //   Kaltstart 2250 ms -> 3040 ms   (Budget 5000 ms -> beide GRUEN)
    //   WS-Latenz    6 ms ->  210 ms   (Budget  500 ms -> beide GRUEN)
    const advisoryFps: Partial<Measurement>[] = [
      { id: 'fps_pan_zoom', advisory: true, advisoryReason: 'SwiftShader-Softwarerasterung' },
    ];
    const gpuBaseline = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 }, advisoryFps);
    const degraded = report({ cold_start_ms: 3040, ws_latency_ms: 210, fps_pan_zoom: 10.4 }, advisoryFps);
    expect(degraded.evaluation.overall).not.toBe('red');
    expect(degraded.evaluation.metrics.find((m) => m.id === 'cold_start_ms')?.status).toBe('green');
    expect(degraded.evaluation.metrics.find((m) => m.id === 'ws_latency_ms')?.status).toBe('green');

    const trend = evaluateTrend(DEFS, gpuBaseline, degraded);
    expect(trend.red).toBe(true);
    expect(trend.regressedIds).toEqual(['cold_start_ms', 'ws_latency_ms']);
  });

  it('haelt die Toleranz bei 10 %', () => {
    expect(REGRESSION_TOLERANCE_PCT).toBe(10);
  });
});

describe('renderTrendComment()', () => {
  const baseline = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 });

  it('nennt Messwert, Budget, Verstoss und beide Gates', () => {
    const current = report({ cold_start_ms: 2300, ws_latency_ms: 6.3, fps_pan_zoom: 10.5 });
    const md = renderTrendComment(current, evaluateTrend(DEFS, baseline, current));
    expect(md).toContain('Performance-Budgets (E10-T2)');
    expect(md).toContain('Budget-Gate');
    expect(md).toContain('Regressions-Gate');
    expect(md).toContain('CPU-Throttle 4x');
    expect(md).toContain('Kaltstart bis interaktive Karte');
  });

  it('weist nicht gemessene Budgets ausdruecklich als solche aus', () => {
    const defs = [...RUNTIME_BUDGETS.slice(0, 1), budgetById('rss_valhalla_mb')];
    const partial: PerfReport = {
      schema: 'yapaja.perf.v1',
      generatedAt: '2026-08-03T00:00:00.000Z',
      gitSha: null,
      environment: ENV,
      evaluation: evaluateReport(defs, [
        { id: 'cold_start_ms', value: 2250 },
        {
          id: 'rss_valhalla_mb',
          value: null,
          notMeasuredReason: 'Valhalla laeuft in der per-PR-Pipeline nicht als Dienst.',
        },
      ]),
    };
    const md = renderTrendComment(partial, evaluateTrend(defs, null, partial));
    expect(md).toContain('NICHT gemessen');
    expect(md).toContain('nicht als Dienst');
    // Ein nicht gemessenes Budget darf nirgends als gruen auftauchen.
    expect(partial.evaluation.overall).toBe('warn');
  });

  it('weist advisory-Metriken getrennt aus', () => {
    const current = report({ cold_start_ms: 2250, ws_latency_ms: 6.2, fps_pan_zoom: 10.4 }, [
      { id: 'fps_pan_zoom', advisory: true, advisoryReason: 'SwiftShader-Softwarerasterung' },
    ]);
    const md = renderTrendComment(current, evaluateTrend(DEFS, baseline, current));
    expect(md).toContain('nicht zertifizierbar');
    expect(md).toContain('SwiftShader-Softwarerasterung');
    expect(md).toContain('(nur Hinweis)');
  });
});
