/**
 * Great-circle distance helpers for the Track-Recorder (E09-T5, docs/05
 * §6.2). Deliberately self-contained -- service add-ons have NO internal
 * imports (docs/05 §1B: "keine internen Importe"), so this is a fresh
 * implementation of the same haversine formula
 * `apps/core/src/position/simulator/geo.ts#haversineDistanceM` uses, not a
 * shared import from Core-internal code.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters (haversine formula). */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Sums consecutive-point haversine distances WITHIN each segment only --
 * NEVER bridging the gap between one segment's last point and the next
 * segment's first point. This is the GPS-loss segment-split rule (docs/05
 * §6.2) applied to distance accounting: a segment boundary means "we do not
 * know what happened here", so that stretch must never contribute distance.
 */
export function totalDistanceMeters(segments: readonly LatLon[][]): number {
  let total = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      total += haversineMeters(segment[i - 1], segment[i]);
    }
  }
  return total;
}
