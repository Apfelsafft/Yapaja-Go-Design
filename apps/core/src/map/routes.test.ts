import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Buffer } from 'node:buffer';
import { setImmediate } from 'node:timers';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import {
  createFixtureTilesDir,
  buildPMTilesFixtureBuffer,
  FIXTURE_BOUNDS,
  type FixtureDirHandle,
} from './__fixtures__/pmtiles-fixture.js';

const FIXTURE_SIZE = 20000;

describe('Map / tiles routes integration', () => {
  let server: FastifyInstance;
  let fixture: FixtureDirHandle;

  beforeEach(async () => {
    fixture = createFixtureTilesDir({ germany: { totalSize: FIXTURE_SIZE } });
    process.env.TILES_DIR = fixture.dir;
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    fixture.cleanup();
    delete process.env.TILES_DIR;
  });

  describe('GET /tiles/:region.pmtiles - range requests', () => {
    it('returns 206 with exact bytes and Content-Range for a range from the start', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: 'bytes=0-16383' },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers['content-range']).toBe(`bytes 0-16383/${FIXTURE_SIZE}`);
      expect(response.headers['content-length']).toBe('16384');
      expect(response.rawPayload.length).toBe(16384);

      const expected = buildPMTilesFixtureBuffer({ totalSize: FIXTURE_SIZE }).subarray(0, 16384);
      expect(Buffer.compare(response.rawPayload, expected)).toBe(0);
    });

    it('returns 206 with exact bytes for a range in the middle of the file', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: 'bytes=5000-9999' },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers['content-range']).toBe(`bytes 5000-9999/${FIXTURE_SIZE}`);
      expect(response.headers['content-length']).toBe('5000');
      expect(response.rawPayload.length).toBe(5000);

      const expected = buildPMTilesFixtureBuffer({ totalSize: FIXTURE_SIZE }).subarray(5000, 10000);
      expect(Buffer.compare(response.rawPayload, expected)).toBe(0);
    });

    it('returns 206 for a suffix range (last N bytes)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: 'bytes=-500' },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers['content-range']).toBe(
        `bytes ${FIXTURE_SIZE - 500}-${FIXTURE_SIZE - 1}/${FIXTURE_SIZE}`,
      );
      expect(response.headers['content-length']).toBe('500');
      expect(response.rawPayload.length).toBe(500);

      const expected = buildPMTilesFixtureBuffer({ totalSize: FIXTURE_SIZE }).subarray(
        FIXTURE_SIZE - 500,
      );
      expect(Buffer.compare(response.rawPayload, expected)).toBe(0);
    });

    it('returns 206 for an open-ended range (N-)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: 'bytes=19000-' },
      });

      expect(response.statusCode).toBe(206);
      expect(response.headers['content-range']).toBe(`bytes 19000-19999/${FIXTURE_SIZE}`);
      expect(response.headers['content-length']).toBe('1000');
      expect(response.rawPayload.length).toBe(1000);
    });

    it('returns 416 with Content-Range: bytes */<size> for an invalid range', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: `bytes=${FIXTURE_SIZE + 100}-${FIXTURE_SIZE + 200}` },
      });

      expect(response.statusCode).toBe(416);
      expect(response.headers['content-range']).toBe(`bytes */${FIXTURE_SIZE}`);
    });

    it('returns 416 for garbage range syntax', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { range: 'bytes=abc-def' },
      });

      expect(response.statusCode).toBe(416);
      expect(response.headers['content-range']).toBe(`bytes */${FIXTURE_SIZE}`);
    });

    it('returns the full file with 200 when no Range header is sent', async () => {
      const response = await server.inject({ method: 'GET', url: '/tiles/germany.pmtiles' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-length']).toBe(String(FIXTURE_SIZE));
      expect(response.rawPayload.length).toBe(FIXTURE_SIZE);
      expect(response.headers['accept-ranges']).toBe('bytes');
      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    });
  });

  describe('GET /tiles/:region.pmtiles - ETag / conditional requests', () => {
    it('sets an ETag on a normal response', async () => {
      const response = await server.inject({ method: 'GET', url: '/tiles/germany.pmtiles' });
      expect(response.statusCode).toBe(200);
      expect(response.headers.etag).toBeTruthy();
    });

    it('returns 304 when If-None-Match matches the current ETag', async () => {
      const first = await server.inject({ method: 'GET', url: '/tiles/germany.pmtiles' });
      const etag = first.headers.etag as string;

      const second = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { 'if-none-match': etag },
      });

      expect(second.statusCode).toBe(304);
      expect(second.rawPayload.length).toBe(0);
    });

    it('serves 200 when If-None-Match does not match', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/germany.pmtiles',
        headers: { 'if-none-match': '"stale-etag"' },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /tiles/:region.pmtiles - unknown region', () => {
    it('returns 404 in the unified error format for an unknown region', async () => {
      const response = await server.inject({ method: 'GET', url: '/tiles/nonexistent.pmtiles' });
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
    });
  });

  describe('GET /tiles/:region.pmtiles - path traversal defense', () => {
    const maliciousUrls = [
      '/tiles/..%2f..%2fetc%2fpasswd.pmtiles',
      '/tiles/%2e%2e%2fsecret.pmtiles',
      '/tiles/%2Fetc%2Fpasswd.pmtiles',
      '/tiles/foo bar.pmtiles',
      '/tiles/foo%00bar.pmtiles',
      '/tiles/..pmtiles',
      '/tiles/.pmtiles',
    ];

    for (const url of maliciousUrls) {
      it(`rejects "${url}" with 400 or 404, never touching files outside TILES_DIR`, async () => {
        const response = await server.inject({ method: 'GET', url });
        expect([400, 404]).toContain(response.statusCode);
      });
    }

    it('never resolves a region outside TILES_DIR even via encoded traversal', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tiles/..%2f..%2f..%2f..%2fetc%2fpasswd.pmtiles',
      });
      expect([400, 404]).toContain(response.statusCode);
      // Must not have leaked /etc/passwd content (which starts with "root:").
      expect(response.body).not.toContain('root:');
    });
  });

  describe('GET /tiles/:region.pmtiles - concurrent load', () => {
    it('serves 50 concurrent range requests without errors or FD leaks', async () => {
      const requests = Array.from({ length: 50 }, (_, i) => {
        const start = (i * 300) % (FIXTURE_SIZE - 1000);
        const end = start + 999;
        return server.inject({
          method: 'GET',
          url: '/tiles/germany.pmtiles',
          headers: { range: `bytes=${start}-${end}` },
        });
      });

      const responses = await Promise.all(requests);

      for (const response of responses) {
        expect(response.statusCode).toBe(206);
        expect(response.rawPayload.length).toBe(1000);
      }

      // Give any close/destroy handlers a tick to run, then check we're not
      // accumulating open file descriptors (Linux-only best-effort check).
      await new Promise((resolveFn) => setImmediate(resolveFn));

      if (process.platform === 'linux') {
        const { readdirSync } = await import('fs');
        const fdCountBefore = readdirSync('/proc/self/fd').length;
        // Run a second wave to make sure counts stay stable (no accumulation).
        const secondWave = Array.from({ length: 50 }, (_, i) => {
          const start = (i * 137) % (FIXTURE_SIZE - 1000);
          return server.inject({
            method: 'GET',
            url: '/tiles/germany.pmtiles',
            headers: { range: `bytes=${start}-${start + 999}` },
          });
        });
        await Promise.all(secondWave);
        await new Promise((resolveFn) => setImmediate(resolveFn));
        const fdCountAfter = readdirSync('/proc/self/fd').length;
        // Allow small slack for unrelated fds opened by the test runner itself.
        expect(fdCountAfter).toBeLessThanOrEqual(fdCountBefore + 10);
      }
    });
  });

  describe('GET /api/v1/map/regions', () => {
    it('lists the fixture region with plausible bounds and file size', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/map/regions' });
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        data: Array<{
          region: string;
          bounds: [number, number, number, number];
          size_bytes: number;
          minzoom: number;
          maxzoom: number;
        }>;
      };

      expect(body.data).toHaveLength(1);
      const region = body.data[0];
      expect(region.region).toBe('germany');
      expect(region.size_bytes).toBe(FIXTURE_SIZE);

      const [minLon, minLat, maxLon, maxLat] = region.bounds;
      expect(minLon).toBeCloseTo(FIXTURE_BOUNDS.minLon, 5);
      expect(minLat).toBeCloseTo(FIXTURE_BOUNDS.minLat, 5);
      expect(maxLon).toBeCloseTo(FIXTURE_BOUNDS.maxLon, 5);
      expect(maxLat).toBeCloseTo(FIXTURE_BOUNDS.maxLat, 5);
      expect(minLon).toBeGreaterThanOrEqual(-180);
      expect(maxLon).toBeLessThanOrEqual(180);
      expect(minLat).toBeGreaterThanOrEqual(-90);
      expect(maxLat).toBeLessThanOrEqual(90);
    });
  });
});
