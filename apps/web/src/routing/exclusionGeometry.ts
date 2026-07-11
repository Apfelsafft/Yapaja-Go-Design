/**
 * Geometry helper for "Diesen Abschnitt meiden" (E03-T4): builds a small
 * square `exclude_polygon` ring (~200 m half-width) around a clicked map
 * point. Stays in the app-internal `{lat, lon}` order throughout -- the
 * Core's `profileMapping.ts` is the ONLY place that swaps to Valhalla's
 * `[lon, lat]` tuple order for `exclude_polygons`.
 */

import type { LatLng } from '@yapaja/shared';

const EARTH_RADIUS_M = 6371000;

/**
 * Builds a closed, axis-aligned square ring centred on `center`, with each
 * edge `radiusM` metres away (so a ~400 m x 400 m box for the default
 * 200 m radius). The ring is closed (first point === last point), matching
 * the shared schema's `minItems: 3` + typical polygon convention.
 */
export function buildAvoidSquare(center: LatLng, radiusM = 200): LatLng[] {
  const dLatDeg = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const latRad = (center.lat * Math.PI) / 180;
  const dLonDeg = (radiusM / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI);

  const nw: LatLng = { lat: center.lat + dLatDeg, lon: center.lon - dLonDeg };
  const ne: LatLng = { lat: center.lat + dLatDeg, lon: center.lon + dLonDeg };
  const se: LatLng = { lat: center.lat - dLatDeg, lon: center.lon + dLonDeg };
  const sw: LatLng = { lat: center.lat - dLatDeg, lon: center.lon - dLonDeg };

  return [nw, ne, se, sw, nw];
}
