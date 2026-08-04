/**
 * E10-T2 Pflicht-Test: Aggregations- und Plausibilitaetslogik.
 *
 * Die 15-%-Streuungsvorgabe ("sonst Messaufbau fixen, nicht Schwellen
 * aufweichen!") wird hier als CODE festgehalten, damit sie ueberpruefbar ist
 * und nicht nur in einer README steht.
 */

import { describe, it, expect } from 'vitest';
import {
  STABILITY_MAX_SPREAD_PCT,
  evaluateStability,
  interquartileMean,
  mean,
  median,
  percentile,
  relativeSpreadPct,
} from './statistics.js';

describe('median()', () => {
  it('rechnet ungerade und gerade Laengen korrekt', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('wirft auf leerer Messreihe statt NaN zu liefern', () => {
    expect(() => median([])).toThrow(/leerer Messreihe/);
  });
});

describe('mean()', () => {
  it('rechnet den arithmetischen Mittelwert', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('wirft auf leerer Messreihe', () => {
    expect(() => mean([])).toThrow(/leerer Messreihe/);
  });
});

describe('interquartileMean() -- die Kennzahl je Lauf', () => {
  it('mittelt die mittleren 50 % der sortierten Stichprobe', () => {
    // sortiert: 1..8 -> mittlere 50 % = 3,4,5,6 -> 4.5
    expect(interquartileMean([8, 1, 5, 3, 7, 2, 6, 4])).toBe(4.5);
  });

  it('ignoriert Ausreisser, die den Mittelwert reissen wuerden', () => {
    const samples = [5, 5, 6, 6, 6, 7, 7, 7, 8, 400];
    expect(mean(samples)).toBeGreaterThan(45);
    expect(interquartileMean(samples)).toBeCloseTo(6.5, 5);
  });

  it('faellt bei < 4 Werten bewusst auf den Median zurueck', () => {
    expect(interquartileMean([1, 2, 100])).toBe(2);
    expect(interquartileMean([5])).toBe(5);
  });

  it('reproduziert die im Kommentar dokumentierten realen WS-Latenz-Laeufe', () => {
    // Zwei echte Messreihen dieser Suite (je 20 Stichproben, ms).
    const lauf1 = [14, 7, 5, 10, 5, 4, 5, 8, 8, 5, 5, 7, 9, 9, 6, 5, 7, 7, 4, 5];
    const lauf2 = [7, 10, 8, 5, 9, 7, 4, 5, 5, 7, 7, 5, 5, 10, 4, 5, 5, 4, 5, 5];
    // Der Median quantisiert auf ganze Millisekunden und streut deshalb weit …
    expect(relativeSpreadPct([median(lauf1), median(lauf2)])).toBeGreaterThan(STABILITY_MAX_SPREAD_PCT);
    // … das interquartile Mittel bleibt deutlich unter der 15-%-Vorgabe.
    expect(
      relativeSpreadPct([interquartileMean(lauf1), interquartileMean(lauf2)]),
    ).toBeLessThan(STABILITY_MAX_SPREAD_PCT);
  });

  it('wirft auf leerer Messreihe', () => {
    expect(() => interquartileMean([])).toThrow(/leerer Messreihe/);
  });
});

describe('percentile()', () => {
  it('liefert nearest-rank-Perzentile', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.95)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 1)).toBe(10);
  });

  it('weist unsinnige Quantile und leere Reihen zurueck', () => {
    expect(() => percentile([1], 1.5)).toThrow(/q muss in \[0,1\]/);
    expect(() => percentile([], 0.5)).toThrow(/leerer Messreihe/);
  });
});

describe('relativeSpreadPct() -- die 15-%-Plausibilitaetsgroesse', () => {
  it('ist 0 bei identischen Laeufen und bei nur einem Lauf', () => {
    expect(relativeSpreadPct([100, 100, 100])).toBe(0);
    expect(relativeSpreadPct([42])).toBe(0);
  });

  it('rechnet Spannweite relativ zum Mittelwert', () => {
    // (110-90)/100 = 20 %
    expect(relativeSpreadPct([90, 110])).toBeCloseTo(20, 10);
    // (2310-2223)/2266.5 = 3,84 % -- zwei echte Kaltstart-Laeufe dieser Suite
    expect(relativeSpreadPct([2223, 2310])).toBeCloseTo(3.84, 2);
  });

  it('meldet Unendlich, wenn der Mittelwert 0 ist, die Werte aber streuen', () => {
    expect(relativeSpreadPct([0, 0])).toBe(0);
    expect(relativeSpreadPct([-5, 5])).toBe(Number.POSITIVE_INFINITY);
  });

  it('wirft auf leerer Messreihe', () => {
    expect(() => relativeSpreadPct([])).toThrow(/leerer Messreihe/);
  });
});

describe('evaluateStability()', () => {
  it('haelt zwei eng beieinanderliegende Laeufe fuer stabil', () => {
    const result = evaluateStability([
      { cold_start_ms: 2223, ws_latency_ms: 6.2 },
      { cold_start_ms: 2310, ws_latency_ms: 6.1 },
    ]);
    expect(result.stable).toBe(true);
    expect(result.unstableIds).toEqual([]);
    expect(result.metrics.find((m) => m.id === 'cold_start_ms')?.spreadPct).toBeCloseTo(3.84, 2);
  });

  it('markiert eine Metrik oberhalb von 15 % als instabil -- ohne die Schwelle zu bewegen', () => {
    const result = evaluateStability([{ reroute_ms: 100 }, { reroute_ms: 140 }]);
    expect(result.stable).toBe(false);
    expect(result.unstableIds).toEqual(['reroute_ms']);
    expect(result.maxSpreadPct).toBe(15);
  });

  it('erlaubt die 15-%-Grenze selbst noch', () => {
    // (115-100)/107.5 = 13,95 %
    expect(evaluateStability([{ m: 100 }, { m: 115 }]).stable).toBe(true);
    // (100-85)/92.5 = 16,2 %
    expect(evaluateStability([{ m: 85 }, { m: 100 }]).stable).toBe(false);
  });

  it('ueberspringt Metriken, die nicht in ALLEN Laeufen vorkommen', () => {
    const result = evaluateStability([
      { cold_start_ms: 2200, rss_core_mb: 97 },
      { cold_start_ms: 2250 },
    ]);
    expect(result.metrics.map((m) => m.id)).toEqual(['cold_start_ms']);
  });

  it('besteht auf mindestens zwei Laeufen', () => {
    expect(() => evaluateStability([{ a: 1 }])).toThrow(/mindestens 2 Laeufe/);
  });

  it('laesst eine strengere Schwelle zu, aber nicht stillschweigend eine weichere', () => {
    // Die Funktion nimmt den Parameter an -- der DEFAULT bleibt 15 %, und der
    // ist das, was Suite und Nachweis benutzen.
    expect(STABILITY_MAX_SPREAD_PCT).toBe(15);
    expect(evaluateStability([{ m: 100 }, { m: 105 }], 2).stable).toBe(false);
  });
});
