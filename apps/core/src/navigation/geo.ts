/**
 * Geodesy helpers for the safety-critical map-matcher (E04-T1).
 *
 * Kept LOCAL to the navigation module (not imported from the simulator's
 * `geo.ts` nor from `@yapaja/shared`): the matcher is on the turn-by-turn
 * safety path, and coupling its geometry to an unrelated helper would let a
 * change there silently alter where a fix snaps onto the route. The formulae
 * are a handful of well-established lines, easy to audit in isolation.
 *
 * All distances are in metres; all bearings/headings in degrees, 0 = North,
 * clockwise, range [0, 360).
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_M = 6371000;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in metres (haversine). */
export function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial compass bearing from `a` to `b`, degrees, 0 = North, range [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Smallest absolute difference between two headings, degrees, range [0, 180].
 * `angularDifference(10, 350) === 20`, `angularDifference(0, 180) === 180`.
 */
export function angularDifference(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface SegmentProjection {
  /** Clamped parametric position along the segment, 0 (at `a`) .. 1 (at `b`). */
  t: number;
  /** Perpendicular (cross-track) distance from the point to the segment, metres. */
  crossTrackM: number;
}

/**
 * Project `p` onto the segment `a`->`b` using a local equirectangular frame
 * centred on `a` (x = easting, y = northing in metres). For the short segments
 * a decoded route polyline is made of (tens to low-thousands of metres) the
 * planar error versus a full geodesic projection is negligible, and — crucially
 * for a safety path — the maths is simple enough to verify by hand.
 *
 * A degenerate (zero-length) segment projects to `a` with `t = 0`.
 */
export function projectPointOntoSegment(p: LatLon, a: LatLon, b: LatLon): SegmentProjection {
  const cosLat = Math.cos(toRadians(a.lat));
  // Local metres relative to `a`.
  const bx = toRadians(b.lon - a.lon) * cosLat * EARTH_RADIUS_M;
  const by = toRadians(b.lat - a.lat) * EARTH_RADIUS_M;
  const px = toRadians(p.lon - a.lon) * cosLat * EARTH_RADIUS_M;
  const py = toRadians(p.lat - a.lat) * EARTH_RADIUS_M;

  const segLen2 = bx * bx + by * by;
  let t = 0;
  if (segLen2 > 0) {
    t = (px * bx + py * by) / segLen2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const projX = t * bx;
  const projY = t * by;
  const crossTrackM = Math.hypot(px - projX, py - projY);
  return { t, crossTrackM };
}
