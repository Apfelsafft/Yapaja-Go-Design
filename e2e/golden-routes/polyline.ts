/**
 * polyline6 decoder for the Golden-Route suite (E03-T5).
 *
 * SELF-CONTAINED copy, deliberately NOT an import of
 * `apps/web/src/routing/polyline.ts` or `apps/core/src/routing/polyline.ts`.
 * The `e2e/` tree is not part of the `apps/web` or `apps/core` package and
 * must not reach across those package boundaries (same reasoning the web and
 * core copies give for not sharing a decoder): a shared dependency would let
 * an unrelated change silently alter what the safety suite decodes. The
 * algorithm is a few lines of well-established bit-twiddling, kept in sync by
 * inspection and pinned by the round-trip in `bbox.test.ts`.
 *
 * "polyline6" = Google Encoded Polyline Algorithm Format with a 1e6 precision
 * factor -- the encoding the Core returns for `Route.geometry`
 * (docs/03-api-spec.md §1).
 */

const POLYLINE6_FACTOR = 1e6;

/** A `[lon, lat]` coordinate pair in GeoJSON order. */
export type LonLat = [number, number];

/**
 * Decodes a polyline6 string into `[lon, lat]` pairs (GeoJSON coordinate
 * order), the same order the web decoder returns.
 */
export function decodePolyline6(encoded: string): LonLat[] {
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const len = encoded.length;

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += dLon;

    points.push([lon / POLYLINE6_FACTOR, lat / POLYLINE6_FACTOR]);
  }

  return points;
}

/**
 * Encodes `[lon, lat]` pairs back into polyline6.
 *
 * Added in E10-T3 for the STUB ROUTER used by `scripts/runbook-smoke.sh`: the
 * runbook's acceptance step has to prove that a data update which loses a
 * height restriction turns the safety gate red, and that proof needs a router
 * that emits real polyline6 geometry without a 4 GB map behind it.
 *
 * It is deliberately NOT used by any assertion — the safety path only ever
 * DECODES what the Core produced. Round-tripped against
 * {@link decodePolyline6} in `polyline.test.ts`, which is what keeps the two
 * halves of this file honest with each other.
 */
export function encodePolyline6(coords: readonly LonLat[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let out = '';

  for (const [lon, lat] of coords) {
    const latE6 = Math.round(lat * POLYLINE6_FACTOR);
    const lonE6 = Math.round(lon * POLYLINE6_FACTOR);
    out += encodeSigned(latE6 - lastLat);
    out += encodeSigned(lonE6 - lastLon);
    lastLat = latE6;
    lastLon = lonE6;
  }
  return out;
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}
