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
import { POI_LAYER_ID_PREFIX } from './constants';
import { OMITTED_LAYER_IDS, buildYapajaMinimalStyle } from './yapaja-minimal';
import { buildYapajaContrastStyle } from './yapaja-contrast';

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
    expect(buildYapajaMinimalStyle().layers.length).toBe(baseIds.size - OMITTED_LAYER_IDS.size);
  });

  it('hängt „Kontrast" den POI-Filter an eine Ebene, die es wirklich gibt', () => {
    const filtered = buildYapajaContrastStyle().layers.filter(
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
