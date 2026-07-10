/**
 * Small geodesy helpers for the GPS simulator (E02-T4): great-circle
 * distance, initial bearing, straight-line interpolation between two
 * points, and destination-point projection (used by the `jump`/`detour`
 * mutations). Kept local to the simulator rather than added to
 * `@yapaja/shared` -- these are simulator-internal implementation details,
 * not part of the public API contract.
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

/** Great-circle distance in meters (haversine formula). */
export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial compass bearing from `a` to `b`, in degrees, 0 = North, range [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}

/**
 * Position at fraction `f` (0..1) along the straight line from `a` to `b`,
 * interpolating lat/lon linearly (equirectangular approximation). Spec'd
 * this way deliberately ("Position linear entlang des Segments") -- for the
 * short segments a GPS track/replay uses (tens to low thousands of meters)
 * the error versus a true great-circle interpolation is negligible.
 */
export function interpolateLatLon(a: LatLon, b: LatLon, f: number): LatLon {
  const clamped = Math.min(1, Math.max(0, f));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lon: a.lon + (b.lon - a.lon) * clamped,
  };
}

/**
 * Destination point starting at `start`, traveling `distanceM` meters along
 * initial compass bearing `bearingDegVal`. Used by the `jump` and `detour`
 * mutations to project a plausible offset point rather than a naive
 * degrees-of-lat/lon fudge (which distorts badly away from the equator).
 */
export function destinationPoint(start: LatLon, bearingDegVal: number, distanceM: number): LatLon {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = toRadians(bearingDegVal);
  const lat1 = toRadians(start.lat);
  const lon1 = toRadians(start.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDegrees(lat2), lon: ((toDegrees(lon2) + 540) % 360) - 180 };
}
