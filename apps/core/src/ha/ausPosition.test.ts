/**
 * Tempo und Höhe aus der Position — und wann eben nicht.
 *
 * Die Zahlen hier sind nachgerechnet, nicht abgeschrieben: 25 m/s sind
 * 90 km/h, 13,9 m/s sind 50,04 km/h. Ein Test, der dieselbe Formel noch
 * einmal aufschreibt, prüft nur, dass man zweimal dasselbe tippt.
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaia/shared';
import { tempoAusPosition, hoeheAusPosition, hatFix, MS_JE_KMH } from './ausPosition.js';

function pos(teil: Partial<Position>): Position {
  return {
    lat: 49.239,
    lon: 8.32,
    alt: 120,
    speed: 25,
    heading: 180,
    accuracy: 53.2,
    source: 'gpsd',
    fix: '3d',
    ts: '2026-09-17T18:23:00.000Z',
    ...teil,
  } as Position;
}

describe('tempoAusPosition — die Angabe war da, sie wurde nur nicht abgeholt', () => {
  it('rechnet m/s in km/h um', () => {
    // 25 m/s = 90 km/h. Von Hand gerechnet.
    expect(tempoAusPosition(pos({ speed: 25 }))).toBe(90);
  });

  it('rundet auf eine Nachkommastelle', () => {
    // 13,9 m/s = 50,04 km/h. Eine Tempoanzeige mit sechs Stellen behauptet
    // eine Genauigkeit, die das GPS nicht hat.
    expect(tempoAusPosition(pos({ speed: 13.9 }))).toBe(50);
    expect(tempoAusPosition(pos({ speed: 13.95 }))).toBe(50.2);
  });

  it('Stillstand ist ein Messwert und kein fehlender Wert', () => {
    // 0 km/h heisst „steht". Würde das zu `null`, zeigte das Display beim
    // Halt „unbekannt" statt einer Null — und aus einer Messung würde eine
    // Lücke.
    expect(tempoAusPosition(pos({ speed: 0 }))).toBe(0);
  });

  it('ohne Fix gibt es kein Tempo', () => {
    // Was ohne Satellitenlösung in `speed` steht, ist kein Messwert.
    expect(tempoAusPosition(pos({ fix: 'none', speed: 25 }))).toBeNull();
  });

  it('ein 2D-Fix reicht fürs Tempo', () => {
    // Anders als bei der Höhe: die Geschwindigkeit über Grund braucht keinen
    // vierten Satelliten.
    expect(tempoAusPosition(pos({ fix: '2d', speed: 25 }))).toBe(90);
  });

  it('verweigert, was keine Zahl ist', () => {
    for (const unsinn of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tempoAusPosition(pos({ speed: unsinn as unknown as number }))).toBeNull();
    }
  });

  it('verweigert ein negatives Tempo', () => {
    // Das Schema schreibt `minimum: 0` vor. Ein negativer Wert ist ein Fehler
    // der Quelle; ihn weiterzureichen hiesse, ihn zu bestätigen.
    expect(tempoAusPosition(pos({ speed: -5 }))).toBeNull();
  });

  it('ohne Position gibt es nichts', () => {
    expect(tempoAusPosition(null)).toBeNull();
    expect(tempoAusPosition(undefined)).toBeNull();
  });

  it('der Umrechnungsfaktor steht benannt da', () => {
    expect(MS_JE_KMH).toBe(3.6);
  });
});

describe('hoeheAusPosition — nur, wenn sie wirklich gemessen ist', () => {
  it('nimmt die Höhe bei einem 3D-Fix', () => {
    expect(hoeheAusPosition(pos({ fix: '3d', alt: 214.4 }))).toBe(214);
  });

  it('gibt bei einem 2D-Fix NICHTS zurück', () => {
    // ─── WARUM STRENGER ALS BEIM TEMPO ──────────────────────────────────────
    // Eine Höhe braucht einen vierten Satelliten. Mit einem 2D-Fix steht in
    // `alt` entweder nichts oder der zuletzt bekannte Wert — und der kann aus
    // einem anderen Tal stammen. Für ein Wohnmobil vor einer Passhöhe ist
    // das keine Kleinigkeit.
    expect(hoeheAusPosition(pos({ fix: '2d', alt: 214 }))).toBeNull();
  });

  it('ohne Fix erst recht nicht', () => {
    expect(hoeheAusPosition(pos({ fix: 'none', alt: 214 }))).toBeNull();
  });

  it('Meereshöhe 0 ist ein Messwert', () => {
    expect(hoeheAusPosition(pos({ fix: '3d', alt: 0 }))).toBe(0);
  });

  it('eine negative Höhe ist gültig', () => {
    // Das Rheindelta liegt unter dem Meeresspiegel, und ein Wohnmobil kommt
    // dort hin. Anders als beim Tempo ist das Vorzeichen hier eine Aussage.
    expect(hoeheAusPosition(pos({ fix: '3d', alt: -4 }))).toBe(-4);
  });

  it('verweigert, was keine Zahl ist', () => {
    for (const unsinn of [null, undefined, Number.NaN]) {
      expect(hoeheAusPosition(pos({ alt: unsinn as unknown as number }))).toBeNull();
    }
  });
});

describe('hatFix', () => {
  it('kennt genau die beiden brauchbaren Zustände', () => {
    expect(hatFix(pos({ fix: '2d' }))).toBe(true);
    expect(hatFix(pos({ fix: '3d' }))).toBe(true);
    expect(hatFix(pos({ fix: 'none' }))).toBe(false);
    expect(hatFix(null)).toBe(false);
  });
});
