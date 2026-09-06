/**
 * Winkel liegen auf einem Kreis, nicht auf einer Zahlengeraden.
 *
 * Diese Datei haelt die Regel fest, deren Fehlen den Absturz „Maximum call
 * stack size exceeded." verursacht hat -- siehe `angles.ts` fuer die Messung
 * und `viewMode.ts` fuer die Stelle.
 */

import { describe, it, expect } from 'vitest';
import { angleDifferenceDeg, anglesMatch } from './angles.js';

describe('der kleinste Weg zwischen zwei Winkeln', () => {
  it('ist bei gleichen Winkeln null', () => {
    expect(angleDifferenceDeg(0, 0)).toBe(0);
    expect(angleDifferenceDeg(200, 200)).toBe(0);
  });

  it('ist im Kleinen die schlichte Differenz', () => {
    expect(angleDifferenceDeg(10, 40)).toBe(30);
    expect(angleDifferenceDeg(40, 10)).toBe(-30);
  });

  it('geht ueber die Null herum, nicht darum herum', () => {
    // Der eigentliche Punkt: 359 und 1 sind zwei Grad auseinander, nicht 358.
    expect(angleDifferenceDeg(359, 1)).toBe(2);
    expect(angleDifferenceDeg(1, 359)).toBe(-2);
  });

  it('bleibt im Bereich (-180, 180]', () => {
    for (let a = -720; a <= 720; a += 7) {
      for (let b = -720; b <= 720; b += 13) {
        const d = angleDifferenceDeg(a, b);
        expect(d > -180 && d <= 180, `${a} -> ${b} ergab ${d}`).toBe(true);
      }
    }
  });

  it('ist bei genau gegenueber +180, nicht -180', () => {
    expect(angleDifferenceDeg(0, 180)).toBe(180);
    expect(angleDifferenceDeg(180, 0)).toBe(180);
  });
});

describe('zeigen zwei Winkel in dieselbe Richtung?', () => {
  // ─── DIE GEMESSENEN PAARE ─────────────────────────────────────────────────
  // Links, was Yapaia setzt (GPS-Kurs, 0..360), rechts, was MapLibre danach
  // zurueckgibt. Im Browser gemessen, nicht angenommen. Genau diese Paare
  // hielt der alte Vergleich fuer grundverschieden -- und drehte deshalb
  // endlos weiter.
  const GEMESSEN: Array<[number, number]> = [
    [0, 0],
    [90, 90],
    [179, 179],
    [180, 180],
    [181, -179],
    [200, -160],
    [270, -90],
    [359, -1],
  ];

  for (const [gesetzt, gelesen] of GEMESSEN) {
    it(`Kurs ${gesetzt} und Kartenwinkel ${gelesen} sind dieselbe Richtung`, () => {
      expect(anglesMatch(gelesen, gesetzt, 0.1)).toBe(true);
    });
  }

  it('und der alte Vergleich haette genau hier danebengelegen', () => {
    // Nicht als Zierde: dieser Ausdruck stand im Quelltext und ist die
    // Ursache des Absturzes. 360 Grad Unterschied zwischen zwei Winkeln,
    // die in dieselbe Richtung zeigen.
    expect(Math.abs(-160 - 200)).toBe(360);
    expect(Math.abs(angleDifferenceDeg(-160, 200))).toBe(0);
  });

  it('wirklich verschiedene Richtungen bleiben verschieden', () => {
    expect(anglesMatch(0, 90, 0.1)).toBe(false);
    expect(anglesMatch(0, 180, 0.1)).toBe(false);
    expect(anglesMatch(-160, 20, 0.1)).toBe(false); // genau gegenueber
  });

  it('die Toleranz gilt in beide Richtungen', () => {
    expect(anglesMatch(0, 0.09, 0.1)).toBe(true);
    expect(anglesMatch(0, -0.09, 0.1)).toBe(true);
    expect(anglesMatch(0, 0.11, 0.1)).toBe(false);
  });

  it('unbrauchbare Zahlen zeigen nie in dieselbe Richtung', () => {
    // Sonst unterbliebe das Nachdrehen still, und die Karte bliebe stehen.
    expect(anglesMatch(Number.NaN, 0, 0.1)).toBe(false);
    expect(anglesMatch(0, Number.NaN, 0.1)).toBe(false);
    expect(anglesMatch(Number.POSITIVE_INFINITY, 0, 0.1)).toBe(false);
  });
});

describe('das Nachdrehen kommt zur Ruhe', () => {
  // Die Eigenschaft, um die es wirklich geht: nach EINEM Setzen darf kein
  // weiteres mehr noetig sein. Sonst ruft sich `moveend -> setCamera` selbst
  // auf, bis der Aufrufstapel voll ist.
  //
  // `wickle` ist genau das, was MapLibre laut Messung tut.
  const wickle = (grad: number): number => {
    const r = grad % 360;
    if (r > 180) return r - 360;
    if (r <= -180) return r + 360;
    return r;
  };

  it('fuer jeden Kurs von 0 bis 359', () => {
    for (let kurs = 0; kurs < 360; kurs++) {
      const nachDemSetzen = wickle(kurs);
      expect(
        anglesMatch(nachDemSetzen, kurs, 0.1),
        `Kurs ${kurs} wurde zu ${nachDemSetzen} und wuerde erneut gesetzt`,
      ).toBe(true);
    }
  });
});
