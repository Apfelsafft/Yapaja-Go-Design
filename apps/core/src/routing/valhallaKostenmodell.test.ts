/**
 * Warum „schnellste" die Autobahn gemieden hat — nachgerechnet.
 *
 * ─── WAS DIESE DATEI IST, UND WAS NICHT ─────────────────────────────────────
 * Sie ist ein NACHBAU von Valhallas Kantenkosten, keine Messung an Valhalla.
 * Hier läuft kein Router; es gibt in dieser Umgebung keinen.
 *
 * Nachgebaut ist genau der Block aus `src/sif/truckcost.cc#TruckCost::EdgeCost`
 * mit den Konstanten aus `valhalla/sif/dynamiccost.h`:
 *
 *     final_speed = min(edge_speed, top_speed)
 *     sec         = length * kSpeedFactor[final_speed]
 *     if (shortest_) return Cost(length, sec);          // ← steigt HIER aus
 *     factor  = kDensityFactor[density]
 *     factor += highway_factor_ * kHighwayFactor[class]
 *             + kSurfaceFactor[surface]
 *             + SpeedPenalty(edge_speed)
 *             + toll * toll_factor_
 *     return Cost(sec * factor, sec);                   // use_distance = 0
 *
 *     kSpeedFactor[s]   = 3.6 / s          (Sekunden je Meter)
 *     kDensityFactor[d] = 0.85 + d * 0.025 (ländlich: d = 0 → 0,85)
 *     SpeedPenalty      = max(0, edge_speed - top_speed) * 0.05
 *                        (`kDefaultSpeedPenaltyFactor = 0.05f`)
 *
 * Was diese Datei deshalb kann: zeigen, dass die Reihenfolge der Straßen
 * kippt, und an welcher Zahl das liegt. Was sie NICHT kann: beweisen, dass
 * eine bestimmte Route herauskommt. Dafür braucht es die echte Fahrt — das
 * steht so auch im Änderungsprotokoll.
 *
 * Sie bricht auch nicht, wenn Valhalla seine Konstanten ändert. Sie hält
 * fest, WAS gerechnet wurde, als die Ursache gefunden wurde.
 */

import { describe, it, expect } from 'vitest';
import type { VehicleProfile } from '@yapaia/shared';
import { buildTruckCostingOptions } from './profileMapping.js';

/** Dasselbe Wohnmobil wie in `profileMapping.test.ts`. */
function camper(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    id: 'p-camper',
    name: 'Teilintegriert 3.5t',
    height_m: 3.0,
    width_m: 2.2,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 85,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
    dimensions_confirmed_at: null,
    ...overrides,
  };
}

/** `kSpeedFactor[s]` aus `dynamiccost.h`: Sekunden je Meter. */
function sekundenJeMeter(tempoKmh: number): number {
  return 3.6 / tempoKmh;
}

/** `kDensityFactor[d] = 0.85f + (d * 0.025f)`. Freie Strecke ist d = 0. */
const GRUNDFAKTOR_LAENDLICH = 0.85;

/** `kDefaultSpeedPenaltyFactor = 0.05f` aus `dynamiccost.h`. */
const STRAFFAKTOR = 0.05;

/** Valhallas Vorgabe für `truck`: `kMaxAssumedTruckSpeed = 120`. */
const VALHALLA_VORGABE_TOP_SPEED = 120;

/**
 * Kosten je Meter in der Betriebsart „schnellste".
 *
 * `highway_factor_` ist hier 0 und taucht darum nicht auf: `use_highways`
 * wird in dieser Betriebsart nicht gesetzt, Valhallas Vorgabe ist 0,5, und
 * daraus folgt `(0.5 - 0.5)^3 = 0`. Ebenso `kSurfaceFactor` für Asphalt und
 * der Mautanteil für mautfreie Strecken.
 */
function kostenJeMeter(tempoKmh: number, topSpeed: number): number {
  const gerechnetesTempo = Math.min(tempoKmh, topSpeed);
  const sek = sekundenJeMeter(gerechnetesTempo);
  const strafe = Math.max(0, tempoKmh - topSpeed) * STRAFFAKTOR;
  return sek * (GRUNDFAKTOR_LAENDLICH + strafe);
}

/** Die drei Straßentypen aus der gemeldeten Route. */
const AUTOBAHN = 130;
const BUNDESSTRASSE = 100;
const LANDSTRASSE = 80;

describe('warum „schnellste" die A61 gemieden hat', () => {
  // Bis 0.8.13 schickte Yapaia `top_speed: avg_speed_kmh`, Vorgabe 85.
  const ALT = 85;

  it('machte die Autobahn TEURER als die Landstraße — je Meter', () => {
    // Das ist der ganze Fehler in einer Zeile. „Schnellste" suchte das
    // Minimum dieser Zahl, und das Minimum lag bei der langsamsten Straße.
    expect(kostenJeMeter(AUTOBAHN, ALT)).toBeGreaterThan(kostenJeMeter(LANDSTRASSE, ALT));
  });

  it('kehrte die Reihenfolge vollständig um: je schneller, desto teurer', () => {
    const teuerNachTempo = [LANDSTRASSE, BUNDESSTRASSE, AUTOBAHN].map((t) => kostenJeMeter(t, ALT));
    const aufsteigend = [...teuerNachTempo].sort((a, b) => a - b);
    expect(teuerNachTempo).toEqual(aufsteigend);
  });

  it('verteuerte die Autobahn um mehr als das Dreifache', () => {
    // 0,85 Grundfaktor gegen 0,85 + (130 − 85) × 0,05 = 3,10.
    const verhaeltnis = kostenJeMeter(AUTOBAHN, ALT) / kostenJeMeter(LANDSTRASSE, ALT);
    expect(verhaeltnis).toBeGreaterThan(3);
  });

  it('rechnete die Autobahn zusätzlich mit 85 statt 130 km/h', () => {
    // Auch ohne jede Strafe wäre der Zeitvorteil damit schon weg gewesen.
    expect(Math.min(AUTOBAHN, ALT)).toBe(ALT);
  });
});

describe('ohne top_speed — Valhallas eigene Vorgabe für truck', () => {
  const NEU = VALHALLA_VORGABE_TOP_SPEED;

  it('verringert den Nachteil der Autobahn von über 240 % auf unter 10 %', () => {
    // Gemessen gegen die Landstraße, also gegen die Straße, die vorher
    // gewonnen hat.
    const alt = kostenJeMeter(AUTOBAHN, 85) / kostenJeMeter(LANDSTRASSE, 85);
    const neu = kostenJeMeter(AUTOBAHN, NEU) / kostenJeMeter(LANDSTRASSE, NEU);
    expect(alt).toBeGreaterThan(3.4);
    expect(neu).toBeLessThan(1.1);
  });

  it('senkt den Aufschlag auf die Autobahn von 2,25 auf 0,50', () => {
    const alt = Math.max(0, AUTOBAHN - 85) * STRAFFAKTOR;
    const neu = Math.max(0, AUTOBAHN - NEU) * STRAFFAKTOR;
    expect(alt).toBeCloseTo(2.25, 10);
    expect(neu).toBeCloseTo(0.5, 10);
  });

  it('rechnet die Autobahn mit 120 statt 85 km/h', () => {
    expect(Math.min(AUTOBAHN, NEU)).toBe(120);
  });

  /**
   * ─── EHRLICH BLEIBEN: EIN REST BLEIBT ─────────────────────────────────────
   * Valhalla hält einen LKW weiterhin bei 120 km/h an und bestraft die
   * restlichen 10 km/h. Die Autobahn kostet je Meter deshalb immer noch
   * etwas mehr als eine frei fahrbare Bundesstraße.
   *
   * Das ist Valhallas eigenes Modell für diese Fahrzeugklasse, keine
   * Erfindung von Yapaia — und es ist genau der Grund, warum die echte Fahrt
   * über die A61 die Probe ist und nicht diese Datei. Bleibt die Route
   * danach falsch, ist der nächste Hebel benannt: `speed_penalty_factor`
   * lässt sich auf 0 setzen, dann ist „schnellste" reine Zeit.
   */
  it('lässt einen Rest stehen, und das steht hier, statt verschwiegen zu werden', () => {
    expect(kostenJeMeter(AUTOBAHN, NEU)).toBeGreaterThan(kostenJeMeter(BUNDESSTRASSE, NEU));
  });
});

/**
 * ─── DIE VERBINDUNG ZUM ECHTEN CODE ─────────────────────────────────────────
 * Alles oben wäre sonst nur meine Herleitung: richtig gerechnet, aber ohne
 * Griff am Produkt. Der folgende Block holt sich das `top_speed`, das Yapaia
 * TATSÄCHLICH verschickt, und rechnet damit. Wer es wieder einbaut, bringt
 * diese Zusicherungen zum Fallen.
 */
describe('was Yapaia wirklich verschickt, ergibt die richtige Reihenfolge', () => {
  function gesendetesTopSpeed(): number {
    const truck = buildTruckCostingOptions(camper());
    // Fehlt der Schlüssel, nimmt Valhalla seine Vorgabe — genau das ist der
    // Sinn des Weglassens.
    return truck.top_speed ?? VALHALLA_VORGABE_TOP_SPEED;
  }

  it('bestraft die Autobahn nicht mehr härter als die Landstraße', () => {
    const top = gesendetesTopSpeed();
    expect(kostenJeMeter(AUTOBAHN, top) / kostenJeMeter(LANDSTRASSE, top)).toBeLessThan(1.1);
  });

  it('rechnet die Autobahn mit mindestens 120 km/h', () => {
    expect(Math.min(AUTOBAHN, gesendetesTopSpeed())).toBeGreaterThanOrEqual(120);
  });

  it('macht die Bundesstraße billiger als die Landstraße, nicht teurer', () => {
    // Mit der alten Einstellung war es umgekehrt: 1,77× statt 0,80×.
    const top = gesendetesTopSpeed();
    expect(kostenJeMeter(BUNDESSTRASSE, top)).toBeLessThan(kostenJeMeter(LANDSTRASSE, top));
  });
});

describe('warum „kürzeste" die A61 trotzdem genommen hat', () => {
  /**
   * `truckcost.cc`:
   *
   *     float sec = edge->length() * kSpeedFactor[final_speed];
   *     if (shortest_) {
   *       return Cost(edge->length(), sec);
   *     }
   *     float factor = 1.f;
   *     ...
   *     factor += ... + SpeedPenalty(...) + ...;
   *
   * Der Ausstieg steht VOR dem Faktorblock. Die Strafe kam dort also nie an.
   */
  it('kürzeste rechnet ohne jeden Faktor — nur Länge', () => {
    // Nachbau des `shortest`-Zweigs: die Kosten SIND die Länge.
    const kostenKuerzeste = (laengeM: number): number => laengeM;
    expect(kostenKuerzeste(1000)).toBe(kostenKuerzeste(1000));
    // Tempo und top_speed kommen in dieser Zeile gar nicht vor — deshalb
    // konnte die Autobahn dort gewinnen, während sie nebenan verlor.
  });

  it('das erklärt die Ungereimtheit, die aufgefallen ist', () => {
    // Derselbe Straßentyp, dieselbe Einstellung, zwei Betriebsarten:
    // in der einen die teuerste Wahl, in der anderen unbelastet.
    const inSchnellste = kostenJeMeter(AUTOBAHN, 85) / kostenJeMeter(LANDSTRASSE, 85);
    const inKuerzeste = 1; // kein Faktor, nur Länge
    expect(inSchnellste).toBeGreaterThan(3);
    expect(inKuerzeste).toBe(1);
  });
});
