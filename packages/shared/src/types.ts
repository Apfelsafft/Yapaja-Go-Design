/**
 * Core data types for Yapaja Go navigation application
 * Exact definitions from docs/03-api-spec.md Section 1
 */

// WGS84 coordinates, EPSG:4326
export interface LatLng {
  lat: number;
  lon: number;
}

// Current vehicle/device position with GPS metadata
export interface Position {
  lat: number;
  lon: number;
  alt: number | null; // Meter über MSL (above mean sea level)
  speed: number | null; // m/s über Grund (over ground)
  heading: number | null; // Grad (degrees), 0 = Nord (North), range 0-360
  accuracy: number | null; // Meter (HDOP-based for gpsd)
  source: 'gpsd' | 'browser' | 'simulator';
  fix: 'none' | '2d' | '3d';
  ts: string; // ISO 8601 UTC
}

// Vehicle profile for routing and restriction checking
export interface VehicleProfile {
  id: string; // uuid
  name: string; // e.g. "Kastenwagen", "Alkoven 7.5t"
  height_m: number; // 1.0–4.5
  width_m: number; // 1.5–3.0
  length_m: number; // 3.0–20.0
  weight_t: number; // 1.0–40.0
  avg_speed_kmh: number; // 40–130, used for ETA calculation
  hazmat: boolean; // default false
  avoid: {
    motorway: boolean;
    toll: boolean;
    ferry: boolean;
    unpaved: boolean;
  };
  is_active: boolean;
}

// Per-request override of a VehicleProfile's `avoid` flags. Every field is
// optional: an absent field falls back to the active profile's own flag.
// Applies to THIS request only -- the profile itself is never modified or
// persisted (E03-T4).
export interface RouteAvoidOverrides {
  motorway?: boolean;
  toll?: boolean;
  ferry?: boolean;
  unpaved?: boolean;
}

// Request to calculate route(s)
export interface RouteRequest {
  origin: LatLng | 'current';
  destination: LatLng;
  waypoints: LatLng[]; // max 25
  profile_id: string;
  alternatives: number; // 0–3
  // E03-T4: optional temporary avoidances, independent of the vehicle
  // profile and not persisted anywhere -- scoped to this single request.
  /** Point locations to exclude from routing. */
  exclude_locations?: LatLng[];
  /** Polygons (closed rings of LatLng) to exclude from routing. */
  exclude_polygons?: LatLng[][];
  /** Per-request avoid-flag overrides, see {@link RouteAvoidOverrides}. */
  avoid_overrides?: RouteAvoidOverrides;
}

// TODO(spec): minimal definition, refine when first consumed
export interface RouteLeg {
  index: number;
  distance_m: number;
  duration_s: number;
}

// Speed restriction segment along route
export interface SpeedSegment {
  begin_shape_index: number;
  end_shape_index: number;
  kmh: number | null; // null = "unbekannt" (unknown)
}

// TODO(spec): minimal definition, refine when first consumed
export interface LaneInfo {
  lane_index: number;
  is_usable: boolean;
  direction?: string;
}

// TODO(spec): minimal definition, refine when first consumed
export interface RouteWarning {
  code: string;
  message: string;
}

// TODO(spec): minimal definition, refine when first consumed
export type ManeuverType =
  | 'turn_left'
  | 'turn_right'
  | 'roundabout_enter'
  | 'roundabout_exit'
  | 'straight'
  | 'continue'
  | string; // Allow other Valhalla types

// Maneuver instruction for upcoming turn/action
export interface Maneuver {
  index: number;
  type: ManeuverType;
  instruction: string; // localized, e.g. "Links abbiegen auf B27"
  street_names: string[];
  distance_m: number; // length of this maneuver segment
  begin_shape_index: number;
  lanes?: LaneInfo[];
}

// Complete route
export interface Route {
  id: string;
  distance_m: number;
  duration_s: number; // Valhalla time, calibrated with avg_speed_kmh
  geometry: string; // polyline6
  legs: RouteLeg[];
  maneuvers: Maneuver[];
  speed_limits: SpeedSegment[];
  warnings: RouteWarning[];
}

// Navigation state machine
export interface NavState {
  status: 'idle' | 'routing' | 'navigating' | 'paused' | 'arrived' | 'off_route';
  route_id: string | null;
  next_maneuver: Maneuver | null;
  distance_to_maneuver_m: number | null;
  distance_remaining_m: number | null;
  duration_remaining_s: number | null;
  eta: string | null; // ISO 8601, local TZ of device
  speed_kmh: number | null; // current speed
  speed_limit_kmh: number | null; // from map data, null = unknown
  altitude_m: number | null;
  destination: {
    latlng: LatLng;
    name: string | null;
  } | null;
}

// Geocoding search result (E05-T1)
export interface SearchResult {
  name: string; // short name, e.g. "Vaduz"
  label: string; // full display label, e.g. "Vaduz, Liechtenstein"
  latlng: LatLng;
  type: string; // result category, e.g. "city", "street", "coordinates"
  source: 'photon' | 'nominatim' | 'coords'; // backend that produced this result
  out_of_coverage?: boolean; // true if outside all installed map regions (Vorgriff W-09)
}

// Favorite destination (E05-T3, docs/03 §2 "Favoriten")
export interface Favorite {
  id: string; // uuid
  name: string;
  latlng: LatLng;
  icon: string; // free-form icon key/emoji, e.g. "home", "campsite", "⛺"
  category: 'home' | 'campsite' | 'poi' | 'custom';
  sort_order: number; // drag-order position, ascending
}

// A search-history entry: either a raw search `query`, a picked `destination`,
// or both -- at least one must be non-null (enforced by the Core, not this
// structural schema). Max 100 entries, FIFO eviction (E05-T3).
export interface HistoryEntry {
  id: string; // uuid
  query: string | null;
  destination: {
    latlng: LatLng;
    name: string | null;
  } | null;
  ts: string; // ISO 8601 UTC
}

// Unified error format
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: object;
  };
}
