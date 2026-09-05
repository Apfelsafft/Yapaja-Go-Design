/**
 * Dead-reckoning lifecycle integration (E04-T6, Wargame W-01), the two
 * mandatory outage scenarios end-to-end:
 *
 *   1. Short outage (~20 s) just before a maneuver: the real
 *      `DeadReckoningController` (E02-T5) + the route-aware
 *      `RouteAwareDeadReckoningProvider` keep publishing `pos/extrapolated`
 *      fixes ALONG the route, so `NavigationService`'s announcement engine
 *      still fires `nav/instruction` at the (shrinking, extrapolated) distance
 *      to the turn — the "announcement comes even in the tunnel" case.
 *   2. Long outage (~45 s): after 30 s with no real fix the navigation goes
 *      `paused` + `event/gps_lost_paused`; when a real fix finally returns
 *      (well beyond where GPS was lost) navigation auto-resumes and the
 *      widened one-shot search window re-matches the far fix.
 *
 * Drives the REAL NavigationService + DeadReckoningController wired together
 * over the bus, exactly as `index.ts` wires them in production. Fake timers
 * throughout — no real sleeps.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NavInstructionPayload, Position, Route, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { NavigationService, type ActiveProfileLookup, type RouteProvider } from './service.js';
import { DeadReckoningController } from '../position/deadReckoning.js';
import { RouteAwareDeadReckoningProvider } from './deadreckoning.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;
const M_PER_DEG_LAT = 111_190; // metres per degree latitude (~constant)

/** A straight due-north route of `count` vertices, 0.001° (~111 m) apart, with
 *  a single `turn_left` maneuver anchored at the LAST vertex (so it stays
 *  "upcoming" for the whole drive and the announcement engine has a target). */
function northRouteWithEndTurn(count: number): Route {
  const points: LatLon[] = [];
  for (let i = 0; i < count; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineM(points[i - 1], points[i]);
  return {
    id: 'dr-route',
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
      {
        index: 1,
        type: 'turn_left',
        instruction: 'Links abbiegen',
        street_names: ['Zielstraße'],
        distance_m: 0,
        begin_shape_index: count - 1,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

function pos(lat: number, speed: number | null): Position {
  return {
    lat,
    lon: BASE_LON,
    alt: null,
    speed,
    heading: 0,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date(Date.now()).toISOString(),
  };
}

/** Latitude that sits `metresFromStart` north of the route start. */
function latAt(metresFromStart: number): number {
  return BASE_LAT + metresFromStart / M_PER_DEG_LAT;
}

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
    dimensions_confirmed_at: null,
  };
  return { getActive: () => profile };
}

describe('E04-T6 dead-reckoning lifecycle (W-01)', () => {
  let bus: EventBus;
  let route: Route;
  let nav: NavigationService;
  let dr: DeadReckoningController;
  let lastRealFix: Position | null;
  let instructions: NavInstructionPayload[];
  let events: Record<string, unknown[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:00:00.000Z'));
    bus = new EventBus({ isProduction: false });
    route = northRouteWithEndTurn(21); // ~2224 m, turn at the end
    lastRealFix = null;
    instructions = [];
    events = {};
    ['event/gps_lost_paused', 'pos/extrapolated', 'nav/state'].forEach((t) => {
      bus.subscribe(t, (p) => {
        (events[t] ??= []).push(p);
      });
    });
    bus.subscribe('nav/instruction', (p) => instructions.push(p as NavInstructionPayload));

    const routeProvider: RouteProvider = {
      getCachedRoute: (id) => (id === route.id ? route : null),
    };
    nav = new NavigationService({ bus, routeProvider, profileProvider: profileProvider() });

    // DeadReckoningController wired exactly like index.ts: it reads the last
    // real fix from a PositionService-shaped source and extrapolates via the
    // route-aware provider (which reads NavigationService's frozen anchor).
    dr = new DeadReckoningController({
      bus,
      service: { getLast: () => lastRealFix } as unknown as ConstructorParameters<
        typeof DeadReckoningController
      >[0]['service'],
      provider: new RouteAwareDeadReckoningProvider(nav),
    });

    nav.start({ route });
  });

  afterEach(() => {
    dr.dispose();
    nav.dispose();
    vi.useRealTimers();
  });

  /** Send a real fix `metresFromStart` along the route at `speed` m/s. */
  function drive(metresFromStart: number, speed: number): void {
    const p = pos(latAt(metresFromStart), speed);
    lastRealFix = p;
    bus.publish('pos/update', p);
  }

  it('scenario 1 (~20 s outage before the turn): the turn announcement still fires at the extrapolated distance', () => {
    // Approach the end turn with a stable 15 m/s, stopping ~260 m short.
    drive(1900, 15);
    vi.advanceTimersByTime(1000);
    drive(1915, 15);
    vi.advanceTimersByTime(1000);
    drive(1930, 15); // ~294 m before the turn (route ~2224 m)

    const instructionsBeforeLoss = instructions.length;

    // GPS drops out.
    bus.publish('event/gps_lost', undefined);

    // 20 s of extrapolation at 1 Hz — well under the 30 s pause cutoff.
    vi.advanceTimersByTime(20_000);

    // Extrapolated fixes were produced (the puck kept moving)...
    expect((events['pos/extrapolated'] ?? []).length).toBeGreaterThan(0);
    // ...navigation never paused (still within the 30 s window)...
    expect(nav.getStatus()).toBe('navigating');
    // ...and the announcement engine fired the turn announcement DURING the
    // outage, at a distance that reflects the extrapolated (shrunk) approach.
    const newInstructions = instructions.slice(instructionsBeforeLoss);
    expect(newInstructions.length).toBeGreaterThan(0);
    const turnAnnouncement = newInstructions.find((i) => i.maneuver.type === 'turn_left');
    expect(turnAnnouncement).toBeDefined();
    // Distance to the turn at announcement time is well below the pre-loss
    // ~294 m (the extrapolation walked the vehicle toward the turn).
    expect(turnAnnouncement!.distance_m).toBeLessThan(294);
  });

  it('scenario 2 (~45 s outage): pauses at 30 s, then auto-resumes with a widened re-match on GPS return', () => {
    drive(1500, 15);
    vi.advanceTimersByTime(1000);
    drive(1515, 15);

    bus.publish('event/gps_lost', undefined);

    // 30 s with no real fix -> paused + event.
    vi.advanceTimersByTime(30_000);
    expect(nav.getStatus()).toBe('paused');
    expect((events['event/gps_lost_paused'] ?? []).length).toBe(1);

    // 15 more seconds pass, then GPS returns — the vehicle is now WELL beyond
    // where it was lost (a real 460 m jump, past the normal ±match window),
    // which only re-matches thanks to the one-shot widened search window.
    vi.advanceTimersByTime(15_000);
    drive(1975, 15);

    expect(nav.getStatus()).toBe('navigating');
    // The far fix was accepted: progress advanced beyond the ~1515 m loss point.
    const states = events['nav/state'] as Array<{ distance_remaining_m: number | null }>;
    const last = states[states.length - 1];
    expect(last.distance_remaining_m).not.toBeNull();
    // ~2224 m total − ~1975 m progress ≈ 249 m remaining (well under the
    // ~709 m that was remaining at the loss point).
    expect(last.distance_remaining_m!).toBeLessThan(400);
  });
});
