/**
 * Ranking for the `lite` backend (E05-T5, Wargame W-12).
 *
 * RANKING CONTRACT (documented per task spec, "Ranking simpel dokumentieren"):
 * candidates are ordered by a strict 5-tier lexicographic comparison, NOT a
 * weighted score. Each tier only breaks ties left by the previous one, so a
 * "worse" value on a later tier can NEVER outweigh an earlier one:
 *
 *   1. Prefix match: does the candidate's name start with the query
 *      (case-insensitive, whitespace-trimmed)? Prefix matches always sort
 *      before non-prefix (pure trigram/substring) matches.
 *   2. Kind: city > town > village > street. This is what makes query
 *      "Vadu" rank "Vaduz" (city) above "Vaduzer Straße" (street) even
 *      though BOTH are prefix matches for "Vadu" -- the mandatory E05-T5
 *      test case.
 *   3. Entfernung (nur mit Ursprung). Bis 0.39.0 stand hier bm25, in 0.39.0
 *      ein grobes Entfernungsband (unter 25/100/400 km) davor. Gemeldet
 *      danach: „Rewe ist vielleicht 2km vom aktuellen Standort ... während
 *      die Suche Treffer anzeigt die weiter weg sind." Innerhalb eines Bandes
 *      entschied weiter bm25, und bm25 bevorzugt kurze Namen: „Rewe To Go"
 *      in 13 km schlug „REWE Familie Appel" in 2 km, und die Liste ist nach
 *      zehn Eintraegen zu Ende. Wer einen Laden sucht, meint den naechsten.
 *   4. FTS5 rank (SQLite's `bm25()`, or the name length where bm25 was not
 *      computed -- see `reader.ts#kandidaten`; lower = better).
 *   5. Original order (stable). A far-away city still beats a nearby
 *      street for the same query -- kind (tier 2) comes before distance.
 *
 * Hausnummern stehen seit 0.39.0 in einer eigenen Tabelle (`reader.ts#
 * hausnummer`); sie werden nicht hier gerankt, sondern den gefundenen
 * Strassen nachgeschlagen (`liteBackend.ts#mitHausnummer`).
 */

/**
 * ─── EINE LISTE, AUS DER ALLES ANDERE FOLGT ────────────────────────────────
 * Die Arten standen bis 0.3.6 an DREI Stellen: als Typ hier, als Typ in
 * `extract.ts` und als Laufzeit-Menge `KNOWN_KINDS` in `reader.ts`. Beim
 * Hinzufuegen von `poi` habe ich die ersten beiden gepflegt und die dritte
 * uebersehen -- mit dem Ergebnis, dass die Sonderziele zwar korrekt im Index
 * standen und die Volltextsuche sie auch FAND, `reader.ts` sie danach aber
 * stillschweigend wegwarf. Die Suche lieferte „nichts", und nichts wies
 * darauf hin, wo es fehlte.
 *
 * Jetzt gibt es eine Liste. Der Typ folgt aus ihr, `KIND_RANK` erzwingt per
 * `Record<LiteKind, number>` Vollstaendigkeit, und `reader.ts` baut seine
 * Menge daraus. Eine neue Art kann nicht mehr an einer Stelle fehlen.
 */
import { faltung } from './faltung.js';

export const LITE_KINDS = [
  'city',
  'town',
  'village',
  // ─── ORTSTEILE (0.6.0) ────────────────────────────────────────────────────
  // Gemeldet: „Ich habe dann direkt nach Sondernheim gesucht, das wurde nicht
  // gefunden." Sondernheim ist ein Stadtteil von Germersheim und in OSM als
  // `place=suburb` erfasst. Der Index nahm nur city/town/village -- der Ort
  // war also nicht schwer zu finden, sondern gar nicht vorhanden.
  //
  // Wer einen Ortsteil sucht, meint einen Ort. Sie stehen deshalb bei den
  // Orten, nur hinter den groesseren: gibt es beides gleichnamig, ist die
  // Stadt fast immer das gemeinte Ziel.
  'suburb',
  'quarter',
  'borough',
  'hamlet',
  'poi',
  'street',
] as const;

export type LiteKind = (typeof LITE_KINDS)[number];

const KIND_RANK: Record<LiteKind, number> = {
  city: 0,
  town: 1,
  village: 2,
  borough: 3,
  suburb: 4,
  quarter: 5,
  hamlet: 6,
  // Sonderziele VOR Strassen: wer „Camping" tippt, meint den Campingplatz
  // und nicht den „Campingweg". Unter den Orten bleiben sie, weil eine
  // gleichnamige Stadt fast immer das groebere, gemeinte Ziel ist.
  poi: 7,
  street: 8,
};

export interface LiteCandidate {
  /** Strasse und Hausnummer, sofern in den Daten. Nur zum Anzeigen. */
  address?: string | null;
  /** Der Ort, in dem der Eintrag liegt. Nur zum Anzeigen. */
  locality?: string | null;
  name: string;
  kind: LiteKind;
  /** Nur bei POIs: der OSM-Tag-Wert, der das Symbol bestimmt. */
  category?: string | null;
  lat: number;
  lon: number;
  /** SQLite FTS5 `bm25()` value for this row against the query that produced
   *  it -- lower (more negative) is a better match. */
  ftsRank: number;
}

export interface RankOrigin {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in km. Deliberately re-implemented here (not
 *  imported from elsewhere) -- same "one small independent copy per
 *  module" convention as `apps/web/src/search/distance.ts` (see that
 *  file's doc comment: `packages/shared`'s Haversine is private/internal,
 *  and duplicating the ~6-line formula is cheaper than widening that
 *  package's public surface for it). */
export function haversineKm(a: RankOrigin, b: RankOrigin): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ß/ss und Umlaute zählen beim Vergleich nicht -- „Ziolkowskistrasse"
// beginnt wie „Ziolkowskistraße" (siehe `reader.ts#termVarianten`).
function normalize(s: string): string {
  return faltung(s);
}

/** 0 = prefix match, 1 = not. */
function prefixTier(name: string, query: string): 0 | 1 {
  return normalize(name).startsWith(normalize(query)) ? 0 : 1;
}

/**
 * Sorts `candidates` per the ranking contract above (does not mutate the
 * input array) and returns a new, ordered array. Ties that survive all five
 * tiers keep their original relative order (stable sort, explicit index
 * tiebreak so behavior doesn't depend on the JS engine's sort stability
 * guarantees).
 */
export function rankLiteCandidates(
  candidates: readonly LiteCandidate[],
  query: string,
  origin?: RankOrigin,
  opts: { adresse?: boolean } = {},
): LiteCandidate[] {
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    prefix: prefixTier(candidate.name, query),
    // ─── MIT HAUSNUMMER: STRASSEN VOR SONDERZIELEN (0.39.1) ──────────────
    // Gemeldet: „Habe auch ziolkowski 8 probiert ... Da kommt dann aber
    // ziolkowskizehn in 500km. Wieso kommt dieses andere Ziel in der Liste?"
    // Ein Lokal namens „ZiolkowskiZEHN" beginnt mit „Ziolkowski", und
    // Sonderziele standen vor Strassen. Wer eine Hausnummer tippt, sucht
    // aber eine Adresse.
    kind: opts.adresse && candidate.kind === 'poi' ? KIND_RANK.street + 1 : KIND_RANK[candidate.kind],
    fts: candidate.ftsRank,
    distanceKm: origin ? haversineKm(origin, { lat: candidate.lat, lon: candidate.lon }) : 0,
  }));

  scored.sort(
    (a, b) =>
      a.prefix - b.prefix ||
      a.kind - b.kind ||
      a.distanceKm - b.distanceKm ||
      a.fts - b.fts ||
      a.index - b.index,
  );

  return scored.map((s) => s.candidate);
}
