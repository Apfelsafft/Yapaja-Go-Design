/**
 * Hält die Kartografie gegen die Ebenen, die unsere Kacheln wirklich führen.
 *
 * ─── WARUM DAS EIN EIGENER TEST IST ─────────────────────────────────────────
 * MapLibre wirft KEINEN Fehler, wenn ein Stil eine `source-layer` nennt, die
 * es im Kachelarchiv nicht gibt. Die Ebene wird stillschweigend leer
 * gezeichnet. Ein Tippfehler in `landcover` — oder ein erfundener Ebenenname —
 * wäre also von „für diese Gegend gibt es keine Daten" nicht zu unterscheiden.
 * Und die Stil-Spec-Validierung in `styles.test.ts` merkt es auch nicht: der
 * Stil ist ja formal gültig.
 *
 * Genau so entsteht das, was der Betreiber gemeldet hat — eine Karte, die
 * „langweilig" aussieht, obwohl die Daten da sind. Der bisherige Zustand war
 * dieselbe Klasse Problem, nur aus dem anderen Grund: die Ebenen wurden gar
 * nicht erst genannt.
 *
 * ─── DIE LISTE IST NICHT AUSGEDACHT ─────────────────────────────────────────
 * `OMT_LAYERS` unten ist die vollständige `LAYER_NAME`-Liste aus
 * `OpenMapTilesSchema.java` des Profils, mit dem planetiler unsere Kacheln
 * baut (openmaptiles/planetiler-openmaptiles). Sie wurde aus dem Quelltext
 * gelesen, nicht aus dem Gedächtnis. Ändert sich das Profil, gehört diese
 * Liste angepasst — dann fällt dieser Test um und sagt genau das.
 */

import { describe, it, expect } from 'vitest';
import { buildBaseLayers } from './baseLayers';
import { LIGHT_PALETTE, DARK_PALETTE, CONTRAST_PALETTE, OUTDOOR_PALETTE } from './palette';
import { REGION_SOURCE_ID } from './constants';
import { SHIPPED_FONTS } from './fonts';
import { POI_LAYER_ID_PREFIX } from './constants';
import { OMITTED_LAYER_IDS, buildYapaiaMinimalStyle } from './yapaja-minimal';
import { buildYapaiaContrastStyle } from './yapaja-contrast';

/** Die `source-layer`-Namen, die das OpenMapTiles-Profil erzeugt. */
const OMT_LAYERS: ReadonlySet<string> = new Set([
  'aerodrome_label',
  'aeroway',
  'boundary',
  'building',
  'housenumber',
  'landcover',
  'landuse',
  'mountain_peak',
  'park',
  'place',
  'poi',
  'transportation',
  'transportation_name',
  'water',
  'water_name',
  'waterway',
]);

const ALL_PALETTES = [
  ['hell', LIGHT_PALETTE],
  ['dunkel', DARK_PALETTE],
  ['kontrast', CONTRAST_PALETTE],
  ['natur', OUTDOOR_PALETTE],
] as const;

describe('buildBaseLayers — Ebenen gegen das echte Kachelschema', () => {
  // ─── DER EIGENTLICHE PUNKT ────────────────────────────────────────────────
  it('nennt ausschließlich source-layer, die es in den Kacheln gibt', () => {
    for (const [name, palette] of ALL_PALETTES) {
      for (const layer of buildBaseLayers(palette)) {
        if (layer.type === 'background') continue;
        const sourceLayer = (layer as { 'source-layer': string })['source-layer'];
        expect(
          OMT_LAYERS.has(sourceLayer),
          `Stil "${name}", Ebene "${layer.id}" zeichnet aus "${sourceLayer}" — die gibt es im ` +
            'Kachelarchiv nicht. MapLibre meldet das NICHT, die Ebene bliebe einfach leer.',
        ).toBe(true);
      }
    }
  });

  it('bezieht jede Ebene aus der einen Vektorquelle', () => {
    for (const layer of buildBaseLayers(LIGHT_PALETTE)) {
      if (layer.type === 'background') continue;
      expect((layer as { source: string }).source).toBe(REGION_SOURCE_ID);
    }
  });

  /** Das war der gemeldete Mangel: drei Ebenen von sechzehn. Diese Prüfung
   *  hält fest, dass die Karte die Elemente zeichnet, an denen man eine Gegend
   *  überhaupt erkennt. */
  it('zeichnet Wasser, Grün, Gebäude, Straßenhierarchie und Straßennamen', () => {
    const layers = buildBaseLayers(LIGHT_PALETTE);
    const used = new Set(
      layers.filter((l) => l.type !== 'background').map((l) => (l as { 'source-layer': string })['source-layer']),
    );

    for (const required of ['water', 'landcover', 'building', 'transportation', 'transportation_name', 'place']) {
      expect(used, `"${required}" wird von keiner Ebene gezeichnet`).toContain(required);
    }

    // Strassenhierarchie: mehrere Klassen, nicht eine Linie fuer alles.
    const roadFills = layers.filter(
      (l) => l.type === 'line' && l.id.startsWith('road-') && !l.id.endsWith('-casing') && l.id !== 'road-labels',
    );
    expect(roadFills.length, 'keine Strassenhierarchie').toBeGreaterThanOrEqual(5);
  });

  /**
   * Reihenfolge ist Bedeutung: ALLE Umrandungen unter ALLEN Füllungen. Sonst
   * schneidet die Umrandung der kleinen Straße in die große hinein, und an
   * jeder Kreuzung entsteht ein Fleck.
   */
  it('legt jede Straßen-Umrandung unter jede Straßen-Füllung', () => {
    const layers = buildBaseLayers(LIGHT_PALETTE);
    const ids = layers.map((l) => l.id);
    const lastCasing = Math.max(...ids.filter((id) => id.endsWith('-casing')).map((id) => ids.indexOf(id)));
    const firstFill = Math.min(
      ...ids
        .filter((id) => id.startsWith('road-') && !id.endsWith('-casing') && id !== 'road-labels')
        .map((id) => ids.indexOf(id)),
    );
    expect(lastCasing).toBeLessThan(firstFill);
  });

  it('zeichnet die Beschriftung über allen Flächen und Linien', () => {
    const layers = buildBaseLayers(LIGHT_PALETTE);
    const firstSymbol = layers.findIndex((l) => l.type === 'symbol');
    const lastNonSymbol = layers.map((l) => l.type).lastIndexOf('line');
    expect(firstSymbol).toBeGreaterThan(lastNonSymbol);
  });

  /**
   * ─── ZWEI REGELN, DIE VON AUSSEN KOMMEN ─────────────────────────────────
   * `options.ts` skaliert `text-size` NUR, wenn es eine Zahl ist, und erkennt
   * POI-Ebenen an ihrem Präfix. Ein Zoom-Ausdruck als Schriftgröße würde die
   * Einstellung „Label-Größe" also still wirkungslos machen — die Art von
   * Regression, die niemand bemerkt, bis jemand die Einstellung benutzt.
   */
  it('hält text-size numerisch, damit die Label-Größen-Einstellung greift', () => {
    for (const [name, palette] of ALL_PALETTES) {
      for (const layer of buildBaseLayers(palette)) {
        if (layer.type !== 'symbol') continue;
        expect(
          typeof layer.layout['text-size'],
          `Stil "${name}", Ebene "${layer.id}": text-size ist kein Zahlenwert — ` +
            'options.ts kann die Label-Größe dann nicht mehr skalieren.',
        ).toBe('number');
      }
    }
  });

  it('benennt die POI-Ebene so, dass die POI-Dichte auf sie greift', () => {
    const poiLayers = buildBaseLayers(LIGHT_PALETTE).filter(
      (l) => l.type === 'symbol' && (l as { 'source-layer': string })['source-layer'] === 'poi',
    );
    expect(poiLayers.length).toBeGreaterThan(0);
    for (const layer of poiLayers) {
      expect(
        layer.id.startsWith(POI_LAYER_ID_PREFIX),
        `"${layer.id}" zeichnet POIs, heißt aber nicht "${POI_LAYER_ID_PREFIX}…" — ` +
          'die POI-Dichte-Einstellung würde diese Ebene nicht erfassen.',
      ).toBe(true);
    }
  });

  /**
   * ─── EINE ID, DIE NIEMANDEN MEHR TRIFFT ───────────────────────────────────
   * Zwei Stile greifen Ebenen über ihre ID heraus: „Reduziert" lässt eine
   * Liste weg, „Kontrast" hängt der POI-Ebene einen Filter an. Wird eine ID in
   * `baseLayers.ts` umbenannt, trifft der Zugriff ins Leere — und zwar
   * lautlos: „Reduziert" zeigt dann plötzlich Gebäude, „Kontrast" alle POIs.
   * Kein Fehler, nur ein Stil, der nicht mehr das tut, was sein Name sagt.
   */
  it('lässt „Reduziert" nur Ebenen weg, die es wirklich gibt', () => {
    const baseIds = new Set(buildBaseLayers(LIGHT_PALETTE).map((l) => l.id));
    for (const omitted of OMITTED_LAYER_IDS) {
      expect(
        baseIds.has(omitted),
        `"Reduziert" laesst "${omitted}" weg — diese Ebene gibt es aber nicht (mehr). ` +
          'Die Auslassung ist damit wirkungslos, ohne dass es auffiele.',
      ).toBe(true);
    }
    expect(buildYapaiaMinimalStyle().layers.length).toBe(baseIds.size - OMITTED_LAYER_IDS.size);
  });

  it('hängt „Kontrast" den POI-Filter an eine Ebene, die es wirklich gibt', () => {
    const filtered = buildYapaiaContrastStyle().layers.filter(
      (l) => l.type === 'symbol' && Array.isArray((l as { filter?: unknown[] }).filter),
    );
    const poiFiltered = filtered.filter((l) => l.id.startsWith(POI_LAYER_ID_PREFIX));
    expect(
      poiFiltered.length,
      'im Kontraststil traegt keine POI-Ebene den reduzierten Filter — der Zugriff ' +
        'ueber die Ebenen-ID geht ins Leere.',
    ).toBeGreaterThan(0);
  });

  it('vergibt jede Ebenen-ID nur einmal', () => {
    for (const [name, palette] of ALL_PALETTES) {
      const ids = buildBaseLayers(palette).map((l) => l.id);
      expect(new Set(ids).size, `Stil "${name}" hat doppelte Ebenen-IDs`).toBe(ids.length);
    }
  });
});

/**
 * ─── STRASSENNUMMERN (A 61, B 9) ────────────────────────────────────────────
 * Gemeldet: „Die Straßennamen sind sichtbar. Aber sowas wie A61 für
 * Autobahnen um B9 für Bundesstraßen sehe ich nicht."
 *
 * Die Nummer steht im OMT-Schema in `ref`, nicht in `name`. Eine Autobahn hat
 * in OpenStreetMap meist gar keinen Namen — für sie gab es auf der
 * Namensebene also nichts zu zeichnen, und sie blieb stumm, ohne dass
 * irgendetwas fehlschlug.
 */
describe('road-shields — die Straßennummern', () => {
  const schilder = (): Record<string, unknown> => {
    const l = buildBaseLayers(LIGHT_PALETTE).find((e) => e.id === 'road-shields');
    if (!l) throw new Error('Ebene "road-shields" fehlt');
    return l as unknown as Record<string, unknown>;
  };
  const layout = (): Record<string, unknown> =>
    schilder().layout as Record<string, unknown>;

  it('liest aus `ref` und nicht aus `name`', () => {
    expect(layout()['text-field']).toEqual(['get', 'ref']);
  });

  it('liegt auf `transportation_name` — dort führt planetiler das Feld', () => {
    expect(schilder()['source-layer']).toBe('transportation_name');
  });

  it('erscheint FRÜHER als die Straßennamen', () => {
    // Der eigentliche Grund für eine eigene Ebene. „Wo ist die A61" ist eine
    // Frage der Übersicht, nicht der Zoomstufe 13, auf der man ohnehin schon
    // darauf steht.
    const namen = buildBaseLayers(LIGHT_PALETTE).find((e) => e.id === 'road-labels');
    expect((schilder().minzoom as number)).toBeLessThan(
      (namen as unknown as { minzoom: number }).minzoom,
    );
  });

  it('beschränkt sich auf Straßen, die überhaupt Nummern tragen', () => {
    // Ohne den Klassenfilter bekäme jeder Feldweg mit einer Wanderwegnummer
    // ein Schild, und die Karte wäre auf kleinem Bildschirm unlesbar.
    const f = JSON.stringify(schilder().filter);
    expect(f).toContain('motorway');
    expect(f).toContain('trunk');
    expect(f).not.toContain('path');
    expect(f).not.toContain('service');
  });

  it('gibt es in JEDEM ausgelieferten Stil', () => {
    // Sonst wäre die Nummer je nach gewähltem Stil da oder nicht — und
    // niemand käme darauf, dass es am Stil liegt.
    for (const p of [LIGHT_PALETTE, DARK_PALETTE, CONTRAST_PALETTE, OUTDOOR_PALETTE]) {
      expect(
        buildBaseLayers(p).some((e) => e.id === 'road-shields'),
        'road-shields fehlt in einer Palette',
      ).toBe(true);
    }
  });

  // ─── OHNE DIESE DREI ZEILEN SIEHT DAS SCHILD FALSCH AUS ──────────────────
  // Und zwar ohne jede Fehlermeldung: MapLibre zeichnet dann ein starres
  // Kästchen in Grundgröße, und „A 61" ragt links und rechts heraus.
  it('zieht das Schild auf die Breite der Nummer', () => {
    expect(layout()['icon-text-fit']).toBe('both');
  });

  it('lässt Luft zwischen Nummer und Rahmen', () => {
    // Ohne Polsterung klebt die Zahl am Rand. Links/rechts mehr als
    // oben/unten -- sonst wirkt es wie ein Kasten, nicht wie ein Schild.
    const pad = layout()['icon-text-fit-padding'] as number[];
    expect(pad).toHaveLength(4);
    expect(pad[1], 'rechts keine Luft').toBeGreaterThan(0);
    expect(pad[3], 'links keine Luft').toBeGreaterThan(0);
  });

  it('hält Schild UND Nummer aufrecht', () => {
    // `symbol-placement: 'line'` würde beides mit der Straße mitdrehen. Ein
    // kopfstehendes Autobahnschild in einer Linkskurve ist unlesbar.
    expect(layout()['icon-rotation-alignment']).toBe('viewport');
    expect(layout()['text-rotation-alignment']).toBe('viewport');
  });

  it('färbt die Nummer je Schild und nicht einheitlich', () => {
    // Eine feste Farbe wäre auf mindestens einem der drei Schilder unlesbar.
    const farbe = JSON.stringify((schilder().paint as Record<string, unknown>)['text-color']);
    expect(farbe).toContain('match');
    expect(farbe).toContain('#FFFFFF');
    expect(farbe).toContain('#1A1A1A');
  });

  it('trägt keinen Textrand mehr — der Rahmen ist jetzt gemalt', () => {
    // Bliebe der Halo stehen, säße ein weißer Schimmer auf dem Autobahnblau.
    const paint = (schilder().paint ?? {}) as Record<string, unknown>;
    expect('text-halo-width' in paint).toBe(false);
  });

  it('nutzt einen Schriftschnitt, für den Glyphen ausgeliefert werden', () => {
    // Ohne das bliebe die Ebene leer, gemeldet nur in der Browserkonsole --
    // siehe Kopf von `fonts.ts`.
    expect(SHIPPED_FONTS).toContain((layout()['text-font'] as string[])[0]);
  });
});

/**
 * ─── ORTE MIT SYMBOL ────────────────────────────────────────────────────────
 * Gewünscht: „Können wir auch poi's wie bei Google Maps einfügen? Restaurants,
 * Womo Stellplätze, Parkplätze, Campingplätze, Supermärkte,
 * Sehenswürdigkeiten usw?"
 */
describe('poi-labels — Orte mit Symbol', () => {
  const ebene = (): Record<string, unknown> => {
    const l = buildBaseLayers(LIGHT_PALETTE).find((e) => e.id === 'poi-labels');
    if (!l) throw new Error('Ebene "poi-labels" fehlt');
    return l as unknown as Record<string, unknown>;
  };
  const layout = (): Record<string, unknown> => ebene().layout as Record<string, unknown>;

  it('zeigt überhaupt ein Bild und nicht nur den Namen', () => {
    expect(layout()['icon-image']).toBeDefined();
  });

  it('sortiert nach Wichtigkeit — sonst verdrängt die Eisdiele den Stellplatz', () => {
    // Ohne `symbol-sort-key` entscheidet bei MapLibre die Reihenfolge in der
    // Kachel, also der Zufall. In einer Innenstadt ist das genau der Fall, in
    // dem es darauf ankommt.
    const key = layout()['symbol-sort-key'];
    expect(key, 'keine Rangfolge — bei Gedränge gewinnt der Zufall').toBeDefined();
    const text = JSON.stringify(key);
    expect(text).toContain('case');
    expect(text).toContain('caravan_site');
  });

  it('stellt den Stellplatz im Rang vor „Essen und Trinken"', () => {
    // Die Aussage selbst, nicht nur „ein Schlüssel ist gesetzt".
    const text = JSON.stringify(layout()['symbol-sort-key']);
    const womo = text.indexOf('caravan_site');
    const essen = text.indexOf('restaurant');
    expect(womo).toBeGreaterThan(-1);
    expect(essen).toBeGreaterThan(-1);
    expect(womo).toBeLessThan(essen);
  });

  it('setzt den Namen UNTER die Marke', () => {
    // Ohne Anker und Versatz liegt der Name mitten auf dem Symbol und beide
    // sind unlesbar.
    expect(layout()['text-anchor']).toBe('top');
    const versatz = layout()['text-offset'] as number[];
    expect(versatz[1], 'Name sitzt nicht unterhalb').toBeGreaterThan(0);
  });

  it('zeigt einen Ort ohne Kategorie weiterhin mit Namen', () => {
    // `icon-optional` — sonst verschwänden Bäcker, Apotheke und Bank ganz,
    // weil sie kein Bild haben. Das wäre eine Verschlechterung gegenüber
    // vorher, getarnt als neue Funktion.
    expect(layout()['icon-optional']).toBe(true);
  });

  it('lässt lieber den Namen weg als die Marke', () => {
    expect(layout()['text-optional']).toBe(true);
  });

  it('heißt so, dass die POI-Dichte sie erfasst', () => {
    // `options.ts` erkennt POI-Ebenen am Präfix. Ein anderer Name machte die
    // Einstellung „POI-Dichte" für diese Ebene still wirkungslos.
    expect(ebene().id as string).toMatch(/^poi/);
  });
});
