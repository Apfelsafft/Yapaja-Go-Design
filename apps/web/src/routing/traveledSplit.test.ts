/**
 * Das Auftrennen der Route in „gefahren" und „kommt noch".
 *
 * Die Zahlen hier sind keine Wunschwerte: die Punkte liegen auf EINEM
 * Laengengrad, damit die Abschnittslaengen von Hand nachrechenbar sind
 * (0,001° Breite ≈ 111,19 m). Wo eine Erwartung von der Haversine-Formel
 * abhaengt, steht sie mit Toleranz da -- eine auf zehn Stellen festgenagelte
 * Erdkugel prueft nichts als sich selbst.
 */

import { describe, it, expect } from 'vitest';
import {
  cumulativeMeters,
  progressFromRemaining,
  splitRouteAtProgress,
  type Coord,
} from './traveledSplit.js';

/** Fuenf Punkte, je ~111,19 m auseinander, streng nach Norden. */
const LINE: Coord[] = [
  [9.7, 47.4],
  [9.7, 47.401],
  [9.7, 47.402],
  [9.7, 47.403],
  [9.7, 47.404],
];
const CUM = cumulativeMeters(LINE);
const SEG_M = CUM[1];
const TOTAL_M = CUM[4];

describe('die Laengen', () => {
  it('beginnen bei null und wachsen', () => {
    expect(CUM[0]).toBe(0);
    expect(CUM).toHaveLength(LINE.length);
    for (let i = 1; i < CUM.length; i++) expect(CUM[i]).toBeGreaterThan(CUM[i - 1]);
  });

  it('entsprechen dem, was 0,001 Grad Breite ausmachen', () => {
    // ~111,19 m. Waere hier ein anderer Erdradius im Spiel als im Core,
    // laege der Trennpunkt spaeter sichtbar neben dem Fahrzeug.
    expect(SEG_M).toBeGreaterThan(111);
    expect(SEG_M).toBeLessThan(111.4);
    expect(TOTAL_M).toBeCloseTo(4 * SEG_M, 6);
  });

  it('sind fuer eine leere Liste leer', () => {
    expect(cumulativeMeters([])).toEqual([]);
  });
});

describe('der Fortschritt aus der Restentfernung', () => {
  it('ist die Differenz zur Gesamtlaenge', () => {
    expect(progressFromRemaining(1000, 400)).toBe(600);
  });

  it('ist unbekannt, wenn der Core nichts meldet', () => {
    // Genau der Fall vor der ersten Positionsmeldung -- und der Grund, warum
    // die Linie dann durchgehend blau bleibt statt kurz ganz grau zu werden.
    expect(progressFromRemaining(1000, null)).toBeNull();
    expect(progressFromRemaining(1000, undefined)).toBeNull();
  });

  it('ist unbekannt bei unbrauchbaren Zahlen', () => {
    expect(progressFromRemaining(1000, Number.NaN)).toBeNull();
    expect(progressFromRemaining(Number.NaN, 400)).toBeNull();
    expect(progressFromRemaining(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('im Zweifel bleibt alles blau', () => {
  it('ohne bekannten Fortschritt', () => {
    const { traveled, remaining } = splitRouteAtProgress(LINE, CUM, null);
    expect(traveled).toEqual([]);
    expect(remaining).toEqual(LINE);
  });

  it('am Start, vor dem ersten Meter', () => {
    expect(splitRouteAtProgress(LINE, CUM, 0).traveled).toEqual([]);
  });

  it('bei einem unsinnigen Fortschritt hinter dem Start', () => {
    // Kaeme so eine Zahl je an, waere „alles grau" die gefaehrlichere
    // Antwort: sie nimmt der Fuehrung die Farbe.
    expect(splitRouteAtProgress(LINE, CUM, -50).traveled).toEqual([]);
    expect(splitRouteAtProgress(LINE, CUM, Number.NaN).traveled).toEqual([]);
  });

  it('bei einer Linie, die keine ist', () => {
    expect(splitRouteAtProgress([[9.7, 47.4]], [0], 10)).toEqual({
      traveled: [],
      remaining: [[9.7, 47.4]],
    });
    expect(splitRouteAtProgress([], [], 10)).toEqual({ traveled: [], remaining: [] });
  });
});

describe('mitten auf einem Abschnitt', () => {
  const HALF = SEG_M * 1.5; // Mitte des zweiten Abschnitts

  it('endet die gefahrene Haelfte am Fahrzeug', () => {
    const { traveled } = splitRouteAtProgress(LINE, CUM, HALF);
    expect(traveled).toHaveLength(3); // [0], [1], Trennpunkt
    expect(traveled[2][0]).toBeCloseTo(9.7, 9);
    expect(traveled[2][1]).toBeCloseTo(47.4015, 9);
  });

  it('und die verbleibende beginnt dort -- ohne Luecke', () => {
    const { traveled, remaining } = splitRouteAtProgress(LINE, CUM, HALF);
    expect(remaining[0]).toEqual(traveled[traveled.length - 1]);
    expect(remaining).toHaveLength(4); // Trennpunkt + [2], [3], [4]
    expect(remaining[remaining.length - 1]).toEqual(LINE[4]);
  });

  it('zusammen ergeben beide Haelften wieder die ganze Strecke', () => {
    const { traveled, remaining } = splitRouteAtProgress(LINE, CUM, HALF);
    const a = cumulativeMeters(traveled);
    const b = cumulativeMeters(remaining);
    expect(a[a.length - 1] + b[b.length - 1]).toBeCloseTo(TOTAL_M, 6);
  });

  it('waechst die graue Haelfte mit dem Fortschritt', () => {
    const laenge = (p: number): number => {
      const c = cumulativeMeters(splitRouteAtProgress(LINE, CUM, p).traveled);
      return c.length === 0 ? 0 : c[c.length - 1];
    };
    expect(laenge(SEG_M * 0.5)).toBeCloseTo(SEG_M * 0.5, 6);
    expect(laenge(SEG_M * 2.5)).toBeCloseTo(SEG_M * 2.5, 6);
    expect(laenge(SEG_M * 2.5)).toBeGreaterThan(laenge(SEG_M * 0.5));
  });
});

describe('genau auf einem Stuetzpunkt', () => {
  it('gehoert dieser beiden Haelften an, aber nur einmal', () => {
    const { traveled, remaining } = splitRouteAtProgress(LINE, CUM, CUM[2]);
    expect(traveled).toEqual([LINE[0], LINE[1], LINE[2]]);
    expect(remaining).toEqual([LINE[2], LINE[3], LINE[4]]);
  });
});

describe('am Ende der Fahrt', () => {
  it('ist alles gefahren', () => {
    const { traveled, remaining } = splitRouteAtProgress(LINE, CUM, TOTAL_M);
    expect(traveled).toEqual(LINE);
    expect(remaining).toEqual([]);
  });

  it('auch wenn der Fortschritt ueber das Ziel hinauslaeuft', () => {
    expect(splitRouteAtProgress(LINE, CUM, TOTAL_M + 500).remaining).toEqual([]);
  });
});

describe('doppelte Stuetzpunkte', () => {
  // Sie kommen in echten Geometrien vor, und ein Abschnitt der Laenge null
  // waere ein Anteil 0/0 -- ein Trennpunkt aus zwei NaN, also eine Linie, die
  // MapLibre stillschweigend wegwirft. Im Quelltext steht deshalb KEINE
  // Abfrage darauf (sie war nicht ausloesbar, siehe dort); die Eigenschaft
  // wird hier gepruft statt behauptet: jede Stelle, an der ein Doppelpunkt
  // stehen kann, ueber die ganze Laenge abgetastet.
  const BASIS: Coord[] = [
    [9.7, 47.4],
    [9.7, 47.401],
    [9.7, 47.402],
    [9.7, 47.403],
  ];

  for (let stelle = 0; stelle < BASIS.length; stelle++) {
    it(`an Stelle ${stelle} bleibt jeder Punkt eine Zahl`, () => {
      const mitDoppel: Coord[] = [
        ...BASIS.slice(0, stelle + 1),
        [...BASIS[stelle]] as Coord,
        ...BASIS.slice(stelle + 1),
      ];
      const cum = cumulativeMeters(mitDoppel);
      const gesamt = cum[cum.length - 1];

      for (let p = 0; p <= gesamt + 5; p += 3) {
        const { traveled, remaining } = splitRouteAtProgress(mitDoppel, cum, p);
        for (const [lon, lat] of [...traveled, ...remaining]) {
          expect(Number.isFinite(lon) && Number.isFinite(lat), `bei ${p} m`).toBe(true);
        }
        // Und ohne Luecke, solange beide Haelften existieren.
        if (traveled.length > 0 && remaining.length > 0) {
          expect(remaining[0], `bei ${p} m`).toEqual(traveled[traveled.length - 1]);
        }
      }
    });
  }
});

describe('die gefahrene Haelfte taugt immer als Linie', () => {
  it('sie hat nie genau einen Punkt', () => {
    // Eine Linie aus einem Punkt laesst sich nicht zeichnen. Ueber die ganze
    // Strecke abgetastet: entweder leer oder mindestens zwei.
    for (let p = 0; p <= TOTAL_M + 10; p += 7) {
      const { traveled } = splitRouteAtProgress(LINE, CUM, p);
      expect(traveled.length === 0 || traveled.length >= 2, `bei ${p} m`).toBe(true);
    }
  });
});
