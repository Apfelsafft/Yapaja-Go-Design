/**
 * Die POI-Kategorien — gegen das, was die Kacheln wirklich führen.
 *
 * ─── DIE WERTE SIND NACHGELESEN ─────────────────────────────────────────────
 * `OMT_KLASSEN` und `OMT_UNTERKLASSEN` unten stammen aus dem Profil, mit dem
 * planetiler unsere Kacheln baut (`openmaptiles/planetiler-openmaptiles`):
 * die Klassenzuordnung aus `OpenMapTilesSchema.Poi.FieldMappings.Class`, die
 * Unterklassen aus `Tables.OsmPoiPoint` (die `matchAny`-Listen für `amenity`,
 * `tourism` und `shop`). Aus dem Quelltext gelesen, nicht aus dem Gedächtnis.
 *
 * Ohne diesen Abgleich ist eine Kategorie nicht zu prüfen: eine Klasse, die
 * es nicht gibt, filtert stillschweigend NICHTS heraus. Genau so ist der
 * Fehler mit `supermarket` entstanden und monatelang unbemerkt geblieben.
 */

import { describe, it, expect } from 'vitest';
import {
  POI_KATEGORIEN,
  POI_KLASSEN_MIT_SYMBOL,
  rangNachKategorie,
  symbolNachKategorie,
} from './kategorien';

/**
 * Unterklassen, die `FieldMappings.Class` auf eine ANDERE Klasse abbildet.
 * Wer eine davon als Klasse einträgt, filtert ins Leere.
 */
const ZUGEORDNET: Record<string, string> = {
  supermarket: 'grocery',
  deli: 'grocery',
  department_store: 'grocery',
  greengrocer: 'grocery',
  marketplace: 'grocery',
  camp_site: 'campsite',
  caravan_site: 'campsite',
  hotel: 'lodging',
  motel: 'lodging',
  hostel: 'lodging',
  guest_house: 'lodging',
  books: 'library',
  university: 'college',
  townhall: 'town_hall',
  bus_stop: 'bus',
  food_court: 'fast_food',
  nightclub: 'bar',
  marina: 'harbor',
  car_repair: 'car',
  clinic: 'hospital',
  laundry: 'laundry',
  dry_cleaning: 'laundry',
  post_office: 'post',
  post_box: 'post',
  kindergarten: 'school',
  golf_course: 'golf',
  bbq: 'park',
};

/** Unterklassen, die NICHT zugeordnet werden und deshalb als Klasse
 *  durchfallen (`poiClass` gibt dann die Unterklasse zurück). */
const FAELLT_DURCH = new Set([
  'restaurant',
  'parking',
  'fuel',
  'charging_station',
  'attraction',
  'castle',
  'museum',
  'viewpoint',
  'artwork',
  'theme_park',
  'monument',
  'ruins',
  'zoo',
  'drinking_water',
  'toilets',
  'recycling',
  'cafe',
  'fast_food',
  'bar',
  'ice_cream',
]);

/** Klassen, die die Zuordnung ausdrücklich erzeugt. */
const ERZEUGTE_KLASSEN = new Set([...Object.values(ZUGEORDNET), 'art_gallery', 'grocery']);

describe('POI-Kategorien gegen das Kachelschema', () => {
  // ─── DER FEHLER, DER DAS AUSGELÖST HAT ────────────────────────────────────
  it('trägt KEINE Klasse ein, die es gar nicht gibt', () => {
    // `supermarket` war so ein Fall: die Zuordnung schickt ihn nach
    // `grocery`, also filterte die Einstellung „reduzierte POIs" jeden
    // Supermarkt weg, während sie versprach, ihn zu zeigen.
    for (const klasse of POI_KLASSEN_MIT_SYMBOL) {
      const ziel = ZUGEORDNET[klasse];
      expect(
        ziel,
        `"${klasse}" ist eine UNTERklasse — das Kachelprofil bildet sie auf ` +
          `"${ziel}" ab. Als Klassenfilter trifft sie nichts.`,
      ).toBeUndefined();
      expect(
        FAELLT_DURCH.has(klasse) || ERZEUGTE_KLASSEN.has(klasse),
        `"${klasse}" kommt im Kachelprofil weder als zugeordnete Klasse noch ` +
          'als durchfallende Unterklasse vor.',
      ).toBe(true);
    }
  });

  it('zeigt Supermärkte — über `grocery`, nicht über `supermarket`', () => {
    expect(POI_KLASSEN_MIT_SYMBOL).toContain('grocery');
    expect(POI_KLASSEN_MIT_SYMBOL).not.toContain('supermarket');
  });

  // ─── STELLPLATZ IST NICHT CAMPINGPLATZ ────────────────────────────────────
  it('unterscheidet Wohnmobilstellplatz von Campingplatz', () => {
    // Beide liegen unter `class: campsite`. Für ein Wohnmobil sind es zwei
    // verschiedene Dinge, und die Unterscheidung geht NUR über die
    // Unterklasse.
    const womo = POI_KATEGORIEN.find((k) => k.symbol === 'poi-wohnmobil');
    const camping = POI_KATEGORIEN.find((k) => k.symbol === 'poi-camping');
    expect(womo?.unterklassen).toEqual(['caravan_site']);
    expect(camping?.unterklassen).toBeUndefined();
  });

  it('prüft den Stellplatz ZUERST', () => {
    // Stünde der Campingplatz vorn, bekäme jeder Stellplatz das Zelt: seine
    // Bedingung (`class: campsite`) trifft auch auf ihn zu.
    const womo = POI_KATEGORIEN.findIndex((k) => k.symbol === 'poi-wohnmobil');
    const camping = POI_KATEGORIEN.findIndex((k) => k.symbol === 'poi-camping');
    expect(womo).toBeLessThan(camping);
  });

  it('der Ausdruck gibt dem Stellplatz wirklich sein eigenes Bild', () => {
    // Die Reihenfolge oben zu prüfen genügt nicht -- sie könnte stimmen und
    // der Ausdruck trotzdem falsch gebaut sein. Also am Ergebnis prüfen.
    const a = symbolNachKategorie();
    const text = JSON.stringify(a);
    const womoStelle = text.indexOf('poi-wohnmobil');
    const campingStelle = text.indexOf('poi-camping');
    expect(womoStelle).toBeGreaterThan(-1);
    expect(womoStelle).toBeLessThan(campingStelle);
    expect(text).toContain('caravan_site');
    expect(text).toContain('subclass');
  });

  // ─── DER AUSDRUCK MUSS GÜLTIG SEIN ────────────────────────────────────────
  it('hat einen Rückfall — sonst fällt die ganze Ebene aus', () => {
    // Ein `case` ohne letzten Zweig ist in MapLibre ungültig, und eine
    // ungültige Ebene wird nicht etwa teilweise gezeichnet: sie fehlt.
    const a = symbolNachKategorie();
    expect(a[0]).toBe('case');
    // 1 (Schlüsselwort) + 2 je Kategorie + 1 Rückfall.
    expect(a).toHaveLength(1 + POI_KATEGORIEN.length * 2 + 1);
    expect(a[a.length - 1]).toBe('');
  });

  it('der Rang-Ausdruck hat ebenfalls einen Rückfall, und zwar den letzten Platz', () => {
    const a = rangNachKategorie();
    expect(a[0]).toBe('case');
    expect(a[a.length - 1]).toBe(POI_KATEGORIEN.length + 1);
  });

  it('jede Kategorie kommt im Ausdruck genau einmal vor', () => {
    const text = JSON.stringify(symbolNachKategorie());
    for (const k of POI_KATEGORIEN) {
      const treffer = text.split(`"${k.symbol}"`).length - 1;
      expect(treffer, `"${k.symbol}" kommt ${treffer}-mal vor`).toBe(1);
    }
  });

  // ─── DIE RANGFOLGE IST EINE AUSSAGE ───────────────────────────────────────
  it('die Ränge sind eindeutig und lückenlos', () => {
    const raenge = POI_KATEGORIEN.map((k) => k.rang).sort((a, b) => a - b);
    expect(raenge).toEqual(POI_KATEGORIEN.map((_, i) => i + 1));
  });

  it('das Wohnmobil steht an erster Stelle', () => {
    // Das ist der Sinn der ganzen Sortierung: wird es eng, bleibt der
    // Stellplatz stehen und nicht die Eisdiele.
    const womo = POI_KATEGORIEN.find((k) => k.symbol === 'poi-wohnmobil');
    const essen = POI_KATEGORIEN.find((k) => k.symbol === 'poi-essen');
    expect(womo?.rang).toBe(1);
    expect(womo!.rang).toBeLessThan(essen!.rang);
  });

  // ─── VOLLSTÄNDIGKEIT GEGEN DIE FRAGE, DIE GESTELLT WURDE ──────────────────
  it('deckt alles ab, wonach gefragt wurde', () => {
    // „Restaurants, Womo Stellplätze, Parkplätze, Campingplätze, Supermärkte,
    // Sehenswürdigkeiten usw?"
    const klassen = new Set(POI_KLASSEN_MIT_SYMBOL);
    for (const [wunsch, klasse] of [
      ['Restaurants', 'restaurant'],
      ['Parkplätze', 'parking'],
      ['Campingplätze', 'campsite'],
      ['Supermärkte', 'grocery'],
      ['Sehenswürdigkeiten', 'attraction'],
    ] as const) {
      expect(klassen.has(klasse), `${wunsch} fehlen (Klasse "${klasse}")`).toBe(true);
    }
    expect(
      POI_KATEGORIEN.some((k) => k.unterklassen?.includes('caravan_site')),
      'Wohnmobilstellplätze fehlen',
    ).toBe(true);
  });

  it('jede Kategorie hat einen deutschen Namen', () => {
    // Er taucht in Legende und Einstellungen auf; eine leere Kategorie wäre
    // ein Knopf ohne Beschriftung.
    for (const k of POI_KATEGORIEN) {
      expect(k.name.length, `"${k.symbol}" ohne Namen`).toBeGreaterThan(2);
    }
  });

  it('jedes Symbol heißt nach der Sprite-Regel', () => {
    for (const k of POI_KATEGORIEN) {
      expect(k.symbol, `"${k.symbol}" passt nicht zum Namensschema`).toMatch(/^poi-[a-z]+$/);
    }
  });
});
