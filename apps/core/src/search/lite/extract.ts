/**
 * PBF-extraction normalization layer (E05-T5, Wargame W-12).
 *
 * The actual OSM-PBF *parsing* happens OUTSIDE Node entirely, in
 * `osmium-tool` (see `services/valhalla/build-lite-index.sh`): `osmium
 * tags-filter` selects the relevant nodes/ways, `osmium export -f geojsonseq`
 * turns them into one-GeoJSON-Feature-per-line NDJSON. Places (nodes) arrive
 * as `Point` geometries; streets (ways) arrive as `LineString`/`Polygon`
 * geometries -- `coordsFromGeometry` below reduces those to their centroid
 * (the "Zentroid" the task spec asks for). NOTE: `osmium export` does NOT
 * itself collapse ways to a point; `--geometry-types=point` would drop ways
 * entirely, so the build script exports ways as linestrings/polygons and the
 * centroiding is done here.
 *
 * Everything in THIS file is pure, dependency-free, and unit-testable
 * without a real .osm.pbf (which this sandbox cannot obtain or parse, see
 * the task's feasibility note): it takes one already-parsed GeoJSON Feature
 * at a time and normalizes it into a `NormalizedRecord`, or returns `null`
 * if the feature isn't a place/street this index cares about. This is the
 * exact boundary the task asks for: "structure the extractor so the
 * PBF-reading layer emits a normalized JS array... and unit-test the
 * tag-filtering/normalization rules".
 */

import {
  findPoiCategory,
  searchTermsFor,
  type PoiCategory,
  type PoiTagKey,
} from './poiCategories.js';

/** Die vier OSM-Schluessel, unter denen POI_CATEGORIES Kategorien fuehrt. */
const POI_TAG_KEYS: readonly PoiTagKey[] = ['amenity', 'shop', 'tourism', 'leisure'];

// NICHT hier noch einmal definieren -- siehe ranking.ts (LITE_KINDS).
export type { LiteKind } from './ranking.js';
import type { LiteKind } from './ranking.js';

export interface NormalizedRecord {
  kind: LiteKind;
  name: string;
  lat: number;
  lon: number;
  /** Nur bei `kind: 'poi'`: der OSM-Tag-Wert (`supermarket`, `camp_site`, …).
   *  Er wird zum `type` im Suchergebnis und damit zum Symbol in der Liste. */
  category?: string;
  /** Zusaetzliche Woerter, unter denen dieser Eintrag gefunden werden soll --
   *  bei POIs die deutschen Kategoriebegriffe („Supermarkt", „Lebensmittel").
   *  Ohne sie fuehrt die Eingabe „Supermarkt" auf nichts, weil der Laden in
   *  den Daten „REWE" heisst. */
  searchTerms?: string;
  /** Raw rank input, best-effort (E05-T5: "raw rank inputs" in the
   *  companion metadata table). OSM's `population` tag, when present, as an
   *  integer. Currently NOT consulted by `ranking.ts` (kind alone decides
   *  city/town/village ordering) -- captured for a future refinement
   *  without needing another index rebuild/schema change. */
  population?: number;
  /** Strasse und Hausnummer aus den Daten (`addr:street`, `addr:housenumber`),
   *  sofern getaggt. Bei mehreren gleichnamigen Treffern -- „welcher REWE?" --
   *  ist das die Auskunft, die sie unterscheidbar macht. */
  address?: string;
  /** Der Ort, in dem der Eintrag liegt. Bevorzugt aus `addr:city`; sonst wird
   *  er beim Bauen aus dem naechsten Ort abgeleitet (`placeLocator.ts`). */
  locality?: string;
  /** Postleitzahl (`addr:postcode`), sofern getaggt. Der Betreiber hat sie
   *  ausdruecklich als Suchaspekt genannt („Poi name, Typ, Strasse, Ort,
   *  plz"). */
  postcode?: string;
}

/** Liest ein Tag als nicht-leere Zeichenkette, sonst `undefined`. */
function tagString(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * „Beethovenstraße 12" aus `addr:street` + `addr:housenumber`.
 *
 * Ohne Strasse keine Adresse: eine Hausnummer allein („12") sagt niemandem
 * etwas und saehe in der Vorschlagsliste aus wie ein Fehler.
 */
function addressFromTags(props: Record<string, unknown>): string | undefined {
  const street = tagString(props, 'addr:street');
  if (!street) return undefined;
  const houseNumber = tagString(props, 'addr:housenumber');
  return houseNumber ? `${street} ${houseNumber}` : street;
}

/** The subset of a `osmium export --geometry-types=point -f geojsonseq`
 *  output line this module actually reads. Loosely typed on purpose --
 *  real OSM tag sets are large and unpredictable; anything not listed here
 *  is simply ignored. */
export interface OsmFeature {
  type?: string;
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
  properties?: Record<string, unknown> | null;
}

/**
 * Welche `place`-Werte in den Index kommen.
 *
 * ─── WARUM ORTSTEILE SEIT 0.6.0 DAZUGEHOEREN ────────────────────────────────
 * Gemeldet: „Ich habe dann direkt nach Sondernheim gesucht, das wurde nicht
 * gefunden." Sondernheim ist ein Stadtteil von Germersheim, in OSM
 * `place=suburb` -- und fiel damit still heraus. Nicht schwer zu finden,
 * sondern gar nicht da.
 *
 * `hamlet` ist der Weiler, `borough`/`quarter` die weiteren gebraeuchlichen
 * Untergliederungen. Alles vier sind Namen, die Menschen eintippen.
 *
 * NICHT dabei: `city_block`, `plot`, `isolated_dwelling` und Verwandte. Die
 * tragen selten einen Namen, den jemand sucht, und blaehten den Index mit
 * Eintraegen auf, die in der Trefferliste nur im Weg staenden.
 */
const PLACE_KINDS: ReadonlySet<string> = new Set([
  'city',
  'town',
  'village',
  'suburb',
  'quarter',
  'borough',
  'hamlet',
]);

/** `highway` values that are structural/non-navigable-by-name and get
 *  dropped even when (unusually) tagged with a `name` -- keeps the street
 *  half of the index limited to things a user would plausibly type. */
const EXCLUDED_HIGHWAY_VALUES: ReadonlySet<string> = new Set([
  'proposed',
  'construction',
  'platform',
  'razed',
  'rest_area', // has its own place-ish semantics; excluded to avoid dupes with POI search (out of E05-T5 scope)
]);

function validLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Averages a flat list of `[lon, lat]` pairs into a single centroid point.
 *  Deliberately a plain arithmetic mean, not area/length-weighted -- good
 *  enough for "roughly where this street/place is" (E05-T5's documented
 *  "simple ranking, no house numbers" scope), not a geodesy exercise. */
function centroidOfPositions(positions: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(positions) || positions.length === 0) return null;
  let sumLat = 0;
  let sumLon = 0;
  let n = 0;
  for (const p of positions) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [lon, lat] = p;
    const point = validLatLon(lat, lon);
    if (!point) continue;
    sumLat += point.lat;
    sumLon += point.lon;
    n += 1;
  }
  if (n === 0) return null;
  return { lat: sumLat / n, lon: sumLon / n };
}

/**
 * Extracts a single lat/lon centroid from a GeoJSON geometry, regardless of
 * whether it's already a `Point` (the expected case when `osmium export
 * --geometry-types=point` converts ways/areas to their centroid itself) or
 * a `LineString`/`Polygon`/`MultiPolygon` (defensive fallback: this repo's
 * sandbox has no PBF tooling/network to verify osmium's exact centroid
 * behavior for every geometry shape, see the task's feasibility note, so
 * this extractor computes its own centroid rather than assuming a specific
 * upstream geometry type). A missing/malformed `geometry.type` is treated
 * the same as `Point` (bare `[lon, lat]` coordinates), for tolerance
 * against export-tool variations.
 */
function coordsFromGeometry(feature: OsmFeature): { lat: number; lon: number } | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  const coords = geometry.coordinates;

  switch (geometry.type) {
    case 'LineString':
      return centroidOfPositions(coords);
    case 'Polygon':
      // First ring (outer boundary) is coords[0]; holes are irrelevant for
      // a rough centroid.
      return centroidOfPositions(Array.isArray(coords) ? coords[0] : undefined);
    case 'MultiPolygon':
      return centroidOfPositions(
        Array.isArray(coords) && Array.isArray(coords[0]) ? coords[0][0] : undefined,
      );
    case 'Point':
    case undefined:
    default: {
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const [lon, lat] = coords;
      return validLatLon(lat, lon);
    }
  }
}

function parsePopulation(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined;
}

/**
 * Normalizes one `place=city|town|village` feature. Returns `null` if it's
 * not a place feature this index indexes (wrong/missing `place` tag,
 * missing/empty name, or unparsable geometry).
 */
export function normalizePlaceFeature(feature: OsmFeature): NormalizedRecord | null {
  const props = feature.properties ?? {};
  const place = props.place;
  if (typeof place !== 'string' || !PLACE_KINDS.has(place)) return null;

  const name = props.name;
  if (typeof name !== 'string' || name.trim().length === 0) return null;

  const point = coordsFromGeometry(feature);
  if (!point) return null;

  return {
    kind: place as LiteKind,
    name: name.trim(),
    lat: point.lat,
    lon: point.lon,
    population: parsePopulation(props.population),
  };
}

/**
 * Normalizes one named-highway feature into a `kind: 'street'` record.
 * Returns `null` for unnamed ways (a street a user can't type by name is
 * useless in this index) or ways whose `highway` value is structural/
 * non-navigable (see `EXCLUDED_HIGHWAY_VALUES`).
 */
export function normalizeStreetFeature(feature: OsmFeature): NormalizedRecord | null {
  const props = feature.properties ?? {};
  const highway = props.highway;
  if (typeof highway !== 'string' || highway.length === 0) return null;
  if (EXCLUDED_HIGHWAY_VALUES.has(highway)) return null;

  const name = props.name;
  if (typeof name !== 'string' || name.trim().length === 0) return null;

  const point = coordsFromGeometry(feature);
  if (!point) return null;

  const locality = tagString(props, 'addr:city');
  const postcode = tagString(props, 'addr:postcode');
  return {
    kind: 'street',
    name: name.trim(),
    lat: point.lat,
    lon: point.lon,
    ...(locality ? { locality } : {}),
    ...(postcode ? { postcode } : {}),
  };
}

/**
 * Normalisiert ein Sonderziel (POI) in einen `kind: 'poi'`-Datensatz.
 *
 * Zwei Dinge, die hier anders laufen als bei Orten und Strassen:
 *
 * 1. EIN NAME IST NICHT PFLICHT. Ein Campingplatz ohne `name` ist immer noch
 *    ein Campingplatz, und wer „Campingplatz" tippt, will ihn finden. Fehlt
 *    der Name, tritt die deutsche Kategoriebezeichnung an seine Stelle
 *    („Campingplatz", „Tankstelle"). Das ist ehrlich -- der Eintrag behauptet
 *    keinen Namen, den es nicht gibt -- und nuetzlicher als ihn wegzulassen.
 * 2. ES WERDEN SUCHBEGRIFFE MITGEGEBEN. Sonst waere die Kategorie nur ueber
 *    den Namen auffindbar, und genau das ist der Fall, der nicht funktioniert.
 */
export function normalizePoiFeature(feature: OsmFeature): NormalizedRecord | null {
  const props = feature.properties ?? {};

  let category: PoiCategory | undefined;
  for (const key of POI_TAG_KEYS) {
    const value = props[key];
    if (typeof value === 'string' && value.length > 0) {
      category = findPoiCategory(key, value);
      if (category) break;
    }
  }
  if (!category) return null;

  const point = coordsFromGeometry(feature);
  if (!point) return null;

  const rawName = props.name;
  const name =
    typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : category.label;

  const address = addressFromTags(props);
  const locality = tagString(props, 'addr:city');
  const postcode = tagString(props, 'addr:postcode');

  return {
    kind: 'poi',
    name,
    lat: point.lat,
    lon: point.lon,
    category: category.value,
    searchTerms: searchTermsFor(category),
    ...(address ? { address } : {}),
    ...(locality ? { locality } : {}),
    ...(postcode ? { postcode } : {}),
  };
}

/**
 * Normalizes one line of `osmium export -f geojsonseq` output (a single
 * JSON object, NOT wrapped in a FeatureCollection -- geojsonseq is
 * newline-delimited). `sourceKind` tells the parser which extraction rule
 * applies (mirrors the two separate `osmium tags-filter` passes in
 * `build-lite-index.sh`, one for places, one for streets). Malformed JSON
 * or a feature the relevant normalizer rejects both simply yield `null` --
 * the build script counts/logs skips but never aborts the whole build over
 * one bad line.
 */
export function normalizeGeoJsonSeqLine(
  line: string,
  sourceKind: 'place' | 'street' | 'poi',
): NormalizedRecord | null {
  // `osmium export -f geojsonseq` emits RFC 8142 GeoJSON Text Sequences: each
  // record is PREFIXED with an ASCII Record Separator (U+001E). `String.trim()`
  // does NOT strip it (RS is not whitespace), so it must be removed explicitly
  // before `JSON.parse` -- otherwise EVERY real osmium line throws and the whole
  // index comes out empty. (Hand-written unit fixtures without the RS masked
  // this; it was caught in CI against the real Liechtenstein PBF: 0/21 places
  // and 0/14397 streets "uebernommen".)
  const withoutRs = line.charCodeAt(0) === 0x1e ? line.slice(1) : line;
  const trimmed = withoutRs.trim();
  if (trimmed.length === 0) return null;

  let feature: unknown;
  try {
    feature = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof feature !== 'object' || feature === null) return null;
  const f = feature as OsmFeature;

  switch (sourceKind) {
    case 'place':
      return normalizePlaceFeature(f);
    case 'poi':
      return normalizePoiFeature(f);
    default:
      return normalizeStreetFeature(f);
  }
}
