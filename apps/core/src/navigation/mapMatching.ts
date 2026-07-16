/**
 * Map-matching core (E04-T1, 🔴 safety-critical).
 *
 * Projects a live position onto the active route polyline and reports, per fix:
 *  - `progressM`   metres travelled along the route from its start,
 *  - `crossTrackM` perpendicular offset from the route,
 *  - `matchedHeadingDeg` bearing of the matched polyline segment,
 *  - `segmentIndex` which segment `[i, i+1]` the fix matched.
 *
 * The matcher is PURE (no clocks, no bus, no I/O): monotonic-progress clamping
 * and the on/off-route decision that need speed/heading live in the caller
 * (`NavigationService`) and in `evaluateOnRoute` below, so every geometric
 * claim is unit-testable against fixed fixtures.
 *
 * Search window (±500 m of progress around the last match) is what makes the
 * matcher both fast AND correct on hairpins/parallel roads: the geometrically
 * near "wrong" leg of a hairpin is FAR along the route from the current
 * progress, so it never enters the candidate set and can't be snapped onto.
 * The route geometry itself is the one decoded by the routing module, so the
 * matcher and the route producer agree on every vertex.
 */

import type { Route } from '@yapaja/shared';
import { decodePolyline6 } from '../routing/polyline.js';
import {
  bearingDeg,
  angularDifference,
  haversineM,
  projectPointOntoSegment,
  type LatLon,
} from './geo.js';

/** On-route iff cross-track is within this many metres of the polyline. */
export const CROSS_TRACK_MAX_M = 30;
/** On-route (when moving) iff |heading − matchedHeading| is within this many degrees. */
export const HEADING_MAX_DIFF_DEG = 100;
/**
 * Below this ground speed (m/s ≈ 5.4 km/h) the GPS-reported heading is treated
 * as unreliable and the heading test is skipped — a stopped/crawling vehicle's
 * heading jitters freely and must not flip the route to off_route.
 */
export const STATIONARY_SPEED_MS = 1.5;
/** Half-width of the along-route search window around the last match, metres. */
export const SEARCH_WINDOW_M = 500;

export interface RouteGeometry {
  /** Decoded polyline vertices, in route order. */
  points: LatLon[];
  /** `cumulative[i]` = metres from the route start to `points[i]`. */
  cumulative: number[];
  /** Total route length in metres (== `cumulative[last]`). */
  totalLengthM: number;
}

/** Build the matcher's geometry from an ordered vertex list. */
export function buildRouteGeometryFromPoints(points: LatLon[]): RouteGeometry {
  if (points.length < 2) {
    throw new Error('RouteGeometry requires at least 2 points');
  }
  const cumulative = new Array<number>(points.length);
  cumulative[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + haversineM(points[i - 1], points[i]);
  }
  return { points, cumulative, totalLengthM: cumulative[cumulative.length - 1] };
}

/** Build the matcher's geometry from a `Route.geometry` polyline6 string. */
export function buildRouteGeometry(route: Pick<Route, 'geometry'>): RouteGeometry {
  return buildRouteGeometryFromPoints(decodePolyline6(route.geometry));
}

export interface MatchResult {
  /** Raw (un-clamped) progress along the route, metres. */
  progressM: number;
  crossTrackM: number;
  matchedHeadingDeg: number;
  /** Index `i` of the matched segment `points[i] -> points[i+1]`. */
  segmentIndex: number;
}

/**
 * Match `point` onto the route.
 *
 * `prevProgressM === null` (first fix): the WHOLE route is searched.
 * Otherwise only segments whose along-route span overlaps
 * `[prevProgressM − SEARCH_WINDOW_M, prevProgressM + SEARCH_WINDOW_M]` are
 * considered; among those the segment with the smallest cross-track wins. If —
 * defensively — the window contains no segment (e.g. a corrupt prevProgress),
 * the search falls back to the whole route rather than returning nothing.
 */
export function matchPosition(
  geom: RouteGeometry,
  point: LatLon,
  prevProgressM: number | null,
  searchWindowM: number = SEARCH_WINDOW_M,
): MatchResult {
  const { points, cumulative } = geom;
  const segCount = points.length - 1;

  const lo = prevProgressM === null ? -Infinity : prevProgressM - searchWindowM;
  const hi = prevProgressM === null ? Infinity : prevProgressM + searchWindowM;

  let best: MatchResult | null = null;
  let bestCross = Infinity;
  let considered = 0;

  for (let i = 0; i < segCount; i++) {
    const segStart = cumulative[i];
    const segEnd = cumulative[i + 1];
    // Skip segments entirely outside the window (this is the hairpin guard).
    if (segEnd < lo || segStart > hi) continue;
    considered++;

    const proj = projectPointOntoSegment(point, points[i], points[i + 1]);
    if (proj.crossTrackM < bestCross) {
      bestCross = proj.crossTrackM;
      best = {
        progressM: segStart + proj.t * (segEnd - segStart),
        crossTrackM: proj.crossTrackM,
        matchedHeadingDeg: bearingDeg(points[i], points[i + 1]),
        segmentIndex: i,
      };
    }
  }

  if (best === null) {
    // Window contained no segment — retry against the whole route.
    if (considered === 0 && prevProgressM !== null) {
      return matchPosition(geom, point, null, searchWindowM);
    }
    // Unreachable for a valid (>=2 point) geometry, but never return junk.
    throw new Error('matchPosition: no route segment to match against');
  }
  return best;
}

export interface OnRouteInput {
  crossTrackM: number;
  matchedHeadingDeg: number;
  /** Position heading in degrees, or null when unknown. */
  headingDeg: number | null;
  /** Ground speed in m/s, or null when unknown. */
  speedMs: number | null;
}

/**
 * On-route decision (docs/03 §5, E04-T1):
 *   cross-track ≤ 30 m  AND  ( vehicle ~stationary  OR  heading unknown
 *                              OR |heading − matchedHeading| ≤ 100° ).
 * A stationary/heading-unknown vehicle passes the heading test by definition —
 * its reported heading can't be trusted to prove it's going the wrong way.
 */
export function evaluateOnRoute(input: OnRouteInput): boolean {
  if (input.crossTrackM > CROSS_TRACK_MAX_M) return false;
  const stationary = input.speedMs === null || input.speedMs < STATIONARY_SPEED_MS;
  if (stationary || input.headingDeg === null) return true;
  return angularDifference(input.headingDeg, input.matchedHeadingDeg) <= HEADING_MAX_DIFF_DEG;
}
