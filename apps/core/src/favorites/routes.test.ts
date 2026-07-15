/**
 * Integration tests for favorites + history routes via HTTP injection
 * (E05-T3). Mirrors `apps/core/src/profiles/routes.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setTimeout } from 'node:timers';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Favorites & History Routes Integration', () => {
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

  const campsitePayload = {
    name: 'Stellplatz Bodensee',
    latlng: { lat: 47.6, lon: 9.3 },
    icon: 'campsite',
    category: 'campsite',
  };

  const homePayload = {
    name: 'Zuhause',
    latlng: { lat: 48.1, lon: 11.5 },
    icon: 'home',
    category: 'home',
  };

  describe('GET /api/v1/favorites', () => {
    it('returns an empty list initially', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/favorites' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual([]);
    });
  });

  describe('POST /api/v1/favorites', () => {
    it('creates a favorite', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: campsitePayload,
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBeDefined();
      expect(body.data.name).toBe('Stellplatz Bodensee');
      expect(body.data.sort_order).toBe(0);
    });

    it('rejects an invalid category', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: { ...campsitePayload, category: 'bogus' },
      });
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a missing name', async () => {
      const { name: _unused, ...rest } = campsitePayload;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: rest,
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects an invalid latlng', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: { ...campsitePayload, latlng: { lat: 999, lon: 9.3 } },
      });
      expect(response.statusCode).toBe(400);
    });

    describe('home uniqueness', () => {
      it('allows the first home favorite', async () => {
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/favorites',
          payload: homePayload,
        });
        expect(response.statusCode).toBe(201);
      });

      it('rejects a second home favorite with 409', async () => {
        await server.inject({ method: 'POST', url: '/api/v1/favorites', payload: homePayload });
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/favorites',
          payload: { ...homePayload, name: 'Zweites Zuhause' },
        });
        expect(response.statusCode).toBe(409);
        const body = JSON.parse(response.body);
        expect(body.error.code).toBe('HOME_ALREADY_EXISTS');
      });

      it('replaces the existing home favorite when replace=true', async () => {
        await server.inject({ method: 'POST', url: '/api/v1/favorites', payload: homePayload });
        const response = await server.inject({
          method: 'POST',
          url: '/api/v1/favorites',
          payload: { ...homePayload, name: 'Neues Zuhause', replace: true },
        });
        expect(response.statusCode).toBe(201);

        const listRes = await server.inject({ method: 'GET', url: '/api/v1/favorites' });
        const homes = JSON.parse(listRes.body).data.filter((f: { category: string }) => f.category === 'home');
        expect(homes).toHaveLength(1);
        expect(homes[0].name).toBe('Neues Zuhause');
      });
    });
  });

  describe('PUT /api/v1/favorites/:id', () => {
    it('updates a favorite', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: campsitePayload,
      });
      const id = JSON.parse(createRes.body).data.id;

      const updateRes = await server.inject({
        method: 'PUT',
        url: `/api/v1/favorites/${id}`,
        payload: { name: 'Neuer Name' },
      });
      expect(updateRes.statusCode).toBe(200);
      expect(JSON.parse(updateRes.body).data.name).toBe('Neuer Name');
    });

    it('returns 404 for a non-existent favorite', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/favorites/non-existent',
        payload: { name: 'x' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('returns 409 when updating into home while one already exists', async () => {
      await server.inject({ method: 'POST', url: '/api/v1/favorites', payload: homePayload });
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: campsitePayload,
      });
      const id = JSON.parse(createRes.body).data.id;

      const response = await server.inject({
        method: 'PUT',
        url: `/api/v1/favorites/${id}`,
        payload: { category: 'home' },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe('DELETE /api/v1/favorites/:id', () => {
    it('deletes a favorite', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/favorites',
        payload: campsitePayload,
      });
      const id = JSON.parse(createRes.body).data.id;

      const deleteRes = await server.inject({ method: 'DELETE', url: `/api/v1/favorites/${id}` });
      expect(deleteRes.statusCode).toBe(204);

      const listRes = await server.inject({ method: 'GET', url: '/api/v1/favorites' });
      expect(JSON.parse(listRes.body).data).toEqual([]);
    });

    it('returns 404 for a non-existent favorite', async () => {
      const response = await server.inject({ method: 'DELETE', url: '/api/v1/favorites/nope' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/v1/favorites/reorder', () => {
    it('persists a new sort order', async () => {
      const a = JSON.parse(
        (
          await server.inject({
            method: 'POST',
            url: '/api/v1/favorites',
            payload: { ...campsitePayload, name: 'A' },
          })
        ).body,
      ).data;
      const b = JSON.parse(
        (
          await server.inject({
            method: 'POST',
            url: '/api/v1/favorites',
            payload: { ...campsitePayload, name: 'B' },
          })
        ).body,
      ).data;

      const reorderRes = await server.inject({
        method: 'PUT',
        url: '/api/v1/favorites/reorder',
        payload: { ids: [b.id, a.id] },
      });
      expect(reorderRes.statusCode).toBe(200);
      const body = JSON.parse(reorderRes.body);
      expect(body.data.map((f: { name: string }) => f.name)).toEqual(['B', 'A']);

      const listRes = await server.inject({ method: 'GET', url: '/api/v1/favorites' });
      expect(JSON.parse(listRes.body).data.map((f: { name: string }) => f.name)).toEqual(['B', 'A']);
    });

    it('rejects a non-array ids body', async () => {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/favorites/reorder',
        payload: { ids: 'nope' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET/POST/DELETE /api/v1/history', () => {
    it('returns an empty list initially', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/history' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual([]);
    });

    it('records a query entry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/history',
        payload: { query: 'Vaduz' },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.query).toBe('Vaduz');
      expect(body.data.destination).toBeNull();
      expect(body.data.ts).toBeDefined();
    });

    it('records a destination entry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/history',
        payload: { destination: { latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' } },
      });
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.destination).toEqual({ latlng: { lat: 47.14, lon: 9.52 }, name: 'Vaduz' });
    });

    it('rejects an entry with neither query nor destination', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/history',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('ignores a client-supplied ts', async () => {
      const clientTs = '2000-01-01T00:00:00.000Z';
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/history',
        payload: { query: 'Vaduz', ts: clientTs },
      });
      const body = JSON.parse(response.body);
      expect(body.data.ts).not.toBe(clientTs);
    });

    it('deletes a single entry', async () => {
      const createRes = await server.inject({
        method: 'POST',
        url: '/api/v1/history',
        payload: { query: 'Vaduz' },
      });
      const id = JSON.parse(createRes.body).data.id;

      const deleteRes = await server.inject({ method: 'DELETE', url: `/api/v1/history/${id}` });
      expect(deleteRes.statusCode).toBe(204);

      const listRes = await server.inject({ method: 'GET', url: '/api/v1/history' });
      expect(JSON.parse(listRes.body).data).toEqual([]);
    });

    it('returns 404 deleting a non-existent entry', async () => {
      const response = await server.inject({ method: 'DELETE', url: '/api/v1/history/nope' });
      expect(response.statusCode).toBe(404);
    });

    it('clears all entries', async () => {
      await server.inject({ method: 'POST', url: '/api/v1/history', payload: { query: 'A' } });
      await server.inject({ method: 'POST', url: '/api/v1/history', payload: { query: 'B' } });

      const clearRes = await server.inject({ method: 'DELETE', url: '/api/v1/history' });
      expect(clearRes.statusCode).toBe(204);

      const listRes = await server.inject({ method: 'GET', url: '/api/v1/history' });
      expect(JSON.parse(listRes.body).data).toEqual([]);
    });

    it('returns entries newest-first', async () => {
      await server.inject({ method: 'POST', url: '/api/v1/history', payload: { query: 'First' } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await server.inject({ method: 'POST', url: '/api/v1/history', payload: { query: 'Second' } });

      const listRes = await server.inject({ method: 'GET', url: '/api/v1/history' });
      const queries = JSON.parse(listRes.body).data.map((e: { query: string }) => e.query);
      expect(queries).toEqual(['Second', 'First']);
    });
  });
});
