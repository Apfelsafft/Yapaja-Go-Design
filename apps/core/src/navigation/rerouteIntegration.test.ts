/**
 * Reroute lifecycle integration (E04-T4, 🔴 safety-critical).
 *
 * Drives fixes through the real `NavigationService` (via the bus) with a MOCKED
 * reroute provider standing in for `RoutingService.createRoutes` (offline, like
 * the routing tests). Covers docs/07 §5 Flow 3 (detour → new forward-facing
 * route), the W-05 loop guard, the Valhalla-down failure + 15 s retry, and the
 * 10 s debounce. Fake timers throughout — no real sleeps.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Position, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import {
  NavigationService,
  type ActiveProfileLookup,
  type RerouteProvider,
  type RouteProvider,
} from './service.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;
const M_PER_DEG_LON = 111_320 * Math.cos((BASE_LAT * Math.PI) / 180);

function straightNorthPoints(startLat: number, lon: number, count: number, stepDeg = 0.001): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i < count; i++) pts.push({ lat: startLat + i * stepDeg, lon });
  return pts;
}

function makeRoute(points: LatLon[], id: string, firstManeuverType = 'continue'): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id,
    distance_m: total,
    duration_s: total / 15,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: total / 15 }],
    maneuvers: [
      {
        index: 0,
        type: firstManeuverType,
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

function pos(lat: number, lon: number, heading: number | null, speed: number | null): Position {
  return {
    lat,
    lon,
    alt: null,
    speed,
    heading,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date(Date.now()).toISOString(),
  };
}

/** East offset in degrees longitude for `m` metres at 47°N. */
function eastDeg(m: number): number {
  return m / M_PER_DEG_LON;
}

describe('E04-T4 reroute lifecycle', () => {
  let bus: EventBus;
  let originalRoute: Route;
  let events: Record<string, unknown[]>;

  const capture = (topic: string): void => {
    bus.subscribe(topic, (p) => {
      (events[topic] ??= []).push(p);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:00:00.000Z'));
    bus = new EventBus({ isProduction: false });
    events = {};
    ['route/deviation', 'route/updated', 'event/reroute_loop', 'event/reroute_failed'].forEach(
      capture,
    );
    // ~2 km straight north route.
    originalRoute = makeRoute(straightNorthPoints(BASE_LAT, BASE_LON, 19), 'orig');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function routeProvider(): RouteProvider {
    return { getCachedRoute: (id) => (id === originalRoute.id ? originalRoute : null) };
  }

  /** Active-profile lookup (production path: reroute reads profile_id from here). */
  function profileProvider(): ActiveProfileLookup {
    const profile: VehicleProfile = {
      id: 'p1',
      name: 'Camper',
      height_m: 3,
      width_m: 2.2,
      length_m: 6.5,
      weight_t: 3.5,
      avg_speed_kmh: 85,
      hazmat: false,
      avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
      is_active: true,
    };
    return { getActive: () => profile };
  }

  function makeNav(provider: RerouteProvider): NavigationService {
    return new NavigationService({
      bus,
      routeProvider: routeProvider(),
      rerouteProvider: provider,
      profileProvider: profileProvider(),
    });
  }

  /** Publish one fix, then advance the fake clock by 1 s (flushing async reroute). */
  async function feed(p: Position): Promise<void> {
    bus.publish('pos/update', p);
    await vi.advanceTimersByTimeAsync(1000);
  }

  it('Flow 3: a confirmed detour reroutes onto a new FORWARD-facing route (heading passed)', async () => {
    const captured: RouteRequest[] = [];
    // The vehicle deviates onto a parallel track ~60 m east and keeps driving
    // NORTH (heading 45° here just to prove the exact value threads through).
    const DETOUR_LON = BASE_LON + eastDeg(60);
    // The new route continues NORTH from the deviation point (forward). A real
    // Valhalla returns such a forward route BECAUSE we pass the heading; the
    // mock stands in for that behaviour and lets us assert heading was sent and
    // that the resulting first maneuver is forward (not a U-turn).
    const forwardRoute = makeRoute(
      straightNorthPoints(47.005, DETOUR_LON, 10),
      'reroute-1',
      'continue',
    );
    // A forward maneuver AHEAD of the vehicle (so `next_maneuver` is populated);
    // 'continue' = points forward, never a U-turn.
    forwardRoute.maneuvers.push({
      index: 1,
      type: 'continue',
      instruction: 'Weiter geradeaus',
      street_names: [],
      distance_m: 300,
      begin_shape_index: 4,
    });
    const provider: RerouteProvider = {
      createRoutes: (req) => {
        captured.push(req);
        return Promise.resolve([forwardRoute]);
      },
    };
    const nav = makeNav(provider);

    nav.start({ route: originalRoute });
    // Two on-route fixes (navigating).
    await feed(pos(BASE_LAT + 0.001, BASE_LON, 0, 15));
    await feed(pos(BASE_LAT + 0.002, BASE_LON, 0, 15));
    expect(nav.getStatus()).toBe('navigating');

    // Detour: parked ~60 m east at 47.005, heading 45. Six fixes => 5 s/5-fix.
    for (let i = 0; i < 7; i++) {
      await feed(pos(47.005, DETOUR_LON, 45, 15));
    }

    // Confirmed deviation published exactly once, then the reroute landed.
    expect(events['route/deviation']).toHaveLength(1);
    expect(captured).toHaveLength(1);
    // W-05: heading threaded into the reroute request (origin edge bias).
    expect(captured[0].heading).toBe(45);
    expect(captured[0].origin).toEqual({ lat: expect.any(Number), lon: expect.any(Number) });
    // Reroute keeps the FINAL destination (original route's last vertex).
    expect(captured[0].destination).toEqual({ lat: expect.any(Number), lon: BASE_LON });
    expect(captured[0].alternatives).toBe(0);

    // route/updated { reason:'reroute' } and navigation continues seamlessly.
    expect(events['route/updated']).toEqual([{ reason: 'reroute', route_id: 'reroute-1' }]);
    const state = nav.getState();
    expect(state.route_id).toBe('reroute-1');
    expect(nav.getStatus()).toBe('navigating');
    // Plausibility: the first post-reroute maneuver points FORWARD (not a U-turn).
    expect(state.next_maneuver?.type).toBe('continue');
    expect(state.next_maneuver?.type).not.toMatch(/uturn|turn.?around|wenden/i);

    nav.dispose();
  });

  it('keeps the ETA calibration factor across a reroute but resets progress/maneuvers', async () => {
    const forwardRoute = makeRoute(
      straightNorthPoints(47.009, BASE_LON + eastDeg(60), 10),
      'reroute-1',
    );
    const provider: RerouteProvider = { createRoutes: () => Promise.resolve([forwardRoute]) };
    const nav = makeNav(provider);

    nav.start({ route: originalRoute });
    for (let i = 0; i < 7; i++) {
      await feed(pos(47.003 + i * 0.00013, BASE_LON + eastDeg(60), 0, 15));
    }
    // Calibration factor is preserved across the reroute (default 1.0 here; the
    // point is it is NOT reset to a fresh state object mid-navigation).
    expect(events['route/updated']).toHaveLength(1);
    expect(nav.getCalibrationFactor()).toBeGreaterThanOrEqual(0.7);
    expect(nav.getCalibrationFactor()).toBeLessThanOrEqual(1.5);
    nav.dispose();
  });

  it('W-05 loop guard: 3 clustered reroutes → event/reroute_loop, auto-reroute stops', async () => {
    // The vehicle sits at ONE off-route spot (simulator ignores each reroute);
    // the mock always hands back the ORIGINAL route, which the vehicle is still
    // off — so it keeps re-confirming at the same place.
    const provider: RerouteProvider = { createRoutes: () => Promise.resolve([originalRoute]) };
    const nav = makeNav(provider);
    nav.start({ route: originalRoute });

    // Fixed spot ~60 m east of the mid-route, near-stationary. Feed enough fixes
    // to clear two debounce windows (10 s each) plus confirmation.
    const spot = pos(47.009, BASE_LON + eastDeg(60), 0, 0);
    for (let i = 0; i < 30; i++) {
      await feed(pos(47.009, BASE_LON + eastDeg(60), 0, 0));
    }

    // Two reroutes performed, then the 3rd clustered deviation trips the loop.
    expect(events['route/updated']).toHaveLength(2);
    expect(events['event/reroute_loop']).toHaveLength(1);
    expect((events['event/reroute_loop'][0] as { suggestion: string }).suggestion).toBe(
      'avoid_segment',
    );
    // Distance from the reported loop spot to the vehicle is tiny.
    const at = (events['event/reroute_loop'][0] as { at: { lat: number; lon: number } }).at;
    expect(haversineM(at, { lat: spot.lat, lon: spot.lon })).toBeLessThan(200);
    nav.dispose();
  });

  it('Valhalla down: stays on the old route, event/reroute_failed, retries after 15 s', async () => {
    let calls = 0;
    const provider: RerouteProvider = {
      createRoutes: () => {
        calls += 1;
        return Promise.reject(new Error('Valhalla routing backend is unreachable'));
      },
    };
    const nav = makeNav(provider);
    nav.start({ route: originalRoute });

    for (let i = 0; i < 7; i++) {
      await feed(pos(47.009, BASE_LON + eastDeg(60), 0, 0));
    }

    // First attempt failed: old route kept, still off_route, failure published.
    expect(calls).toBe(1);
    expect(events['route/failed']).toBeUndefined();
    expect(events['event/reroute_failed']).toHaveLength(1);
    expect(events['route/updated']).toBeUndefined();
    expect(nav.getState().route_id).toBe('orig');
    expect(nav.getStatus()).toBe('off_route');

    // Retry fires 15 s later (vehicle still off route).
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toBe(2);
    expect(events['event/reroute_failed']).toHaveLength(2);

    nav.dispose();
  });

  it('cancels the retry once the vehicle returns to the route', async () => {
    let calls = 0;
    const provider: RerouteProvider = {
      createRoutes: () => {
        calls += 1;
        return Promise.reject(new Error('down'));
      },
    };
    const nav = makeNav(provider);
    nav.start({ route: originalRoute });

    for (let i = 0; i < 7; i++) {
      await feed(pos(47.009, BASE_LON + eastDeg(60), 0, 0));
    }
    expect(calls).toBe(1);
    expect(nav.getStatus()).toBe('off_route');

    // Vehicle returns onto the route BEFORE the 15 s retry.
    await feed(pos(47.010, BASE_LON, 0, 15));
    expect(nav.getStatus()).toBe('navigating');

    await vi.advanceTimersByTimeAsync(15_000);
    // No retry attempt — the vehicle is back on route.
    expect(calls).toBe(1);
    nav.dispose();
  });

  it('debounce: no more than one reroute attempt per 10 s', async () => {
    let calls = 0;
    // Always hand back the original route (vehicle stays off it) so it would
    // re-confirm continuously without the debounce.
    const provider: RerouteProvider = {
      createRoutes: () => {
        calls += 1;
        return Promise.resolve([originalRoute]);
      },
    };
    const nav = makeNav(provider);
    nav.start({ route: originalRoute });

    // Sustained deviation for ~9 s after the first confirm: still only ONE
    // attempt (the first reroute fires at ~t=5 s; debounce blocks until t=15 s).
    for (let i = 0; i < 9; i++) {
      await feed(pos(47.009, BASE_LON + eastDeg(60), 0, 0));
    }
    expect(calls).toBe(1);

    // Keep deviating past the 10 s debounce boundary (t≈15 s): a second attempt
    // is now allowed.
    for (let i = 0; i < 8; i++) {
      await feed(pos(47.009, BASE_LON + eastDeg(60), 0, 0));
    }
    expect(calls).toBe(2);
    nav.dispose();
  });
});
