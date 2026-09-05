/**
 * HTTP integration tests for the routing plugin via Fastify inject.
 * The Valhalla transport is mocked through the plugin's `fetchImpl` seam.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { LatLng, Position, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { validateRoute } from '@yapaja/shared';
import { routingPlugin } from './routes.js';
import type { FetchLike, FetchResponseLike } from './valhallaClient.js';
import { encodePolyline6 } from './polyline.js';
import type { ValhallaRouteResponse } from './types.js';

const ORIGIN: LatLng = { lat: 0, lon: 0 };
const DEST: LatLng = { lat: 0, lon: 0.1 };

function camper(): VehicleProfile {
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
    dimensions_confirmed_at: null,
  };
}

const OK_RESPONSE: ValhallaRouteResponse = {
  trip: {
    summary: { length: 12.5, time: 900 },
    legs: [
      {
        shape: encodePolyline6([
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.1 },
        ]),
        summary: { length: 12.5, time: 900 },
        maneuvers: [{ type: 1, instruction: 'go', street_names: [], length: 12.5, begin_shape_index: 0 }],
      },
    ],
  },
};

function jsonResponse(json: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

const okFetch: FetchLike = async () => jsonResponse(OK_RESPONSE);

async function buildTestServer(fetchImpl: FetchLike = okFetch): Promise<FastifyInstance> {
  const fastify = Fastify();
  await fastify.register(routingPlugin, {
    prefix: '/api/v1',
    profileService: { getById: (id) => (id === 'p1' ? camper() : null) },
    positionService: { getLast: (): Position | null => null },
    fetchImpl,
  });
  await fastify.ready();
  return fastify;
}

function body(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    origin: ORIGIN,
    destination: DEST,
    waypoints: [],
    profile_id: 'p1',
    alternatives: 0,
    ...overrides,
  };
}

describe('routing plugin HTTP', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('POST /routes returns { data: Route[] } with schema-valid routes', async () => {
    const res = await server.inject({ method: 'POST', url: '/api/v1/routes', payload: body() });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: Route[] };
    expect(parsed.data).toHaveLength(1);
    expect(validateRoute(parsed.data[0])).toBe(true);
  });

  it('GET /routes/:id returns a previously computed route', async () => {
    const post = await server.inject({ method: 'POST', url: '/api/v1/routes', payload: body() });
    const id = (JSON.parse(post.body) as { data: Route[] }).data[0].id;

    const get = await server.inject({ method: 'GET', url: `/api/v1/routes/${id}` });
    expect(get.statusCode).toBe(200);
    expect((JSON.parse(get.body) as { data: Route }).data.id).toBe(id);
  });

  it('GET /routes/:id returns 404 for an unknown id', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/routes/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('POST /routes with an invalid body returns 400 VALIDATION_ERROR', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/routes',
      payload: { origin: ORIGIN }, // missing required fields
    });
    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /routes surfaces a 503 when Valhalla is unavailable', async () => {
    const failing = await buildTestServer(async () => jsonResponse({}, 502));
    const res = await failing.inject({ method: 'POST', url: '/api/v1/routes', payload: body() });
    expect(res.statusCode).toBe(503);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('ROUTING_UNAVAILABLE');
    await failing.close();
  });

  it('POST /routes returns 409 for origin:"current" without a position', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/routes',
      payload: body({ origin: 'current' }),
    });
    expect(res.statusCode).toBe(409);
    expect((JSON.parse(res.body) as { error: { code: string } }).error.code).toBe('NO_POSITION');
  });
});

/**
 * Live integration against a real Valhalla (LI graph). NOT runnable in this
 * sandbox (no Docker/Valhalla), so it is skipped unless VALHALLA_URL_LIVE is
 * set. The real end-to-end gate is wired separately by the orchestrator
 * (follow-up): see task report.
 */
describe.skipIf(!process.env.VALHALLA_URL_LIVE)('routing live integration', () => {
  it('computes a truck route against a live Valhalla', async () => {
    const fastify = Fastify();
    await fastify.register(routingPlugin, {
      prefix: '/api/v1',
      profileService: { getById: () => camper() },
      positionService: { getLast: (): Position | null => null },
      valhallaUrl: process.env.VALHALLA_URL_LIVE,
    });
    await fastify.ready();
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/routes',
      // Two reachable points on the Liechtenstein graph.
      payload: body({
        origin: { lat: 47.14, lon: 9.52 },
        destination: { lat: 47.16, lon: 9.51 },
      }),
    });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: Route[] };
    expect(validateRoute(parsed.data[0])).toBe(true);
    await fastify.close();
  });
});
