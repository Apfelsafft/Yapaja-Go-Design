/**
 * Die nächste passende Station VORAUS auf der Route -- oder in der Nähe.
 *
 * ─── WARUM NICHT EINFACH DIE NÄCHSTE LUFTLINIE ──────────────────────────────
 * Weil die nächste Entsorgungsstation hinter einem liegen kann, oder auf der
 * anderen Seite der Autobahn, 12 km Umweg. Was man unterwegs braucht, ist die
 * nächste, an der man VORBEIKOMMT: nah an der Strecke und in Fahrtrichtung.
 *
 * Ohne laufende Route gibt es kein „voraus" -- dann gilt die Luftlinie ab der
 * aktuellen Position, mit engerem Radius.
 *
 * Der Umweg ist hier der Abstand zur Route (Luftlinie), nicht die gefahrene
 * Strecke dorthin. Ihn über Valhalla zu rechnen wäre genauer und teurer; für
 * „liegt das an der Strecke?" reicht die Luftlinie, und die Route zum
 * Zwischenstopp rechnet Valhalla ohnehin, sobald man ihn übernimmt.
 */

import { haversineM } from '../navigation/geo.js';
import { matchPosition, type RouteGeometry } from '../navigation/mapMatching.js';

export interface Kandidat {
  name: string;
  lat: number;
  lon: number;
}

export interface Fundstelle extends Kandidat {
  /** Wie weit man auf der Route noch fährt, bis man daneben ist. `null` ohne Route. */
  voraus_m: number | null;
  /** Abstand von der Route (mit Route) bzw. von der Position (ohne). */
  abseits_m: number;
}

/** So weit abseits der Route darf eine Station liegen. */
export const KORRIDOR_M = 2_000;
/** So weit voraus wird gesucht. */
export const VORAUS_HOECHSTENS_M = 80_000;
/** Ohne Route: so weit um die Position. */
export const UMKREIS_OHNE_ROUTE_M = 25_000;

/**
 * Die besten Fundstellen, nächste zuerst (höchstens `anzahl`).
 *
 * Mit Route: nur, was VORAUS (`progressM` bis `+VORAUS_HOECHSTENS_M`) und
 * höchstens {@link KORRIDOR_M} neben der Strecke liegt, sortiert nach dem Weg
 * dorthin. Ohne Route: Luftlinie ab `position`.
 */
export function naechsteStationen(
  kandidaten: readonly Kandidat[],
  ort: {
    route: { geom: RouteGeometry; progressM: number } | null;
    position: { lat: number; lon: number } | null;
  },
  anzahl = 3,
): Fundstelle[] {
  if (ort.route) {
    const { geom, progressM } = ort.route;
    const bis = Math.min(progressM + VORAUS_HOECHSTENS_M, geom.totalLengthM);

    // Grobfilter über das Rechteck des Streckenstücks voraus: der Abgleich
    // gegen die Route ist das Teure, und von Tausenden Stationen liegt nur
    // eine Handvoll überhaupt in der Nähe.
    const stueck = geom.points.filter((_, i) => geom.cumulative[i]! >= progressM - 1 && geom.cumulative[i]! <= bis);
    if (stueck.length === 0) return [];
    const rand = KORRIDOR_M / 111_000;
    const minLat = Math.min(...stueck.map((p) => p.lat)) - rand;
    const maxLat = Math.max(...stueck.map((p) => p.lat)) + rand;
    const lonRand = rand / Math.max(0.2, Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    const minLon = Math.min(...stueck.map((p) => p.lon)) - lonRand;
    const maxLon = Math.max(...stueck.map((p) => p.lon)) + lonRand;

    const funde: Fundstelle[] = [];
    for (const k of kandidaten) {
      if (k.lat < minLat || k.lat > maxLat || k.lon < minLon || k.lon > maxLon) continue;
      // Abgleich NUR im Fenster voraus -- eine Station, die zu einer weiter
      // hinten liegenden Stelle der Route näher ist, zählt nicht.
      const mitte = (progressM + bis) / 2;
      const m = matchPosition(geom, { lat: k.lat, lon: k.lon }, mitte, (bis - progressM) / 2 + 1);
      if (m.crossTrackM > KORRIDOR_M) continue;
      if (m.progressM < progressM || m.progressM > bis) continue;
      funde.push({ ...k, voraus_m: Math.round(m.progressM - progressM), abseits_m: Math.round(m.crossTrackM) });
    }
    return funde.sort((a, b) => a.voraus_m! - b.voraus_m!).slice(0, anzahl);
  }

  if (ort.position) {
    const p = ort.position;
    return kandidaten
      .map((k) => ({ ...k, voraus_m: null, abseits_m: Math.round(haversineM(p, { lat: k.lat, lon: k.lon })) }))
      .filter((f) => f.abseits_m <= UMKREIS_OHNE_ROUTE_M)
      .sort((a, b) => a.abseits_m - b.abseits_m)
      .slice(0, anzahl);
  }

  return [];
}
