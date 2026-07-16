/**
 * Map a Valhalla `/route` response onto the app-internal `Route[]` contract
 * (`@yapaja/shared`). Pure functions -- no I/O, fully unit-tested against a
 * realistic fixture.
 */

import { randomUUID } from 'crypto';
import type {
  LatLng,
  Maneuver,
  Route,
  RouteLeg,
  RouteWarning,
  SpeedSegment,
} from '@yapaja/shared';
import { mapManeuverType } from './maneuverMapping.js';
import { joinLegShapes } from './polyline.js';
import type { ValhallaRouteResponse, ValhallaTrip } from './types.js';

const EARTH_RADIUS_M = 6371000;

/**
 * Great-circle distance in metres. Matches the Haversine used inside
 * `@yapaja/shared`'s `checkRoute` (same Earth radius) so the ROUTE_TOO_LONG
 * warning and the plausibility gate agree on the straight-line reference.
 */
export function haversineMeters(from: LatLng, to: LatLng): number {
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Build the route warnings.
 *
 * docs/03-api-spec.md §5 invariant: "Route-Distanz ... ≤ 4 × Luftlinie (sonst
 * RouteWarning + Log)". Emitted here as `ROUTE_TOO_LONG`.
 *
 * NOTE (W-08, restriction-data-missing warning): Valhalla's `/route` response
 * does not tell us which traversed edges lacked restriction attributes, so we
 * cannot raise that warning from here.
 * TODO(routing-restriction-warnings): enrich via `/trace_attributes` and add a
 * per-edge "restriction data missing" `RouteWarning` once available.
 */
export function buildRouteWarnings(
  distanceM: number,
  origin: LatLng,
  destination: LatLng,
): RouteWarning[] {
  const warnings: RouteWarning[] = [];
  const straightLineM = haversineMeters(origin, destination);
  if (straightLineM > 0 && distanceM > 4 * straightLineM) {
    warnings.push({
      code: 'ROUTE_TOO_LONG',
      message:
        `Route distance ${Math.round(distanceM)} m exceeds 4× the straight-line ` +
        `distance (${Math.round(straightLineM)} m) between origin and destination`,
    });
  }
  return warnings;
}

function mapTrip(trip: ValhallaTrip, origin: LatLng, destination: LatLng): Route {
  const { geometry, offsets } = joinLegShapes(trip.legs.map((leg) => leg.shape));

  const legs: RouteLeg[] = trip.legs.map((leg, index) => ({
    index,
    distance_m: leg.summary.length * 1000,
    duration_s: leg.summary.time,
  }));

  const maneuvers: Maneuver[] = [];
  trip.legs.forEach((leg, legIndex) => {
    const legOffset = offsets[legIndex] ?? 0;
    for (const m of leg.maneuvers) {
      maneuvers.push({
        index: maneuvers.length,
        type: mapManeuverType(m.type),
        instruction: m.instruction ?? '',
        street_names: m.street_names ?? [],
        distance_m: m.length * 1000,
        // Re-base the leg-local shape index onto the joined route geometry.
        begin_shape_index: legOffset + m.begin_shape_index,
        // E04-T2 ETA input: Valhalla's per-maneuver `time` (seconds), when
        // present. Conditionally spread rather than `duration_s: m.time` so a
        // missing Valhalla field stays ABSENT (not an explicit `undefined`
        // key) -- keeps the object exactly what the (additionalProperties:
        // false) maneuverSchema expects.
        ...(m.time !== undefined ? { duration_s: m.time } : {}),
      });
    }
  });

  // Valhalla `/route` does not return per-segment speed limits (that needs
  // `/trace_attributes`). Per docs/03-api-spec.md §1 we therefore leave
  // `speed_limits` empty rather than fabricate values.
  // TODO(routing-speed-limits): populate via `/trace_attributes` enrichment.
  const speed_limits: SpeedSegment[] = [];

  const distance_m = trip.summary.length * 1000;
  const duration_s = trip.summary.time;

  return {
    id: randomUUID(),
    distance_m,
    duration_s,
    geometry,
    legs,
    maneuvers,
    speed_limits,
    warnings: buildRouteWarnings(distance_m, origin, destination),
  };
}

/**
 * Map the primary trip plus any alternates into `Route[]`. Order: primary
 * route first, then alternates in Valhalla's order.
 */
export function mapValhallaResponse(
  response: ValhallaRouteResponse,
  origin: LatLng,
  destination: LatLng,
): Route[] {
  const trips: ValhallaTrip[] = [response.trip, ...(response.alternates ?? []).map((a) => a.trip)];
  return trips.map((trip) => mapTrip(trip, origin, destination));
}
