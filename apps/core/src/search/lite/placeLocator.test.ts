/**
 * Der Ortsbezug eines Treffers.
 *
 * Gemeldet: „Wenn ich Beethoven eintippe, gib bitte den Ort mit an, in dem
 * sich der jeweilige Eintrag befindet." Ohne ihn sind dreihundert
 * Beethovenstraßen in der Vorschlagsliste dreihundertmal derselbe Eintrag.
 */

import { describe, it, expect } from 'vitest';
import { PlaceLocator, MAX_LOCALITY_KM, type PlacePoint } from './placeLocator';

const WORMS: PlacePoint = { name: 'Worms', kind: 'town', lat: 49.63, lon: 8.35 };
const MANNHEIM: PlacePoint = { name: 'Mannheim', kind: 'city', lat: 49.48, lon: 8.45 };
const VADUZ: PlacePoint = { name: 'Vaduz', kind: 'city', lat: 47.141, lon: 9.5215 };

describe('PlaceLocator', () => {
  it('nennt den Ort, in dem der Punkt liegt', () => {
    const locator = new PlaceLocator([WORMS, MANNHEIM, VADUZ]);
    expect(locator.nearestName(49.631, 8.351)).toBe('Worms');
    expect(locator.nearestName(49.481, 8.451)).toBe('Mannheim');
  });

  /** Der eigentliche Zweck: zwei gleichnamige Strassen unterscheidbar machen. */
  it('unterscheidet zwei gleichnamige Strassen ueber ihren Ort', () => {
    const locator = new PlaceLocator([WORMS, MANNHEIM]);
    const a = locator.nearestName(49.6305, 8.3505);
    const b = locator.nearestName(49.4805, 8.4505);
    expect(a).toBe('Worms');
    expect(b).toBe('Mannheim');
    expect(a).not.toBe(b);
  });

  /**
   * ─── LIEBER NICHTS SAGEN ALS FALSCHES ─────────────────────────────────────
   * Ein Rasthof mitten in der Pampa gehoert zu keinem Ort. „Rasthof, Koblenz"
   * waere eine Auskunft, die schlechter ist als keine.
   */
  it('behauptet keinen Ort, der zu weit weg ist', () => {
    const locator = new PlaceLocator([VADUZ]);
    // ── DIESE ZAHL IST MIT BEDACHT GEWAEHLT ───────────────────────────────
    // 0,4 Grad Breite sind rund 44 km: WEITER als MAX_LOCALITY_KM (25), aber
    // noch INNERHALB der Ringsuche. Nur so prueft dieser Test die
    // Entfernungsgrenze. Mit 300 km -- wie hier zuerst -- griff schon die
    // Ringbegrenzung, und die Pruefung bestand auch dann noch, wenn man die
    // Entfernungsgrenze ersatzlos strich.
    const km = 0.4 * 111;
    expect(km).toBeGreaterThan(MAX_LOCALITY_KM);
    expect(locator.nearestName(VADUZ.lat + 0.4, VADUZ.lon)).toBeNull();
  });

  it('nennt einen Ort noch knapp innerhalb der Grenze', () => {
    const locator = new PlaceLocator([VADUZ]);
    // ~0.1 Grad Breite sind ~11 km -- deutlich unter MAX_LOCALITY_KM.
    expect(MAX_LOCALITY_KM).toBeGreaterThan(11);
    expect(locator.nearestName(47.241, 9.5215)).toBe('Vaduz');
  });

  /**
   * ─── DIE FALLE AM ZELLENRAND ──────────────────────────────────────────────
   * Gesucht wird in Ringen um die eigene Gitterzelle. Wer beim ERSTEN Treffer
   * aufhoert, nimmt womoeglich den zweitnaechsten Ort: ein Ort am aeusseren
   * Rand des Rings kann weiter weg sein als einer im naechsten Ring. Der Punkt
   * hier liegt genau so.
   */
  it('nimmt den naechsten Ort, nicht den erstbesten Ring', () => {
    // Zellen sind 0.1 Grad. Punkt knapp oberhalb einer Zellengrenze.
    const near: PlacePoint = { name: 'Nah', kind: 'village', lat: 50.0005, lon: 8.0 };
    const farInSameCell: PlacePoint = { name: 'Fern', kind: 'city', lat: 49.9501, lon: 8.0 };
    // "Fern" liegt in DERSELBEN Zelle wie der Suchpunkt, "Nah" in der Zelle
    // darueber -- also erst im naechsten Ring, obwohl er naeher ist.
    const locator = new PlaceLocator([farInSameCell, near]);
    expect(locator.nearestName(49.9999, 8.0)).toBe('Nah');
  });

  it('liefert null, wenn es gar keine Orte gibt', () => {
    expect(new PlaceLocator([]).nearestName(49.6, 8.3)).toBeNull();
  });

  it('liefert bei wiederholter Abfrage stabil denselben Ort', () => {
    const locator = new PlaceLocator([WORMS]);
    expect(locator.nearestName(49.631, 8.351)).toBe('Worms');
    expect(locator.nearestName(49.632, 8.352)).toBe('Worms');
  });

  /** Deutschland: Millionen Abfragen gegen zehntausende Orte. Paarweise waere
   *  der Bau nie fertig -- diese Pruefung haelt fest, dass das Gitter traegt. */
  it('bleibt bei vielen Orten und vielen Abfragen schnell', () => {
    const places: PlacePoint[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      places.push({
        name: `Ort ${i}`,
        kind: 'village',
        lat: 47 + (i % 140) * 0.05,
        lon: 6 + Math.floor(i / 140) * 0.05,
      });
    }
    const locator = new PlaceLocator(places);
    const started = Date.now();
    let found = 0;
    for (let i = 0; i < 20_000; i += 1) {
      if (locator.nearestName(47 + (i % 140) * 0.05 + 0.001, 6 + Math.floor(i / 140) * 0.05)) {
        found += 1;
      }
    }
    const elapsedMs = Date.now() - started;
    expect(found).toBe(20_000);
    // Grosszuegig: es geht darum, eine quadratische Suche auffallen zu lassen,
    // nicht darum, Millisekunden zu zaehlen.
    expect(elapsedMs).toBeLessThan(4000);
  });
});
