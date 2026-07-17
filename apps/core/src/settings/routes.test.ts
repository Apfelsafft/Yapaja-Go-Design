/**
 * Integration tests for the settings routes via HTTP injection (E07-T1).
 * Mirrors `apps/core/src/favorites/routes.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Settings Routes Integration', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
  });

  describe('GET /api/v1/settings', () => {
    it('returns an empty object initially', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({});
    });
  });

  describe('GET /api/v1/settings/:key', () => {
    it('returns 404 for an unset key', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/units' });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('NOT_FOUND');
    });

    it('returns a single key after it was set via PATCH', async () => {
      await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { units: 'metric' },
      });
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/units' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toBe('metric');
    });
  });

  describe('PATCH /api/v1/settings', () => {
    it('creates and round-trips a key', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { units: 'metric' },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({ units: 'metric' });
    });

    it('merges additional keys without dropping previously-set ones', async () => {
      await server.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { units: 'metric' } });
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { theme: 'dark' },
      });
      expect(JSON.parse(response.body).data).toEqual({ units: 'metric', theme: 'dark' });
    });

    it('round-trips the layouts key (widget-shell persistence, E07-T1)', async () => {
      const layouts = {
        explore: { mode: 'explore', slots: { 'top-bar': [{ instanceId: 'x1', widgetId: 'clock', size: 'S' }] }, updatedAt: 12345 },
        drive: { mode: 'drive', slots: {}, updatedAt: 999 },
      };
      const patchResponse = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { layouts },
      });
      expect(patchResponse.statusCode).toBe(200);
      expect(JSON.parse(patchResponse.body).data.layouts).toEqual(layouts);

      const getResponse = await server.inject({ method: 'GET', url: '/api/v1/settings/layouts' });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).data).toEqual(layouts);
    });

    it('rejects a non-object body', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: [1, 2, 3],
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    });
  });
});
