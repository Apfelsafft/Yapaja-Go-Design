/**
 * Was man unterwegs als Zwischenstopp sucht — für „Unterwegs finden" im
 * Fahrtmenü und später für den Sprach-Copiloten (`docs/ideen-ki.md`, Idee 1).
 *
 * Hier und nicht im Kern, weil Kern (Suche) und App (Knöpfe) dieselbe Liste
 * brauchen. Zwei Abschriften liefen auseinander, und dann gäbe es einen
 * Knopf, den der Kern mit 400 beantwortet.
 *
 * Die `id` ist der OSM-Wert im Suchindex
 * (`apps/core/src/search/lite/poiCategories.ts`); ein Test im Kern prüft,
 * dass jede auch wirklich dort steht.
 */

export interface UnterwegsKategorie {
  /** Der OSM-Wert im Suchindex (`fuel`, `caravan_site`, …). */
  id: string;
  /** Wie sie auf dem Knopf heißt. */
  name: string;
  symbol: string;
}

/** In der Reihenfolge, in der sie im Fahrtmenü stehen: das Häufigste zuerst. */
export const UNTERWEGS_KATEGORIEN: readonly UnterwegsKategorie[] = [
  { id: 'fuel', name: 'Tankstelle', symbol: '⛽' },
  { id: 'parking', name: 'Parkplatz', symbol: '🅿️' },
  { id: 'caravan_site', name: 'Stellplatz', symbol: '🚐' },
  { id: 'camp_site', name: 'Campingplatz', symbol: '⛺' },
  { id: 'supermarket', name: 'Supermarkt', symbol: '🛒' },
  { id: 'sanitary_dump_station', name: 'Entsorgung', symbol: '🚽' },
  { id: 'water_point', name: 'Frischwasser', symbol: '💧' },
  { id: 'gas', name: 'Gasflaschen', symbol: '🔥' },
  { id: 'toilets', name: 'Toilette', symbol: '🚻' },
];

export function unterwegsKategorie(id: string): UnterwegsKategorie | undefined {
  return UNTERWEGS_KATEGORIEN.find((k) => k.id === id);
}

