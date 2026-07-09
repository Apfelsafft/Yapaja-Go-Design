/**
 * Integration tests for position REST routes via HTTP injection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import type { FastifyInstance } from 'fastify';
import type { Position } from '@yapaja/shared';

function browserFixBody(overrides: Partial<Omit<Position, 'source'>> = {}): Omit<Position, 'source'> {
  return {
    lat: 52.5,
    lon: 13.4,
    alt: 34,
    speed: 8,
    heading: 120,
    accuracy: 4,
    fix: '3d',
    ts: new Date().toISOString(),
    ...overrides,
  };
}

describe('Position Routes Integration', () => {
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

  describe('GET /api/v1/position', () => {
    it('returns 204 when no position is known yet', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/position' });
      expect(response.statusCode).toBe(204);
    });

    it('returns the last known position after a browser fix', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/position/browser',
        payload: browserFixBody({ lat: 48.1 }),
      });

      const response = await server.inject({ method: 'GET', url: '/api/v1/position' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Position;
      expect(body.lat).toBe(48.1);
      expect(body.source).toBe('browser');
    });
  });

  describe('GET /api/v1/position/sources', () => {
    it('lists all three known sources with inactive defaults', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/position/sources' });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const names = body.sources.map((s: { name: string }) => s.name).sort();
      expect(names).toEqual(['browser', 'gpsd', 'simulator']);
      expect(body.active).toBeNull();
      expect(body.forced).toBeNull();
    });

    it('reflects the active source after a fix', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/v1/position/browser',
        payload: browserFixBody(),
      });

      const response = await server.inject({ method: 'GET', url: '/api/v1/position/sources' });
      const body = JSON.parse(response.body);
      expect(body.active).toBe('browser');
      const browser = body.sources.find((s: { name: string }) => s.name === 'browser');
      expect(browser.active).toBe(true);
    });
  });

  describe('POST /api/v1/position/browser', () => {
    it('accepts a valid fix', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/position/browser',
        payload: browserFixBody(),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.source).toBe('browser');
    });

    it('rejects a schema-invalid payload', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/position/browser',
        payload: { lat: 999, lon: 13.4 },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects with 409 when the source is forced to something else', async () => {
      await server.inject({
        method: 'PUT',
        url: '/api/v1/position/source',
        payload: { source: 'gpsd' },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/position/browser',
        payload: browserFixBody(),
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('SOURCE_NOT_SELECTABLE');
    });
  });

  describe('PUT /api/v1/position/source', () => {
    it('forces a specific source', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/position/source',
        payload: { source: 'simulator' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.forced).toBe('simulator');
    });

    it('releases the forced source with "auto"', async () => {
      await server.inject({
        method: 'PUT',
        url: '/api/v1/position/source',
        payload: { source: 'gpsd' },
      });
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/position/source',
        payload: { source: 'auto' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.forced).toBeNull();
    });

    it('rejects an invalid source value', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/position/source',
        payload: { source: 'satellite' },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
