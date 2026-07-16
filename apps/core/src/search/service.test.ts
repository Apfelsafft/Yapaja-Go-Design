/**
 * SearchService backend-chain tests (E05-T1 Pflicht-Test), fully mock-based:
 *  - coords hit short-circuits Photon/Nominatim entirely
 *  - Photon hit is returned, Nominatim never called
 *  - Photon 0 hits + online_fallback:true -> Nominatim called
 *  - online_fallback:false -> Nominatim never called even on Photon 0 hits
 *  - Photon throws (down) -> degraded health + chain continues to Nominatim
 *    (when online_fallback is on) or returns [] (when it's off) -- never crashes
 *  - out_of_coverage marking is applied to whichever backend's results win
 */
import { describe, it, expect, vi } from 'vitest';
import type { SearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from './errors.js';
import type { SearchRegionsProvider } from './coverage.js';
import { SearchService } from './service.js';
import type { GeocoderBackend, ReverseQuery, SearchQuery } from './types.js';

const COORDS_RESULT: SearchResult = {
  name: 'Koordinaten',
  label: '47.14000, 9.52000',
  latlng: { lat: 47.14, lon: 9.52 },
  type: 'coordinates',
  source: 'coords',
};

const PHOTON_RESULT: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz, Liechtenstein',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'photon',
};

const NOMINATIM_RESULT: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz, Liechtenstein',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'nominatim',
};

const LITE_RESULT: SearchResult = {
  name: 'Vaduz',
  label: 'Vaduz',
  latlng: { lat: 47.141, lon: 9.5215 },
  type: 'city',
  source: 'lite',
};

function backend(
  source: SearchResult['source'],
  impl: {
    search?: (q: SearchQuery) => Promise<SearchResult[]>;
    reverse?: (q: ReverseQuery) => Promise<SearchResult[]>;
  } = {},
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

const QUERY: SearchQuery = { q: 'Vaduz', limit: 10 };
const REVERSE_QUERY: ReverseQuery = { lat: 47.141, lon: 9.5215, limit: 1 };

describe('SearchService', () => {
  describe('search() chain', () => {
    it('coords hit short-circuits the chain: Photon/Nominatim never called', async () => {
      const photonSearch = vi.fn(async () => [PHOTON_RESULT]);
      const nominatimSearch = vi.fn(async () => [NOMINATIM_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords', { search: async () => [COORDS_RESULT] }),
        photonBackend: backend('photon', { search: photonSearch }),
        nominatimBackend: backend('nominatim', { search: nominatimSearch }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search({ q: '47.14, 9.52', limit: 10 });

      expect(results).toEqual([COORDS_RESULT]);
      expect(photonSearch).not.toHaveBeenCalled();
      expect(nominatimSearch).not.toHaveBeenCalled();
    });

    it('Photon hit is returned; Nominatim is never called', async () => {
      const nominatimSearch = vi.fn(async () => [NOMINATIM_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [PHOTON_RESULT] }),
        nominatimBackend: backend('nominatim', { search: nominatimSearch }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([PHOTON_RESULT]);
      expect(nominatimSearch).not.toHaveBeenCalled();
    });

    it('Photon 0 hits + online_fallback:true -> falls through to Nominatim', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [] }),
        nominatimBackend: backend('nominatim', { search: async () => [NOMINATIM_RESULT] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([NOMINATIM_RESULT]);
    });

    it('Photon 0 hits + online_fallback:false -> Nominatim is never called, [] returned', async () => {
      const nominatimSearch = vi.fn(async () => [NOMINATIM_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [] }),
        nominatimBackend: backend('nominatim', { search: nominatimSearch }),
        onlineFallback: false,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([]);
      expect(nominatimSearch).not.toHaveBeenCalled();
    });

    it('Photon down (throws) + online_fallback:true -> degraded + falls through to Nominatim', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'Photon is unreachable');
          },
        }),
        nominatimBackend: backend('nominatim', { search: async () => [NOMINATIM_RESULT] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([NOMINATIM_RESULT]);
      expect(service.getBackendHealth().photon).toBe('degraded');
    });

    it('Photon down (throws) + online_fallback:false -> [] returned, never crashes', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'TIMEOUT', 'timed out');
          },
        }),
        nominatimBackend: backend('nominatim'),
        onlineFallback: false,
        regionsProvider: allowAllProvider(),
      });

      await expect(service.search(QUERY)).resolves.toEqual([]);
      expect(service.getBackendHealth().photon).toBe('degraded');
    });

    it('online_fallback:true but no nominatimBackend configured -> no crash, [] returned', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      await expect(service.search(QUERY)).resolves.toEqual([]);
    });

    it('a successful backend call marks that backend healthy', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [PHOTON_RESULT] }),
        regionsProvider: allowAllProvider(),
      });

      await service.search(QUERY);

      expect(service.getBackendHealth().photon).toBe('ok');
    });

    it('applies out_of_coverage marking to the winning backend\'s results', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [PHOTON_RESULT] }),
        regionsProvider: {
          getInstalledRegions: async () => [
            { id: 'somewhere-else', name: 'x', bounds: [0, 0, 1, 1] },
          ],
        },
      });

      const results = await service.search(QUERY);

      expect(results[0].out_of_coverage).toBe(true);
    });
  });

  // E05-T5 (W-12) mandatory "Failover-Integration" test: Photon down/disabled
  // -> lite is used (source:'lite'); Photon healthy -> lite is NEVER used,
  // even with 0 hits (existing E05-T1 behavior stays intact).
  describe('lite fallback chain (E05-T5, W-12)', () => {
    it('Photon down (throws) -> lite is used, results carry source:"lite"', async () => {
      const liteSearch = vi.fn(async () => [LITE_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'Photon is unreachable');
          },
        }),
        liteBackend: backend('lite', { search: liteSearch }),
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([LITE_RESULT]);
      expect(liteSearch).toHaveBeenCalledTimes(1);
      expect(service.getBackendHealth().photon).toBe('degraded');
    });

    it('Photon healthy with a real hit -> lite is never called', async () => {
      const liteSearch = vi.fn(async () => [LITE_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [PHOTON_RESULT] }),
        liteBackend: backend('lite', { search: liteSearch }),
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([PHOTON_RESULT]);
      expect(liteSearch).not.toHaveBeenCalled();
    });

    it('Photon healthy but 0 hits -> lite must NOT override a healthy Photon (falls through to Nominatim/[] exactly as pre-E05-T5)', async () => {
      const liteSearch = vi.fn(async () => [LITE_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [] }),
        liteBackend: backend('lite', { search: liteSearch }),
        onlineFallback: false,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([]);
      expect(liteSearch).not.toHaveBeenCalled();
    });

    it('Photon healthy, 0 hits, online_fallback:true -> Nominatim is used, lite is still never called', async () => {
      const liteSearch = vi.fn(async () => [LITE_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: async () => [] }),
        liteBackend: backend('lite', { search: liteSearch }),
        nominatimBackend: backend('nominatim', { search: async () => [NOMINATIM_RESULT] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([NOMINATIM_RESULT]);
      expect(liteSearch).not.toHaveBeenCalled();
    });

    it('photonEnabled:false -> Photon is never called, lite is used directly, photon health is "disabled"', async () => {
      const photonSearch = vi.fn(async () => [PHOTON_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { search: photonSearch }),
        liteBackend: backend('lite', { search: async () => [LITE_RESULT] }),
        photonEnabled: false,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([LITE_RESULT]);
      expect(photonSearch).not.toHaveBeenCalled();
      expect(service.getBackendHealth().photon).toBe('disabled');
    });

    it('Photon down + lite also 0 hits + online_fallback:true -> falls through to Nominatim', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'TIMEOUT', 'timed out');
          },
        }),
        liteBackend: backend('lite', { search: async () => [] }),
        nominatimBackend: backend('nominatim', { search: async () => [NOMINATIM_RESULT] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search(QUERY);

      expect(results).toEqual([NOMINATIM_RESULT]);
    });

    it('Photon down + no liteBackend configured -> no crash, falls through exactly as pre-E05-T5', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'down');
          },
        }),
        regionsProvider: allowAllProvider(),
      });

      await expect(service.search(QUERY)).resolves.toEqual([]);
    });

    it('lite itself throws (index not built) -> degraded + chain continues, no crash', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'down');
          },
        }),
        liteBackend: backend('lite', {
          search: async () => {
            throw new GeocoderBackendError('lite', 'UNAVAILABLE', 'Lite-Suchindex nicht gebaut');
          },
        }),
        regionsProvider: allowAllProvider(),
      });

      await expect(service.search(QUERY)).resolves.toEqual([]);
      expect(service.getBackendHealth().lite).toBe('degraded');
    });

    it('coords hit still short-circuits everything, even with lite configured', async () => {
      const liteSearch = vi.fn(async () => [LITE_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords', { search: async () => [COORDS_RESULT] }),
        photonBackend: backend('photon'),
        liteBackend: backend('lite', { search: liteSearch }),
        regionsProvider: allowAllProvider(),
      });

      const results = await service.search({ q: '47.14, 9.52', limit: 10 });

      expect(results).toEqual([COORDS_RESULT]);
      expect(liteSearch).not.toHaveBeenCalled();
    });

    it('out_of_coverage marking is applied to lite results too', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', {
          search: async () => {
            throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'down');
          },
        }),
        liteBackend: backend('lite', { search: async () => [LITE_RESULT] }),
        regionsProvider: {
          getInstalledRegions: async () => [{ id: 'somewhere-else', name: 'x', bounds: [0, 0, 1, 1] }],
        },
      });

      const results = await service.search(QUERY);

      expect(results[0].out_of_coverage).toBe(true);
      expect(results[0].source).toBe('lite');
    });

    describe('reverse()', () => {
      it('Photon down -> lite.reverse() is used', async () => {
        const liteReverse = vi.fn(async () => [LITE_RESULT]);
        const service = new SearchService({
          coordsBackend: backend('coords'),
          photonBackend: backend('photon', {
            reverse: async () => {
              throw new GeocoderBackendError('photon', 'UNAVAILABLE', 'down');
            },
          }),
          liteBackend: backend('lite', { reverse: liteReverse }),
          regionsProvider: allowAllProvider(),
        });

        const results = await service.reverse(REVERSE_QUERY);

        expect(results).toEqual([LITE_RESULT]);
        expect(liteReverse).toHaveBeenCalledTimes(1);
      });

      it('Photon healthy with 0 hits -> lite.reverse() is NOT used', async () => {
        const liteReverse = vi.fn(async () => [LITE_RESULT]);
        const service = new SearchService({
          coordsBackend: backend('coords'),
          photonBackend: backend('photon', { reverse: async () => [] }),
          liteBackend: backend('lite', { reverse: liteReverse }),
          onlineFallback: false,
          regionsProvider: allowAllProvider(),
        });

        const results = await service.reverse(REVERSE_QUERY);

        expect(results).toEqual([]);
        expect(liteReverse).not.toHaveBeenCalled();
      });

      it('photonEnabled:false -> lite.reverse() is used directly', async () => {
        const photonReverse = vi.fn(async () => [PHOTON_RESULT]);
        const service = new SearchService({
          coordsBackend: backend('coords'),
          photonBackend: backend('photon', { reverse: photonReverse }),
          liteBackend: backend('lite', { reverse: async () => [LITE_RESULT] }),
          photonEnabled: false,
          regionsProvider: allowAllProvider(),
        });

        const results = await service.reverse(REVERSE_QUERY);

        expect(results).toEqual([LITE_RESULT]);
        expect(photonReverse).not.toHaveBeenCalled();
      });
    });
  });

  describe('reverse() chain', () => {
    it('Photon hit is returned; Nominatim never called', async () => {
      const nominatimReverse = vi.fn(async () => [NOMINATIM_RESULT]);
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { reverse: async () => [PHOTON_RESULT] }),
        nominatimBackend: backend('nominatim', { reverse: nominatimReverse }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.reverse(REVERSE_QUERY);

      expect(results).toEqual([PHOTON_RESULT]);
      expect(nominatimReverse).not.toHaveBeenCalled();
    });

    it('Photon 0 hits + online_fallback:true -> Nominatim reverse is used', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { reverse: async () => [] }),
        nominatimBackend: backend('nominatim', { reverse: async () => [NOMINATIM_RESULT] }),
        onlineFallback: true,
        regionsProvider: allowAllProvider(),
      });

      const results = await service.reverse(REVERSE_QUERY);

      expect(results).toEqual([NOMINATIM_RESULT]);
    });

    it('Photon 0 hits + online_fallback:false -> [] returned', async () => {
      const service = new SearchService({
        coordsBackend: backend('coords'),
        photonBackend: backend('photon', { reverse: async () => [] }),
        onlineFallback: false,
        regionsProvider: allowAllProvider(),
      });

      await expect(service.reverse(REVERSE_QUERY)).resolves.toEqual([]);
    });
  });
});
