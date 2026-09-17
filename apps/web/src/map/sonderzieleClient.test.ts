/**
 * Was die Karte glaubt, und was nicht.
 *
 * ─── DIE EINE FRAGE DIESER DATEI ────────────────────────────────────────────
 * Kann aus „konnte nicht nachsehen" lautlos „es gibt hier keine" werden?
 *
 * Genau diese Verwechslung ist der Grund, aus dem es die Sonderziele-Ebene
 * überhaupt gibt — und sie hier durch die Hintertür wieder hereinzulassen
 * wäre die teuerste Art, diese Änderung zu verlieren.
 */

import { describe, it, expect } from 'vitest';
import { pruefeAntwort, SONDERZIELE_LEER } from './sonderzieleClient.js';

const MERKMAL = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [8.36, 49.22] },
  properties: { name: 'Stellplatz', kategorie: 'sanitary_dump_station', symbol: 'poi-entsorgung' },
};

const BEFUND = { indizes: [], kategorien: [], gekappt: false, ohne_index: false };

describe('pruefeAntwort — im Zweifel „unbekannt", nie „alles gut"', () => {
  it('nimmt eine vollständige Antwort an', () => {
    const a = pruefeAntwort({ type: 'FeatureCollection', features: [MERKMAL], befund: BEFUND });
    expect(a.features).toHaveLength(1);
    expect(a.befund.ohne_index).toBe(false);
  });

  it('eine Antwort OHNE `befund` gilt als „kein Index", nicht als „nichts da"', () => {
    // ─── DER FEHLER, DEN DAS VERHINDERT ─────────────────────────────────────
    // Fiele `befund` je weg -- ein älterer Kern, ein Zwischenspeicher, ein
    // Umbau der Schnittstelle --, wäre `ohne_index` schlicht `undefined`.
    // Als Wahrheitswert gelesen ist das „falsch", und aus „konnte nicht
    // nachsehen" würde stillschweigend „es gibt hier keine". Ein Fahrer mit
    // vollem Abwassertank bekäme die beruhigende Auskunft statt der wahren.
    const a = pruefeAntwort({ type: 'FeatureCollection', features: [] });
    expect(a.befund.ohne_index).toBe(true);
  });

  it('nur ein ausdrückliches `false` heißt „es gibt einen Index"', () => {
    expect(pruefeAntwort({ features: [], befund: { ohne_index: false } }).befund.ohne_index).toBe(
      false,
    );
    expect(pruefeAntwort({ features: [], befund: {} }).befund.ohne_index).toBe(true);
    expect(
      pruefeAntwort({ features: [], befund: { ohne_index: 'nein' } }).befund.ohne_index,
    ).toBe(true);
  });

  it('`gekappt` dagegen gilt nur bei ausdrücklichem `true`', () => {
    // Umgekehrt herum als `ohne_index`, und das ist Absicht: bei beiden ist
    // der vorsichtige Wert der, der eine Lücke ANNIMMT. Bei `ohne_index`
    // heisst das `true`, bei `gekappt` ebenfalls -- aber eine fehlende
    // Angabe zur Kappung ist kein Hinweis auf eine, während eine fehlende
    // Befundangabe sehr wohl einer auf einen fehlenden Index ist.
    expect(pruefeAntwort({ features: [], befund: { gekappt: true } }).befund.gekappt).toBe(true);
    expect(pruefeAntwort({ features: [], befund: {} }).befund.gekappt).toBe(false);
  });

  it('wirft nichts bei Unsinn', () => {
    for (const unsinn of [null, undefined, 42, 'nein', [], {}]) {
      expect(() => pruefeAntwort(unsinn)).not.toThrow();
    }
    expect(pruefeAntwort(null)).toEqual(SONDERZIELE_LEER);
  });
});

describe('pruefeAntwort — was MapLibre nicht zeichnen könnte, kommt gar nicht erst an', () => {
  it('wirft Punkte ohne Symbol weg', () => {
    // Ein `icon-image`, das im Blatt fehlt, zeichnet MapLibre als NICHTS --
    // ohne Fehler, ohne Eintrag im Protokoll. Ein solcher Punkt wäre ein
    // Datensatz, der da ist und den niemand je sieht.
    const ohne = { ...MERKMAL, properties: { ...MERKMAL.properties, symbol: '' } };
    expect(pruefeAntwort({ features: [MERKMAL, ohne], befund: BEFUND }).features).toHaveLength(1);
  });

  it('wirft Punkte ohne brauchbare Koordinaten weg', () => {
    const faelle = [
      { ...MERKMAL, geometry: { type: 'Point', coordinates: [8.36] } },
      { ...MERKMAL, geometry: { type: 'Point', coordinates: ['8.36', 49.22] } },
      { ...MERKMAL, geometry: { type: 'Point', coordinates: [Number.NaN, 49.22] } },
      { ...MERKMAL, geometry: { type: 'Point', coordinates: [8.36, Number.POSITIVE_INFINITY] } },
      { ...MERKMAL, geometry: undefined },
      { ...MERKMAL, properties: undefined },
    ];
    for (const fall of faelle) {
      expect(pruefeAntwort({ features: [fall], befund: BEFUND }).features).toHaveLength(0);
    }
  });

  it('ein einzelner unbrauchbarer Punkt nimmt die anderen nicht mit', () => {
    const kaputt = { ...MERKMAL, geometry: { type: 'Point', coordinates: [] } };
    expect(pruefeAntwort({ features: [kaputt, MERKMAL], befund: BEFUND }).features).toHaveLength(1);
  });

  it('`features`, das keine Liste ist, ergibt eine leere Liste statt eines Absturzes', () => {
    expect(pruefeAntwort({ features: 'nichts', befund: BEFUND }).features).toEqual([]);
  });
});
