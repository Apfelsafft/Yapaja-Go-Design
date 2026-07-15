/**
 * Unit tests for NominatimBackend: jsonv2 -> SearchResult mapping, the
 * required User-Agent header, the 3s timeout, and -- most importantly -- the
 * max-1-req/s rate limit (E05-T1 Pflicht-Test), driven with fake timers so
 * the wait is asserted deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateSearchResult } from '@yapaja/shared';
import type { FetchLike, HttpResponseLike } from './httpTypes.js';
import { NominatimBackend } from './nominatimBackend.js';
import { RateLimiter } from './rateLimiter.js';

function jsonResponse(json: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

const VADUZ_ITEM = {
  lat: '47.141',
  lon: '9.5215',
  display_name: 'Vaduz, Liechtenstein',
  name: 'Vaduz',
  type: 'city',
};

describe('NominatimBackend', () => {
  it('maps a jsonv2 response to schema-valid SearchResult[]', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse([VADUZ_ITEM]);
    const backend = new NominatimBackend({ fetchImpl, rateLimiter: new RateLimiter(0) });

    const results = await backend.search({ q: 'Vaduz', limit: 10 });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: 'Vaduz',
      label: 'Vaduz, Liechtenstein',
      source: 'nominatim',
      type: 'city',
      latlng: { lat: 47.141, lon: 9.5215 },
    });
    expect(validateSearchResult(results[0])).toBe(true);
  });

  it('sends a descriptive User-Agent header (Nominatim usage policy)', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl: FetchLike = async (_url, init) => {
      capturedHeaders = init.headers;
      return jsonResponse([]);
    };
    const backend = new NominatimBackend({
      fetchImpl,
      userAgent: 'YapajaGoTest/1.0',
      rateLimiter: new RateLimiter(0),
    });

    await backend.search({ q: 'x', limit: 10 });

    expect(capturedHeaders['User-Agent']).toBe('YapajaGoTest/1.0');
  });

  it('reverse geocode hits /reverse with jsonv2 and maps the single result', async () => {
    let capturedUrl = '';
    const fetchImpl: FetchLike = async (url) => {
      capturedUrl = url;
      return jsonResponse(VADUZ_ITEM);
    };
    const backend = new NominatimBackend({ fetchImpl, rateLimiter: new RateLimiter(0) });

    const results = await backend.reverse({ lat: 47.141, lon: 9.5215, limit: 1 });

    expect(capturedUrl).toContain('/reverse?');
    expect(capturedUrl).toContain('format=jsonv2');
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('nominatim');
  });

  it('returns [] for an empty result array (no hits, not an error)', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse([]);
    const backend = new NominatimBackend({ fetchImpl, rateLimiter: new RateLimiter(0) });

    const results = await backend.search({ q: 'zzzzzz-nonexistent', limit: 10 });
    expect(results).toEqual([]);
  });

  it('throws GeocoderBackendError(UNAVAILABLE) on a non-ok HTTP status', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 503);
    const backend = new NominatimBackend({ fetchImpl, rateLimiter: new RateLimiter(0) });

    await expect(backend.search({ q: 'x', limit: 10 })).rejects.toMatchObject({
      name: 'GeocoderBackendError',
      backend: 'nominatim',
      code: 'UNAVAILABLE',
    });
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
      const backend = new NominatimBackend({
        fetchImpl: hangingFetch,
        timeoutMs: 3000,
        rateLimiter: new RateLimiter(0),
      });

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

  describe('rate limit (max 1 req/s)', () => {
    it('a second immediate request waits >= 1s before hitting the network', async () => {
      vi.useFakeTimers();
      try {
        const callTimestamps: number[] = [];
        const fetchImpl: FetchLike = async () => {
          callTimestamps.push(Date.now());
          return jsonResponse([]);
        };
        // Real (default) 1000ms rate limiter -- this is the actual policy under test.
        const backend = new NominatimBackend({ fetchImpl });

        const first = backend.search({ q: 'a', limit: 1 });
        await vi.advanceTimersByTimeAsync(0);
        await first;

        const secondStart = Date.now();
        const second = backend.search({ q: 'b', limit: 1 });

        await vi.advanceTimersByTimeAsync(999);
        expect(callTimestamps).toHaveLength(1); // second hasn't hit the network yet

        await vi.advanceTimersByTimeAsync(1);
        await second;

        expect(callTimestamps).toHaveLength(2);
        expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThanOrEqual(1000);
        expect(callTimestamps[1] - secondStart).toBeGreaterThanOrEqual(999);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
