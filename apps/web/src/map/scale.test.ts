/**
 * Der Kartenmassstab.
 *
 * Die Werte hier sind nicht erfunden: sie stammen aus der bekannten
 * Web-Mercator-Tabelle (156543,034 m/px auf Stufe 0 am Aequator bei 256er
 * Kacheln, also die Haelfte bei den 512er, mit denen MapLibre arbeitet).
 */

import { describe, it, expect } from 'vitest';
import { METERS_PER_PIXEL_AT_ZOOM_0, metersPerPixel } from './scale.js';

describe('der Massstab am Aequator', () => {
  it('entspricht auf Stufe 0 der halben 256er-Tabelle', () => {
    // 156543,034 gilt fuer 256er Kacheln; MapLibre nutzt 512er.
    expect(METERS_PER_PIXEL_AT_ZOOM_0).toBeCloseTo(156543.034 / 2, 1);
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 1);
  });

  it('halbiert sich mit jeder Zoomstufe', () => {
    for (let z = 0; z < 20; z++) {
      expect(metersPerPixel(z + 1, 0)!).toBeCloseTo(metersPerPixel(z, 0)! / 2, 9);
    }
  });
});

describe('die geografische Breite zaehlt mit', () => {
  it('auf 47,4 Grad sind es rund 0,40 m je Bildpunkt (Stufe 17)', () => {
    // Genau der Fall, an dem der Fehler auffiel. Vorher stand hier 1,1943 --
    // fast das Dreifache.
    expect(metersPerPixel(17, 47.4)!).toBeCloseTo(0.4042, 3);
  });

  it('und am Aequator entsprechend mehr', () => {
    expect(metersPerPixel(17, 0)! / metersPerPixel(17, 47.4)!).toBeCloseTo(
      1 / Math.cos((47.4 * Math.PI) / 180),
      6,
    );
  });

  it('nach Norden wird es kleiner, nie groesser', () => {
    let vorher = metersPerPixel(17, 0)!;
    for (const lat of [10, 30, 47.4, 60, 70, 80]) {
      const jetzt = metersPerPixel(17, lat)!;
      expect(jetzt, `bei ${lat} Grad`).toBeLessThan(vorher);
      vorher = jetzt;
    }
  });

  it('und die Breite zaehlt symmetrisch -- Sued wie Nord', () => {
    expect(metersPerPixel(17, -47.4)).toBeCloseTo(metersPerPixel(17, 47.4)!, 12);
  });
});

describe('wann es keinen Massstab gibt', () => {
  it('bei unbrauchbaren Zahlen', () => {
    expect(metersPerPixel(Number.NaN, 47.4)).toBeNull();
    expect(metersPerPixel(17, Number.NaN)).toBeNull();
  });

  it('an den Polen -- dort ist Mercator nicht definiert', () => {
    // Ohne diese Abfrage waere der Massstab dort 0, und jede Anzeige, die
    // durch ihn teilt, ergaebe Unendlich.
    expect(metersPerPixel(17, 90)).toBeNull();
    expect(metersPerPixel(17, -90)).toBeNull();
    expect(metersPerPixel(17, 95)).toBeNull();
  });
});
