/**
 * HTTP integration tests for the navigation plugin via Fastify inject.
 * Focus: happy-path control endpoints and the 409/404/400 error mapping.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Route } from '@yapaja/shared';
import { EventBus } from '../bus/index.js';
import { encodePolyline6 } from '../routing/polyline.js';
import { navigationPlugin } from './routes.js';
import type { RouteProvider } from './service.js';

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
});
