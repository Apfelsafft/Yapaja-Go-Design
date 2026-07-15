/**
 * Great-circle distance helper for search results (E05-T2): "Distanz von
 * aktueller Position" in the results list.
 *
 * `packages/shared/src/plausibility.ts` already has a Haversine
 * implementation, but it's a private, unexported helper (not part of
 * `@yapaja/shared`'s public surface, see `packages/shared/src/index.ts`) --
 * and `packages/shared` is out of scope for this task ("packages/shared
 * NICHT ändern"). This re-implements the exact same formula rather than
 * reaching into the package's internals.
 *
 * IMPORTANT: this module only ever produces the distance NUMBER (meters).
 * Turning that number into a displayed string always goes through the
 * app's single existing formatter, `formatDistance` in
 * `apps/web/src/routing/format.ts` (reused as-is, see `SearchBar.tsx`) --
 * never re-formatted ad hoc here or in a component, per the task's "EINEN
 * Formatter" requirement.
 */

import type { LatLng } from '@yapaja/shared';

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle (Haversine) distance between two points, in meters. */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;

  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}
