/**
 * Der Richtungspfeil -- Form, Lage und die Faelle, in denen es keinen gibt.
 *
 * Geprueft wird in BILDPUNKTEN zurueckgerechnet: die Zahlen im Quelltext sind
 * Bildpunkte, und nur so sieht man, ob der Pfeil wirklich vor dem Punkt sitzt
 * statt in ihm.
 */

import { describe, it, expect } from 'vitest';
import {
  ARROW_BASE_PX,
  ARROW_SPREAD_DEG,
  ARROW_TIP_PX,
  headingArrowRing,
  type Coord,
} from './headingArrow.js';

const LAT = 47.4;
const LON = 9.7;
/** Ein rundes Massband: 1 m je Bildpunkt macht die Rechnung nachvollziehbar. */
const M_PRO_PX = 1;
const M_PRO_GRAD_LAT = 111_195;

/** Ein Punkt des Rings, zurueck in Bildpunkte: (voraus, seitlich) bei Kurs 0. */
function inBildpunkten([lon, lat]: Coord): { voraus: number; seitlich: number } {
  return {
    voraus: ((lat - LAT) * M_PRO_GRAD_LAT) / M_PRO_PX,
    seitlich: ((lon - LON) * M_PRO_GRAD_LAT * Math.cos((LAT * Math.PI) / 180)) / M_PRO_PX,
  };
}

describe('die Form des Pfeils', () => {
  const ring = headingArrowRing(LON, LAT, 0, M_PRO_PX)!;

  it('ist ein geschlossenes Dreieck', () => {
    expect(ring).toHaveLength(4); // Spitze, links, rechts, Spitze
    expect(ring[0]).toEqual(ring[3]);
  });

  it('hat die Spitze voraus', () => {
    const s = inBildpunkten(ring[0]);
    expect(s.voraus).toBeCloseTo(ARROW_TIP_PX, 1);
    expect(Math.abs(s.seitlich)).toBeLessThan(0.01);
  });

  it('hat zwei Ecken, symmetrisch zur Mitte', () => {
    const a = inBildpunkten(ring[1]);
    const b = inBildpunkten(ring[2]);
    expect(a.voraus).toBeCloseTo(b.voraus, 3);
    expect(a.seitlich).toBeCloseTo(-b.seitlich, 3);
    expect(Math.abs(a.seitlich)).toBeGreaterThan(1); // wirklich breit, keine Linie
  });
});

describe('der Pfeil sitzt VOR dem Punkt, nicht darin', () => {
  it('auch die hintersten Ecken liegen ausserhalb', () => {
    // Der Punkt hat 8 px Radius plus 2 px weissen Rand. Laege die Basis
    // darin, verdeckte der Pfeil genau das, was die Position anzeigt.
    const RADIUS_MIT_RAND_PX = 10;
    const ring = headingArrowRing(LON, LAT, 0, M_PRO_PX)!;
    for (const ecke of [ring[1], ring[2]]) {
      const { voraus } = inBildpunkten(ecke);
      expect(voraus, 'Abstand der Basis nach vorn').toBeGreaterThan(RADIUS_MIT_RAND_PX);
    }
  });

  it('und die Masse passen rechnerisch zusammen', () => {
    // Gegenrechnung zu der Begruendung in `headingArrow.ts`: die Basis liegt
    // `ARROW_BASE_PX * cos(spread)` voraus.
    const erwartet = ARROW_BASE_PX * Math.cos((ARROW_SPREAD_DEG * Math.PI) / 180);
    const ring = headingArrowRing(LON, LAT, 0, M_PRO_PX)!;
    expect(inBildpunkten(ring[1]).voraus).toBeCloseTo(erwartet, 1);
    expect(erwartet).toBeGreaterThan(10);
  });
});

describe('er zeigt in die gemeldete Richtung', () => {
  it('nach Osten bei Kurs 90', () => {
    const ring = headingArrowRing(LON, LAT, 90, M_PRO_PX)!;
    const s = inBildpunkten(ring[0]);
    expect(s.seitlich).toBeCloseTo(ARROW_TIP_PX, 1);
    expect(Math.abs(s.voraus)).toBeLessThan(0.01);
  });

  it('nach Sueden bei Kurs 180', () => {
    const s = inBildpunkten(headingArrowRing(LON, LAT, 180, M_PRO_PX)![0]);
    expect(s.voraus).toBeCloseTo(-ARROW_TIP_PX, 1);
  });

  it('und bei Kursen ueber 180 genauso -- ohne Umweg ueber die Null', () => {
    // Dieselbe Falle wie beim Absturz in 0.6.4: 270 Grad darf nicht als
    // -90 „irgendwo anders" landen.
    const s = inBildpunkten(headingArrowRing(LON, LAT, 270, M_PRO_PX)![0]);
    expect(s.seitlich).toBeCloseTo(-ARROW_TIP_PX, 1);
  });
});

describe('er waechst nicht mit der Zoomstufe', () => {
  it('doppeltes Massband, doppelte Meter -- gleiche Bildpunkte', () => {
    // Sonst waere der Pfeil beim Herauszoomen eine Nadel und beim
    // Heranzoomen ein Wegweiser.
    const nah = headingArrowRing(LON, LAT, 0, 1)!;
    const fern = headingArrowRing(LON, LAT, 0, 2)!;
    const vorausNah = (nah[0][1] - LAT) * M_PRO_GRAD_LAT;
    const vorausFern = (fern[0][1] - LAT) * M_PRO_GRAD_LAT;
    expect(vorausFern).toBeCloseTo(vorausNah * 2, 6);
  });
});

describe('wann es keinen Pfeil gibt', () => {
  it('ohne gemeldeten Kurs', () => {
    // Ein geratener Pfeil waere schlimmer als keiner.
    expect(headingArrowRing(LON, LAT, null, M_PRO_PX)).toBeNull();
    expect(headingArrowRing(LON, LAT, undefined, M_PRO_PX)).toBeNull();
    expect(headingArrowRing(LON, LAT, Number.NaN, M_PRO_PX)).toBeNull();
  });

  it('bei unbrauchbarem Massband', () => {
    expect(headingArrowRing(LON, LAT, 0, 0)).toBeNull();
    expect(headingArrowRing(LON, LAT, 0, -1)).toBeNull();
    expect(headingArrowRing(LON, LAT, 0, Number.NaN)).toBeNull();
  });
});
