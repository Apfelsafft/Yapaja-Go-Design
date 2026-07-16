/**
 * Map-matching unit tests (E04-T1, 🔴 safety-critical).
 *
 * Exact fixtures from the task spec:
 *   1. position exactly on route,
 *   2. 25 m off  -> still on_route,
 *   3. 35 m off  -> off_route,
 *   4. opposite direction -> off_route (heading rule),
 *   5. hairpin  -> the ±500 m window must NOT snap onto the returning leg,
 * plus a CPU benchmark asserting < 5 ms / fix.
 *
 * Geometry: a due-North polyline at lat≈47 (Liechtenstein). At that latitude
 * 0.001° lat ≈ 111.2 m and 0.001° lon ≈ 75.8 m, so cross-track offsets are
 * created by nudging longitude.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import {
  buildRouteGeometryFromPoints,
  matchPosition,
  evaluateOnRoute,
  CROSS_TRACK_MAX_M,
  type RouteGeometry,
} from './mapMatching.js';
import { haversineM, toRadians, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;
const EARTH_RADIUS_M = 6371000;

/** Metres per degree of longitude at BASE_LAT (for building cross-track offsets). */
const M_PER_DEG_LON = toRadians(1) * Math.cos(toRadians(BASE_LAT)) * EARTH_RADIUS_M;
/** Degrees of longitude east that offsets a point by `m` metres. */
function lonOffsetForMeters(m: number): number {
  return m / M_PER_DEG_LON;
}

/** A straight due-North route: 11 points, ~111.2 m spacing, ~1112 m long. */
function straightNorthRoute(): RouteGeometry {
  const points: LatLon[] = [];
  for (let i = 0; i <= 10; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return buildRouteGeometryFromPoints(points);
}

describe('map-matching fixtures (spec)', () => {
  const geom = straightNorthRoute();
  // A point at lat 47.0035 sits between vertex 3 and 4; progress ≈ 3.5 segments.
  const onLat = BASE_LAT + 0.0035;
  const expectedProgress = haversineM({ lat: BASE_LAT, lon: BASE_LON }, { lat: onLat, lon: BASE_LON });

  it('1. exactly on route: ~0 cross-track, North heading, on_route while moving', () => {
    const m = matchPosition(geom, { lat: onLat, lon: BASE_LON }, null);
    expect(m.crossTrackM).toBeLessThan(0.5);
    expect(m.progressM).toBeCloseTo(expectedProgress, 0);
    // Matched heading is due North (0°), within a hair.
    expect(Math.min(m.matchedHeadingDeg, 360 - m.matchedHeadingDeg)).toBeLessThan(0.5);
    expect(
      evaluateOnRoute({
        crossTrackM: m.crossTrackM,
        matchedHeadingDeg: m.matchedHeadingDeg,
        headingDeg: 0,
        speedMs: 15,
      }),
    ).toBe(true);
  });

  it('2. 25 m off route: cross-track ≈ 25 m, still on_route', () => {
    const point = { lat: onLat, lon: BASE_LON + lonOffsetForMeters(25) };
    const m = matchPosition(geom, point, null);
    expect(m.crossTrackM).toBeGreaterThan(23);
    expect(m.crossTrackM).toBeLessThan(27);
    expect(m.crossTrackM).toBeLessThanOrEqual(CROSS_TRACK_MAX_M);
    expect(m.progressM).toBeCloseTo(expectedProgress, 0);
    expect(
      evaluateOnRoute({
        crossTrackM: m.crossTrackM,
        matchedHeadingDeg: m.matchedHeadingDeg,
        headingDeg: 2,
        speedMs: 15,
      }),
    ).toBe(true);
  });

  it('3. 35 m off route: cross-track ≈ 35 m, off_route', () => {
    const point = { lat: onLat, lon: BASE_LON + lonOffsetForMeters(35) };
    const m = matchPosition(geom, point, null);
    expect(m.crossTrackM).toBeGreaterThan(33);
    expect(m.crossTrackM).toBeLessThan(37);
    expect(m.crossTrackM).toBeGreaterThan(CROSS_TRACK_MAX_M);
    expect(
      evaluateOnRoute({
        crossTrackM: m.crossTrackM,
        matchedHeadingDeg: m.matchedHeadingDeg,
        headingDeg: 0,
        speedMs: 15,
      }),
    ).toBe(false);
  });

  it('4. opposite direction on route: off_route while moving, on_route when stopped', () => {
    const m = matchPosition(geom, { lat: onLat, lon: BASE_LON }, null);
    // Driving South (heading 180) along a North-bound segment: |Δheading| = 180 > 100.
    expect(
      evaluateOnRoute({
        crossTrackM: m.crossTrackM,
        matchedHeadingDeg: m.matchedHeadingDeg,
        headingDeg: 180,
        speedMs: 15,
      }),
    ).toBe(false);
    // Same fix, but stationary -> heading is ignored -> on_route.
    expect(
      evaluateOnRoute({
        crossTrackM: m.crossTrackM,
        matchedHeadingDeg: m.matchedHeadingDeg,
        headingDeg: 180,
        speedMs: 0,
      }),
    ).toBe(true);
  });
});

describe('map-matching hairpin (window guard)', () => {
  // Northbound leg (lon = BASE_LON), a ~20 m connector East, then a return leg
  // ~20 m East running back South. The return leg is geometrically CLOSER to a
  // point placed between the legs, so a full-route search snaps onto it — only
  // the ±500 m window keeps the match on the (correct) outbound leg.
  const returnLonOffset = lonOffsetForMeters(20);
  const points: LatLon[] = [
    { lat: 47.0, lon: BASE_LON },
    { lat: 47.001, lon: BASE_LON },
    { lat: 47.002, lon: BASE_LON },
    { lat: 47.003, lon: BASE_LON },
    { lat: 47.004, lon: BASE_LON },
    { lat: 47.005, lon: BASE_LON }, // apex (outbound top)
    { lat: 47.005, lon: BASE_LON + returnLonOffset }, // connector
    { lat: 47.004, lon: BASE_LON + returnLonOffset },
    { lat: 47.003, lon: BASE_LON + returnLonOffset },
    { lat: 47.002, lon: BASE_LON + returnLonOffset },
    { lat: 47.001, lon: BASE_LON + returnLonOffset },
    { lat: 47.0, lon: BASE_LON + returnLonOffset }, // return bottom
  ];
  const geom = buildRouteGeometryFromPoints(points);

  // A fix near the bottom, ~15 m East of the outbound leg, ~5 m West of the
  // return leg (so it is genuinely closer to the return leg).
  const fix = { lat: 47.0005, lon: BASE_LON + lonOffsetForMeters(15) };

  it('full-route search snaps onto the WRONG (returning) leg', () => {
    const m = matchPosition(geom, fix, null);
    expect(m.progressM).toBeGreaterThan(1000); // deep into the return leg
    expect(m.crossTrackM).toBeLessThan(8);
  });

  it('±500 m window keeps the match on the outbound leg', () => {
    // Last match was near the bottom of the outbound leg (~56 m in).
    const m = matchPosition(geom, fix, 56);
    expect(m.segmentIndex).toBe(0); // first outbound segment
    expect(m.progressM).toBeLessThan(200);
    expect(m.crossTrackM).toBeGreaterThan(13);
    expect(m.crossTrackM).toBeLessThan(17);
  });
});

describe('map-matching monotonic clamp helper behaviour', () => {
  it('window follows accepted progress across a sequence of noisy fixes', () => {
    const geom = straightNorthRoute();
    let prev: number | null = null;
    let accepted = 0;
    const progresses: number[] = [];
    for (let i = 0; i <= 10; i++) {
      const lat = BASE_LAT + i * 0.0009; // advance ~100 m/fix
      const jitterLon = BASE_LON + lonOffsetForMeters(i % 2 === 0 ? 8 : -8); // ±8 m noise
      const m = matchPosition(geom, { lat, lon: jitterLon }, prev);
      accepted = prev === null ? m.progressM : Math.max(m.progressM, accepted);
      progresses.push(accepted);
      prev = accepted;
    }
    // Non-decreasing throughout.
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i]).toBeGreaterThanOrEqual(progresses[i - 1]);
    }
  });
});

describe('map-matching CPU benchmark (< 5 ms / fix)', () => {
  it('averages well under 5 ms per fix on a ~1000-point route', () => {
    const points: LatLon[] = [];
    for (let i = 0; i < 1000; i++) {
      points.push({ lat: BASE_LAT + i * 0.0002, lon: BASE_LON + Math.sin(i / 20) * 0.0005 });
    }
    const geom = buildRouteGeometryFromPoints(points);

    // Warm up the JIT.
    for (let i = 0; i < 500; i++) matchPosition(geom, points[i], geom.cumulative[i]);

    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const idx = i % 1000;
      matchPosition(geom, points[idx], geom.cumulative[idx]);
    }
    const perFixMs = (performance.now() - start) / iterations;
    // eslint-disable-next-line no-console
    console.log(`map-matching benchmark: ${perFixMs.toFixed(4)} ms/fix`);
    expect(perFixMs).toBeLessThan(5);
  });
});
