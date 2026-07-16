/**
 * Pure-geometry / EWMA unit tests for the dead-reckoning provider (E04-T6,
 * Wargame W-01). Integration coverage (both outage scenarios end-to-end,
 * incl. announcements-keep-firing and the 30s -> paused -> auto-resume
 * lifecycle) lives in `deadReckoningIntegration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { Position } from '@yapaja/shared';
import {
  buildRouteGeometryFromPoints,
  matchPosition,
  type RouteGeometry,
} from './mapMatching.js';
import { type LatLon } from './geo.js';
import {
  extrapolateAlongRoute,
  RouteAwareDeadReckoningProvider,
  initialStableSpeedState,
  updateStableSpeed,
  type DeadReckoningContext,
  type DeadReckoningRouteSource,
} from './deadreckoning.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;

/** Straight due-North route, 11 vertices, ~1112 m long (mirrors mapMatching.test.ts's fixture). */
function straightNorthRoute(): RouteGeometry {
  const points: LatLon[] = [];
  for (let i = 0; i <= 10; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return buildRouteGeometryFromPoints(points);
}

/**
 * A genuinely CURVED polyline: 21 vertices sweeping from due-North to
 * increasingly north-EAST as latitude increases (a smooth bend, not a
 * straight line) -- every consecutive segment has a distinct bearing, so a
 * "stays on the polyline" assertion is actually exercising curve-following,
 * not just interpolating a single straight segment.
 */
function curvedRoute(): RouteGeometry {
  const points: LatLon[] = [];
  const AMPLITUDE_DEG = 0.012; // ~900 m of eastward drift at BASE_LAT by the end (a pronounced bend)
  const STEPS = 20;
  for (let i = 0; i <= STEPS; i++) {
    const lat = BASE_LAT + i * 0.001;
    const lon = BASE_LON + AMPLITUDE_DEG * (1 - Math.cos((i / STEPS) * (Math.PI / 2)));
    points.push({ lat, lon });
  }
  return buildRouteGeometryFromPoints(points);
}

describe('extrapolateAlongRoute (pure geometry)', () => {
  describe('curve geometry: stays ON the polyline, tangent heading, progress ~ speed*elapsed', () => {
    const geom = curvedRoute();
    // Start mid-route, deliberately BETWEEN two vertices (not exactly on
    // one), so the test also exercises the interpolation path itself.
    const startProgressM = (geom.cumulative[5] + geom.cumulative[6]) / 2;
    const speedMs = 12;

    it.each([1000, 5000, 12000, 20000])('elapsed=%dms', (elapsedMs) => {
      const result = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs,
        elapsedMs,
        clampProgressM: null,
      });
      expect(result).not.toBeNull();
      if (!result) return;

      // Re-match the extrapolated point against the WHOLE route with the
      // real map-matcher: cross-track must be ~0 (floating-point only) --
      // i.e. the guessed point is genuinely ON the polyline, following the
      // bend, not cutting a straight line across it.
      const match = matchPosition(geom, { lat: result.lat, lon: result.lon }, null);
      expect(match.crossTrackM).toBeLessThan(1e-6);
      expect(match.progressM).toBeCloseTo(result.progressM, 6);

      // Heading follows the tangent of whichever segment the point landed
      // on -- the SAME bearing the map-matcher itself computed for that segment.
      expect(result.headingDeg).toBeCloseTo(match.matchedHeadingDeg, 6);

      // Progress advanced by ~speed * elapsed (well short of the route end
      // for every elapsed value tested here, so no clamping kicks in).
      const expectedAdvanceM = speedMs * (elapsedMs / 1000);
      expect(result.progressM - startProgressM).toBeCloseTo(expectedAdvanceM, 1);
    });

    it('heading changes across the bend (not frozen at the start segment\'s bearing)', () => {
      const early = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs,
        elapsedMs: 500,
        clampProgressM: null,
      });
      const late = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs,
        elapsedMs: 25_000, // far enough along the curve to reach a markedly different bearing
        clampProgressM: null,
      });
      expect(early).not.toBeNull();
      expect(late).not.toBeNull();
      if (!early || !late) return;
      expect(Math.abs(late.headingDeg - early.headingDeg)).toBeGreaterThan(5);
    });
  });

  describe('stop-at-maneuver clamp (never guess around the corner)', () => {
    const geom = straightNorthRoute();
    const startProgressM = 100;
    const maneuverProgressM = 400;

    it('clamps exactly at the maneuver point when the raw target overshoots it', () => {
      const result = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs: 50, // fast enough that 20s of travel (1000 m) blows way past the maneuver
        elapsedMs: 20_000,
        clampProgressM: maneuverProgressM,
      });
      expect(result).not.toBeNull();
      expect(result?.progressM).toBeCloseTo(maneuverProgressM, 9);

      // The clamped point is exactly what pointAtProgress would compute for
      // maneuverProgressM directly -- verify via the real map-matcher too.
      if (!result) return;
      const match = matchPosition(geom, { lat: result.lat, lon: result.lon }, null);
      expect(match.crossTrackM).toBeLessThan(1e-6);
      expect(match.progressM).toBeCloseTo(maneuverProgressM, 6);
    });

    it('stays frozen at the clamp for further elapsed time (does not creep past it)', () => {
      const at20s = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs: 50,
        elapsedMs: 20_000,
        clampProgressM: maneuverProgressM,
      });
      const at29s = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs: 50,
        elapsedMs: 29_000,
        clampProgressM: maneuverProgressM,
      });
      expect(at20s?.progressM).toBeCloseTo(maneuverProgressM, 9);
      expect(at29s?.progressM).toBeCloseTo(maneuverProgressM, 9);
    });

    it('does NOT clamp before the raw target reaches the maneuver', () => {
      const result = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs: 10,
        elapsedMs: 5000, // 50 m of travel -> 150 m, well short of the 400 m maneuver
        clampProgressM: maneuverProgressM,
      });
      expect(result?.progressM).toBeCloseTo(150, 6);
    });

    it('also clamps at the route end when there is no upcoming maneuver', () => {
      const result = extrapolateAlongRoute({
        geom,
        progressM: startProgressM,
        speedMs: 50,
        elapsedMs: 60_000, // way more than enough to blow past the route end
        clampProgressM: null,
      });
      expect(result?.progressM).toBeCloseTo(geom.totalLengthM, 6);
    });
  });

  describe('declines (returns null) on inputs it cannot extrapolate', () => {
    const geom = straightNorthRoute();

    it('zero speed', () => {
      expect(
        extrapolateAlongRoute({ geom, progressM: 0, speedMs: 0, elapsedMs: 1000, clampProgressM: null }),
      ).toBeNull();
    });

    it('negative speed', () => {
      expect(
        extrapolateAlongRoute({ geom, progressM: 0, speedMs: -5, elapsedMs: 1000, clampProgressM: null }),
      ).toBeNull();
    });

    it('negative elapsed', () => {
      expect(
        extrapolateAlongRoute({ geom, progressM: 0, speedMs: 10, elapsedMs: -1, clampProgressM: null }),
      ).toBeNull();
    });

    it('degenerate (zero-length) geometry', () => {
      const degenerate = buildRouteGeometryFromPoints([
        { lat: BASE_LAT, lon: BASE_LON },
        { lat: BASE_LAT, lon: BASE_LON },
      ]);
      expect(
        extrapolateAlongRoute({
          geom: degenerate,
          progressM: 0,
          speedMs: 10,
          elapsedMs: 1000,
          clampProgressM: null,
        }),
      ).toBeNull();
    });
  });
});

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    lat: BASE_LAT,
    lon: BASE_LON,
    alt: 400,
    speed: 8,
    heading: 0,
    accuracy: 5,
    source: 'gpsd',
    fix: '3d',
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sourceReturning(ctx: DeadReckoningContext | null): DeadReckoningRouteSource {
  return { getActiveForDeadReckoning: () => ctx };
}

describe('RouteAwareDeadReckoningProvider', () => {
  const geom = straightNorthRoute();

  it('returns null when there is no active route to extrapolate along', () => {
    const provider = new RouteAwareDeadReckoningProvider(sourceReturning(null));
    expect(provider.extrapolate(makePosition(), 5000)).toBeNull();
  });

  it('extrapolates using the context\'s last STABLE speed, not the stale lastFix speed', () => {
    const ctx: DeadReckoningContext = {
      geom,
      progressM: 0,
      nextManeuverProgressM: null,
      lastStableSpeedMs: 10, // deliberately different from lastFix.speed below
    };
    const provider = new RouteAwareDeadReckoningProvider(sourceReturning(ctx));
    const result = provider.extrapolate(makePosition({ speed: 999 }), 5000);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.speed).toBe(10);
    // ~50 m of due-North travel from BASE_LAT/BASE_LON.
    const expectedLat = BASE_LAT + (10 * 5) / 111_194.9;
    expect(result.lat).toBeCloseTo(expectedLat, 4);
    expect(result.lon).toBeCloseTo(BASE_LON, 6);
    expect(result.heading).toBeCloseTo(0, 3);
    // lastFix fields not touched by the extrapolation carry over unchanged.
    expect(result.alt).toBe(400);
    expect(result.accuracy).toBe(5);
    expect(result.source).toBe('gpsd');
    expect(result.fix).toBe('3d');
    // A fresh timestamp is stamped (never the stale lastFix.ts).
    expect(result.ts).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to lastFix.speed when no stable speed is available yet', () => {
    const ctx: DeadReckoningContext = {
      geom,
      progressM: 0,
      nextManeuverProgressM: null,
      lastStableSpeedMs: null,
    };
    const provider = new RouteAwareDeadReckoningProvider(sourceReturning(ctx));
    const result = provider.extrapolate(makePosition({ speed: 6 }), 1000);
    expect(result?.speed).toBe(6);
  });

  it('declines when neither a stable speed nor a lastFix speed is known', () => {
    const ctx: DeadReckoningContext = {
      geom,
      progressM: 0,
      nextManeuverProgressM: null,
      lastStableSpeedMs: null,
    };
    const provider = new RouteAwareDeadReckoningProvider(sourceReturning(ctx));
    expect(provider.extrapolate(makePosition({ speed: null }), 1000)).toBeNull();
  });

  it('clamps at nextManeuverProgressM (delegates to extrapolateAlongRoute)', () => {
    const ctx: DeadReckoningContext = {
      geom,
      progressM: 0,
      nextManeuverProgressM: 50,
      lastStableSpeedMs: 20,
    };
    const provider = new RouteAwareDeadReckoningProvider(sourceReturning(ctx));
    const result = provider.extrapolate(makePosition(), 10_000); // would be 200 m unclamped
    expect(result).not.toBeNull();
    if (!result) return;
    const match = matchPosition(geom, { lat: result.lat, lon: result.lon }, null);
    expect(match.progressM).toBeCloseTo(50, 6);
  });
});

describe('stable-speed EWMA', () => {
  it('the first reading initializes the average exactly', () => {
    const state = updateStableSpeed(initialStableSpeedState(), 15, 1000);
    expect(state.emaMs).toBe(15);
  });

  it('blends towards a new reading over time (moves, without overshooting)', () => {
    let state = updateStableSpeed(initialStableSpeedState(), 10, 0);
    state = updateStableSpeed(state, 20, 2000); // 2s later, a jump to 20 m/s
    expect(state.emaMs).not.toBeNull();
    expect(state.emaMs as number).toBeGreaterThan(10);
    expect(state.emaMs as number).toBeLessThan(20);
  });

  it('converges close to the new value after several seconds (>> tau)', () => {
    let state = updateStableSpeed(initialStableSpeedState(), 10, 0);
    state = updateStableSpeed(state, 20, 30_000); // 30s >> the 5s time constant
    expect(state.emaMs as number).toBeCloseTo(20, 0);
  });

  it('ignores a null reading (state carried over unchanged)', () => {
    const seeded = updateStableSpeed(initialStableSpeedState(), 12, 0);
    const after = updateStableSpeed(seeded, null, 1000);
    expect(after).toEqual(seeded);
  });

  it('ignores a negative reading (state carried over unchanged)', () => {
    const seeded = updateStableSpeed(initialStableSpeedState(), 12, 0);
    const after = updateStableSpeed(seeded, -3, 1000);
    expect(after).toEqual(seeded);
  });
});
