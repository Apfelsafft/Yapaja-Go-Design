/**
 * Type model for `e2e/golden-routes.json` (E03-T5).
 *
 * The cases are strongly typed so a malformed fixture fails at load time in the
 * runner, not deep inside an assertion. The four case shapes mirror
 * docs/07-testing-qa.md §3b.
 */

import type { Bbox } from './bbox.js';

/** WGS84 point, matching the Core's `LatLng` order. */
export interface LatLng {
  lat: number;
  lon: number;
}

/**
 * A vehicle profile as accepted by `POST /api/v1/profiles`
 * (`VehicleProfile` minus the server-owned `id`/`is_active`). The runner
 * creates a fresh profile per case and routes with its returned id, so the
 * profile→Valhalla-costing mapping is exercised end-to-end, not stubbed.
 */
export interface ProfileSpec {
  name: string;
  height_m: number;
  width_m: number;
  length_m: number;
  weight_t: number;
  avg_speed_kmh: number;
  hazmat: boolean;
  avoid: {
    motorway: boolean;
    toll: boolean;
    ferry: boolean;
    unpaved: boolean;
  };
}

/** Which curated set a case belongs to; selected by `GOLDEN_REGION`. */
export type Region = 'li' | 'de';

interface BaseCase {
  /** Stable, human-readable id used in test names and failure messages. */
  id: string;
  region: Region;
  /** Free-text provenance: where the numbers/coordinates come from. */
  provenance: string;
  /**
   * When true the case is NOT yet confirmed against a live routing run (e.g. a
   * DE restriction whose exact OSM way-id / forbidden_bbox still needs an
   * Overpass check, or a seeded distance not yet frozen from a green nightly
   * run). The runner still executes it, but the DE workflow treats an
   * unverified failure as non-blocking (logged, `continue-on-error`) instead
   * of a merge gate. Verified cases (default) are hard gates.
   */
  unverified?: boolean;
  /** Optional note explaining what still has to be done for `unverified` cases. */
  todo?: string;
  /**
   * When true the case is EXCLUDED from a run unless `GOLDEN_NIGHTLY=1` is
   * set (E10-T3). Reserved for cases that need minutes of real wall clock and
   * therefore must not sit in the per-PR merge gate — currently only the
   * `eta` case, whose whole point is a simulator run at `speed_factor: 1.0`
   * (docs/07 §3b: "simulierte Fahrt mit Faktor 1.0"), i.e. one second of
   * wall clock per simulated second. The nightly workflow sets the flag; the
   * per-PR `golden-routes-li` job does not, so that gate keeps its runtime
   * and its `bail: 1` semantics unchanged.
   */
  nightly_only?: boolean;
}

/** Route distance must land within `±tolerance` of `expected_distance_m`. */
export interface DistanceCase extends BaseCase {
  type: 'distance';
  origin: LatLng;
  destination: LatLng;
  profile: ProfileSpec;
  expected_distance_m: number;
  /** Fractional tolerance, e.g. 0.1 for ±10%. */
  tolerance: number;
}

/**
 * 🔴 Safety case. The `small_profile` route MUST enter `forbidden_bbox`
 * (proves the box sits on the natural path), the `large_profile` route MUST
 * NOT (proves the restriction is honoured). BOTH directions are asserted so a
 * total Valhalla failure can't masquerade as a pass.
 */
export interface RestrictionCase extends BaseCase {
  type: 'restriction';
  origin: LatLng;
  destination: LatLng;
  small_profile: ProfileSpec;
  large_profile: ProfileSpec;
  forbidden_bbox: Bbox;
  /** The restriction being exercised, for the log / audit trail. */
  restriction: {
    kind: 'maxheight' | 'maxweight' | 'maxwidth';
    value: number;
    unit: 'm' | 't';
    osm_way_id?: number | null;
    source?: string;
  };
}

/** Route duration must be non-decreasing across `profiles` (ascending size). */
export interface MonotonicCase extends BaseCase {
  type: 'monotonic';
  origin: LatLng;
  destination: LatLng;
  /** Ordered small→large; duration_s must not fall along the list. */
  profiles: ProfileSpec[];
}

/** The OD pair must yield NO_ROUTE for `profile`. */
export interface NoRouteCase extends BaseCase {
  type: 'no_route';
  origin: LatLng;
  destination: LatLng;
  profile: ProfileSpec;
}

/**
 * ETA-Plausibilität (docs/07 §3b, automated by E10-T3): route the OD pair,
 * start navigation on that route, drive the route's own geometry with the GPS
 * simulator at `speed_factor` (1.0 = "fährt genau wie geplant"), and compare
 * the FIRST published ETA against the wall-clock moment navigation reports
 * `arrived`. The deviation must stay below `max_eta_error` of the planned
 * duration.
 *
 * This is the only case type that consumes real wall clock (a simulated
 * second is a real second at factor 1.0), so every `eta` case is
 * `nightly_only` — see {@link BaseCase.nightly_only}.
 */
export interface EtaCase extends BaseCase {
  type: 'eta';
  origin: LatLng;
  destination: LatLng;
  profile: ProfileSpec;
  /** Simulator playback factor. docs/07 §3b prescribes 1.0. */
  speed_factor: number;
  /**
   * Maximum tolerated |actual arrival − initial ETA| as a fraction of the
   * planned route duration. docs/07 §3b: 0.05 (< 5 %).
   */
  max_eta_error: number;
  /**
   * Hard wall-clock cap for the whole case. A route whose planned duration
   * (or whose simulator playback) exceeds this aborts the case with a clear
   * error instead of hanging the nightly job until its timeout.
   */
  max_wall_clock_s: number;
}

export type GoldenCase = DistanceCase | RestrictionCase | MonotonicCase | NoRouteCase | EtaCase;

export interface GoldenRoutesFile {
  $schema_doc: string;
  cases: GoldenCase[];
}
