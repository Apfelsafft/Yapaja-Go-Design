/**
 * Die Ebenen einer Yapaia-Karte — einmal geschrieben, von jedem Stil benutzt.
 *
 * ─── WAS HIER GEZEICHNET WIRD, UND WORAUS ───────────────────────────────────
 * Jede `source-layer` und jeder Klassenwert unten stammt aus
 * `OpenMapTilesSchema.java` des Profils, mit dem planetiler unsere Kacheln
 * baut — nicht aus dem Gedächtnis. Das ist hier keine Formsache: eine Ebene,
 * die es im Archiv nicht gibt, wirft in MapLibre KEINEN Fehler. Sie wird
 * einfach leer gezeichnet. Ein Tippfehler in `landcover` wäre also von „für
 * diese Gegend gibt es keine Daten" nicht zu unterscheiden — und genau diese
 * Sorte lautloses Nichts hat dieses Projekt schon mehrfach gekostet.
 *
 * `baseLayers.test.ts` hält die Liste gegen die Ebenen, die das Schema führt.
 *
 * ─── REIHENFOLGE IST BEDEUTUNG ──────────────────────────────────────────────
 * MapLibre zeichnet von oben nach unten; was später kommt, liegt darüber:
 *
 *   Grund → Landbedeckung → Flächennutzung → Park → Wasser → Wasserläufe
 *   → Gebäude → Straßen (erst Umrandung, dann Füllung, nach Wichtigkeit)
 *   → Grenzen → Beschriftung
 *
 * Die Umrandungen ALLER Straßen liegen unter den Füllungen ALLER Straßen.
 * Sonst schneidet die Umrandung der kleinen Straße in die große hinein, und
 * an jeder Kreuzung entsteht ein Fleck.
 *
 * ─── ZWEI REGELN, DIE VON AUSSEN KOMMEN ─────────────────────────────────────
 * 1. `text-size` bleibt eine ZAHL. `options.ts` skaliert die Labelgröße nur
 *    bei numerischen Werten und lässt Ausdrücke unangetastet — ein
 *    zoom-abhängiger Ausdruck würde die Einstellung „Label-Größe" also still
 *    wirkungslos machen. Zoom-Abhängigkeit steckt deshalb in `minzoom`.
 * 2. POI-Ebenen heißen `poi…`. `options.ts` erkennt sie an diesem Präfix und
 *    wendet die POI-Dichte darauf an (constants.ts).
 */

import { REGION_SOURCE_ID } from './constants.js';
import { FONT_BOLD, FONT_REGULAR } from './fonts.js';
import { SHIELD_ICONS, SHIELD_TEXT_COLORS } from './sprites.js';
import { rangNachKategorie, symbolNachKategorie } from './poiKategorien.js';
import type { MapPalette } from './palette.js';
import type { StyleLayer } from './types.js';

/** Zoomabhängige Linienbreite, skaliert mit `roadWidthScale` der Palette. */
function width(scale: number, stops: readonly (readonly [number, number])[]): unknown[] {
  const out: unknown[] = ['interpolate', ['exponential', 1.5], ['zoom']];
  for (const [zoom, w] of stops) {
    out.push(zoom, Math.round(w * scale * 100) / 100);
  }
  return out;
}

/** Eine Straßenebene (Umrandung ODER Füllung) für eine Klassenauswahl. */
function road(
  id: string,
  classes: readonly string[],
  color: string,
  widths: readonly (readonly [number, number])[],
  scale: number,
  minzoom: number,
  extraPaint: Record<string, unknown> = {},
): StyleLayer {
  return {
    id,
    type: 'line',
    source: REGION_SOURCE_ID,
    'source-layer': 'transportation',
    minzoom,
    filter: ['in', ['get', 'class'], ['literal', [...classes]]],
    layout: { visibility: 'visible', 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width(scale, widths), ...extraPaint },
  };
}

function fill(
  id: string,
  sourceLayer: string,
  color: string,
  opts: { minzoom?: number; filter?: unknown[]; opacity?: number } = {},
): StyleLayer {
  return {
    id,
    type: 'fill',
    source: REGION_SOURCE_ID,
    'source-layer': sourceLayer,
    ...(opts.minzoom !== undefined ? { minzoom: opts.minzoom } : {}),
    ...(opts.filter ? { filter: opts.filter } : {}),
    layout: { visibility: 'visible' },
    paint: { 'fill-color': color, ...(opts.opacity !== undefined ? { 'fill-opacity': opts.opacity } : {}) },
  };
}

/**
 * Welche Straßenklasse welches Schild bekommt.
 *
 * `motorway` ist die Autobahn (blau). `trunk` (Kraftfahrstraße) und
 * `primary` (in Deutschland die Bundesstraße) teilen sich das gelbe Schild.
 * `secondary` — Landes- und Kreisstraßen — bekommt das weiße.
 *
 * Als EINE Tabelle, aus der beide Ausdrücke unten entstehen: sonst könnte
 * eine Klasse das blaue Schild und die schwarze Schrift bekommen, und das
 * fiele erst auf der Karte auf.
 */
const SCHILD_KLASSEN: ReadonlyArray<readonly [string, keyof typeof SHIELD_ICONS]> = [
  ['motorway', 'motorway'],
  ['trunk', 'trunk'],
  ['primary', 'trunk'],
  ['secondary', 'minor'],
];

/** Die Klassen, für die es überhaupt ein Schild gibt. */
export const SCHILD_KLASSENWERTE = SCHILD_KLASSEN.map(([omt]) => omt);

/** `['match', ['get','class'], 'motorway', 'shield-motorway', …, <Rückfall>]` */
const SCHILD_NACH_KLASSE: unknown[] = [
  'match',
  ['get', 'class'],
  ...SCHILD_KLASSEN.flatMap(([omt, form]) => [omt, SHIELD_ICONS[form]]),
  // Rückfall: das unauffälligste Schild. MapLibre BRAUCHT einen -- ohne ihn
  // ist der Ausdruck ungültig und die ganze Ebene fällt aus.
  SHIELD_ICONS.minor,
];

const TEXTFARBE_NACH_KLASSE: unknown[] = [
  'match',
  ['get', 'class'],
  ...SCHILD_KLASSEN.flatMap(([omt, form]) => [omt, SHIELD_TEXT_COLORS[form]]),
  SHIELD_TEXT_COLORS.minor,
];

/** Klassenwerte aus dem OMT-Schema. Als Konstanten, damit ein Tippfehler beim
 *  Wiederverwenden auffällt statt eine Ebene still leer zu lassen. */
const CLASS = {
  motorway: ['motorway'],
  trunk: ['trunk'],
  primary: ['primary'],
  secondary: ['secondary', 'tertiary'],
  minor: ['minor'],
  service: ['service'],
  path: ['path', 'track'],
} as const;

export function buildBaseLayers(p: MapPalette): StyleLayer[] {
  const s = p.roadWidthScale;

  return [
    { id: 'background', type: 'background', paint: { 'background-color': p.background } },

    // ─── Landbedeckung ────────────────────────────────────────────────────
    fill('landcover-wood', 'landcover', p.wood, { filter: ['==', ['get', 'class'], 'wood'] }),
    fill('landcover-grass', 'landcover', p.grass, { filter: ['==', ['get', 'class'], 'grass'] }),
    fill('landcover-farmland', 'landcover', p.farmland, { filter: ['==', ['get', 'class'], 'farmland'] }),
    fill('landcover-wetland', 'landcover', p.wetland, { filter: ['==', ['get', 'class'], 'wetland'] }),
    fill('landcover-sand', 'landcover', p.sand, { filter: ['==', ['get', 'class'], 'sand'] }),
    fill('landcover-rock', 'landcover', p.rock, { filter: ['==', ['get', 'class'], 'rock'] }),
    fill('landcover-ice', 'landcover', p.ice, { filter: ['==', ['get', 'class'], 'ice'] }),

    // ─── Flächennutzung ───────────────────────────────────────────────────
    fill('landuse-residential', 'landuse', p.residential, {
      minzoom: 9,
      filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'quarter']]],
    }),
    fill('landuse-industrial', 'landuse', p.industrial, {
      minzoom: 10,
      filter: ['in', ['get', 'class'], ['literal', ['industrial', 'commercial', 'retail', 'garages', 'quarry']]],
    }),
    fill('landuse-institution', 'landuse', p.institution, {
      minzoom: 11,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['school', 'university', 'college', 'hospital', 'kindergarten', 'library']],
      ],
    }),
    fill('landuse-cemetery', 'landuse', p.cemetery, {
      minzoom: 11,
      filter: ['==', ['get', 'class'], 'cemetery'],
    }),

    // ─── Parks ────────────────────────────────────────────────────────────
    // `park` fuehrt keine `class`-Werte, die wir unterscheiden muessten.
    fill('park', 'park', p.park, { minzoom: 8, opacity: 0.75 }),

    // ─── Wasser ───────────────────────────────────────────────────────────
    // Ohne diese eine Ebene wirkt jede Karte tot -- Wasser ist das Element,
    // an dem man eine Gegend zuerst wiedererkennt.
    fill('water', 'water', p.water),
    {
      id: 'waterway',
      type: 'line',
      source: REGION_SOURCE_ID,
      'source-layer': 'waterway',
      minzoom: 9,
      layout: { visibility: 'visible', 'line-cap': 'round' },
      paint: {
        'line-color': p.waterway,
        'line-width': width(1, [
          [9, 0.6],
          [14, 1.8],
          [18, 4],
        ]),
      },
    },

    // ─── Gebäude ──────────────────────────────────────────────────────────
    fill('building', 'building', p.building, { minzoom: 14 }),
    {
      id: 'building-outline',
      type: 'line',
      source: REGION_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 15,
      layout: { visibility: 'visible' },
      paint: { 'line-color': p.buildingOutline, 'line-width': 0.6 },
    },

    // ─── Bahn ─────────────────────────────────────────────────────────────
    {
      id: 'rail',
      type: 'line',
      source: REGION_SOURCE_ID,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: ['in', ['get', 'subclass'], ['literal', ['rail', 'light_rail', 'narrow_gauge', 'funicular']]],
      layout: { visibility: 'visible' },
      paint: {
        'line-color': p.rail,
        'line-width': width(1, [
          [10, 0.5],
          [16, 2],
        ]),
        'line-dasharray': [3, 2],
      },
    },

    // ─── Straßen: ERST alle Umrandungen ───────────────────────────────────
    road('road-service-casing', CLASS.service, p.minorCasing, [[13, 2], [18, 8]], s, 13),
    road('road-minor-casing', CLASS.minor, p.minorCasing, [[11, 1.6], [14, 4], [18, 16]], s, 11),
    road('road-secondary-casing', CLASS.secondary, p.secondaryCasing, [[8, 1.6], [14, 6], [18, 22]], s, 7),
    road('road-primary-casing', CLASS.primary, p.primaryCasing, [[7, 2], [14, 8], [18, 26]], s, 6),
    road('road-trunk-casing', CLASS.trunk, p.trunkCasing, [[6, 2.2], [14, 9], [18, 28]], s, 5),
    road('road-motorway-casing', CLASS.motorway, p.motorwayCasing, [[5, 2.4], [14, 11], [18, 32]], s, 4),

    // ─── … DANN alle Füllungen (siehe Kopfkommentar) ──────────────────────
    // Wege gestrichelt: sie sind sichtbar, ohne wie eine befahrbare Strasse
    // auszusehen -- fuer ein 3,2 m hohes Fahrzeug ein wichtiger Unterschied.
    // Ohne `scale`: der Kontraststil soll Fahrwege betonen, nicht Trampelpfade.
    road('road-path', CLASS.path, p.path, [[13, 0.8], [18, 3]], 1, 13, {
      'line-dasharray': [2, 2],
    }),
    road('road-service', CLASS.service, p.service, [[13, 1], [18, 6]], s, 13),
    road('road-minor', CLASS.minor, p.minor, [[11, 0.8], [14, 2.6], [18, 13]], s, 11),
    road('road-secondary', CLASS.secondary, p.secondary, [[8, 0.9], [14, 4.4], [18, 19]], s, 7),
    road('road-primary', CLASS.primary, p.primary, [[7, 1.2], [14, 6], [18, 23]], s, 6),
    road('road-trunk', CLASS.trunk, p.trunk, [[6, 1.4], [14, 7], [18, 25]], s, 5),
    road('road-motorway', CLASS.motorway, p.motorway, [[5, 1.6], [14, 8.5], [18, 28]], s, 4),

    // ─── Grenzen ──────────────────────────────────────────────────────────
    {
      id: 'boundary',
      type: 'line',
      source: REGION_SOURCE_ID,
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['<=', ['get', 'admin_level'], 4],
      layout: { visibility: 'visible' },
      paint: {
        'line-color': p.boundary,
        'line-width': width(1, [
          [3, 0.6],
          [10, 1.6],
        ]),
        'line-dasharray': [4, 2],
      },
    },

    // ─── Beschriftung ─────────────────────────────────────────────────────
    // `text-size` bleibt eine Zahl, damit die Label-Groessen-Option greift
    // (siehe Kopfkommentar). Zoom-Staffelung laeuft ueber `minzoom`.
    {
      id: 'water-labels',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'water_name',
      minzoom: 9,
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': [FONT_REGULAR],
      },
      paint: { 'text-color': p.waterText, 'text-halo-color': p.placeHalo, 'text-halo-width': 1 },
    },
    {
      // Strassennamen -- sie fehlten bisher voellig, und ohne sie ist eine
      // Karte zum Navigieren kaum zu gebrauchen.
      id: 'road-labels',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 13,
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': [FONT_REGULAR],
        'symbol-placement': 'line',
        'text-rotation-alignment': 'map',
      },
      paint: { 'text-color': p.roadText, 'text-halo-color': p.roadHalo, 'text-halo-width': 1.4 },
    },
    {
      // ─── STRASSENNUMMERN: A 61, B 9 ───────────────────────────────────────
      // Gemeldet: „Die Straßennamen sind sichtbar. Aber sowas wie A61 für
      // Autobahnen um B9 für Bundesstraßen sehe ich nicht."
      //
      // Der Grund: die Nummer steht im OMT-Schema NICHT in `name`, sondern in
      // einem eigenen Feld `ref`. Die Ebene darüber liest nur `name` — und
      // eine Autobahn hat in OpenStreetMap meist gar keinen Namen, nur eine
      // Nummer. Für sie stand dort also nichts zu beschriften, und sie blieb
      // stumm, ohne dass irgendetwas fehlschlug.
      //
      // Eine EIGENE Ebene und kein zweites Feld in der darüber: die Nummer
      // soll viel früher sichtbar sein. Beim Navigieren sucht man „wo ist die
      // A61" in der Übersicht, nicht bei Zoomstufe 13, wo man ohnehin schon
      // darauf steht.
      //
      // ─── SEIT 0.8.15: ECHTE SCHILDER MIT RAHMEN ───────────────────────────
      // Blau mit weißem Rand für die Autobahn, Gelb mit schwarzem für die
      // Bundesstraße, Weiß für Landes- und Kreisstraßen. Die Bilder liegen im
      // Repo (`scripts/generate-sprites.mjs`).
      //
      // Wie ein Bild zu „A 5" UND zu „A 61" passt: `icon-text-fit` zieht das
      // Symbol auf die Textbreite. Dehnen darf sich dabei nur ein schmaler
      // Streifen in der Mitte (`stretchX` im Sprite) — sonst würden die runden
      // Ecken bei längeren Nummern zu Ellipsen.
      //
      // Die Farbe richtet sich nach der Straßenklasse und NICHT nach dem
      // Buchstaben in der Nummer: „A" heißt nicht überall Autobahn, und die
      // Klasse ist in ganz Europa dieselbe Angabe. Die Begründung steht
      // ausführlich im Erzeuger.
      id: 'road-shields',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'transportation_name',
      minzoom: 7,
      // `['has', 'ref']` genügt: planetiler schreibt `ref` durch
      // `nullIfEmpty(...)`, ein leerer Wert landet also gar nicht erst in der
      // Kachel (`TransportationName.java`). Der zweite Test darunter steht
      // trotzdem da — er kostet nichts und deckt Kacheln ab, die jemand mit
      // einem anderen Werkzeug gebaut hat.
      filter: [
        'all',
        ['has', 'ref'],
        ['!=', ['get', 'ref'], ''],
        ['in', ['get', 'class'], ['literal', SCHILD_KLASSENWERTE]],
      ],
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'ref'],
        'text-size': 11,
        'text-font': [FONT_BOLD],
        'symbol-placement': 'line',
        // Schild UND Nummer bleiben aufrecht, auch wenn die Straße quer
        // verläuft. Ein mitgedrehtes Schild wäre auf einer Kurve unlesbar.
        'text-rotation-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
        'icon-image': SCHILD_NACH_KLASSE,
        'icon-text-fit': 'both',
        // Links/rechts mehr Luft als oben/unten: so wirkt das Schild wie ein
        // Schild und nicht wie ein Kasten, der am Text klebt.
        'icon-text-fit-padding': [1, 4, 1, 4],
        'text-anchor': 'center',
        'icon-anchor': 'center',
        // Damit die Nummer auf einer langen Autobahn mehrfach auftaucht und
        // nicht nur einmal je Kachelabschnitt.
        'symbol-spacing': 220,
        'text-padding': 4,
        // Das Schild darf andere Beschriftung verdrängen, aber nicht sich
        // selbst überlagern.
        'icon-allow-overlap': false,
        'text-allow-overlap': false,
      },
      paint: {
        // Der Rahmen ist jetzt gemalt, nicht mehr aus einem Textrand
        // gebastelt -- der Halo faellt darum weg. Bliebe er stehen, saesse ein
        // weisser Schimmer auf dem Autobahnblau.
        'text-color': TEXTFARBE_NACH_KLASSE,
      },
    },
    {
      id: 'place-labels-major',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'place',
      minzoom: 4,
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'name'],
        'text-size': 14,
        // Halbfett: so heben sich Staedte von allem anderen ab, ohne dass
        // die Schrift groesser werden und mehr Platz belegen muesste.
        'text-font': [FONT_BOLD],
      },
      paint: { 'text-color': p.placeText, 'text-halo-color': p.placeHalo, 'text-halo-width': 1.4 },
    },
    {
      id: 'place-labels',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'place',
      minzoom: 9,
      filter: [
        'in',
        ['get', 'class'],
        ['literal', ['village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling']],
      ],
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-font': [FONT_REGULAR],
      },
      paint: { 'text-color': p.placeText, 'text-halo-color': p.placeHalo, 'text-halo-width': 1.2 },
    },
    {
      id: 'mountain-peak-labels',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'mountain_peak',
      minzoom: 11,
      filter: ['in', ['get', 'class'], ['literal', ['peak', 'volcano']]],
      layout: {
        visibility: 'visible',
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': [FONT_REGULAR],
      },
      paint: { 'text-color': p.poiText, 'text-halo-color': p.poiHalo, 'text-halo-width': 1 },
    },
    {
      // Muss mit `poi` beginnen -- daran erkennt options.ts die POI-Dichte.
      // ─── ORTE MIT SYMBOL ──────────────────────────────────────────────────
      // Gewuenscht: „Koennen wir auch poi's wie bei Google Maps einfuegen?
      // Restaurants, Womo Stellplaetze, Parkplaetze, Campingplaetze,
      // Supermaerkte, Sehenswuerdigkeiten usw?"
      //
      // Bis 0.8.15 stand hier nur der Name. Auf einer Karte, auf der ein
      // Baecker genauso aussieht wie ein Stellplatz, ist „wo kann ich heute
      // stehen" nicht zu beantworten.
      //
      // EINE Ebene und nicht neun: die POI-Dichte in `options.ts` erkennt
      // Ebenen am Praefix `poi`, und neun Ebenen waeren neun Stellen, an
      // denen dieselbe Einstellung wirken muesste. Welches Bild ein Ort
      // bekommt, entscheidet stattdessen ein Ausdruck -- die Zuordnung steht
      // in `poiKategorien.ts`, samt der Belege aus dem Kachelprofil.
      id: 'poi-labels',
      type: 'symbol',
      source: REGION_SOURCE_ID,
      'source-layer': 'poi',
      // Tiefer waere wirkungslos: die Kacheln fuehren POIs erst ab 14
      // (`Poi.java#minzoom`).
      minzoom: 14,
      layout: {
        visibility: 'visible',
        'icon-image': symbolNachKategorie(),
        'icon-size': 0.85,
        'icon-anchor': 'center',
        // Wird es eng, gewinnt die Kategorie mit dem kleineren Rang. Fuer ein
        // Wohnmobil heisst das: Stellplatz vor Eisdiele.
        'symbol-sort-key': rangNachKategorie(),
        'text-field': ['get', 'name'],
        'text-size': 10,
        'text-font': [FONT_REGULAR],
        // Der Name steht UNTER der Marke, nicht darauf.
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        // Beides optional: ein Ort ohne Kategorie hat kein Bild und soll
        // trotzdem seinen Namen zeigen -- und wird es eng, faellt lieber der
        // Name weg als die Marke.
        'icon-optional': true,
        'text-optional': true,
      },
      paint: { 'text-color': p.poiText, 'text-halo-color': p.poiHalo, 'text-halo-width': 1.2 },
    },
  ];
}
