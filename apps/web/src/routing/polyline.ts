/**
 * polyline6 decoder for `Route.geometry` (E03-T3).
 *
 * "polyline6" is the Google Encoded Polyline Algorithm Format with a 1e6
 * precision factor -- the format the Core's routing service returns for
 * `Route.geometry` (docs/03-api-spec.md §1, `apps/core/src/routing/polyline.ts`).
 *
 * This is a self-contained web-side copy, NOT an import of the core module:
 * the web app must not reach across the `apps/core` package boundary, and
 * the core's own `polyline.ts` makes the same call for the reverse direction
 * (not reusing the GPS simulator's decoder) for the same reason -- a shared
 * dependency would let an unrelated change silently alter what either side
 * decodes. The algorithm itself is a few lines of well-established
 * bit-twiddling, easy to keep in sync by inspection.
 */

const POLYLINE6_FACTOR = 1e6;

/**
 * Decodes a polyline6 string into `[lon, lat]` pairs -- GeoJSON coordinate
 * order, ready to hand straight to a MapLibre `LineString` geometry.
 */
export function decodePolyline6(encoded: string): [number, number][] {
  const points: [number, number][] = [];
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
