/**
 * polyline6 decode/encode + multi-leg shape joining for the routing service.
 *
 * "polyline6" is the Google Encoded Polyline Algorithm Format with a 1e6
 * precision factor -- the format Valhalla returns for each leg's `shape` and
 * the format `Route.geometry` must be in (docs/03-api-spec.md §1).
 *
 * A near-identical decoder/encoder already exists under the GPS simulator
 * (`../position/simulator/polyline.ts`). It is intentionally NOT imported
 * here: this is the safety-critical routing path, and coupling it to a
 * simulator-internal helper would let an unrelated change there silently alter
 * routing geometry. The algorithm is a few lines of well-established
 * bit-twiddling; keeping a self-contained copy here keeps the routing module
 * auditable in isolation.
 */

import { appendAll } from '@yapaja/shared';

export interface LatLon {
  lat: number;
  lon: number;
}

const POLYLINE6_FACTOR = 1e6;

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) {
    sgnNum = ~sgnNum;
  }
  let value = sgnNum;
  let output = '';
  while (value >= 0x20) {
    output += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  output += String.fromCharCode(value + 63);
  return output;
}

/** Encode a sequence of {lat, lon} points as a polyline6 string. */
export function encodePolyline6(points: readonly LatLon[]): string {
  let output = '';
  let prevLat = 0;
  let prevLon = 0;
  for (const point of points) {
    const lat = Math.round(point.lat * POLYLINE6_FACTOR);
    const lon = Math.round(point.lon * POLYLINE6_FACTOR);
    output += encodeSignedNumber(lat - prevLat);
    output += encodeSignedNumber(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return output;
}

/** Decode a polyline6 string into a sequence of {lat, lon} points. */
export function decodePolyline6(encoded: string): LatLon[] {
  const points: LatLon[] = [];
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

    points.push({ lat: lat / POLYLINE6_FACTOR, lon: lon / POLYLINE6_FACTOR });
  }

  return points;
}

export interface JoinedShape {
  /** polyline6 for the whole route (all legs concatenated). */
  geometry: string;
  /**
   * Per-leg offset into the joined geometry's point list. A maneuver whose
   * leg-local `begin_shape_index` is `k` sits at joined index
   * `offsets[legIndex] + k`. For a single-leg route `offsets` is `[0]` and the
   * joined geometry is the original leg shape unchanged.
   */
  offsets: number[];
}

/**
 * Join the per-leg polyline6 shapes Valhalla returns into ONE route geometry,
 * de-duplicating the shared junction point between consecutive legs (leg i's
 * first point equals leg i-1's last point).
 *
 * Single-leg routes short-circuit: the original shape string is returned
 * verbatim (no decode/re-encode round-trip, so no rounding drift), which is
 * the common case (origin -> destination with no waypoints).
 */
export function joinLegShapes(shapes: readonly string[]): JoinedShape {
  if (shapes.length === 0) {
    return { geometry: '', offsets: [] };
  }
  if (shapes.length === 1) {
    return { geometry: shapes[0], offsets: [0] };
  }

  const joined: LatLon[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < shapes.length; i++) {
    const pts = decodePolyline6(shapes[i]);
    if (i === 0) {
      offsets.push(0);
      // NICHT `push(...pts)` -- dieselbe Falle wie im Suchindex-Bauer: der
      // Spread macht aus jedem Punkt ein Argument. Ein einzelner Abschnitt
      // einer langen Route kann Zehntausende Punkte haben; oberhalb der
      // V8-Grenze bricht das mit „Maximum call stack size exceeded" ab --
      // mitten in einer Routenberechnung.
      appendAll(joined, pts);
    } else {
      // Leg i's local index 0 is the junction, which is already present as the
      // previous leg's last point -> the new base offset points at it.
      offsets.push(joined.length - 1);
      appendAll(joined, pts.slice(1));
    }
  }

  return { geometry: encodePolyline6(joined), offsets };
}
