/**
 * HTTP integration tests for the navigation plugin via Fastify inject.
 * Focus: happy-path control endpoints and the 409/404/400 error mapping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LatLng, Route, RouteRequest, SearchResult, VehicleProfile } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { RoutingError } from '../routing/errors.js';
import { navigationPlugin, type DestinationSearchProvider } from './routes.js';
import type { ActiveProfileLookup, RerouteProvider, RouteProvider } from './service.js';
import { InMemoryNavRecoveryStore } from './recoveryStore.js';

function makeRoute(id = 'r1'): Route {
  const geometry = encodePolyline6([
    { lat: 47.0, lon: 9.5 },
    { lat: 47.005, lon: 9.5 },
    { lat: 47.01, lon: 9.5 },
  ]);
  return {
    id,
    distance_m: 1112,
    duration_s: 80,
    geometry,
    legs: [{ index: 0, distance_m: 1112, duration_s: 80 }],
    maneuvers: [
      {
        index: 0,
        type: 'continue',
        instruction: 'Depart',
        street_names: [],
        distance_m: 1112,
        begin_shape_index: 0,
      },
    ],
    speed_limits: [],
    warnings: [],
  };
}

async function buildTestServer(route: Route): Promise<FastifyInstance> {
  const fastify = Fastify();
  const bus = new EventBus({ isProduction: false });
  const routeProvider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
  await fastify.register(navigationPlugin, { prefix: '/api/v1', bus, routeProvider });
  await fastify.ready();
  return fastify;
}

describe('navigation REST plugin', () => {
  let fastify: FastifyInstance;
  const route = makeRoute();

  beforeEach(async () => {
    fastify = await buildTestServer(route);
  });
  afterEach(async () => {
    await fastify.close();
  });

  it('GET /navigation/state starts idle', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('idle');
  });

  it('POST /navigation/start {route_id} -> 200 navigating', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: { route_id: route.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('navigating');
    expect(res.json().data.route_id).toBe(route.id);
  });

  it('start with unknown route_id -> 404', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: { route_id: 'nope' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('start without route_id or route -> 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('pause before start -> 409 INVALID_TRANSITION', async () => {
    const res = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/pause' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('full control cycle start -> pause -> resume -> stop', async () => {
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: { route_id: route.id },
    });
    const pause = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/pause' });
    expect(pause.json().data.status).toBe('paused');
    const resume = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/resume' });
    expect(resume.json().data.status).toBe('navigating');
    const stop = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/stop' });
    expect(stop.json().data.status).toBe('idle');

    // resume after stop -> 409
    const badResume = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/resume' });
    expect(badResume.statusCode).toBe(409);
  });

  it('accepts a full route object in the start body', async () => {
    const other = makeRoute('inline-1');
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: { route: other, destination: { latlng: { lat: 47.01, lon: 9.5 }, name: 'X' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.route_id).toBe('inline-1');
    expect(res.json().data.destination.name).toBe('X');
  });

  it('POST /navigation/start rejects a malformed "reroute" with 400', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: { route_id: route.id, reroute: { avoid_overrides: { motorway: 'yes' } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /navigation/start accepts a well-formed "reroute" context', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: {
        route_id: route.id,
        reroute: {
          waypoints: [{ lat: 47.006, lon: 9.5 }],
          exclude_polygons: [
            [
              { lat: 47.001, lon: 9.501 },
              { lat: 47.001, lon: 9.502 },
              { lat: 47.002, lon: 9.502 },
            ],
          ],
          avoid_overrides: { motorway: true, toll: false },
          profile_id: 'p1',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('navigating');
  });
});

/**
 * E04-T5: proves the `reroute` field POSTed to `/navigation/start` actually
 * threads through to a later auto-reroute (E04-T4) -- i.e. the frontend's
 * avoid-chip/temp-avoidance/waypoint state, once wired through the HTTP
 * layer, is what a reroute request ends up carrying. Mirrors
 * `rerouteIntegration.test.ts`'s fake-timer "5 s / 5-fix confirmed deviation"
 * pattern, but drives it through the REST endpoint instead of calling
 * `NavigationService` directly, so the `parseReroute` HTTP parsing itself is
 * exercised too.
 */
describe('navigation REST plugin — reroute context reproduces avoidances (E04-T5)', () => {
  const BASE_LAT = 48.0;
  const BASE_LON = 11.0;

  function straightNorthRoute(id: string): Route {
    const points: LatLng[] = [];
    for (let i = 0; i <= 15; i++) points.push({ lat: BASE_LAT + i * 0.001, lon: BASE_LON });
    return {
      id,
      distance_m: 1665,
      duration_s: 120,
      geometry: encodePolyline6(points),
      legs: [{ index: 0, distance_m: 1665, duration_s: 120 }],
      maneuvers: [
        { index: 0, type: 'continue', instruction: 'Depart', street_names: [], distance_m: 1665, begin_shape_index: 0 },
      ],
      speed_limits: [],
      warnings: [],
    };
  }

  function fixPayload(lat: number, lon: number, heading: number, speed: number): Record<string, unknown> {
    return { lat, lon, alt: null, speed, heading, accuracy: 5, fix: '3d', ts: new Date().toISOString() };
  }

  it('avoid_overrides / exclude_polygons / waypoints / profile_id from the start body reach the reroute RouteRequest', async () => {
    const originalRoute = straightNorthRoute('orig');
    const forwardRoute = straightNorthRoute('reroute-1');
    const captured: RouteRequest[] = [];
    const rerouteProvider: RerouteProvider = {
      createRoutes: (req) => {
        captured.push(req);
        return Promise.resolve([forwardRoute]);
      },
    };
    const routeProvider: RouteProvider = {
      getCachedRoute: (id) => (id === originalRoute.id ? originalRoute : null),
    };

    const fastify = Fastify();
    const bus = new EventBus({ isProduction: false });
    await fastify.register(navigationPlugin, {
      prefix: '/api/v1',
      bus,
      routeProvider,
      rerouteProvider,
    });
    // `fastify.ready()`/the first `inject()` must happen with REAL timers --
    // Fastify's own async plumbing (setImmediate etc.) hangs forever under
    // `vi.useFakeTimers()`, so fake time is enabled ONLY around the
    // time-gated feed loop below (the 5 s/5-fix deviation-confirmation
    // window), never around any Fastify call.
    await fastify.ready();

    const tempAvoidancePolygon: LatLng[] = [
      { lat: BASE_LAT + 0.0005, lon: BASE_LON + 0.0005 },
      { lat: BASE_LAT + 0.0005, lon: BASE_LON + 0.0006 },
      { lat: BASE_LAT + 0.0006, lon: BASE_LON + 0.0006 },
    ];
    const startRes = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/start',
      payload: {
        route: originalRoute,
        reroute: {
          waypoints: [{ lat: BASE_LAT + 0.012, lon: BASE_LON }],
          exclude_polygons: [tempAvoidancePolygon],
          avoid_overrides: { motorway: true, ferry: true },
          profile_id: 'camper-1',
        },
      },
    });
    expect(startRes.statusCode).toBe(200);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:00:00.000Z'));
    try {
      // Two on-route fixes, then a confirmed detour (5 s / 5 fixes) ~60 m east.
      const eastOffsetDeg = 60 / (111_320 * Math.cos((BASE_LAT * Math.PI) / 180));
      const feed = async (lat: number, lon: number, heading: number): Promise<void> => {
        bus.publish('pos/update', { ...fixPayload(lat, lon, heading, 15), source: 'simulator' });
        await vi.advanceTimersByTimeAsync(1000);
      };
      await feed(BASE_LAT + 0.001, BASE_LON, 0);
      await feed(BASE_LAT + 0.002, BASE_LON, 0);
      for (let i = 0; i < 7; i++) {
        await feed(BASE_LAT + 0.003, BASE_LON + eastOffsetDeg, 45);
      }
    } finally {
      vi.useRealTimers();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0].profile_id).toBe('camper-1');
    expect(captured[0].waypoints).toEqual([{ lat: BASE_LAT + 0.012, lon: BASE_LON }]);
    expect(captured[0].exclude_polygons).toEqual([tempAvoidancePolygon]);
    expect(captured[0].avoid_overrides).toEqual({ motorway: true, ferry: true });

    await fastify.close();
  });
});

/**
 * E04-T5: `POST /navigation/destination` integration -- `latlng`/`query`
 * resolution, profile resolution, route computation via the shared
 * `rerouteProvider` seam, `autostart`, and every clear-error path.
 */
describe('navigation REST plugin — POST /navigation/destination (E04-T5)', () => {
  const DEST_LATLNG: LatLng = { lat: 47.02, lon: 9.51 };

  function computedRoute(id = 'dest-route-1'): Route {
    const geometry = encodePolyline6([
      { lat: 47.0, lon: 9.5 },
      { lat: 47.02, lon: 9.51 },
    ]);
    return {
      id,
      distance_m: 2500,
      duration_s: 200,
      geometry,
      legs: [{ index: 0, distance_m: 2500, duration_s: 200 }],
      maneuvers: [
        { index: 0, type: 'continue', instruction: 'Depart', street_names: [], distance_m: 2500, begin_shape_index: 0 },
      ],
      speed_limits: [],
      warnings: [],
    };
  }

  function makeProfile(id = 'p1'): VehicleProfile {
    return {
      id,
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
  }

  function searchResult(name = 'Vaduz'): SearchResult {
    return { name, label: `${name}, Liechtenstein`, latlng: DEST_LATLNG, type: 'city', source: 'photon' };
  }

  interface ServerOpts {
    route?: Route;
    rerouteProvider?: RerouteProvider | null;
    profileProvider?: ActiveProfileLookup | null;
    searchProvider?: DestinationSearchProvider | null;
  }

  async function buildDestinationServer(opts: ServerOpts = {}): Promise<{
    fastify: FastifyInstance;
    createRoutesCalls: RouteRequest[];
  }> {
    const route = opts.route ?? computedRoute();
    const createRoutesCalls: RouteRequest[] = [];
    const rerouteProvider: RerouteProvider | undefined =
      opts.rerouteProvider === null
        ? undefined
        : (opts.rerouteProvider ?? {
            createRoutes: (req) => {
              createRoutesCalls.push(req);
              return Promise.resolve([route]);
            },
          });
    const profileProvider: ActiveProfileLookup | undefined =
      opts.profileProvider === null ? undefined : (opts.profileProvider ?? { getActive: () => makeProfile() });
    const searchProvider: DestinationSearchProvider | undefined =
      opts.searchProvider === null
        ? undefined
        : (opts.searchProvider ?? { search: () => Promise.resolve([searchResult()]) });

    const fastify = Fastify();
    const bus = new EventBus({ isProduction: false });
    const routeProvider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
    await fastify.register(navigationPlugin, {
      prefix: '/api/v1',
      bus,
      routeProvider,
      rerouteProvider,
      profileProvider,
      searchProvider,
    });
    await fastify.ready();
    return { fastify, createRoutesCalls };
  }

  it('latlng + autostart:true starts navigation with ZERO further UI interaction', async () => {
    const { fastify, createRoutesCalls } = await buildDestinationServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG, autostart: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.route.id).toBe('dest-route-1');
    expect(body.data.nav_state.status).toBe('navigating');
    expect(body.data.nav_state.destination.latlng).toEqual(DEST_LATLNG);
    expect(createRoutesCalls).toHaveLength(1);
    expect(createRoutesCalls[0].destination).toEqual(DEST_LATLNG);
    expect(createRoutesCalls[0].origin).toBe('current');
    expect(createRoutesCalls[0].profile_id).toBe('p1');

    // GET /navigation/state confirms it's really live, not just the response body.
    const state = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(state.json().data.status).toBe('navigating');
    await fastify.close();
  });

  it('latlng WITHOUT autostart computes a route but leaves navigation idle', async () => {
    const { fastify } = await buildDestinationServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.route.id).toBe('dest-route-1');
    expect(body.data.nav_state.status).toBe('idle');
    await fastify.close();
  });

  it('query geocodes via SearchService (top result) then routes to it', async () => {
    const searchCalls: Array<{ q: string; limit: number }> = [];
    const { fastify, createRoutesCalls } = await buildDestinationServer({
      searchProvider: {
        search: (q) => {
          searchCalls.push({ q: q.q, limit: q.limit });
          return Promise.resolve([searchResult('Vaduz'), searchResult('Vaduz Bahnhof')]);
        },
      },
    });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { query: 'Vaduz' },
    });
    expect(res.statusCode).toBe(200);
    expect(searchCalls).toEqual([{ q: 'Vaduz', limit: 1 }]); // top result only
    expect(createRoutesCalls[0].destination).toEqual(DEST_LATLNG);
    await fastify.close();
  });

  it('query with no geocode hit -> 404 NO_GEOCODE_RESULT', async () => {
    const { fastify } = await buildDestinationServer({ searchProvider: { search: () => Promise.resolve([]) } });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { query: 'Nirgendwo' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_GEOCODE_RESULT');
    await fastify.close();
  });

  it('query given but no SearchService configured -> 501 SEARCH_NOT_CONFIGURED', async () => {
    const { fastify } = await buildDestinationServer({ searchProvider: null });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { query: 'Vaduz' },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('SEARCH_NOT_CONFIGURED');
    await fastify.close();
  });

  it('neither latlng nor query -> 400 VALIDATION_ERROR', async () => {
    const { fastify } = await buildDestinationServer();
    const res = await fastify.inject({ method: 'POST', url: '/api/v1/navigation/destination', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await fastify.close();
  });

  it('invalid latlng -> 400 VALIDATION_ERROR', async () => {
    const { fastify } = await buildDestinationServer();
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: { lat: 999, lon: 9.5 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await fastify.close();
  });

  it('no active profile and no profile_id -> 409 NO_ACTIVE_PROFILE', async () => {
    const { fastify } = await buildDestinationServer({ profileProvider: { getActive: () => null } });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_ACTIVE_PROFILE');
    await fastify.close();
  });

  it('explicit profile_id in the body overrides the active profile', async () => {
    const { fastify, createRoutesCalls } = await buildDestinationServer({
      profileProvider: { getActive: () => makeProfile('active-profile') },
    });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG, profile_id: 'override-profile' },
    });
    expect(res.statusCode).toBe(200);
    expect(createRoutesCalls[0].profile_id).toBe('override-profile');
    await fastify.close();
  });

  it('no route found -> 404 NO_ROUTE', async () => {
    const { fastify } = await buildDestinationServer({
      rerouteProvider: { createRoutes: () => Promise.resolve([]) },
    });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NO_ROUTE');
    await fastify.close();
  });

  it('routing not configured -> 501 ROUTING_NOT_CONFIGURED', async () => {
    const { fastify } = await buildDestinationServer({ rerouteProvider: null });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error.code).toBe('ROUTING_NOT_CONFIGURED');
    await fastify.close();
  });

  it('a RoutingError from the provider is mapped to its own status/code (e.g. OUT_OF_COVERAGE)', async () => {
    const { fastify } = await buildDestinationServer({
      rerouteProvider: {
        createRoutes: () => {
          throw new RoutingError(422, 'OUT_OF_COVERAGE', 'destination outside installed coverage');
        },
      },
    });
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { latlng: DEST_LATLNG },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OUT_OF_COVERAGE');
    await fastify.close();
  });
});

/** E04-T5, W-19: `GET /navigation/state`'s additive `recovered_route` field. */
describe('navigation REST plugin — GET /navigation/state recovered_route (W-19)', () => {
  it('includes recovered_route when idle with a still-cached recoverable route', async () => {
    const route = makeRoute('recoverable-1');
    const routeProvider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
    const recoveryStore = new InMemoryNavRecoveryStore({
      route_id: route.id,
      destination: { latlng: { lat: 47.01, lon: 9.5 }, name: 'Ziel' },
    });
    const fastify = Fastify();
    const bus = new EventBus({ isProduction: false });
    await fastify.register(navigationPlugin, { prefix: '/api/v1', bus, routeProvider, recoveryStore });
    await fastify.ready();

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('idle');
    expect(body.recovered_route).toEqual({
      route_id: route.id,
      destination: { latlng: { lat: 47.01, lon: 9.5 }, name: 'Ziel' },
    });
    await fastify.close();
  });

  it('omits recovered_route once navigating (already live, nothing to prompt)', async () => {
    const route = makeRoute('recoverable-2');
    const routeProvider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
    const recoveryStore = new InMemoryNavRecoveryStore({ route_id: route.id, destination: null });
    const fastify = Fastify();
    const bus = new EventBus({ isProduction: false });
    await fastify.register(navigationPlugin, { prefix: '/api/v1', bus, routeProvider, recoveryStore });
    await fastify.ready();

    await fastify.inject({ method: 'POST', url: '/api/v1/navigation/start', payload: { route_id: route.id } });
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(res.json().data.status).toBe('navigating');
    expect(res.json().recovered_route).toBeUndefined();
    await fastify.close();
  });

  it('omits recovered_route when there is no recovery record at all', async () => {
    const route = makeRoute('recoverable-3');
    const routeProvider: RouteProvider = { getCachedRoute: (id) => (id === route.id ? route : null) };
    const fastify = Fastify();
    const bus = new EventBus({ isProduction: false });
    await fastify.register(navigationPlugin, { prefix: '/api/v1', bus, routeProvider });
    await fastify.ready();

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/navigation/state' });
    expect(res.json().recovered_route).toBeUndefined();
    await fastify.close();
  });
});
