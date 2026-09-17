/**
 * Die Sonderziele, die in den Kacheln GAR NICHT vorkommen können.
 *
 * ─── DIE LÜCKE, UM DIE ES GEHT ──────────────────────────────────────────────
 * In `apps/core/src/map/styles/poiKategorien.ts` steht seit 0.9.0 dieser Satz:
 *
 *   „Eine ENTSORGUNGSSTATION (amenity=sanitary_dump_station) führen unsere
 *    Kacheln nicht … Für ein Wohnmobil ist das die schmerzlichste Lücke
 *    dieser Liste, und sie lässt sich hier nicht schliessen, sondern nur beim
 *    Kachelbau."
 *
 * Der erste Teil stimmt und ist nachgemessen (siehe unten). Der zweite Teil
 * war FALSCH, und zwar auf die Art, die dieses Projekt seit Monaten verfolgt:
 * die Auskunft war längst da, nur nicht dort, wo jemand hinsieht.
 *
 * Denn `services/valhalla/build-lite-index.sh` filtert beim Bau des
 * Suchindex GENAU DIESE Sonderziele mit `osmium tags-filter` aus derselben
 * `.osm.pbf` heraus — die Filterliste kommt aus `search/lite/poiCategories.ts`
 * und enthält `sanitary_dump_station` seit es diese Liste gibt. Jede
 * Entsorgungsstation steht also mit Name, Länge und Breite in
 * `lite_search-<region>.db`. Wer sie SUCHT, findet sie. Wer auf die KARTE
 * sieht, findet sie nicht.
 *
 * Es fehlte kein Datensatz. Es fehlte ein Weg von der einen Datei zur anderen.
 *
 * ─── WAS NACHGEMESSEN IST ───────────────────────────────────────────────────
 * Gegen `layers/poi/mapping.yaml` aus openmaptiles/openmaptiles (das ist die
 * Liste, aus der planetiler den `poi`-Layer bildet), gezählt:
 *
 *   sanitary_dump_station   0×      drinking_water   1×
 *   waste_disposal          0×      toilets          1×
 *   water_point             0×      recycling        1×
 *   shower                  0×
 *
 * Die linke Spalte kann in keiner Kachel stehen — nicht weil beim Bau etwas
 * schiefging, sondern weil das Schema diese Werte nicht kennt. Ein anderes
 * Kachelschema wäre der einzige Weg dorthin, und das kostet einen kompletten
 * Neubau aller Karten.
 *
 * ─── WARUM NICHT EINFACH ALLES SO AUSLIEFERN ────────────────────────────────
 * Weil die Kacheln für alles andere das bessere Werkzeug sind: sie sind nach
 * Zoomstufe vorsortiert, der Browser lädt nur den Ausschnitt, und die
 * Symbolkollision rechnet MapLibre selbst. Diese Liste hier ist bewusst KURZ
 * und soll es bleiben — sie ist der Notausgang für das, was durch das Schema
 * fällt, nicht ein zweiter Kartenaufbau daneben.
 */

/** Ein Sonderziel, das nur über den Suchindex auf die Karte kommt. */
export interface FehlendeKlasse {
  /** Der OSM-Tag-Wert, wie er in `places.category` steht. */
  readonly kategorie: string;
  /** Deutscher Name — für Legende, Einstellungen und Tippkarte. */
  readonly name: string;
  /** Name im Sprite (`scripts/generate-sprites.mjs`). */
  readonly symbol: string;
  /**
   * Wer gewinnt, wenn zwei Symbole übereinanderliegen. Kleiner ist wichtiger.
   *
   * Die Zahlen setzen die Reihe aus `poiKategorien.ts` fort, wo Rang 1 bis 9
   * vergeben sind. Ein eigener Zahlenraum wäre bequemer zu pflegen und
   * trotzdem falsch: beide Ebenen liegen auf derselben Karte, und ein Rang
   * hat nur dann eine Bedeutung, wenn er mit dem der Nachbarebene vergleichbar
   * ist.
   *
   * ─── WARUM DIE ENTSORGUNG VOR DIE TANKSTELLE RÜCKT ────────────────────────
   * Nicht, weil sie wichtiger wäre. Sondern weil es sie viel seltener gibt:
   * eine verdeckte Tankstelle findet man zwei Straßen weiter wieder, eine
   * verdeckte Entsorgungsstation nicht. Bei Gleichstand soll das seltenere
   * Symbol stehen bleiben.
   */
  readonly rang: number;
  /**
   * Warum dieses Ziel nicht in den Kacheln steht — im Klartext.
   *
   * Steht in der Antwort der Schnittstelle. Wer sich fragt, warum ein Symbol
   * aus einer anderen Quelle kommt als alle übrigen, soll die Antwort dort
   * finden, wo er nachsieht, und nicht in dieser Datei.
   */
  readonly grund: string;
}

const NICHT_IM_SCHEMA =
  'Das OpenMapTiles-Schema kennt diesen Wert nicht; er kann in keiner Kachel stehen.';

/**
 * Die Sonderziele aus dem Suchindex, in der Reihenfolge ihrer Bedeutung.
 *
 * Nur Kategorien, die `search/lite/poiCategories.ts` auch wirklich sammelt —
 * sonst verspräche diese Liste etwas, das kein Index enthält. Ein Test hält
 * genau das fest, damit die beiden nicht auseinanderlaufen.
 */
export const FEHLENDE_KLASSEN: readonly FehlendeKlasse[] = [
  {
    kategorie: 'sanitary_dump_station',
    name: 'Entsorgungsstation',
    symbol: 'poi-entsorgung',
    rang: 2.5,
    grund: NICHT_IM_SCHEMA,
  },
  {
    kategorie: 'waste_disposal',
    name: 'Müllentsorgung',
    symbol: 'poi-muell',
    rang: 8.5,
    grund: NICHT_IM_SCHEMA,
  },
];

/** Die Kategorien als flache Liste — für die `IN (…)`-Abfrage. */
export const FEHLENDE_KATEGORIEN: readonly string[] = FEHLENDE_KLASSEN.map((k) => k.kategorie);

/** Die Klasse zu einer Kategorie, oder `undefined`. */
export function klasseFuer(kategorie: string): FehlendeKlasse | undefined {
  return FEHLENDE_KLASSEN.find((k) => k.kategorie === kategorie);
}
