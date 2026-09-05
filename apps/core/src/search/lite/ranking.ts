/**
 * Ranking for the `lite` backend (E05-T5, Wargame W-12).
 *
 * RANKING CONTRACT (documented per task spec, "Ranking simpel dokumentieren"):
 * candidates are ordered by a strict 4-tier lexicographic comparison, NOT a
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
 *   3. FTS5 rank (SQLite's `bm25()`; more negative = better match) -- the
 *      tiebreaker within the same prefix/kind tier.
 *   4. Distance-bias: if an origin (device position / map center) was
 *      given, the closer candidate wins remaining ties. Never applied
 *      without an origin, and never promoted above tiers 1-3 -- it's a
 *      last-resort tiebreaker, not a primary signal (a far-away city still
 *      beats a nearby street for the same query).
 *
 * Explicitly OUT of scope (documented, not a bug): no house-number-level
 * data at all -- this index only ever stores place/street centroids
 * (E05-T5 acceptance note "keine Hausnummern").
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
function haversineKm(a: RankOrigin, b: RankOrigin): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** 0 = prefix match, 1 = not. */
function prefixTier(name: string, query: string): 0 | 1 {
  return normalize(name).startsWith(normalize(query)) ? 0 : 1;
}

/**
 * Sorts `candidates` per the ranking contract above (does not mutate the
 * input array) and returns a new, ordered array. Ties that survive all four
 * tiers keep their original relative order (stable sort, explicit index
 * tiebreak so behavior doesn't depend on the JS engine's sort stability
 * guarantees).
 */
export function rankLiteCandidates(
  candidates: readonly LiteCandidate[],
  query: string,
  origin?: RankOrigin,
): LiteCandidate[] {
  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    prefix: prefixTier(candidate.name, query),
    kind: KIND_RANK[candidate.kind],
    fts: candidate.ftsRank,
    distanceKm: origin ? haversineKm(origin, { lat: candidate.lat, lon: candidate.lon }) : 0,
  }));

  scored.sort(
    (a, b) =>
      a.prefix - b.prefix ||
      a.kind - b.kind ||
      a.fts - b.fts ||
      a.distanceKm - b.distanceKm ||
      a.index - b.index,
  );

  return scored.map((s) => s.candidate);
}
