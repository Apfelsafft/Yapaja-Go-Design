/**
 * Unit tests for PhotonBackend: GeoJSON -> SearchResult mapping, error
 * status handling, and the 3s per-request timeout. All network I/O is
 * intercepted via the injectable `fetchImpl` seam -- no live Photon needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateSearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from './errors.js';
import { PhotonBackend } from './photonBackend.js';
import type { FetchLike, HttpResponseLike } from './httpTypes.js';

function jsonResponse(json: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

const VADUZ_FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [9.5215, 47.141] },
  properties: { name: 'Vaduz', country: 'Liechtenstein', osm_value: 'city' },
};

describe('PhotonBackend', () => {
  it('maps a Photon GeoJSON response to schema-valid SearchResult[]', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ features: [VADUZ_FEATURE] });
    const backend = new PhotonBackend({ fetchImpl });

    const results = await backend.search({ q: 'Vaduz', limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'Vaduz',
      source: 'photon',
      type: 'city',
      latlng: { lat: 47.141, lon: 9.5215 },
    });
    expect(results[0].label).toContain('Vaduz');
    expect(validateSearchResult(results[0])).toBe(true);
  });

  it('passes q/limit/lang and lat/lon bias through as query params', async () => {
    let capturedUrl = '';
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url;
      return jsonResponse({ features: [] });
    };
    const backend = new PhotonBackend({ fetchImpl, baseUrl: 'http://photon.local' });

    await backend.search({ q: 'Vaduz', limit: 5, lat: 47.1, lon: 9.5, lang: 'de' });

    expect(capturedUrl).toContain('http://photon.local/api?');
    expect(capturedUrl).toContain('q=Vaduz');
    expect(capturedUrl).toContain('limit=5');
    expect(capturedUrl).toContain('lat=47.1');
    expect(capturedUrl).toContain('lon=9.5');
    expect(capturedUrl).toContain('lang=de');
  });

  it('reverse geocode hits /reverse and maps results', async () => {
    let capturedUrl = '';
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url;
      return jsonResponse({ features: [VADUZ_FEATURE] });
    };
    const backend = new PhotonBackend({ fetchImpl });

    const results = await backend.reverse({ lat: 47.141, lon: 9.5215, limit: 1 });

    expect(capturedUrl).toContain('/reverse?');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('photon');
  });

  it('returns [] for an empty features array (no hits, not an error)', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ features: [] });
    const backend = new PhotonBackend({ fetchImpl });

    const results = await backend.search({ q: 'zzzzzz-nonexistent', limit: 10 });
    expect(results).toEqual([]);
  });

  it('throws GeocoderBackendError(UNAVAILABLE) on a non-ok HTTP status', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 500);
    const backend = new PhotonBackend({ fetchImpl });

    await expect(backend.search({ q: 'x', limit: 10 })).rejects.toMatchObject({
      name: 'GeocoderBackendError',
      backend: 'photon',
      code: 'UNAVAILABLE',
    });
  });

  it('throws GeocoderBackendError(BAD_RESPONSE) on malformed JSON shape', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({ notFeatures: true });
    const backend = new PhotonBackend({ fetchImpl });

    await expect(backend.search({ q: 'x', limit: 10 })).rejects.toThrow(GeocoderBackendError);
  });

  it('times out after 3s and throws GeocoderBackendError(TIMEOUT)', async () => {
    vi.useFakeTimers();
    try {
      const hangingFetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      const backend = new PhotonBackend({ fetchImpl: hangingFetch, timeoutMs: 3000 });

      const pending = backend.search({ q: 'x', limit: 10 });
      const assertion = expect(pending).rejects.toMatchObject({
        name: 'GeocoderBackendError',
        code: 'TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(3000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
