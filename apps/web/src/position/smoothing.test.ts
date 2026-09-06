/**
 * Der Zwischenschritt zwischen zwei Positionsmeldungen.
 *
 * Die Begruendung und die gemessenen Raten stehen in `smoothing.ts`.
 */

import { describe, it, expect } from 'vitest';
import { interpolateFix, type SmoothFix } from './smoothing.js';

const A: SmoothFix = { lat: 47.4, lon: 9.7, heading: 0 };
const B: SmoothFix = { lat: 47.402, lon: 9.704, heading: 90 };

describe('der Weg von einer Meldung zur naechsten', () => {
  it('beginnt genau am Ausgangspunkt', () => {
    expect(interpolateFix(A, B, 0)).toEqual(A);
  });

  it('endet genau am Ziel', () => {
    expect(interpolateFix(A, B, 1)).toEqual(B);
  });

  it('liegt in der Mitte auch wirklich in der Mitte', () => {
    const m = interpolateFix(A, B, 0.5);
    expect(m.lat).toBeCloseTo(47.401, 9);
    expect(m.lon).toBeCloseTo(9.702, 9);
    expect(m.heading).toBeCloseTo(45, 9);
  });

  it('geht gleichmaessig voran', () => {
    // Sonst waere die Bewegung zwar fluessig, aber ungleichmaessig -- ein
    // Zucken statt eines Sprungs.
    const viertel = interpolateFix(A, B, 0.25).lat - A.lat;
    const haelfte = interpolateFix(A, B, 0.5).lat - A.lat;
    expect(haelfte).toBeCloseTo(viertel * 2, 12);
  });
});

describe('Werte ausserhalb bleiben auf der Strecke', () => {
  it('vor dem Start', () => {
    // Ein negativer Anteil (Uhr springt zurueck) darf den Punkt nicht HINTER
    // die letzte Meldung setzen.
    expect(interpolateFix(A, B, -0.5)).toEqual(A);
  });

  it('nach dem Ziel', () => {
    // Und ein Anteil ueber 1 (verspaeteter Einzelbild-Aufruf) nicht darueber
    // hinaus -- das waere Raten, siehe Kopfkommentar.
    expect(interpolateFix(A, B, 1.7)).toEqual(B);
  });
});

describe('der Kurs dreht ueber die Null, nicht darum herum', () => {
  it('von 350 auf 10 Grad sind zwanzig Grad, nicht dreihundertvierzig', () => {
    // Geradlinig gerechnet drehte sich das Fahrzeug hier fast einmal ganz
    // herum. Dieselbe Falle wie beim Absturz in 0.6.4.
    const m = interpolateFix(
      { lat: 0, lon: 0, heading: 350 },
      { lat: 0, lon: 0, heading: 10 },
      0.5,
    );
    expect(m.heading).toBe(0);
  });

  it('und umgekehrt genauso', () => {
    const m = interpolateFix(
      { lat: 0, lon: 0, heading: 10 },
      { lat: 0, lon: 0, heading: 350 },
      0.5,
    );
    expect(m.heading).toBe(0);
  });

  it('bleibt immer im Bereich 0 bis unter 360', () => {
    for (const [von, nach] of [
      [350, 10],
      [10, 350],
      [0, 180],
      [270, 90],
      [359, 1],
    ]) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const h = interpolateFix({ lat: 0, lon: 0, heading: von }, { lat: 0, lon: 0, heading: nach }, t)
          .heading!;
        expect(h >= 0 && h < 360, `${von} -> ${nach} bei t=${t} ergab ${h}`).toBe(true);
      }
    }
  });

  it('nimmt nie den langen Weg', () => {
    // Der Zwischenwert darf nie weiter von BEIDEN Enden entfernt sein als
    // die Enden voneinander.
    for (const [von, nach] of [
      [350, 10],
      [10, 350],
      [200, 20],
      [45, 315],
    ]) {
      const spanne = Math.abs(((nach - von + 540) % 360) - 180);
      const h = interpolateFix({ lat: 0, lon: 0, heading: von }, { lat: 0, lon: 0, heading: nach }, 0.5)
        .heading!;
      const zuVon = Math.abs(((h - von + 540) % 360) - 180);
      expect(zuVon, `${von} -> ${nach}`).toBeLessThanOrEqual(spanne / 2 + 1e-9);
    }
  });
});

describe('wenn ein Kurs fehlt', () => {
  it('gilt ohne Ausgangskurs sofort der neue', () => {
    expect(interpolateFix({ lat: 0, lon: 0, heading: null }, { lat: 0, lon: 0, heading: 90 }, 0.5)
      .heading).toBe(90);
  });

  it('bleibt es ohne neuen Kurs beim alten', () => {
    // Sonst schnappte die Nase des Pucks auf Norden, sobald der Empfaenger
    // den Kurs einmal nicht mitliefert.
    expect(interpolateFix({ lat: 0, lon: 0, heading: 90 }, { lat: 0, lon: 0, heading: null }, 0.5)
      .heading).toBe(90);
  });

  it('und bleibt leer, wenn keiner von beiden einen hat', () => {
    expect(interpolateFix({ lat: 0, lon: 0, heading: null }, { lat: 1, lon: 1, heading: null }, 0.5)
      .heading).toBeNull();
  });
});
