/**
 * HTTP integration tests for the search plugin via Fastify inject
 * (E05-T1 acceptance criteria). Backends are injected as pre-built
 * `GeocoderBackend` mocks -- no live Photon/Nominatim required.
 *
 * The live Photon-container integration test (real HTTP against a running
 * Photon instance) is out of scope here -- it's gated behind E05-T4
 * (Photon-Setup & Daten-Pipeline) and is expected to land as a
 * `describe.skipIf(!process.env.PHOTON_URL_LIVE)` suite once that task ships
 * the container/CI plumbing. See the bottom of this file for the stub.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError, SearchResult } from '@yapaja/shared';
import { validateSearchResult } from '@yapaja/shared';
import { searchPlugin, type SearchRoutesOptions } from './routes.js';
import type { GeocoderBackend } from './types.js';
import type { SearchRegionsProvider } from './coverage.js';

const VADUZ: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz, Liechtenstein',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'photon',
};

function backend(
  source: SearchResult['source'],
  impl: Partial<GeocoderBackend> = {},
): GeocoderBackend {
  return {
    source,
    search: impl.search ?? (async () => []),
    reverse: impl.reverse ?? (async () => []),
  };
}

function allowAllProvider(): SearchRegionsProvider {
  return { getInstalledRegions: async () => [] };
}

async function buildTestServer(overrides: Partial<SearchRoutesOptions> = {}): Promise<FastifyInstance> {
  const fastify = Fastify();
  await fastify.register(searchPlugin, {
    prefix: '/api/v1',
    photonBackend: backend('photon'),
    nominatimBackend: backend('nominatim'),
    regionsProvider: allowAllProvider(),
    ...overrides,
  });
  await fastify.ready();
  return fastify;
}

describe('search plugin HTTP', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('GET /search returns { data: SearchResult[] } with a schema-valid "Vaduz" result (mocked Photon)', async () => {
    server = await buildTestServer({
      photonBackend: backend('photon', { search: async () => [VADUZ] }),
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz&limit=10' });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].name).toBe('Vaduz');
    expect(validateSearchResult(parsed.data[0])).toBe(true);
  });

  it('GET /search with a coordinate query short-circuits to a coords result', async () => {
    server = await buildTestServer();

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=47.14%2C%209.52' });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].source).toBe('coords');
  });

  it('GET /search falls back to Nominatim when Photon is stopped/0-hit and online_fallback is on', async () => {
    server = await buildTestServer({
      photonBackend: backend('photon', {
        search: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
      nominatimBackend: backend('nominatim', {
        search: async () => [{ ...VADUZ, source: 'nominatim' }],
      }),
      onlineFallback: true,
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].source).toBe('nominatim');
  });

  it('GET /search without q returns 400 VALIDATION_ERROR', async () => {
    server = await buildTestServer();

    const res = await server.inject({ method: 'GET', url: '/api/v1/search' });

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /search with an invalid lat returns 400 VALIDATION_ERROR', async () => {
    server = await buildTestServer();

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=x&lat=999' });

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /search/reverse returns { data: SearchResult[] }', async () => {
    server = await buildTestServer({
      photonBackend: backend('photon', { reverse: async () => [VADUZ] }),
    });

    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/search/reverse?lat=47.141&lon=9.5215',
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toHaveLength(1);
    expect(validateSearchResult(parsed.data[0])).toBe(true);
  });

  it('GET /search/reverse without lat/lon returns 400 VALIDATION_ERROR', async () => {
    server = await buildTestServer();

    const res = await server.inject({ method: 'GET', url: '/api/v1/search/reverse' });

    expect(res.statusCode).toBe(400);
    expect((JSON.parse(res.body) as ApiError).error.code).toBe('VALIDATION_ERROR');
  });

  // E05-T5 (W-12): the `lite` fallback wired through the HTTP layer.
  it('GET /search falls back to lite when Photon is down (source:"lite")', async () => {
    server = await buildTestServer({
      photonBackend: backend('photon', {
        search: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
      liteBackend: backend('lite', { search: async () => [{ ...VADUZ, label: 'Vaduz', source: 'lite' }] }),
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].source).toBe('lite');
    expect(validateSearchResult(parsed.data[0])).toBe(true);
  });

  it('GET /search: photonEnabled:false skips Photon entirely and uses lite directly', async () => {
    const photonSearch = async () => [VADUZ];
    server = await buildTestServer({
      photonBackend: backend('photon', { search: photonSearch }),
      liteBackend: backend('lite', { search: async () => [{ ...VADUZ, label: 'Vaduz', source: 'lite' }] }),
      photonEnabled: false,
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });

    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data[0].source).toBe('lite');
  });

  it('GET /search: Photon healthy with 0 hits does NOT use lite (lite must not override a healthy Photon)', async () => {
    const liteSearch = async () => [{ ...VADUZ, label: 'Vaduz', source: 'lite' as const }];
    server = await buildTestServer({
      photonBackend: backend('photon', { search: async () => [] }),
      liteBackend: backend('lite', { search: liteSearch }),
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });

    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data).toEqual([]);
  });

  it('out_of_coverage results are marked true in the HTTP response', async () => {
    server = await buildTestServer({
      photonBackend: backend('photon', { search: async () => [VADUZ] }),
      regionsProvider: {
        getInstalledRegions: async () => [{ id: 'elsewhere', name: 'x', bounds: [0, 0, 1, 1] }],
      },
    });

    const res = await server.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });

    const parsed = JSON.parse(res.body) as { data: SearchResult[] };
    expect(parsed.data[0].out_of_coverage).toBe(true);
  });
});

// --- Live Photon-container integration (E05-T4 follow-up) -----------------
//
// Gated behind PHOTON_URL_LIVE so this suite is a documented no-op until
// E05-T4 wires up the Photon container/CI plumbing (see docs/03-api-spec.md,
// E05-T4 acceptance: "CI startet Photon-LI und E05-T1-Integration läuft
// dagegen"). Not run and not claimed green in this task -- Photon does not
// run in this sandbox.
describe.skipIf(!process.env.PHOTON_URL_LIVE)('search plugin HTTP (live Photon container)', () => {
  it('GET /search against a real Photon (LI index) finds "Vaduz"', async () => {
    const fastify = Fastify();
    await fastify.register(searchPlugin, {
      prefix: '/api/v1',
      photonUrl: process.env.PHOTON_URL_LIVE,
      regionsProvider: allowAllProvider(),
    });
    await fastify.ready();
    try {
      const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=Vaduz' });
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as { data: SearchResult[] };
      expect(parsed.data.some((r) => r.name.toLowerCase().includes('vaduz'))).toBe(true);
    } finally {
      await fastify.close();
    }
  });
});
