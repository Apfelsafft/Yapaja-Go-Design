/**
 * Integration tests for the simulator REST routes via HTTP injection,
 * including the production ENABLE_SIMULATOR guard.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../index.js';
import { closeDb } from '../../db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Simulator Routes Integration', () => {
  let server: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableSimulator = process.env.ENABLE_SIMULATOR;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnableSimulator === undefined) {
      delete process.env.ENABLE_SIMULATOR;
    } else {
      process.env.ENABLE_SIMULATOR = originalEnableSimulator;
    }
  });

  describe('dev/test (default): simulator control is enabled', () => {
    it('POST /simulator/play starts playback and forces the position source', async () => {
      const playRes = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'city' } },
      });
      expect(playRes.statusCode).toBe(200);
      const playBody = JSON.parse(playRes.body);
      expect(playBody.data.state).toBe('playing');

      const sourcesRes = await server.inject({ method: 'GET', url: '/api/v1/position/sources' });
      const sourcesBody = JSON.parse(sourcesRes.body);
      expect(sourcesBody.forced).toBe('simulator');
    });

    it('GET /simulator/status reflects state transitions across play/pause/stop', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'country' } },
      });

      let statusRes = await server.inject({ method: 'GET', url: '/api/v1/simulator/status' });
      expect(JSON.parse(statusRes.body).data.state).toBe('playing');

      await server.inject({ method: 'POST', url: '/api/v1/simulator/pause' });
      statusRes = await server.inject({ method: 'GET', url: '/api/v1/simulator/status' });
      expect(JSON.parse(statusRes.body).data.state).toBe('paused');

      await server.inject({ method: 'POST', url: '/api/v1/simulator/stop' });
      statusRes = await server.inject({ method: 'GET', url: '/api/v1/simulator/status' });
      expect(JSON.parse(statusRes.body).data.state).toBe('stopped');
    });

    it('rejects a play request with no track and nothing to resume', async () => {
      const res = await server.inject({ method: 'POST', url: '/api/v1/simulator/play', payload: {} });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unknown gpxId', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'not-a-real-fixture' } },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid mutations payload (negative detour index)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'city' }, mutations: { detour: { at_index: -1 } } },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts a polyline6 + constant speed track', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { polyline6: 'AAA@', speedMs: 5 } },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.state).toBe('playing');
    });

    it('rejects a polyline6 track with no speed profile', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { polyline6: 'AAA@' } },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('production guard', () => {
    it('403s all simulator routes in production without ENABLE_SIMULATOR', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ENABLE_SIMULATOR;

      const playRes = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'city' } },
      });
      expect(playRes.statusCode).toBe(403);
      expect(JSON.parse(playRes.body).error.code).toBe('SIMULATOR_DISABLED');

      const statusRes = await server.inject({ method: 'GET', url: '/api/v1/simulator/status' });
      expect(statusRes.statusCode).toBe(403);

      const pauseRes = await server.inject({ method: 'POST', url: '/api/v1/simulator/pause' });
      expect(pauseRes.statusCode).toBe(403);

      const stopRes = await server.inject({ method: 'POST', url: '/api/v1/simulator/stop' });
      expect(stopRes.statusCode).toBe(403);
    });

    it('allows simulator routes in production once ENABLE_SIMULATOR=1 is set', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_SIMULATOR = '1';

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/simulator/play',
        payload: { track: { gpxId: 'city' } },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
