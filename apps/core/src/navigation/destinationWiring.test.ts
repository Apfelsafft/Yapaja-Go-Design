/**
 * E08-T3 (b): confirm the FULL server (`buildServer`) wires a `searchProvider`
 * into `POST /api/v1/navigation/destination`, so a `{query}` body reaches the
 * geocoder end-to-end rather than short-circuiting on a missing collaborator.
 *
 * NOTE: destination-`query` was already implemented (E04-T5) and is covered at
 * the plugin level with a mocked SearchService in `navigation/routes.test.ts`
 * ("query geocodes via SearchService (top result) then routes to it"). This
 * test adds the missing END-TO-END assertion that `index.ts` actually passes
 * the shared `searchService` through: with a query body the route must NOT
 * answer `501 SEARCH_NOT_CONFIGURED` (which is exactly what a missing
 * `searchProvider` would produce). Photon is disabled so no network is touched;
 * the offline lite backend has no index in the test env, so the query resolves
 * to a normal "no result / geocode unavailable" outcome -- never a wiring 501.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';

describe('POST /api/v1/navigation/destination — {query} wiring (E08-T3 b)', () => {
  const savedEnv = { ...process.env };
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    process.env.PHOTON_ENABLED = 'false'; // offline-only, no network in tests
    delete process.env.API_AUTH_TOKEN; // open posture
    delete process.env.SEARCH_ONLINE_FALLBACK;
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    process.env = { ...savedEnv };
  });

  it('a query body reaches the geocoder (never 501 SEARCH_NOT_CONFIGURED)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { query: 'Vaduz' },
    });
    // The searchProvider IS wired: we get a geocode-outcome status, not the
    // "no searchProvider configured" 501.
    expect(res.statusCode).not.toBe(501);
    if (res.statusCode >= 400) {
      expect(res.json().error.code).not.toBe('SEARCH_NOT_CONFIGURED');
    }
  });

  it('coordinate-style query resolves through the coords backend to a route step', async () => {
    // A "lat,lon" query is handled by the offline coords backend (no index
    // needed), so this exercises the full query -> geocode -> route pipeline
    // end-to-end without any external service.
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/navigation/destination',
      payload: { query: '47.14, 9.52' },
    });
    // No Valhalla in the test env, so routing fails -- but we must have gotten
    // PAST geocoding (never SEARCH_NOT_CONFIGURED / NO_GEOCODE_RESULT).
    expect(res.statusCode).not.toBe(501);
    if (res.statusCode >= 400) {
      const code = res.json().error.code;
      expect(code).not.toBe('SEARCH_NOT_CONFIGURED');
      expect(code).not.toBe('NO_GEOCODE_RESULT');
    }
  });
});
