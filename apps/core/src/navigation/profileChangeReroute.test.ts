/**
 * Profile-change-during-navigation reroute coupling (E06-T3, tasks/E06-fahrzeugprofile.md).
 *
 * Same harness/style as `rerouteIntegration.test.ts` (E04-T4): drives the
 * real `NavigationService` via the bus with a MOCKED reroute provider
 * standing in for `RoutingService.createRoutes`. `event/profile_changed` is
 * published directly (mirroring exactly what `ProfileService#activate` ->
 * `onProfileChanged` -> `buildServer`'s bus wiring does in production --
 * see `apps/core/src/index.ts`), paired with a mutable "active profile"
 * pointer the mock `ActiveProfileLookup` reads, so the test never needs a
 * real `ProfileService`/SQLite.
 *
 * Covers the three mandatory paths (docs/07 §5 Flow 5's core-side half):
 *  (a) a UI client is connected -> confirmation banner event -> "Ja" reroutes
 *      with `reason: 'profile_change'`;
 *  (b) "Abbrechen" (== reactivating the previous profile) -> no reroute, the
 *      exact prior state stays untouched;
 *  (c) headless (no client connected) -> auto-reroutes immediately, no
 *      confirmation event at all;
 * plus the docs/03 §2 >15%-longer warning banner input and the docs/07 §3b
 * monotonicity log (both live in `route/updated`'s payload / the logger).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Position, Route, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import {
  NavigationService,
  type ActiveProfileLookup,
  type ClientPresence,
  type NavigationServiceLogger,
  type RerouteProvider,
  type RouteProvider,
} from './service.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { haversineM, type LatLon } from './geo.js';

const BASE_LAT = 47.0;
const BASE_LON = 9.5;

function straightNorthPoints(startLat: number, lon: number, count: number, stepDeg = 0.001): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i < count; i++) pts.push({ lat: startLat + i * stepDeg, lon });
  return pts;
}

function makeRoute(points: LatLon[], id: string): Route {
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

function pos(lat: number, lon: number): Position {
  return {
    lat,
    lon,
    alt: null,
    speed: 15,
    heading: 0,
    accuracy: 5,
    source: 'simulator',
    fix: '3d',
    ts: new Date(Date.now()).toISOString(),
  };
}

const AVOID_NONE = { motorway: false, toll: false, ferry: false, unpaved: false };

const PROFILE_A: VehicleProfile = {
  id: 'pA',
  name: 'Camper',
  height_m: 2.5,
  width_m: 2.1,
  length_m: 6.0,
  weight_t: 3.0,
  avg_speed_kmh: 85,
  hazmat: false,
  avoid: AVOID_NONE,
  is_active: true,
};

// Dominates PROFILE_A in every dimension (E06-T3 "switch to a LARGER/heavier
// vehicle" case).
const PROFILE_B_LARGER: VehicleProfile = {
  id: 'pB',
  name: "Alkoven 7,5 t",
  height_m: 3.2,
  width_m: 2.4,
  length_m: 7.5,
  weight_t: 7.5,
  avg_speed_kmh: 80,
  hazmat: false,
  avoid: AVOID_NONE,
  is_active: false,
};

describe('E06-T3 profile-change-during-navigation reroute coupling', () => {
  let bus: EventBus;
  let originalRoute: Route;
  let events: Record<string, unknown[]>;
  let profiles: Record<string, VehicleProfile>;
  let activeProfileId: string;

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
    [
      'route/updated',
      'event/profile_change_pending',
      'event/reroute_failed',
    ].forEach(capture);
    originalRoute = makeRoute(straightNorthPoints(BASE_LAT, BASE_LON, 19), 'orig');
    profiles = { pA: { ...PROFILE_A }, pB: { ...PROFILE_B_LARGER } };
    activeProfileId = 'pA';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function routeProvider(): RouteProvider {
    return { getCachedRoute: (id) => (id === originalRoute.id ? originalRoute : null) };
  }

  function profileProvider(): ActiveProfileLookup {
    return {
      getActive: () => profiles[activeProfileId] ?? null,
      getById: (id) => profiles[id] ?? null,
    };
  }

  /** Mirrors `ProfileService#activate` -> `onProfileChanged` -> `event/profile_changed`
   *  (see `apps/core/src/index.ts`'s wiring) without needing a real ProfileService. */
  function activateProfile(id: string): void {
    activeProfileId = id;
    const profile = profiles[id];
    bus.publish('event/profile_changed', { id, name: profile.name });
  }

  function makeNav(
    provider: RerouteProvider,
    clientPresence: ClientPresence,
    logger?: NavigationServiceLogger,
  ): NavigationService {
    return new NavigationService({
      bus,
      routeProvider: routeProvider(),
      rerouteProvider: provider,
      profileProvider: profileProvider(),
      clientPresence,
      ...(logger ? { logger } : {}),
    });
  }

  async function feed(p: Position): Promise<void> {
    bus.publish('pos/update', p);
    await vi.advanceTimersByTimeAsync(1000);
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(10);
  }

  it('(a) client connected: shows a confirmation event, then "Ja" reroutes with reason profile_change', async () => {
    const newRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-confirmed');
    const createRoutes = vi.fn(() => Promise.resolve([newRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => true });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    expect(nav.getStatus()).toBe('navigating');

    activateProfile('pB');

    // No reroute yet -- awaiting confirmation.
    expect(createRoutes).not.toHaveBeenCalled();
    expect(events['route/updated']).toBeUndefined();
    expect(events['event/profile_change_pending']).toEqual([
      {
        profile_id: 'pB',
        profile_name: 'Alkoven 7,5 t',
        previous_profile_id: 'pA',
        previous_profile_name: 'Camper',
      },
    ]);
    expect(nav.getPendingProfileChange()).toEqual(events['event/profile_change_pending'][0]);

    // "Ja": returns the CURRENT (not-yet-rerouted) state synchronously...
    const immediateState = nav.confirmProfileChange();
    expect(immediateState.route_id).toBe(originalRoute.id);
    expect(nav.getPendingProfileChange()).toBeNull();

    // ...the actual route swap lands asynchronously.
    await flush();
    expect(createRoutes).toHaveBeenCalledTimes(1);
    expect(events['route/updated']).toEqual([{ reason: 'profile_change', route_id: 'reroute-confirmed' }]);
    expect(nav.getState().route_id).toBe('reroute-confirmed');
    expect(nav.getStatus()).toBe('navigating');

    nav.dispose();
  });

  it('(b) "Abbrechen" (reactivating the previous profile): no reroute, exact prior state', async () => {
    const createRoutes = vi.fn(() => Promise.resolve([originalRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => true });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    const stateBefore = nav.getState();

    activateProfile('pB');
    expect(nav.getPendingProfileChange()).not.toBeNull();

    // Abbrechen: the UI reactivates the PREVIOUS profile (same REST call as
    // any other activation) -- `activeRouteProfileId` already equals 'pA', so
    // this must be a complete no-op for the navigation.
    activateProfile('pA');

    expect(nav.getPendingProfileChange()).toBeNull();
    expect(createRoutes).not.toHaveBeenCalled();
    expect(events['route/updated']).toBeUndefined();
    expect(events['event/profile_change_pending']).toHaveLength(1); // only the first (pending) one
    expect(nav.getState()).toEqual(stateBefore);
    expect(nav.getStatus()).toBe('navigating');

    nav.dispose();
  });

  it('(c) headless (no client connected): auto-reroutes immediately, no confirmation event', async () => {
    const newRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-headless');
    const createRoutes = vi.fn(() => Promise.resolve([newRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => false });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));

    activateProfile('pB');
    await flush();

    expect(events['event/profile_change_pending']).toBeUndefined();
    expect(nav.getPendingProfileChange()).toBeNull();
    expect(createRoutes).toHaveBeenCalledTimes(1);
    expect(events['route/updated']).toEqual([{ reason: 'profile_change', route_id: 'reroute-headless' }]);
    expect(nav.getState().route_id).toBe('reroute-headless');

    nav.dispose();
  });

  it('reactivating the SAME profile is a no-op even headless (no spurious reroute)', async () => {
    const createRoutes = vi.fn(() => Promise.resolve([originalRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => false });
    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));

    activateProfile('pA'); // already active -- id equals activeRouteProfileId
    await flush();

    expect(createRoutes).not.toHaveBeenCalled();
    expect(events['route/updated']).toBeUndefined();
    nav.dispose();
  });

  it('not navigating (idle): a profile change is not coupled to anything', () => {
    const createRoutes = vi.fn(() => Promise.resolve([originalRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => true });

    activateProfile('pB');

    expect(events['event/profile_change_pending']).toBeUndefined();
    expect(createRoutes).not.toHaveBeenCalled();
    expect(nav.getPendingProfileChange()).toBeNull();
    nav.dispose();
  });

  it('applies while paused, not only while navigating (docs/03 §2 "navigating|paused")', async () => {
    const newRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-paused');
    const createRoutes = vi.fn(() => Promise.resolve([newRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => false });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    nav.pause();
    expect(nav.getStatus()).toBe('paused');

    activateProfile('pB');
    await flush();

    expect(events['route/updated']).toEqual([{ reason: 'profile_change', route_id: 'reroute-paused' }]);
    // A reroute landing mid-pause must not itself resume navigation.
    expect(nav.getStatus()).toBe('paused');

    nav.dispose();
  });

  it('no position fix yet: skipped gracefully (logged), never throws/crashes', async () => {
    const createRoutes = vi.fn(() => Promise.resolve([originalRoute]));
    const warn = vi.fn();
    const nav = makeNav(
      { createRoutes },
      { hasConnectedClients: () => false },
      { info: vi.fn(), warn, error: vi.fn() },
    );

    nav.start({ route: originalRoute }); // no `feed()` -- no fix received yet
    expect(() => activateProfile('pB')).not.toThrow();
    await flush();

    expect(createRoutes).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no position fix'));
    nav.dispose();
  });

  it('docs/03 §2: route/updated carries duration_warning_pct when the new route is >15% longer', async () => {
    const longerRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-longer');
    longerRoute.duration_s = originalRoute.duration_s * 1.3; // +30%
    const createRoutes = vi.fn(() => Promise.resolve([longerRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => false });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    activateProfile('pB');
    await flush();

    const updated = events['route/updated'][0] as {
      reason: string;
      route_id: string;
      duration_warning_pct?: number;
    };
    expect(updated.duration_warning_pct).toBe(30);
    nav.dispose();
  });

  it('no warning banner input when the new route is within 15% of the old duration', async () => {
    const closeRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-close');
    closeRoute.duration_s = originalRoute.duration_s * 1.1; // +10%, under the 15% threshold
    const createRoutes = vi.fn(() => Promise.resolve([closeRoute]));
    const nav = makeNav({ createRoutes }, { hasConnectedClients: () => false });

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    activateProfile('pB');
    await flush();

    const updated = events['route/updated'][0] as { duration_warning_pct?: number };
    expect(updated.duration_warning_pct).toBeUndefined();
    nav.dispose();
  });

  it('docs/07 §3b: switching to a LARGER/heavier profile that yields a SHORTER-duration route logs a warning (not a hard failure)', async () => {
    const shorterRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-mono');
    shorterRoute.duration_s = 5; // deliberately implausibly short vs. the original
    const createRoutes = vi.fn(() => Promise.resolve([shorterRoute]));
    const warn = vi.fn();
    const nav = makeNav(
      { createRoutes },
      { hasConnectedClients: () => false },
      { info: vi.fn(), warn, error: vi.fn() },
    );

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    activateProfile('pB'); // pB dominates pA in every dimension
    await flush();

    // The reroute is NOT blocked -- it still lands.
    expect(events['route/updated']).toEqual([{ reason: 'profile_change', route_id: 'reroute-mono' }]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('monotonicity'),
      expect.objectContaining({ old_profile_id: 'pA', new_profile_id: 'pB' }),
    );
    nav.dispose();
  });

  it('no monotonicity warning for an AMBIGUOUS switch (not a strict dominance)', async () => {
    // Taller but LIGHTER than pA -- not a "larger/heavier vehicle" per the
    // strict-dominance rule, so a shorter duration must NOT be flagged.
    profiles.pB = { ...PROFILE_B_LARGER, weight_t: 1.0 };
    const shorterRoute = makeRoute(straightNorthPoints(47.01, BASE_LON, 10), 'reroute-ambiguous');
    shorterRoute.duration_s = 5;
    const createRoutes = vi.fn(() => Promise.resolve([shorterRoute]));
    const warn = vi.fn();
    const nav = makeNav(
      { createRoutes },
      { hasConnectedClients: () => false },
      { info: vi.fn(), warn, error: vi.fn() },
    );

    nav.start({ route: originalRoute });
    await feed(pos(BASE_LAT + 0.001, BASE_LON));
    activateProfile('pB');
    await flush();

    expect(events['route/updated']).toEqual([{ reason: 'profile_change', route_id: 'reroute-ambiguous' }]);
    expect(warn).not.toHaveBeenCalled();
    nav.dispose();
  });
});
