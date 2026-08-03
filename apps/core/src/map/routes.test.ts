import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Buffer } from 'node:buffer';
import { readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
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
    /**
     * Counts ONLY the file descriptors of THIS test's own fixture tile file.
     *
     * E10-T1 de-flake. The previous version of this check compared the TOTAL
     * `/proc/self/fd` entry count before/after a wave of requests, with a
     * `+10` slack. Both halves of that were unsound:
     *
     *  1. `/proc/self/fd` is PROCESS-global, and Vitest 1.x's default pool is
     *     `threads` -- many test FILES run concurrently as worker_threads of
     *     the SAME process. Every SQLite handle, temp fixture dir, socket and
     *     module file another test file opens or closes between the two
     *     samples lands in this test's delta. Nothing about the tiles route
     *     is being measured there.
     *  2. The wave was not quiesced. `createReadStream(...).destroy()` closes
     *     its fd through libuv's threadpool (4 threads by default), which the
     *     other worker threads in the same process are also queued on. One
     *     `setImmediate` is nowhere near enough for 50 closes to complete, so
     *     the "after" sample routinely counts still-closing descriptors.
     *
     *     Measured on this repo (temporary probe, 6 full `npx vitest run`s):
     *     delta was 0, 9, 0, 0, 0, -1 -- i.e. one run in six came within a
     *     single descriptor of tripping the `+10` threshold, purely from
     *     unrelated parallel activity. That is the flake.
     *
     * Scoping the count to fds that `readlink()` to this test's own fixture
     * path (a per-`beforeEach` `mkdtemp` dir, so no other test file can ever
     * hold one) makes the measurement independent of everything else in the
     * process -- and lets the assertion be the STRICTER, exact one it always
     * meant to be: zero descriptors left open on the tile file, rather than a
     * fuzzy global +/-10.
     */
    function openFixtureFdCount(): number {
      const filePath = join(fixture.dir, 'germany.pmtiles');
      let count = 0;
      for (const entry of readdirSync('/proc/self/fd')) {
        try {
          if (readlinkSync(`/proc/self/fd/${entry}`) === filePath) count += 1;
        } catch {
          // The fd vanished between readdir and readlink (it was closing) --
          // that is precisely the "not leaked" case, so skip it.
        }
      }
      return count;
    }

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

      if (process.platform === 'linux') {
        // Run a second wave to make sure descriptors do not accumulate.
        const secondWave = Array.from({ length: 50 }, (_, i) => {
          const start = (i * 137) % (FIXTURE_SIZE - 1000);
          return server.inject({
            method: 'GET',
            url: '/tiles/germany.pmtiles',
            headers: { range: `bytes=${start}-${start + 999}` },
          });
        });
        await Promise.all(secondWave);

        // Event-loop-driven wait for quiescence (NOT a fixed sleep): poll
        // until every descriptor this route opened on the fixture file has
        // actually been closed. `vi.waitFor` re-runs the callback on the
        // event loop and fails with the last error if the condition never
        // holds -- so a REAL leak still fails the test, it just no longer
        // fails on unrelated threadpool latency.
        await vi.waitFor(
          () => {
            expect(openFixtureFdCount()).toBe(0);
          },
          { timeout: 5_000, interval: 20 },
        );
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
