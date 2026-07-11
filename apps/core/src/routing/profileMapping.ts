/**
 * 🔴 W-08 SAFETY CORE: map a `VehicleProfile` onto Valhalla `costing: "truck"`
 * options and build the full `/route` request body.
 *
 * Every field here decides which physical edges a truck route may use. A wrong
 * value means a route under too low a bridge or over too weak a road. The
 * mapping is therefore 1:1 and unit-checked, and each field is proven by the
 * profile-mapping intercept test.
 *
 * Unit alignment (all verified against the Valhalla truck-costing reference):
 *  - Valhalla `height`/`width`/`length` are in METRES; profile is in metres.  ✓
 *  - Valhalla `weight` is in metric TONNES; profile `weight_t` is in tonnes.   ✓
 *  - Valhalla `top_speed` is in km/h; profile `avg_speed_kmh` is in km/h.       ✓
 *
 * avoid -> Valhalla `use_*` mapping. Valhalla `use_*` default to `1`; setting a
 * flag to `0` makes the router avoid that class. We ONLY emit a `use_*` key
 * when the profile asks to avoid it, so that `avoid.X === false` leaves
 * Valhalla's default untouched (asserted by the negative test):
 *  - avoid.motorway -> use_highways = 0
 *  - avoid.toll     -> use_tolls    = 0
 *  - avoid.ferry    -> use_ferry    = 0
 *  - avoid.unpaved  -> use_tracks   = 0   (see KLÄRUNGSBEDARF below)
 *
 * ⚠️ KLÄRUNGSBEDARF (avoid.unpaved): Valhalla has NO exact "exclude unpaved"
 * switch. `use_tracks:0` (strongly avoid `highway=track`) is the closest
 * documented equivalent but is NOT identical: it does not cover every
 * `surface=unpaved` way, and it down-weights rather than hard-excludes. This
 * is mapped deliberately, not guessed; if a stricter guarantee is required the
 * data pipeline must additionally tag unpaved edges. Flagged for the
 * orchestrator to confirm.
 *
 * E03-T4 additions (temporary avoidances, all optional/backward-compatible):
 *  - `RouteRequest.exclude_locations` -> Valhalla `exclude_locations`, same
 *    `{lat, lon}` order, set only when non-empty.
 *  - `RouteRequest.exclude_polygons`  -> Valhalla `exclude_polygons`, rings
 *    converted from `{lat, lon}` to `[lon, lat]` tuples (⚠️ swapped order --
 *    see `toExcludePolygons` below), set only when non-empty.
 *  - `RouteRequest.avoid_overrides`   -> overrides the profile's `avoid.*`
 *    flags for THIS request only when building `costing_options.truck`; the
 *    profile itself is never mutated.
 */

import type { LatLng, RouteAvoidOverrides, RouteRequest, VehicleProfile } from '@yapaja/shared';
import type {
  ValhallaExcludeLocation,
  ValhallaExcludePolygonRing,
  ValhallaLocation,
  ValhallaRouteRequestBody,
  ValhallaTruckCostingOptions,
} from './types.js';

/**
 * Map a profile to `costing_options.truck`. Pure + exhaustively tested.
 *
 * `avoidOverrides` (E03-T4) is the optional per-REQUEST override coming from
 * `RouteRequest.avoid_overrides` (e.g. the web UI's avoid chips): when a flag
 * is present it wins over the profile's own `avoid.*` flag for this call
 * ONLY -- the `profile` object itself is never mutated or persisted.
 */
export function buildTruckCostingOptions(
  profile: VehicleProfile,
  avoidOverrides?: RouteAvoidOverrides,
): ValhallaTruckCostingOptions {
  const truck: ValhallaTruckCostingOptions = {
    height: profile.height_m,
    width: profile.width_m,
    length: profile.length_m,
    weight: profile.weight_t,
    hazmat: profile.hazmat,
    top_speed: profile.avg_speed_kmh,
  };

  // Effective avoid = per-request override (if present) else the profile's
  // own flag. Only lower a `use_*` flag when the EFFECTIVE flag is true;
  // otherwise leave the key absent so Valhalla keeps its default of 1.
  const effectiveMotorway = avoidOverrides?.motorway ?? profile.avoid.motorway;
  const effectiveToll = avoidOverrides?.toll ?? profile.avoid.toll;
  const effectiveFerry = avoidOverrides?.ferry ?? profile.avoid.ferry;
  const effectiveUnpaved = avoidOverrides?.unpaved ?? profile.avoid.unpaved;

  if (effectiveMotorway) truck.use_highways = 0;
  if (effectiveToll) truck.use_tolls = 0;
  if (effectiveFerry) truck.use_ferry = 0;
  if (effectiveUnpaved) truck.use_tracks = 0;

  return truck;
}

/** E03-T4: maps `RouteRequest.exclude_locations` 1:1 -- Valhalla's
 *  `exclude_locations` uses the SAME `{lat, lon}` order as everywhere else,
 *  unlike `exclude_polygons` below. */
function toExcludeLocations(points: readonly LatLng[]): ValhallaExcludeLocation[] {
  return points.map((p) => ({ lat: p.lat, lon: p.lon }));
}

/**
 * E03-T4: maps `RouteRequest.exclude_polygons` (rings of `{lat, lon}`,
 * app-internal order) to Valhalla's `exclude_polygons` (rings of `[lon, lat]`
 * TUPLES). ⚠️ This is the one field in the whole request body where Valhalla
 * expects GeoJSON-style `[lon, lat]` instead of `{lat, lon}` -- getting this
 * backwards silently excludes the wrong part of the planet, so the order is
 * asserted explicitly by the profile-mapping intercept test.
 */
function toExcludePolygons(polygons: readonly LatLng[][]): ValhallaExcludePolygonRing[] {
  return polygons.map((ring) => ring.map((p): [number, number] => [p.lon, p.lat]));
}

/** E03-T4: optional per-request temporary avoidances, see `RouteRequest`. */
export interface RouteExcludeOptions {
  excludeLocations?: readonly LatLng[];
  excludePolygons?: readonly LatLng[][];
  avoidOverrides?: RouteAvoidOverrides;
}

/**
 * Build the complete Valhalla `/route` request body.
 *
 * @param originLatLng resolved origin (caller has already turned `'current'`
 *   into a concrete LatLng, or rejected the request with NO_POSITION).
 * @param excludeOptions E03-T4: optional temporary avoidances
 *   (`exclude_locations`/`exclude_polygons`/`avoid_overrides`) from the
 *   `RouteRequest`. Each Valhalla field is only SET when the corresponding
 *   input array is non-empty; an absent/empty input leaves the key off the
 *   body entirely (matches the `use_*` "omit when unused" convention above).
 */
export function buildValhallaRouteBody(
  originLatLng: LatLng,
  destination: LatLng,
  waypoints: readonly LatLng[],
  profile: VehicleProfile,
  alternatives: number,
  excludeOptions?: RouteExcludeOptions,
): ValhallaRouteRequestBody {
  const toLocation = (p: LatLng): ValhallaLocation => ({
    lat: p.lat,
    lon: p.lon,
    type: 'break',
  });

  const locations: ValhallaLocation[] = [
    toLocation(originLatLng),
    ...waypoints.map(toLocation),
    toLocation(destination),
  ];

  const body: ValhallaRouteRequestBody = {
    locations,
    costing: 'truck',
    costing_options: { truck: buildTruckCostingOptions(profile, excludeOptions?.avoidOverrides) },
    directions_options: { units: 'kilometers' },
    alternates: alternatives,
  };

  const excludeLocations = excludeOptions?.excludeLocations;
  if (excludeLocations && excludeLocations.length > 0) {
    body.exclude_locations = toExcludeLocations(excludeLocations);
  }

  const excludePolygons = excludeOptions?.excludePolygons;
  if (excludePolygons && excludePolygons.length > 0) {
    body.exclude_polygons = toExcludePolygons(excludePolygons);
  }

  return body;
}

/** Narrow structural view of a `RouteRequest` the builder needs. */
export type RouteRequestLike = Pick<RouteRequest, 'waypoints' | 'alternatives'>;
