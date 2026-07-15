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

export type GoldenCase = DistanceCase | RestrictionCase | MonotonicCase | NoRouteCase;

export interface GoldenRoutesFile {
  $schema_doc: string;
  cases: GoldenCase[];
}
