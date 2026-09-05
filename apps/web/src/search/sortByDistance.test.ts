/**
 * Die Trefferliste nach Entfernung.
 *
 * Gemeldet: „Bitte sortiere die Ergebnisse der Suche nach Entfernung. Das
 * naechste Ergebnis nach oben."
 *
 * Vorher wurde die Entfernung je Treffer ANGEZEIGT, aber nirgends sortiert --
 * man sah, wie weit alles weg ist, und musste sich das naechste selbst
 * heraussuchen.
 */

import { describe, it, expect } from 'vitest';
import type { SearchResult } from '@yapaja/shared';
import { sortResultsByDistance } from './sortByDistance.js';

const HIER = { lat: 49.0, lon: 8.0 };

/** Ein Treffer `kmNord` Kilometer noerdlich von `HIER`. */
function treffer(name: string, kmNord: number): SearchResult {
  return {
    name,
    latlng: { lat: HIER.lat + kmNord / 111.195, lon: HIER.lon },
    source: 'lite',
  } as SearchResult;
}

const namen = (rs: readonly SearchResult[]): string[] => rs.map((r) => r.name);

describe('das naechste nach oben', () => {
  it('kehrt eine verkehrt herum gelieferte Liste um', () => {
    const sortiert = sortResultsByDistance([treffer('fern', 50), treffer('nah', 1)], HIER);
    expect(namen(sortiert)).toEqual(['nah', 'fern']);
  });

  it('ordnet auch mehrere richtig', () => {
    const sortiert = sortResultsByDistance(
      [treffer('c', 30), treffer('a', 2), treffer('d', 100), treffer('b', 9)],
      HIER,
    );
    expect(namen(sortiert)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('eine bereits richtige Liste bleibt richtig', () => {
    const sortiert = sortResultsByDistance([treffer('a', 1), treffer('b', 2)], HIER);
    expect(namen(sortiert)).toEqual(['a', 'b']);
  });
});

describe('was unangetastet bleibt', () => {
  it('ohne Position bleibt die Reihenfolge des Suchdienstes', () => {
    // Nach etwas zu sortieren, das man nicht kennt, hiesse hier: nach nichts.
    const roh = [treffer('fern', 50), treffer('nah', 1)];
    expect(namen(sortResultsByDistance(roh, null))).toEqual(['fern', 'nah']);
    expect(namen(sortResultsByDistance(roh, undefined))).toEqual(['fern', 'nah']);
  });

  it('auch bei unbrauchbaren Koordinaten', () => {
    const roh = [treffer('fern', 50), treffer('nah', 1)];
    expect(namen(sortResultsByDistance(roh, { lat: Number.NaN, lon: 8 }))).toEqual(['fern', 'nah']);
  });

  it('die urspruengliche Liste wird nicht veraendert', () => {
    const roh = [treffer('fern', 50), treffer('nah', 1)];
    sortResultsByDistance(roh, HIER);
    expect(namen(roh)).toEqual(['fern', 'nah']);
  });

  it('gleich weit entfernte behalten ihre Reihenfolge', () => {
    // Sonst ergaebe dieselbe Suche zweimal verschiedene Listen -- und bei
    // gleicher Entfernung soll weiterhin die Bewertung des Suchdienstes
    // entscheiden.
    const sortiert = sortResultsByDistance(
      [treffer('erst', 5), treffer('dann', 5), treffer('zuletzt', 5)],
      HIER,
    );
    expect(namen(sortiert)).toEqual(['erst', 'dann', 'zuletzt']);
  });

  it('kein Treffer bleibt kein Treffer', () => {
    expect(sortResultsByDistance([], HIER)).toEqual([]);
  });

  it('es geht nichts verloren', () => {
    const roh = [treffer('a', 3), treffer('b', 1), treffer('c', 2)];
    expect(sortResultsByDistance(roh, HIER)).toHaveLength(3);
  });
});
