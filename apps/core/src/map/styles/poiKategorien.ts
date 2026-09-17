/**
 * Welche Orte auf der Karte ein Symbol bekommen — ausgesucht für ein
 * Wohnmobil, nicht für eine Stadtkarte.
 *
 * ─── WOFÜR ──────────────────────────────────────────────────────────────────
 * Gewünscht: „Können wir auch poi's wie bei Google Maps einfügen? Restaurants,
 * Womo Stellplätze, Parkplätze, Campingplätze, Supermärkte, Sehenswürdigkeiten
 * usw?"
 *
 * Bis 0.8.15 gab es EINE Ebene, die jeden POI gleich behandelte: nur der Name,
 * kein Symbol, keine Unterscheidung. Auf einer Karte, auf der ein Bäcker
 * genauso aussieht wie ein Stellplatz, ist die Frage „wo kann ich heute
 * stehen" nicht zu beantworten.
 *
 * ─── DIE ZUORDNUNG IST NACHGELESEN, NICHT GERATEN ───────────────────────────
 * Jeder Klassen- und Unterklassenwert unten stammt aus dem planetiler-Profil,
 * mit dem unsere Kacheln gebaut werden (`openmaptiles/planetiler-openmaptiles`,
 * `layers/Poi.java` und `generated/Tables.java`). Zwei Dinge daraus sind hier
 * tragend, und beide sind nicht offensichtlich:
 *
 *  1. `poiClass()` bildet nur eine AUSWAHL von Unterklassen auf eine Klasse ab
 *     und faellt sonst auf die Unterklasse selbst zurueck:
 *
 *         return classMapping.getOrElse(…, subclass);
 *
 *     Deshalb GIBT es die Klassen `restaurant` und `parking`, obwohl sie in
 *     keiner Konstantenliste des Schemas stehen -- sie fallen durch.
 *
 *  2. Umgekehrt gibt es Klassen NICHT, die man erwarten wuerde. `supermarket`
 *     ist eine davon: die Zuordnung schickt `supermarket`, `deli`,
 *     `department_store`, `greengrocer` und `marketplace` alle nach `grocery`.
 *
 * ─── DER FEHLER, DEN DAS AUFGEDECKT HAT ─────────────────────────────────────
 * `REDUCED_POI_CLASSES` in `constants.ts` enthielt bis 0.9.0 den Wert
 * `supermarket`. Den gibt es als Klasse nicht. Wer „reduzierte POIs" gewaehlt
 * hatte -- und im Stil „Kontrast" ist das die Vorgabe --, bekam KEINEN
 * einzigen Supermarkt zu sehen, obwohl die Einstellung genau das versprach.
 * Nichts schlug fehl, nichts stand im Protokoll. Dieselbe Sorte lautloses
 * Nichts wie bei den fehlenden Glyphen und beim nicht zu oeffnenden GPS.
 *
 * ─── WAS DIE KACHELN NICHT KOENNEN -- UND WER ES DOCH KANN ──────────────────
 * Eine ENTSORGUNGSSTATION (`amenity=sanitary_dump_station`) fuehren unsere
 * Kacheln nicht. Das ist nachgemessen: in `layers/poi/mapping.yaml` von
 * OpenMapTiles, aus dem planetiler den `poi`-Layer bildet, kommt der Wert 0x
 * vor, ebenso `waste_disposal`, `water_point` und `shower`. Fuer ein
 * Wohnmobil ist das die schmerzlichste Luecke dieser Liste.
 *
 * Hier stand bis 0.12.2 dazu: „sie laesst sich hier nicht schliessen, sondern
 * nur beim Kachelbau". Der erste Halbsatz stimmt, der zweite war FALSCH --
 * und zwar auf genau die Art, die dieses Projekt seit Monaten verfolgt.
 *
 * Denn der SUCHINDEX hatte diese Stationen die ganze Zeit. Er wird mit
 * `osmium tags-filter` aus derselben `.osm.pbf` gebaut, und seine Filterliste
 * (`search/lite/poiCategories.ts`) enthaelt `sanitary_dump_station`, seit es
 * sie gibt. Wer SUCHTE, fand sie. Wer auf die KARTE sah, nicht. Es fehlte
 * kein Datensatz, es fehlte ein Weg von der einen Datei zur anderen.
 *
 * Seit 0.13.0 gibt es ihn: `map/sonderziele/` liest sie aus
 * `lite_search-<region>.db` und legt sie als eigene Ebene auf die Karte. Die
 * Liste hier bleibt, was sie ist -- was die KACHELN hergeben.
 */

/** Eine Kategorie, wie Yapaia sie auf der Karte zeigt. */
export interface PoiKategorie {
  /** Name im Sprite (`scripts/generate-sprites.mjs`). */
  readonly symbol: string;
  /** Deutscher Name, für Legende und Einstellungen. */
  readonly name: string;
  /** OMT-`class`-Werte, die dazuzählen. */
  readonly klassen: readonly string[];
  /**
   * Wenn gesetzt: zusätzlich muss die `subclass` passen.
   *
   * Nur für die eine Unterscheidung, die es wirklich braucht — Stellplatz
   * gegen Campingplatz. Beide liegen in OMT unter `class: campsite`, und
   * für ein Wohnmobil sind es zwei ganz verschiedene Dinge.
   */
  readonly unterklassen?: readonly string[];
  /**
   * Wer gewinnt, wenn zwei Symbole übereinanderliegen. Kleiner ist wichtiger.
   *
   * ─── WARUM NICHT „ab Zoomstufe X" ─────────────────────────────────────────
   * Zuerst stand hier ein `minzoom` je Kategorie, umgesetzt über die
   * Deckkraft. Das war falsch: ein durchsichtiges Symbol ist zwar unsichtbar,
   * belegt bei MapLibre aber weiterhin seinen Platz und VERDRÄNGT damit ein
   * sichtbares. In einer Innenstadt hätten unsichtbare Eisdielen den
   * Stellplatz weggedrückt.
   *
   * `symbol-sort-key` ist der Weg, den MapLibre dafür vorsieht: wird es eng,
   * bleibt das Symbol mit dem kleineren Wert stehen. Für ein Wohnmobil heißt
   * das: Stellplatz vor Campingplatz vor Tankstelle vor allem anderen.
   */
  readonly rang: number;
}

/**
 * Die Reihenfolge ist BEDEUTUNG: die erste passende Kategorie gewinnt.
 *
 * Deshalb steht „Stellplatz" vor „Campingplatz" — beide haben
 * `class: campsite`, und nur die erste prüft zusätzlich die Unterklasse.
 * Stünde es andersherum, bekäme jeder Stellplatz das Zelt.
 */
export const POI_KATEGORIEN: readonly PoiKategorie[] = [
  {
    symbol: 'poi-wohnmobil',
    name: 'Wohnmobilstellplatz',
    klassen: ['campsite'],
    unterklassen: ['caravan_site'],
    rang: 1,
  },
  {
    symbol: 'poi-camping',
    name: 'Campingplatz',
    klassen: ['campsite'],
    rang: 2,
  },
  {
    symbol: 'poi-tanken',
    name: 'Tankstelle',
    klassen: ['fuel'],
    rang: 3,
  },
  {
    symbol: 'poi-laden',
    name: 'Ladesäule',
    klassen: ['charging_station'],
    rang: 4,
  },
  {
    symbol: 'poi-parken',
    name: 'Parkplatz',
    // `parking` faellt als Unterklasse durch (siehe Kopf). `motorcycle_parking`
    // und `bicycle_parking` bewusst NICHT: da passt kein Wohnmobil hin.
    klassen: ['parking'],
    rang: 5,
  },
  {
    symbol: 'poi-einkaufen',
    name: 'Einkaufen',
    // `grocery` und NICHT `supermarket` -- siehe Kopf. Die Zuordnung in
    // planetiler schickt supermarket, deli, department_store, greengrocer und
    // marketplace alle hierher.
    klassen: ['grocery'],
    rang: 6,
  },
  {
    symbol: 'poi-essen',
    name: 'Essen und Trinken',
    klassen: ['restaurant', 'fast_food', 'cafe', 'bar', 'ice_cream'],
    rang: 7,
  },
  {
    symbol: 'poi-sehenswert',
    name: 'Sehenswürdigkeit',
    // `attraction`, `castle`, `zoo`, `art_gallery` sind zugeordnete Klassen;
    // `museum`, `viewpoint`, `artwork`, `theme_park`, `monument` und `ruins`
    // fallen als Unterklasse durch und sind deshalb ebenfalls Klassenwerte.
    klassen: [
      'attraction',
      'castle',
      'museum',
      'viewpoint',
      'artwork',
      'art_gallery',
      'theme_park',
      'monument',
      'ruins',
      'zoo',
    ],
    rang: 8,
  },
  {
    symbol: 'poi-versorgung',
    name: 'Wasser und Entsorgung',
    // Was die Kacheln hergeben. Eine echte Entsorgungsstation ist NICHT
    // dabei -- sie kommt seit 0.13.0 aus dem Suchindex, siehe Kopf und
    // `map/sonderziele/fehlendeKlassen.ts`.
    klassen: ['drinking_water', 'toilets', 'recycling'],
    rang: 9,
  },
];

/**
 * Jede Klasse, die überhaupt ein Symbol bekommt.
 *
 * Ersetzt `REDUCED_POI_CLASSES` als Filter für „reduzierte POIs": die Liste
 * ist jetzt dieselbe, die auch die Symbole bestimmt, und kann deshalb nicht
 * mehr davon abweichen. Genau das war der Fehler mit `supermarket`.
 */
export const POI_KLASSEN_MIT_SYMBOL: readonly string[] = [
  ...new Set(POI_KATEGORIEN.flatMap((k) => k.klassen)),
];

/** Bedingung „diese Kategorie trifft zu" als MapLibre-Ausdruck. */
function trifftZu(k: PoiKategorie): unknown[] {
  const klasse: unknown[] = ['in', ['get', 'class'], ['literal', [...k.klassen]]];
  if (!k.unterklassen) return klasse;
  return ['all', klasse, ['in', ['get', 'subclass'], ['literal', [...k.unterklassen]]]];
}

/**
 * `['case', <Bedingung>, <Symbol>, …, '']` — welches Bild ein Ort bekommt.
 *
 * `case` und nicht `match`: die Stellplatz-Regel prüft ZWEI Felder, und
 * `match` kann immer nur eines. Der Rückfall ist die leere Zeichenkette;
 * MapLibre zeichnet dann kein Bild, statt die Ebene fallen zu lassen.
 */
export function symbolNachKategorie(): unknown[] {
  return ['case', ...POI_KATEGORIEN.flatMap((k) => [trifftZu(k), k.symbol]), ''];
}

/**
 * `['case', <Bedingung>, <Rang>, …]` für `symbol-sort-key`.
 *
 * Wird es eng, bleibt das Symbol mit dem kleineren Wert stehen. Alles ohne
 * Kategorie bekommt den höchsten Rang und weicht damit zuerst.
 */
export function rangNachKategorie(): unknown[] {
  return [
    'case',
    ...POI_KATEGORIEN.flatMap((k) => [trifftZu(k) as unknown, k.rang]),
    POI_KATEGORIEN.length + 1,
  ];
}
