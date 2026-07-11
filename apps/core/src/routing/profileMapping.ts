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
 */

import type { LatLng, RouteRequest, VehicleProfile } from '@yapaja/shared';
import type {
  ValhallaLocation,
  ValhallaRouteRequestBody,
  ValhallaTruckCostingOptions,
} from './types.js';

/** Map a profile to `costing_options.truck`. Pure + exhaustively tested. */
export function buildTruckCostingOptions(profile: VehicleProfile): ValhallaTruckCostingOptions {
  const truck: ValhallaTruckCostingOptions = {
    height: profile.height_m,
    width: profile.width_m,
    length: profile.length_m,
    weight: profile.weight_t,
    hazmat: profile.hazmat,
    top_speed: profile.avg_speed_kmh,
  };

  // Only lower a `use_*` flag when the profile explicitly avoids that class;
  // otherwise leave the key absent so Valhalla keeps its default of 1.
  if (profile.avoid.motorway) truck.use_highways = 0;
  if (profile.avoid.toll) truck.use_tolls = 0;
  if (profile.avoid.ferry) truck.use_ferry = 0;
  if (profile.avoid.unpaved) truck.use_tracks = 0;

  return truck;
}

/**
 * Build the complete Valhalla `/route` request body.
 *
 * @param originLatLng resolved origin (caller has already turned `'current'`
 *   into a concrete LatLng, or rejected the request with NO_POSITION).
 */
export function buildValhallaRouteBody(
  originLatLng: LatLng,
  destination: LatLng,
  waypoints: readonly LatLng[],
  profile: VehicleProfile,
  alternatives: number,
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

  return {
    locations,
    costing: 'truck',
    costing_options: { truck: buildTruckCostingOptions(profile) },
    directions_options: { units: 'kilometers' },
    alternates: alternatives,
  };
}

/** Narrow structural view of a `RouteRequest` the builder needs. */
export type RouteRequestLike = Pick<RouteRequest, 'waypoints' | 'alternatives'>;
