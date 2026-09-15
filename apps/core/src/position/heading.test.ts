/**
 * Die Fahrtrichtung im Stand.
 *
 * Die Zahlen unten sind nicht ausgedacht: sie stammen aus dem Protokoll eines
 * VK-162, der unbewegt auf einer Fensterbank lag.
 */
import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaia/shared';
import { RICHTUNG_MIN_TEMPO_MS, richtungImStandVerwerfen } from './heading.js';

function fix(teil: Partial<Position>): Position {
  return {
    lat: 49.239201314,
    lon: 8.320362664,
    alt: 126.6655,
    speed: 0,
    heading: null,
    accuracy: 10,
    source: 'gpsd',
    fix: '3d',
    ts: '2026-09-15T22:58:24.000Z',
    ...teil,
  };
}

describe('richtungImStandVerwerfen', () => {
  /**
   * ─── DER GEMELDETE FALL ───────────────────────────────────────────────────
   * „Der Sensor liegt ruhig auf der Fensterbank aber die Anzeige der Karte
   * dreht sich andauernd." Drei aufeinanderfolgende Fixes desselben,
   * unbewegten Geräts -- die Richtung springt über 150°.
   */
  it.each([
    { track: 170.5026, speed: 0.025, zeit: '22:58:24' },
    { track: 39.597, speed: 0.016, zeit: '23:00:33' },
    { track: 186.9639, speed: 0.036, zeit: '23:00:38' },
  ])('verwirft die Richtung des stehenden Empfängers ($zeit)', ({ track, speed }) => {
    expect(richtungImStandVerwerfen(fix({ heading: track, speed })).heading).toBeNull();
  });

  it('lässt die Richtung bei echter Fahrt stehen', () => {
    // 50 km/h sind 13,9 m/s.
    const ergebnis = richtungImStandVerwerfen(fix({ heading: 170.5, speed: 13.9 }));
    expect(ergebnis.heading).toBe(170.5);
  });

  it('lässt sie genau AUF der Schwelle stehen', () => {
    // Die Schwelle ist eine Untergrenze, keine Lücke. Wäre sie exklusiv,
    // fiele genau ein Wert stumm heraus.
    const ergebnis = richtungImStandVerwerfen(
      fix({ heading: 90, speed: RICHTUNG_MIN_TEMPO_MS }),
    );
    expect(ergebnis.heading).toBe(90);
  });

  it('verwirft sie knapp darunter', () => {
    const ergebnis = richtungImStandVerwerfen(
      fix({ heading: 90, speed: RICHTUNG_MIN_TEMPO_MS - 0.01 }),
    );
    expect(ergebnis.heading).toBeNull();
  });

  it('lässt die Richtung stehen, wenn das TEMPO unbekannt ist', () => {
    // Dann lässt sich nicht beurteilen, ob sie Rauschen ist -- und eine
    // Quelle, die Richtung aber kein Tempo liefert, soll nicht stumm ihre
    // einzige Richtungsangabe verlieren.
    const ergebnis = richtungImStandVerwerfen(fix({ heading: 90, speed: null }));
    expect(ergebnis.heading).toBe(90);
  });

  it('rührt nichts an, wenn es gar keine Richtung gibt', () => {
    const eingabe = fix({ heading: null, speed: 0.02 });
    expect(richtungImStandVerwerfen(eingabe)).toBe(eingabe);
  });

  it('ändert sonst NICHTS an der Position', () => {
    // Nur die Richtung. Ein Filter, der nebenbei die Koordinaten anfasst,
    // wäre in einer Navigation das Schlimmste.
    const eingabe = fix({ heading: 170.5, speed: 0.025 });
    const ergebnis = richtungImStandVerwerfen(eingabe);
    expect({ ...ergebnis, heading: 0 }).toEqual({ ...eingabe, heading: 0 });
  });

  it('gibt dasselbe Objekt zurück, wenn nichts zu tun ist', () => {
    const eingabe = fix({ heading: 90, speed: 20 });
    expect(richtungImStandVerwerfen(eingabe)).toBe(eingabe);
  });
});
