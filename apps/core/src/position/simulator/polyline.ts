/**
 * polyline6 encode/decode (E02-T4). "polyline6" is the Google Encoded
 * Polyline Algorithm Format (https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
 * with a fixed-point precision factor of 1e6 instead of the classic 1e5 --
 * the format Valhalla returns for `Route.geometry` (docs/03-api-spec.md
 * §1). We implement decode (and encode, for the round-trip test) ourselves
 * rather than pulling in a polyline-decoding dependency: the algorithm is a
 * few lines of well-established bit-twiddling, we only need the one
 * precision variant, and keeping it in-repo makes the (small) encoder we
 * also need for the `detour` mutation's synthetic points trivial to add
 * alongside it.
 */

import type { LatLon } from './geo.js';

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
