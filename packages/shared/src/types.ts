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
  source: 'gpsd' | 'browser' | 'simulator' | 'ha_tracker';
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
  /**
   * Wann ein Mensch diese Masse zuletzt bestaetigt hat (ISO-8601), oder
   * `null` fuer „nie".
   *
   * Das ausgelieferte Standardprofil hat GERATENE Masse (3,00 m hoch) --
   * die Anwendung kann das Fahrzeug nicht kennen. Ohne dieses Feld sah eine
   * geratene Hoehe genauso aus wie eine gemessene, und `height` ging
   * unveraendert an Valhalla. Bei einem 3,20-m-Wohnmobil plant die Route
   * dann 20 cm zu niedrig, ohne dass irgendwo etwas steht.
   *
   * `null` ist deshalb kein Randfall, sondern der Zustand, den die
   * Oberflaeche sichtbar machen muss (`UnconfirmedDimensionsBanner`).
   */
  dimensions_confirmed_at: string | null;
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
  // E04-T4 (W-05, safety): the vehicle's current heading in degrees (0 = North,
  // clockwise, range 0–360). Optional and additive — set only on a REROUTE
  // request so Valhalla biases the origin edge in the direction of travel and
  // the first post-reroute instruction points FORWARD (never a spurious "Bitte
  // wenden" when continuing is possible). Maps onto the origin location's
  // Valhalla `heading`. Absent for ordinary A→B routing (behaviour unchanged).
  heading?: number;
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
  // Planned duration of this maneuver segment in seconds (Valhalla's
  // per-maneuver `time`, E04-T2 ETA calibration input). Optional: absent on
  // routes computed before this field existed, or in hand-built fixtures --
  // consumers (apps/core/src/navigation/eta.ts) fall back to a
  // distance-proportional estimate when it's missing on ANY maneuver.
  duration_s?: number;
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
  eta: string | null; // ISO 8601 in UTC ('...Z'); Core is UTC-only (W-22). Client formats to the device's local TZ via @yapaja/shared formatEta.
  speed_kmh: number | null; // current speed
  speed_limit_kmh: number | null; // from map data, null = unknown
  altitude_m: number | null;
  destination: {
    latlng: LatLng;
    name: string | null;
  } | null;
}

// Announcement published on the `nav/instruction` bus/WS topic (E04-T3, docs/03
// §3): fired when the announcement engine crosses a speed-scaled distance
// threshold to the active maneuver. `say` is the natural-language (de-DE)
// sentence to speak/display; distance_m is the (unrounded) distance to the
// maneuver AT THE MOMENT the threshold fired.
export interface NavInstructionPayload {
  maneuver: Maneuver;
  distance_m: number;
  say: string;
}

// Geocoding search result (E05-T1)
export interface SearchResult {
  name: string; // short name, e.g. "Vaduz"
  label: string; // full display label, e.g. "Vaduz, Liechtenstein"
  latlng: LatLng;
  type: string; // result category, e.g. "city", "street", "coordinates"
  source: 'photon' | 'nominatim' | 'coords' | 'lite'; // backend that produced this result; 'lite' = offline SQLite/FTS5 fallback used when Photon is down/disabled (E05-T5, W-12)
  out_of_coverage?: boolean; // true if outside all installed map regions (Vorgriff W-09)
  /** Strasse und Hausnummer, sofern die Daten sie tragen ("Beethovenstraße 12").
   *  Gemeldet: bei mehreren gleichnamigen Treffern ("welcher REWE?") ist das
   *  die Auskunft, die sie unterscheidbar macht. */
  address?: string;
  /** Der Ort, in dem der Treffer liegt ("Worms"). Ohne ihn sind dreihundert
   *  Beethovenstraßen in der Vorschlagsliste nicht auseinanderzuhalten. */
  locality?: string;
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

// Add-on manifest (`yapaja-addon.json`, E09-T1, docs/05 §2 "Manifest"). `id`
// becomes a DIRECTORY NAME under `data/addons/` at install time -- validated
// strictly (reverse-DNS-ish, no `/`, `\`, `..`) by `addonManifestSchema`/
// `validateAddonManifest`, not just this structural interface. `core_api` is
// a semver RANGE (see `semver.ts`) checked against the running Core's
// version at install (Wargame W-11).
export interface AddonManifestWidget {
  id: string;
  name: string;
  slots: string[];
}

export interface AddonManifestMapLayer {
  id: string;
  name: string;
  source: string;
}

export interface AddonManifestUi {
  entry: string;
  widgets?: AddonManifestWidget[];
  map_layers?: AddonManifestMapLayer[];
  settings_page?: boolean;
}

export interface AddonManifestService {
  runtime: 'node18' | 'node20' | 'external';
  entry: string;
  /**
   * E09-T3 / W-14: RSS ceiling for a Core-spawned service process, in MB.
   * The watchdog kills + restarts the process when it exceeds this. Optional;
   * the Core applies a 256 MB default (`DEFAULT_RSS_LIMIT_BYTES`) when it is
   * absent. Capped Core-side too -- an add-on cannot raise it arbitrarily.
   */
  max_rss_mb?: number;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string; // exact semver, e.g. "1.2.0"
  core_api: string; // semver RANGE, e.g. "^1.0"
  author: string;
  license: string;
  description: string;
  requires_online?: boolean;
  ui?: AddonManifestUi;
  service?: AddonManifestService;
  permissions: string[]; // see `ADDON_PERMISSION_SCOPES` in schemas/addon-manifest.ts
}
