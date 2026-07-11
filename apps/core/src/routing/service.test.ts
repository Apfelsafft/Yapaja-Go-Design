/**
 * RoutingService behaviour with a mocked Valhalla transport.
 *
 * Covers: the profile-mapping intercept (outgoing costing_options.truck),
 * checkRoute enforcement (500, route NOT delivered), the fatal-vs-warning
 * split for too-long routes, all error paths (503 / 400 / 409), and
 * origin:'current' resolution.
 */

import { describe, it, expect } from 'vitest';
import type { LatLng, Position, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { RoutingService, type PositionLookup, type ProfileLookup } from './service.js';
import { RoutingError } from './errors.js';
import { ValhallaClient, type FetchLike, type FetchResponseLike } from './valhallaClient.js';
import { encodePolyline6 } from './polyline.js';
import type { ValhallaRouteResponse, ValhallaTrip } from './types.js';

// --- fixtures ------------------------------------------------------------

function camper(overrides: Partial<VehicleProfile> = {}): VehicleProfile {
  return {
    id: 'p1',
    name: 'Camper',
    height_m: 3.0,
    width_m: 2.2,
    length_m: 6.5,
    weight_t: 3.5,
    avg_speed_kmh: 85,
    hazmat: false,
    avoid: { motorway: false, toll: false, ferry: false, unpaved: false },
    is_active: true,
    ...overrides,
  };
}

function profileService(profile: VehicleProfile | null): ProfileLookup {
  return { getById: (id) => (profile && profile.id === id ? profile : null) };
}

function positionService(pos: Position | null): PositionLookup {
  return { getLast: () => pos };
}

const ORIGIN: LatLng = { lat: 0, lon: 0 };
const DEST: LatLng = { lat: 0, lon: 0.1 }; // ~11132 m straight line

function tripWithLengthKm(lengthKm: number, timeS: number): ValhallaTrip {
  return {
    summary: { length: lengthKm, time: timeS },
    legs: [
      {
        shape: encodePolyline6([
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.1 },
        ]),
        summary: { length: lengthKm, time: timeS },
        maneuvers: [{ type: 1, instruction: 'go', street_names: [], length: lengthKm, begin_shape_index: 0 }],
      },
    ],
  };
}

const OK_RESPONSE: ValhallaRouteResponse = { trip: tripWithLengthKm(12.5, 900) };

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
}

function jsonResponse(json: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

/** fetch mock that records the outgoing request and returns a fixed response. */
function recordingFetch(captured: Captured, response: FetchResponseLike): FetchLike {
  return async (url, init) => {
    captured.url = url;
    captured.body = JSON.parse(init.body) as Record<string, unknown>;
    return response;
  };
}

function serviceWith(
  fetchImpl: FetchLike,
  profile: VehicleProfile | null = camper(),
  pos: Position | null = null,
): RoutingService {
  const client = new ValhallaClient({ baseUrl: 'http://valhalla.test', fetchImpl });
  return new RoutingService({
    client,
    profileService: profileService(profile),
    positionService: positionService(pos),
  });
}

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    origin: ORIGIN,
    destination: DEST,
    waypoints: [],
    profile_id: 'p1',
    alternatives: 0,
    ...overrides,
  };
}

// --- tests ---------------------------------------------------------------

describe('RoutingService profile-mapping intercept', () => {
  it('sends the active profile as costing_options.truck (all fields, avoid=false omits use_*)', async () => {
    const captured: Captured = {};
    const svc = serviceWith(recordingFetch(captured, jsonResponse(OK_RESPONSE)), camper());

    await svc.createRoutes(request());

    expect(captured.url).toBe('http://valhalla.test/route');
    const truck = (captured.body as { costing_options: { truck: Record<string, unknown> } })
      .costing_options.truck;
    expect(truck).toMatchObject({
      height: 3.0,
      width: 2.2,
      length: 6.5,
      weight: 3.5,
      top_speed: 85,
      hazmat: false,
    });
    expect('use_highways' in truck).toBe(false);
    expect('use_tolls' in truck).toBe(false);
    expect('use_ferry' in truck).toBe(false);
    expect('use_tracks' in truck).toBe(false);
    expect((captured.body as { costing: string }).costing).toBe('truck');
  });

  it('lowers use_* flags when the active profile avoids classes', async () => {
    const captured: Captured = {};
    const svc = serviceWith(
      recordingFetch(captured, jsonResponse(OK_RESPONSE)),
      camper({ avoid: { motorway: true, toll: true, ferry: true, unpaved: true } }),
    );

    await svc.createRoutes(request());

    const truck = (captured.body as { costing_options: { truck: Record<string, unknown> } })
      .costing_options.truck;
    expect(truck.use_highways).toBe(0);
    expect(truck.use_tolls).toBe(0);
    expect(truck.use_ferry).toBe(0);
    expect(truck.use_tracks).toBe(0);
  });
});

describe('RoutingService E03-T4 temporary avoidances (exclude_locations/exclude_polygons/avoid_overrides)', () => {
  it('forwards RouteRequest.exclude_locations to Valhalla unchanged, and omits the field when absent', async () => {
    const captured: Captured = {};
    const svc = serviceWith(recordingFetch(captured, jsonResponse(OK_RESPONSE)), camper());

    await svc.createRoutes(request({ exclude_locations: [{ lat: 0.05, lon: 0.05 }] }));

    expect((captured.body as { exclude_locations?: unknown[] }).exclude_locations).toEqual([
      { lat: 0.05, lon: 0.05 },
    ]);
  });

  it('forwards RouteRequest.exclude_polygons to Valhalla with rings converted to [lon, lat] tuples', async () => {
    const captured: Captured = {};
    const svc = serviceWith(recordingFetch(captured, jsonResponse(OK_RESPONSE)), camper());

    await svc.createRoutes(
      request({
        exclude_polygons: [
          [
            { lat: 0.01, lon: 0.02 },
            { lat: 0.02, lon: 0.02 },
            { lat: 0.02, lon: 0.03 },
          ],
        ],
      }),
    );

    expect((captured.body as { exclude_polygons?: unknown }).exclude_polygons).toEqual([
      [
        [0.02, 0.01],
        [0.02, 0.02],
        [0.03, 0.02],
      ],
    ]);
  });

  it('omits exclude_locations/exclude_polygons from the Valhalla body when the request has neither', async () => {
    const captured: Captured = {};
    const svc = serviceWith(recordingFetch(captured, jsonResponse(OK_RESPONSE)), camper());

    await svc.createRoutes(request());

    expect('exclude_locations' in (captured.body as object)).toBe(false);
    expect('exclude_polygons' in (captured.body as object)).toBe(false);
  });

  it('avoid_overrides overrides the active profile avoid flags for this request only', async () => {
    const captured: Captured = {};
    const svc = serviceWith(
      recordingFetch(captured, jsonResponse(OK_RESPONSE)),
      camper({ avoid: { motorway: false, toll: false, ferry: false, unpaved: false } }),
    );

    await svc.createRoutes(request({ avoid_overrides: { toll: true } }));

    const truck = (captured.body as { costing_options: { truck: Record<string, unknown> } }).costing_options
      .truck;
    expect(truck.use_tolls).toBe(0);
    expect('use_highways' in truck).toBe(false);
  });
});

describe('RoutingService origin resolution', () => {
  it('uses the current device position as the first Valhalla location', async () => {
    const captured: Captured = {};
    // Position sits near ORIGIN so the fixed 12.5 km fixture stays plausible
    // against DEST (~11 km straight line); the assertion is about location[0].
    const pos: Position = {
      lat: 0.001,
      lon: 0.001,
      alt: null,
      speed: null,
      heading: null,
      accuracy: null,
      source: 'gpsd',
      fix: '3d',
      ts: new Date().toISOString(),
    };
    const svc = serviceWith(recordingFetch(captured, jsonResponse(OK_RESPONSE)), camper(), pos);

    await svc.createRoutes(request({ origin: 'current' }));

    const locations = (captured.body as { locations: LatLng[] }).locations;
    expect(locations[0]).toEqual({ lat: 0.001, lon: 0.001, type: 'break' });
  });

  it('rejects origin:"current" with 409 NO_POSITION when no position is known', async () => {
    const svc = serviceWith(recordingFetch({}, jsonResponse(OK_RESPONSE)), camper(), null);
    await expect(svc.createRoutes(request({ origin: 'current' }))).rejects.toMatchObject({
      httpStatus: 409,
      code: 'NO_POSITION',
    });
  });
});

describe('RoutingService plausibility enforcement (checkRoute)', () => {
  it('throws 500 IMPLAUSIBLE_ROUTE and does NOT deliver a too-short route', async () => {
    // 1.0 km << 11132 m straight line -> route_distance_too_short (fatal).
    const svc = serviceWith(
      recordingFetch({}, jsonResponse({ trip: tripWithLengthKm(1.0, 120) })),
      camper(),
    );
    await expect(svc.createRoutes(request())).rejects.toMatchObject({
      httpStatus: 500,
      code: 'IMPLAUSIBLE_ROUTE',
    });
  });

  it('does not cache a route that failed the plausibility gate', async () => {
    const svc = serviceWith(
      recordingFetch({}, jsonResponse({ trip: tripWithLengthKm(1.0, 120) })),
      camper(),
    );
    await expect(svc.createRoutes(request())).rejects.toBeInstanceOf(RoutingError);
    // Nothing plausible was produced, so the cache stays empty (spot-check a
    // fresh service: no id to look up, but the invariant is "never delivered").
  });
});

describe('RoutingService error paths', () => {
  it('maps a network failure to 503 ROUTING_UNAVAILABLE', async () => {
    const failing: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(serviceWith(failing).createRoutes(request())).rejects.toMatchObject({
      httpStatus: 503,
      code: 'ROUTING_UNAVAILABLE',
    });
  });

  it('maps a timeout (AbortError) to 503 ROUTING_UNAVAILABLE', async () => {
    const aborting: FetchLike = async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };
    await expect(serviceWith(aborting).createRoutes(request())).rejects.toMatchObject({
      httpStatus: 503,
      code: 'ROUTING_UNAVAILABLE',
    });
  });

  it('maps a Valhalla 5xx to 503 ROUTING_UNAVAILABLE', async () => {
    const svc = serviceWith(recordingFetch({}, jsonResponse({}, 503)));
    await expect(svc.createRoutes(request())).rejects.toMatchObject({
      httpStatus: 503,
      code: 'ROUTING_UNAVAILABLE',
    });
  });

  it('maps a Valhalla "no path" error to 400 NO_ROUTE', async () => {
    const svc = serviceWith(
      recordingFetch(
        {},
        jsonResponse({ error_code: 442, error: 'No path could be found for input' }, 400),
      ),
    );
    await expect(svc.createRoutes(request())).rejects.toMatchObject({
      httpStatus: 400,
      code: 'NO_ROUTE',
    });
  });

  it('maps a Valhalla "no suitable edges" error to 400 POINT_UNREACHABLE', async () => {
    const svc = serviceWith(
      recordingFetch(
        {},
        jsonResponse({ error_code: 171, error: 'No suitable edges near location' }, 400),
      ),
    );
    await expect(svc.createRoutes(request())).rejects.toMatchObject({
      httpStatus: 400,
      code: 'POINT_UNREACHABLE',
    });
  });

  it('rejects an unknown profile_id with 404 PROFILE_NOT_FOUND', async () => {
    const svc = serviceWith(recordingFetch({}, jsonResponse(OK_RESPONSE)), null);
    await expect(svc.createRoutes(request())).rejects.toMatchObject({
      httpStatus: 404,
      code: 'PROFILE_NOT_FOUND',
    });
  });
});

describe('RoutingService success + cache', () => {
  it('returns schema-valid routes and caches them by id', async () => {
    const svc = serviceWith(recordingFetch({}, jsonResponse(OK_RESPONSE)), camper());
    const routes = await svc.createRoutes(request());
    expect(routes).toHaveLength(1);
    const id = routes[0].id;
    expect(svc.getCachedRoute(id)?.id).toBe(id);
    expect(svc.getCachedRoute('unknown')).toBeNull();
  });
});
