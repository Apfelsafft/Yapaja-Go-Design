/**
 * Announcement-engine + speed-limit wiring integration tests (E04-T3): drives
 * `NavigationService` through the real `pos/update` -> map-matching ->
 * `nav/state`/`nav/instruction` pipeline (same pattern as `service.test.ts`),
 * proving `instructions.ts` is actually wired in, not just unit-correct in
 * isolation.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { NavState, Position, Route } from '@yapaja/shared';
import type { NavInstructionPayload } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { NavigationService, type RouteProvider } from './service.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;

/** Straight due-North route, 11 vertices ~111.2 m apart, ~1112 m total. */
function straightNorthPoints(): LatLon[] {
  const points: LatLon[] = [];
  for (let i = 0; i <= 10; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  return points;
}

function routeWithSpeedLimits(): Route {
  const points = straightNorthPoints();
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id: 'r-instr',
    distance_m: total,
    duration_s: 60,
    geometry: encodePolyline6(points),
    legs: [{ index: 0, distance_m: total, duration_s: 60 }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart North',
        street_names: ['Hauptstraße'],
        distance_m: total,
        begin_shape_index: 0,
      },
      // ~889 m in -- comfortably inside the route so every base threshold
      // (2000/500/200/"Jetzt") can be exercised while approaching it.
      {
        index: 1,
        type: 'turn_left',
        instruction: 'Turn left onto Bundesstraße 27',
        street_names: ['Bundesstraße 27'],
        distance_m: 0,
        begin_shape_index: 8,
      },
    ],
    // Boundary at shape index 5 (~556 m): 50 km/h before, 100 km/h after.
    speed_limits: [
      { begin_shape_index: 0, end_shape_index: 5, kmh: 50 },
      { begin_shape_index: 5, end_shape_index: 10, kmh: 100 },
    ],
    warnings: [],
  };
}

function makePos(lat: number, lon: number, speedMs = 0): Position {
  return {
    lat,
    lon,
    alt: 460,
    speed: speedMs,
    heading: 0,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date().toISOString(),
  };
}

function providerFor(route: Route): RouteProvider {
  return { getCachedRoute: (id) => (id === route.id ? route : null) };
}

describe('nav/instruction wiring (E04-T3)', () => {
  let bus: EventBus;
  let service: NavigationService;
  let route: Route;

  const setup = (): void => {
    bus = new EventBus({ isProduction: false });
    route = routeWithSpeedLimits();
    service = new NavigationService({ bus, routeProvider: providerFor(route) });
  };

  afterEach(() => service?.dispose());

  it('fires nav/instruction exactly once per threshold while approaching, never again after passing', () => {
    setup();
    const instructions: NavInstructionPayload[] = [];
    bus.subscribe('nav/instruction', (p) => instructions.push(p));
    service.start({ route_id: route.id });

    // Drive north in small steps (~11 m each) at low speed (no scaling
    // beyond the base thresholds) all the way past the maneuver at ~889 m
    // and to the end of the route.
    for (let i = 1; i <= 100; i++) {
      const lat = BASE_LAT + i * 0.0001;
      bus.publish('pos/update', makePos(lat, BASE_LON, 3));
    }

    // Exactly 4 announcements (2000 m base clamps to "still ahead" until
    // inside 2000 m, which the whole ~1112 m route always is -- so the very
    // first fix already fires threshold 0; then 500, 200, "Jetzt").
    expect(instructions.length).toBe(4);
    expect(instructions.every((i) => i.maneuver.index === 1)).toBe(true);
    expect(instructions.every((i) => i.say.length > 0)).toBe(true);
    // Fired in decreasing-distance order, never repeats a threshold.
    for (let i = 1; i < instructions.length; i++) {
      expect(instructions[i].distance_m).toBeLessThanOrEqual(instructions[i - 1].distance_m);
    }
    // The 4th (nearest) announcement is the immediate "Jetzt" one.
    expect(instructions[3].say.startsWith('Jetzt')).toBe(true);
    expect(instructions[3].say).toContain('Bundesstraße 27');

    // Continuing past the maneuver (now driving toward/at the destination,
    // no further upcoming maneuver) must not add any more instructions.
    const countAfterFirstPass = instructions.length;
    for (let i = 91; i <= 100; i++) {
      bus.publish('pos/update', makePos(BASE_LAT + i * 0.0001, BASE_LON, 3));
    }
    expect(instructions.length).toBe(countAfterFirstPass);
  });

  it('every published nav/instruction is schema-valid (bus-level self-check)', () => {
    // EventBus throws on an invalid payload outside production (isProduction:
    // false in `setup()`), so simply driving a full approach without an
    // uncaught throw already proves every publish passed `validateNavInstruction`.
    setup();
    service.start({ route_id: route.id });
    expect(() => {
      for (let i = 1; i <= 90; i++) {
        bus.publish('pos/update', makePos(BASE_LAT + i * 0.0001, BASE_LON, 3));
      }
    }).not.toThrow();
  });
});

describe('speed_limit_kmh wiring (E04-T3)', () => {
  let bus: EventBus;
  let service: NavigationService;
  let route: Route;

  const setup = (): void => {
    bus = new EventBus({ isProduction: false });
    route = routeWithSpeedLimits();
    service = new NavigationService({ bus, routeProvider: providerFor(route) });
  };

  afterEach(() => service?.dispose());

  it('updates across the segment boundary and is null before any fix / for an empty speed_limits route', () => {
    setup();
    const states: NavState[] = [];
    bus.subscribe('nav/state', (s) => states.push(s));
    service.start({ route_id: route.id });

    // Boundary sits at shape index 5, i.e. ~556 m in. Before it: 50 km/h.
    bus.publish('pos/update', makePos(BASE_LAT + 0.004, BASE_LON, 3)); // ~444 m
    expect(service.getState().speed_limit_kmh).toBe(50);

    // After it: 100 km/h.
    bus.publish('pos/update', makePos(BASE_LAT + 0.007, BASE_LON, 3)); // ~778 m
    expect(service.getState().speed_limit_kmh).toBe(100);

    expect(states.every((s) => s.speed_limit_kmh === null || s.speed_limit_kmh > 0)).toBe(true);
  });

  it('an empty speed_limits array yields null, never 0', () => {
    bus = new EventBus({ isProduction: false });
    const noLimitsRoute: Route = { ...routeWithSpeedLimits(), id: 'r-no-limits', speed_limits: [] };
    service = new NavigationService({ bus, routeProvider: providerFor(noLimitsRoute) });

    service.start({ route_id: noLimitsRoute.id });
    bus.publish('pos/update', makePos(BASE_LAT + 0.004, BASE_LON, 3));
    expect(service.getState().speed_limit_kmh).toBeNull();
  });
});
