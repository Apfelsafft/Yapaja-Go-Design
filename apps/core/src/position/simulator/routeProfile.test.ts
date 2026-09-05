/**
 * Tempoprofil aus einer Route -- die Regel.
 *
 * Gemeldet: „Die jeweilige Fahrgeschwindigkeit sollte der entsprechenden
 * Hoechstgeschwindigkeit entsprechen."
 *
 * Geprueft wird vor allem, was bei UNVOLLSTAENDIGEN Daten passiert. Valhalla
 * liefert regelmaessig Abschnitte ohne Limit, und eine still eingesetzte Zahl
 * waere hier besonders heikel: die Fahrt sieht danach echt aus.
 */

import { describe, it, expect } from 'vitest';
import type { SpeedSegment } from '@yapaja/shared';
import { encodePolyline6 } from '../../routing/polyline.js';
import {
  routeSpeedProfile,
  kmhToMs,
  FALLBACK_SPEED_KMH,
  MIN_SPEED_KMH,
} from './routeProfile.js';

const BASE_LAT = 47.2;
const BASE_LON = 9.6;
const M_PER_DEG_LAT = 111_195;

/** Elf Stuetzpunkte, ~111 m auseinander, schnurgerade nach Norden. */
const POINTS = Array.from({ length: 11 }, (_, i) => ({
  lat: BASE_LAT + (i * (M_PER_DEG_LAT * 0.001)) / M_PER_DEG_LAT,
  lon: BASE_LON,
}));

function route(speedLimits: SpeedSegment[]): { geometry: string; speed_limits: SpeedSegment[] } {
  return { geometry: encodePolyline6(POINTS), speed_limits: speedLimits };
}

describe('was aus den Limits wird', () => {
  it('jeder Abschnitt bekommt genau ein Tempo', () => {
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: 80 }]));
    // Zehn Abschnitte zwischen elf Punkten -- eine Abweichung hier laesst den
    // Simulator die Strecke ablehnen ("expected one per segment").
    expect(profile.speedsMs).toHaveLength(POINTS.length - 1);
    expect(profile.totalSegments).toBe(POINTS.length - 1);
  });

  it('das Limit des Abschnitts, in m/s umgerechnet', () => {
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: 80 }]));
    for (const speed of profile.speedsMs) {
      expect(speed).toBeCloseTo(kmhToMs(80), 6);
    }
    expect(profile.unknownSegments).toBe(0);
  });

  it('unterschiedliche Limits landen in den richtigen Abschnitten', () => {
    // Erste Haelfte 50, zweite 100. Wuerde die Zuordnung um einen Index
    // verrutschen, faende man es genau an dieser Naht.
    const profile = routeSpeedProfile(
      route([
        { begin_shape_index: 0, end_shape_index: 5, kmh: 50 },
        { begin_shape_index: 5, end_shape_index: 10, kmh: 100 },
      ]),
    );
    expect(profile.speedsMs.slice(0, 5).every((s) => Math.abs(s - kmhToMs(50)) < 1e-6)).toBe(true);
    expect(profile.speedsMs.slice(5).every((s) => Math.abs(s - kmhToMs(100)) < 1e-6)).toBe(true);
    expect(profile.unknownSegments).toBe(0);
  });
});

describe('was bei fehlenden Limits passiert', () => {
  it('eine Luecke bekommt das Ersatztempo -- und wird gezaehlt', () => {
    // Nur die zweite Haelfte ist belegt. Die erste ist eine echte Luecke,
    // genau wie sie Valhalla liefert.
    const profile = routeSpeedProfile(route([{ begin_shape_index: 5, end_shape_index: 10, kmh: 100 }]));
    expect(profile.speedsMs.slice(0, 5).every((s) => Math.abs(s - kmhToMs(FALLBACK_SPEED_KMH)) < 1e-6)).toBe(
      true,
    );
    // Die Zahl ist der Punkt: ohne sie saehe eine halb geratene Fahrt genauso
    // aus wie eine vollstaendig belegte.
    expect(profile.unknownSegments).toBe(5);
  });

  it('ein Abschnitt mit `kmh: null` gilt als unbekannt, nicht als 0', () => {
    // Ohne diese Unterscheidung stuende das Fahrzeug still -- und das saehe
    // aus wie ein Absturz, nicht wie fehlende Daten.
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: null }]));
    expect(profile.unknownSegments).toBe(profile.totalSegments);
    expect(profile.speedsMs.every((s) => s > 0)).toBe(true);
  });

  it('ganz ohne Limits faehrt die Route trotzdem', () => {
    const profile = routeSpeedProfile(route([]));
    expect(profile.unknownSegments).toBe(profile.totalSegments);
    expect(profile.speedsMs.every((s) => Math.abs(s - kmhToMs(FALLBACK_SPEED_KMH)) < 1e-6)).toBe(true);
  });

  it('das Ersatztempo ist einstellbar', () => {
    const profile = routeSpeedProfile(route([]), 90);
    // Fest ausgerechnet und NICHT ueber `kmhToMs` geprueft: sonst pruefte
    // die Zusicherung die Umrechnung gegen sich selbst und bliebe auch dann
    // gruen, wenn gar nicht umgerechnet wird.
    expect(profile.speedsMs[0]).toBeCloseTo(25, 6); // 90 km/h = 25 m/s
  });

  it('km/h werden wirklich in m/s umgerechnet', () => {
    expect(kmhToMs(36)).toBeCloseTo(10, 9);
    expect(kmhToMs(0)).toBe(0);
  });
});

describe('was NICHT stehenbleibt', () => {
  it('ein Limit von 0 gilt als unbekannt und bekommt das Ersatztempo', () => {
    // Ein Abschnitt mit Tempo 0 waere unendlich lang: die Wiedergabe bliebe
    // stehen, und man saehe nicht, ob sie haengt oder die Daten kaputt sind.
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: 0 }]));
    expect(profile.unknownSegments).toBe(profile.totalSegments);
    expect(profile.speedsMs.every((s) => s > 0)).toBe(true);
  });

  it('ein negatives Limit ebenso', () => {
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: -30 }]));
    expect(profile.unknownSegments).toBe(profile.totalSegments);
    expect(profile.speedsMs.every((s) => s > 0)).toBe(true);
  });

  it('ein ECHTES, aber winziges Limit wird auf das Mindesttempo angehoben', () => {
    // Der eigentliche Zweck von MIN_SPEED_KMH -- und der Fall, den die
    // beiden Pruefungen darueber NICHT treffen: 0 und -30 gelten als
    // „unbekannt" und laufen ins Ersatztempo, das ohnehin darueber liegt.
    // Hier ist 3 km/h ein gueltiges Limit, das trotzdem angehoben wird.
    const profile = routeSpeedProfile(route([{ begin_shape_index: 0, end_shape_index: 10, kmh: 3 }]));
    expect(profile.unknownSegments).toBe(0); // gueltig, nicht geraten
    expect(profile.speedsMs[0]).toBeCloseTo(kmhToMs(MIN_SPEED_KMH), 9);
    expect(profile.speedsMs[0]).toBeGreaterThan(kmhToMs(3));
  });

  it('auch ein zu kleines Ersatztempo wird angehoben', () => {
    const profile = routeSpeedProfile(route([]), 1);
    expect(profile.speedsMs[0]).toBeCloseTo(kmhToMs(MIN_SPEED_KMH), 9);
  });

  it('kaputte Indizes von aussen werfen nicht, sie gelten als unbekannt', () => {
    // `speed_limits` ist Fremddaten. Ein Fehlschlag hier wuerde den ganzen
    // Testlauf verhindern, statt ihn nur ungenauer zu machen.
    const profile = routeSpeedProfile(
      route([
        { begin_shape_index: -1, end_shape_index: 5, kmh: 80 },
        { begin_shape_index: 8, end_shape_index: 3, kmh: 80 },
        { begin_shape_index: 0, end_shape_index: 999, kmh: 80 },
      ]),
    );
    expect(profile.unknownSegments).toBe(profile.totalSegments);
  });
});

describe('wann es gar nicht geht', () => {
  it('eine Route ohne genug Stuetzpunkte wird abgelehnt', () => {
    // Ein leeres Profil waere eine stille Fehlfunktion: die Wiedergabe
    // startet, und nichts bewegt sich.
    //
    // Der Fehler kommt aus `buildRouteGeometry` -- hier stand zunaechst
    // dieselbe Pruefung noch einmal, die nie erreicht wurde. Geprueft wird
    // also das Verhalten an dieser Grenze, nicht eine eigene Verteidigung.
    expect(() => routeSpeedProfile({ geometry: '', speed_limits: [] })).toThrow();
    // Ein einzelner Punkt reicht auch nicht -- es gibt keinen Abschnitt.
    expect(() =>
      routeSpeedProfile({ geometry: encodePolyline6([POINTS[0]]), speed_limits: [] }),
    ).toThrow();
  });
});
