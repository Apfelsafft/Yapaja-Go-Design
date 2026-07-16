/**
 * ETA acceptance-scenario integration tests (E04-T2), driven with
 * `vi.useFakeTimers()` per the task spec:
 *
 *  1. Simulator at factor 1.0 (drives exactly as planned)   -> ETA error < 5%.
 *  2. Simulator drives ~20% slower                          -> ETA adapts within ~5 min.
 *  3. A 3-minute stop                                       -> ETA grows by ~the stop
 *     time, calibration factor unchanged.
 *
 * Scenarios 1-2 drive the real GPS simulator (SimulatorSource + PositionService)
 * through the same `pos/update` bus NavigationService consumes in production.
 * Scenario 3 (a true in-place stop) publishes `pos/update` fixes directly --
 * the simulator's track model requires a strictly positive segment speed (see
 * `position/simulator/track.ts#buildFromWaypointsWithSpeeds`), so it cannot
 * express "stopped at a red light"; `service.test.ts` already establishes
 * that driving NavigationService via direct `bus.publish('pos/update', ...)`
 * exercises the exact same code path as the simulator (both just publish onto
 * the shared bus).
 *
 * Every scenario also asserts `checkNavState` stays green across every
 * consecutive published pair (docs/03 §5: eta never in the past,
 * duration_remaining_s non-increasing while navigating).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NavState, Route } from '@yapaja/shared';
import { checkNavState } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { PositionService } from '../position/service.js';
import { SimulatorSource } from '../position/simulator/index.js';
import { encodePolyline6, decodePolyline6 } from '../routing/polyline.js';
import { NavigationService, type RouteProvider } from './service.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;

/** A straight due-North polyline with `steps` segments of `stepDeg` degrees latitude each. */
function straightPoints(steps: number, stepDeg: number): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= steps; i++) pts.push({ lat: BASE_LAT + i * stepDeg, lon: BASE_LON });
  return pts;
}

/** Build a schema-valid single-maneuver `Route` whose `duration_s` assumes `planeSpeedMs`. */
function buildRoute(points: LatLon[], planSpeedMs: number, id: string): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  const duration_s = total / planSpeedMs;
  return {
    id,
    distance_m: total,
    duration_s,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart',
        street_names: [],
        distance_m: total,
        begin_shape_index: 0,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

function providerFor(route: Route): RouteProvider {
  return { getCachedRoute: (id) => (id === route.id ? route : null) };
}

/**
 * Subscribe to `nav/state`, recording each published state ALONGSIDE the
 * (fake-clock) wall time it was published at -- needed so `assertPlausible`
 * can re-check the "eta never in the past" invariant against the clock AS IT
 * STOOD at each publish, not the test's much-later final time (an ETA
 * published early legitimately points tens/hundreds of seconds into ITS OWN
 * future, which would wrongly look "in the past" if compared against a
 * `now` from long after the fact).
 */
function subscribeStates(bus: EventBus): { states: NavState[]; publishedAtMs: number[] } {
  const states: NavState[] = [];
  const publishedAtMs: number[] = [];
  bus.subscribe('nav/state', (s) => {
    states.push(s);
    publishedAtMs.push(Date.now());
  });
  return { states, publishedAtMs };
}

/** Assert checkNavState is green (docs/03 §5) across every consecutive published pair. */
function assertPlausible(states: NavState[], publishedAtMs: number[]): void {
  for (let i = 1; i < states.length; i++) {
    const result = checkNavState(states[i], states[i - 1], new Date(publishedAtMs[i]));
    expect(result.ok, `states[${i}]: ${JSON.stringify(result.violations)}`).toBe(true);
  }
}

describe('E04-T2 ETA acceptance scenarios', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. exact-plan drive (factor 1.0): ETA error < 5%', () => {
    vi.useFakeTimers();
    const bus = new EventBus({ isProduction: false });
    const positionService = new PositionService({ bus, checkIntervalMs: 100, rateHz: 1 });
    const simulator = new SimulatorSource(positionService);
    positionService.registerSource(simulator);

    const planSpeedMs = 15;
    const points = straightPoints(27, 0.001); // ~27 * 111.2 m =~ 3000 m
    const route = buildRoute(points, planSpeedMs, 'r-exact');
    const navigation = new NavigationService({ bus, routeProvider: providerFor(route) });

    const { states, publishedAtMs } = subscribeStates(bus);

    const startedAtMs = Date.now();
    const initial = navigation.start({ route_id: route.id });
    // Predicted arrival straight from the plan, before any calibration data.
    const predictedArrivalMs = Date.parse(initial.eta as string);

    simulator.play({
      track: { polyline6: encodePolyline6(decodePolyline6(route.geometry)), speedMs: planSpeedMs },
    });
    vi.advanceTimersByTime(Math.ceil(route.duration_s + 30) * 1000);

    expect(navigation.getStatus()).toBe('arrived');
    const actualArrivalMs = startedAtMs + route.duration_s * 1000;

    const errorS = Math.abs(predictedArrivalMs - actualArrivalMs) / 1000;
    const errorRatio = errorS / route.duration_s;
    expect(errorRatio).toBeLessThan(0.05);

    assertPlausible(states, publishedAtMs);

    navigation.dispose();
    simulator.dispose();
    positionService.dispose();
  });

  it('2. driving ~20% slower: ETA adapts within ~5 min', () => {
    vi.useFakeTimers();
    const bus = new EventBus({ isProduction: false });
    const positionService = new PositionService({ bus, checkIntervalMs: 100, rateHz: 1 });
    const simulator = new SimulatorSource(positionService);
    positionService.registerSource(simulator);

    const planSpeedMs = 15;
    const actualSpeedMs = planSpeedMs * 0.8; // 20% slower
    const points = straightPoints(160, 0.001); // ~160 * 111.2 m =~ 17.8 km
    const route = buildRoute(points, planSpeedMs, 'r-slow');
    const navigation = new NavigationService({ bus, routeProvider: providerFor(route) });

    const { states, publishedAtMs } = subscribeStates(bus);

    const initial = navigation.start({ route_id: route.id });
    const originalPredictedArrivalMs = Date.parse(initial.eta as string);

    simulator.play({
      track: { polyline6: encodePolyline6(decodePolyline6(route.geometry)), speedMs: actualSpeedMs },
    });

    const FIVE_MIN_MS = 5 * 60 * 1000;
    vi.advanceTimersByTime(FIVE_MIN_MS);

    // Still en route (a 20%-slower ~17.8 km / 12 m/s drive takes ~25 min).
    expect(navigation.getStatus()).toBe('navigating');

    const latest = states[states.length - 1];
    expect(latest.eta).not.toBeNull();
    const adaptedArrivalMs = Date.parse(latest.eta as string);

    // The calibration factor must have moved meaningfully above 1.0 towards
    // the true 1.25 (=1/0.8) ratio -- "adapts", not "ignores".
    expect(navigation.getCalibrationFactor()).toBeGreaterThan(1.05);
    expect(navigation.getCalibrationFactor()).toBeLessThanOrEqual(1.25 + 1e-9);

    // The predicted arrival time must have moved LATER (the ETA "adapts" to
    // the slower pace) by a meaningful amount within these 5 minutes, without
    // wildly overshooting the true ~25% inflation.
    const delayS = (adaptedArrivalMs - originalPredictedArrivalMs) / 1000;
    expect(delayS).toBeGreaterThan(30);
    expect(delayS).toBeLessThan(FIVE_MIN_MS / 1000);

    assertPlausible(states, publishedAtMs);

    navigation.dispose();
    simulator.dispose();
    positionService.dispose();
  });

  it('3. a 3-minute stop: ETA grows by ~the stop time, calibration factor unchanged', () => {
    vi.useFakeTimers();
    const bus = new EventBus({ isProduction: false });

    // ~1 degree latitude =~ 111,195 m (spherical approx, matches geo.ts's
    // EARTH_RADIUS_M) -- good enough to place fixes at exact metre offsets
    // along a straight due-North route without needing the full route
    // geometry to be finely subdivided (a 2-point route is geometrically
    // exact for a straight line; map-matching interpolates along it either way).
    const METERS_PER_DEG_LAT = 111195;
    const planSpeedMs = 15;
    const totalM = 2000;
    const endPoint: LatLon = { lat: BASE_LAT + totalM / METERS_PER_DEG_LAT, lon: BASE_LON };
    const route = buildRoute([{ lat: BASE_LAT, lon: BASE_LON }, endPoint], planSpeedMs, 'r-stop');
    const navigation = new NavigationService({ bus, routeProvider: providerFor(route) });

    const { states, publishedAtMs } = subscribeStates(bus);

    navigation.start({ route_id: route.id });

    function pointAtDistanceM(distM: number): LatLon {
      return { lat: BASE_LAT + distM / METERS_PER_DEG_LAT, lon: BASE_LON };
    }

    function publishAtDistance(distM: number, speedMs: number): void {
      const pt = pointAtDistanceM(distM);
      bus.publish('pos/update', {
        lat: pt.lat,
        lon: pt.lon,
        alt: 460,
        speed: speedMs,
        heading: 0,
        accuracy: 5,
        source: 'simulator',
        fix: '3d',
        ts: new Date().toISOString(),
      });
    }

    // Drive the first 300 m at EXACTLY the planned pace (15 m/s, one fix per
    // simulated second -> 15 m/tick) so the calibration factor stays ~1.0.
    const DRIVE_TICKS = 20;
    for (let t = 1; t <= DRIVE_TICKS; t++) {
      vi.advanceTimersByTime(1000);
      publishAtDistance(t * planSpeedMs, planSpeedMs);
    }
    const stoppedAtM = DRIVE_TICKS * planSpeedMs;

    const factorBeforeStop = navigation.getCalibrationFactor();
    const beforeStop = states[states.length - 1];
    expect(beforeStop.duration_remaining_s).not.toBeNull();
    expect(factorBeforeStop).toBeCloseTo(1, 1);

    // Stand still at a red light for 3 minutes: same position, speed 0,
    // published every 10s (a plausible slow GPS cadence while parked).
    const STOP_S = 180;
    const STOP_TICK_S = 10;
    for (let t = 0; t < STOP_S; t += STOP_TICK_S) {
      vi.advanceTimersByTime(STOP_TICK_S * 1000);
      publishAtDistance(stoppedAtM, 0);
    }

    const afterStop = states[states.length - 1];
    expect(afterStop.duration_remaining_s).not.toBeNull();

    // duration_remaining_s barely moves (progress + factor both frozen)...
    const durationDeltaS = Math.abs(
      (afterStop.duration_remaining_s as number) - (beforeStop.duration_remaining_s as number),
    );
    expect(durationDeltaS).toBeLessThan(2);

    // ...while the `eta` TIMESTAMP grows by ~the stop duration (the clock
    // kept advancing under a flat countdown).
    const etaDeltaS =
      (Date.parse(afterStop.eta as string) - Date.parse(beforeStop.eta as string)) / 1000;
    expect(Math.abs(etaDeltaS - STOP_S)).toBeLessThan(15);

    // The calibration factor is untouched by the stop -- frozen exactly.
    expect(navigation.getCalibrationFactor()).toBe(factorBeforeStop);

    // Resume driving at the planned pace for a bit: the countdown resumes
    // ticking down and the factor stays anchored near 1.0 (no post-stop blip).
    for (let t = 1; t <= 10; t++) {
      vi.advanceTimersByTime(1000);
      publishAtDistance(stoppedAtM + t * planSpeedMs, planSpeedMs);
    }
    const afterResume = states[states.length - 1];
    expect(afterResume.duration_remaining_s as number).toBeLessThan(
      afterStop.duration_remaining_s as number,
    );
    expect(navigation.getCalibrationFactor()).toBeCloseTo(1, 1);

    assertPlausible(states, publishedAtMs);

    navigation.dispose();
  });
});
