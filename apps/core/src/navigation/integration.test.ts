/**
 * Simulator integration (E04-T1 acceptance #1): drive the GPS simulator along
 * an LI-style route with `noise_m: 10` through the SAME PositionService bus the
 * production wiring uses, and assert the NavigationService keeps progress
 * monotonic, stays on_route, and fires arrival at the end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/** ~2.2 km straight-ish LI route (21 vertices ≈ 111 m apart). */
function routePoints(): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i <= 20; i++) pts.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return pts;
}

function buildRoute(points: LatLon[]): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id: 'li-route',
    distance_m: total,
    duration_s: total / 15,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: total / 15 }],
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

describe('NavigationService + GPS simulator integration', () => {
  let bus: EventBus;
  let positionService: PositionService;
  let simulator: SimulatorSource;
  let navigation: NavigationService;
  let route: Route;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new EventBus({ isProduction: false });
    positionService = new PositionService({ bus, checkIntervalMs: 100, rateHz: 1 });
    simulator = new SimulatorSource(positionService);
    positionService.registerSource(simulator);
    const points = routePoints();
    route = buildRoute(points);
    const provider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
    navigation = new NavigationService({ bus, routeProvider: provider });
  });

  afterEach(() => {
    navigation.dispose();
    simulator.dispose();
    positionService.dispose();
    vi.useRealTimers();
  });

  it('drives the route: progress monotonic, on_route stable, arrives (noise_m: 10)', () => {
    const states: NavState[] = [];
    // E04-T2: `eta` is now a real (non-null) UTC timestamp, and checkNavState's
    // "eta never in the past" rule is time-sensitive -- record each state
    // alongside the (fake-clock) wall time it was published at, so replaying
    // the check below compares each `eta` against the clock AS IT STOOD at
    // that publish, not the much-later time this loop runs at.
    const publishedAtMs: number[] = [];
    bus.subscribe('nav/state', (s) => {
      states.push(s);
      publishedAtMs.push(Date.now());
    });

    navigation.start({ route_id: route.id });

    // The simulator emits one fix per simulated second; at 15 m/s the ~2.2 km
    // route is ~148 s. Play with 10 m Gaussian noise (seeded => deterministic).
    simulator.play({
      track: { polyline6: encodePolyline6(decodePolyline6(route.geometry)), speedMs: 15 },
      mutations: { noise_m: 10, seed: 7 },
    });
    vi.advanceTimersByTime(200_000); // 200 s of wall/sim time at speed_factor 1

    // Monotonic distance_remaining within the checkNavState invariant.
    for (let i = 1; i < states.length; i++) {
      const result = checkNavState(states[i], states[i - 1], new Date(publishedAtMs[i]));
      expect(result.ok, JSON.stringify(result.violations)).toBe(true);
    }

    // on_route stable: the overwhelming majority of matched fixes are on-route.
    const matched = states.filter((s) => s.status === 'navigating' || s.status === 'off_route');
    const onRoute = matched.filter((s) => s.status === 'navigating').length;
    expect(matched.length).toBeGreaterThan(50);
    expect(onRoute / matched.length).toBeGreaterThan(0.85);

    // Arrival reached exactly once by the end.
    expect(navigation.getStatus()).toBe('arrived');
    expect(states.filter((s) => s.status === 'arrived').length).toBe(1);
  });
});
