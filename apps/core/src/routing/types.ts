/**
 * Wire-format types for the subset of the Valhalla `/route` HTTP API that the
 * RoutingService produces (request) and consumes (response).
 *
 * These are deliberately NARROW: we only model the fields we actually build or
 * read. They are NOT re-exports of `@yapaja/shared` -- the shared package owns
 * the app-internal `Route`/`Maneuver` contract, this file owns the external
 * Valhalla contract, and the mapping between the two lives in
 * `./profileMapping.ts` (outbound) and `./mapResponse.ts` (inbound).
 *
 * References:
 *  - https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
 *  - Costing model "truck": https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#truck-costing-options
 */

// --- Outbound (request) --------------------------------------------------

export interface ValhallaLocation {
  lat: number;
  lon: number;
  /** All routing points are hard stops ("break") for our use case. */
  type: 'break';
}

/**
 * `costing_options.truck`. Only `use_*` flags that we intentionally *lower*
 * from Valhalla's default of `1` are present; leaving a flag absent keeps
 * Valhalla's default (see `../routing/profileMapping.ts`). This shape is the
 * heart of W-08: every field here changes which physical edges a truck route
 * may traverse.
 */
export interface ValhallaTruckCostingOptions {
  /** metres -- vehicle height, gates low bridges/tunnels. */
  height: number;
  /** metres -- vehicle width, gates narrow ways. */
  width: number;
  /** metres -- vehicle length. */
  length: number;
  /** metric tonnes -- gross weight, gates weak bridges/weight limits. */
  weight: number;
  /** carrying hazardous materials. */
  hazmat: boolean;
  /** km/h -- upper speed cap for ETA. */
  top_speed: number;
  /** present & 0 only when the profile avoids motorways. */
  use_highways?: number;
  /** present & 0 only when the profile avoids tolls. */
  use_tolls?: number;
  /** present & 0 only when the profile avoids ferries. */
  use_ferry?: number;
  /** present & 0 only when the profile avoids unpaved ways (closest Valhalla equivalent). */
  use_tracks?: number;
}

export interface ValhallaRouteRequestBody {
  locations: ValhallaLocation[];
  costing: 'truck';
  costing_options: { truck: ValhallaTruckCostingOptions };
  directions_options: { units: 'kilometers' };
  /** number of alternative routes requested (Valhalla naming: "alternates"). */
  alternates: number;
}

// --- Inbound (response) --------------------------------------------------

export interface ValhallaSummary {
  /** kilometres (because we request `units: "kilometers"`). */
  length: number;
  /** seconds. */
  time: number;
}

export interface ValhallaManeuver {
  /** integer maneuver-type enum, see ./maneuverMapping.ts. */
  type: number;
  instruction?: string;
  street_names?: string[];
  /** kilometres. */
  length: number;
  /** seconds. */
  time?: number;
  begin_shape_index: number;
  end_shape_index?: number;
}

export interface ValhallaLeg {
  /** polyline6-encoded geometry for this leg. */
  shape: string;
  summary: ValhallaSummary;
  maneuvers: ValhallaManeuver[];
}

export interface ValhallaTrip {
  legs: ValhallaLeg[];
  summary: ValhallaSummary;
  /** 0 = success. */
  status?: number;
  status_message?: string;
}

export interface ValhallaAlternate {
  trip: ValhallaTrip;
}

export interface ValhallaRouteResponse {
  trip: ValhallaTrip;
  alternates?: ValhallaAlternate[];
}

/** Valhalla's error payload shape (HTTP 4xx). */
export interface ValhallaErrorBody {
  error_code?: number;
  error?: string;
  status_code?: number;
  status?: string;
}
