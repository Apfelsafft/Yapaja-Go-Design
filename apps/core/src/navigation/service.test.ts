/**
 * NavigationService behaviour tests (E04-T1): control-plane transitions (incl.
 * 409s), arrival-fires-exactly-once, off_route detection, distance_remaining
 * monotonicity (via checkNavState), and W-19 restart recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NavState, Position, Route } from '@yapaja/shared';
import { checkNavState } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import type { ArrivedPayload, NavRecoveredRoutePayload } from '../bus/index.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { NavigationService, type RouteProvider } from './service.js';
import { InMemoryNavRecoveryStore } from './recoveryStore.js';
import { isNavigationError } from './errors.js';
import { haversineM, toRadians, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;
const EARTH_RADIUS_M = 6371000;
const M_PER_DEG_LON = toRadians(1) * Math.cos(toRadians(BASE_LAT)) * EARTH_RADIUS_M;

/** Straight due-North route, 11 vertices, ~1112 m long. */
function straightNorthPoints(): LatLon[] {
  const points: LatLon[] = [];
  for (let i = 0; i <= 10; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return points;
}

function routeFromPoints(points: LatLon[], id = 'r1'): Route {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id,
    distance_m: total,
    duration_s: 60,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: 60 }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart North',
        street_names: ['Test St'],
        distance_m: total,
        begin_shape_index: 0,
      },
      {
        index: 1,
        type: 'turn_left',
        instruction: 'Turn left',
        street_names: ['Second St'],
        distance_m: 0,
        begin_shape_index: 8,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

function makePos(lat: number, lon: number, headingDeg = 0, speedMs = 15): Position {
  return {
    lat,
    lon,
    alt: 460,
    speed: speedMs,
    heading: headingDeg,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

function providerFor(route: Route): RouteProvider {
  return { getCachedRoute: (id) => (id === route.id ? route : null) };
}

describe('NavigationService control plane', () => {
  let bus: EventBus;
  let service: NavigationService;
  let route: Route;

  beforeEach(() => {
    bus = new EventBus({ isProduction: false });
    route = routeFromPoints(straightNorthPoints());
    service = new NavigationService({ bus, routeProvider: providerFor(route) });
  });

  afterEach(() => service.dispose());

  it('start from idle -> navigating; GET state reflects route', () => {
    const state = service.start({ route_id: route.id });
    expect(state.status).toBe('navigating');
    expect(state.route_id).toBe(route.id);
    expect(state.distance_remaining_m).toBeGreaterThan(1000);
    expect(state.destination).not.toBeNull();
    expect(service.getStatus()).toBe('navigating');
  });

  it('rejects invalid transitions with a 409 NavigationError', () => {
    expect(() => service.pause()).toThrowError(/Cannot apply "PAUSE"/);
    try {
      service.resume();
      expect.unreachable();
    } catch (err) {
      expect(isNavigationError(err)).toBe(true);
      if (isNavigationError(err)) expect(err.httpStatus).toBe(409);
    }

    service.start({ route_id: route.id });
    // start again while navigating -> 409
    try {
      service.start({ route_id: route.id });
      expect.unreachable();
    } catch (err) {
      expect(isNavigationError(err) && err.httpStatus).toBe(409);
    }
  });

  it('404 when route_id is not cached', () => {
    try {
      service.start({ route_id: 'does-not-exist' });
      expect.unreachable();
    } catch (err) {
      expect(isNavigationError(err) && err.httpStatus).toBe(404);
    }
  });

  it('pause -> resume -> stop cycle; stop yields idle with null destination', () => {
    service.start({ route_id: route.id });
    expect(service.pause().status).toBe('paused');
    expect(service.resume().status).toBe('navigating');
    const stopped = service.stop();
    expect(stopped.status).toBe('idle');
    expect(stopped.route_id).toBeNull();
    expect(stopped.destination).toBeNull();
    expect(stopped.distance_remaining_m).toBeNull();
  });

  it('publishes nav/state on the bus for each fix and on transitions', () => {
    const states: NavState[] = [];
    bus.subscribe('nav/state', (s) => states.push(s));
    service.start({ route_id: route.id }); // 1 publish
    bus.publish('pos/update', makePos(BASE_LAT + 0.001, BASE_LON)); // 2
    bus.publish('pos/update', makePos(BASE_LAT + 0.002, BASE_LON)); // 3
    expect(states.length).toBe(3);
    expect(states[0].status).toBe('navigating');
    expect(states[2].distance_remaining_m).toBeLessThan(states[0].distance_remaining_m!);
  });
});

describe('NavigationService map-matched navigation', () => {
  let bus: EventBus;
  let service: NavigationService;
  let route: Route;

  beforeEach(() => {
    bus = new EventBus({ isProduction: false });
    route = routeFromPoints(straightNorthPoints());
    service = new NavigationService({ bus, routeProvider: providerFor(route) });
  });

  afterEach(() => service.dispose());

  it('detects off_route (35 m) and returns to navigating when back on route', () => {
    const states: NavState[] = [];
    bus.subscribe('nav/state', (s) => states.push(s));
    service.start({ route_id: route.id });

    bus.publish('pos/update', makePos(BASE_LAT + 0.002, BASE_LON)); // on route
    expect(service.getStatus()).toBe('navigating');

    const off = BASE_LON + 35 / M_PER_DEG_LON;
    bus.publish('pos/update', makePos(BASE_LAT + 0.003, off)); // 35 m off
    expect(service.getStatus()).toBe('off_route');

    bus.publish('pos/update', makePos(BASE_LAT + 0.004, BASE_LON)); // back on route
    expect(service.getStatus()).toBe('navigating');
  });

  it('distance_remaining_m is monotonic (checkNavState) under ±10 m noise', () => {
    const states: NavState[] = [];
    bus.subscribe('nav/state', (s) => states.push(s));
    service.start({ route_id: route.id });

    for (let i = 0; i <= 10; i++) {
      const lat = BASE_LAT + i * 0.0009;
      const noiseLon = BASE_LON + (i % 2 === 0 ? 10 : -10) / M_PER_DEG_LON;
      bus.publish('pos/update', makePos(lat, noiseLon));
    }

    for (let i = 1; i < states.length; i++) {
      const result = checkNavState(states[i], states[i - 1]);
      expect(result.ok, JSON.stringify(result.violations)).toBe(true);
      expect(states[i].distance_remaining_m!).toBeLessThanOrEqual(
        states[i - 1].distance_remaining_m! + 0.001,
      );
    }
  });

  it('exposes next_maneuver ahead of current progress', () => {
    service.start({ route_id: route.id });
    bus.publish('pos/update', makePos(BASE_LAT + 0.002, BASE_LON));
    const state = service.getState();
    // maneuver at shape index 8 is still ahead of ~222 m progress.
    expect(state.next_maneuver?.begin_shape_index).toBe(8);
    expect(state.distance_to_maneuver_m).toBeGreaterThan(0);
  });
});

describe('NavigationService arrival', () => {
  it('fires event/arrived EXACTLY once and transitions to arrived', () => {
    const bus = new EventBus({ isProduction: false });
    const route = routeFromPoints(straightNorthPoints());
    const service = new NavigationService({ bus, routeProvider: providerFor(route) });
    const arrivals: ArrivedPayload[] = [];
    bus.subscribe('event/arrived', (p) => arrivals.push(p));

    service.start({ route_id: route.id });
    // Drive to the destination (last vertex) and keep pushing fixes there.
    for (let i = 6; i <= 10; i++) bus.publish('pos/update', makePos(BASE_LAT + i * 0.001, BASE_LON));
    // Extra fixes at the destination must NOT re-fire arrival.
    bus.publish('pos/update', makePos(BASE_LAT + 0.01, BASE_LON));
    bus.publish('pos/update', makePos(BASE_LAT + 0.01, BASE_LON));

    expect(service.getStatus()).toBe('arrived');
    expect(arrivals.length).toBe(1);
    expect(arrivals[0].route_id).toBe(route.id);
    service.dispose();
  });
});

describe('NavigationService restart recovery (W-19)', () => {
  it('publishes event/nav_recovered_route_available when the route is still cached; stays idle', () => {
    const bus = new EventBus({ isProduction: false });
    const route = routeFromPoints(straightNorthPoints());
    const recovered: NavRecoveredRoutePayload[] = [];
    bus.subscribe('event/nav_recovered_route_available', (p) => recovered.push(p));

    const store = new InMemoryNavRecoveryStore({
      route_id: route.id,
      destination: { latlng: { lat: BASE_LAT + 0.01, lon: BASE_LON }, name: 'Ziel' },
    });
    const service = new NavigationService({
      bus,
      routeProvider: providerFor(route),
      recoveryStore: store,
    });

    expect(recovered.length).toBe(1);
    expect(recovered[0].route_id).toBe(route.id);
    expect(service.getStatus()).toBe('idle'); // no ghost navigation
    service.dispose();
  });

  it('does NOT recover (and clears the stale record) when the route expired', () => {
    const bus = new EventBus({ isProduction: false });
    const recovered: NavRecoveredRoutePayload[] = [];
    bus.subscribe('event/nav_recovered_route_available', (p) => recovered.push(p));

    const emptyProvider: RouteProvider = { getCachedRoute: () => null };
    const store = new InMemoryNavRecoveryStore({ route_id: 'gone', destination: null });
    const service = new NavigationService({ bus, routeProvider: emptyProvider, recoveryStore: store });

    expect(recovered.length).toBe(0);
    expect(store.load()).toBeNull(); // stale record dropped
    expect(service.getStatus()).toBe('idle');
    service.dispose();
  });

  // E04-T5: `getRecoverableRoute()` is the REST-observable counterpart of the
  // startup event above -- the event fires once, synchronously, before any
  // WS client could possibly be subscribed; this getter is what
  // `GET /navigation/state` actually exposes to a reloading tab.
  it('getRecoverableRoute() surfaces the same record while idle with a still-cached route', () => {
    const bus = new EventBus({ isProduction: false });
    const route = routeFromPoints(straightNorthPoints());
    const destination = { latlng: { lat: BASE_LAT + 0.01, lon: BASE_LON }, name: 'Ziel' };
    const store = new InMemoryNavRecoveryStore({ route_id: route.id, destination });
    const service = new NavigationService({ bus, routeProvider: providerFor(route), recoveryStore: store });

    expect(service.getRecoverableRoute()).toEqual({ route_id: route.id, destination });
    service.dispose();
  });

  it('getRecoverableRoute() is null once navigating (nothing to "recover", already live)', () => {
    const bus = new EventBus({ isProduction: false });
    const route = routeFromPoints(straightNorthPoints());
    const destination = { latlng: { lat: BASE_LAT + 0.01, lon: BASE_LON }, name: 'Ziel' };
    const store = new InMemoryNavRecoveryStore({ route_id: route.id, destination });
    const service = new NavigationService({ bus, routeProvider: providerFor(route), recoveryStore: store });

    service.start({ route_id: route.id });
    expect(service.getRecoverableRoute()).toBeNull();
    service.dispose();
  });

  it('getRecoverableRoute() is null with no record and after stop/clear', () => {
    const bus = new EventBus({ isProduction: false });
    const route = routeFromPoints(straightNorthPoints());
    const service = new NavigationService({ bus, routeProvider: providerFor(route) });
    expect(service.getRecoverableRoute()).toBeNull(); // never navigated

    service.start({ route_id: route.id });
    service.stop();
    expect(service.getRecoverableRoute()).toBeNull(); // stop() clears the recovery store
    service.dispose();
  });
});
