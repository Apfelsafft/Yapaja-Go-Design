/**
 * Integration tests for the region manager (E01-T5): resumable download
 * (W-17), disk-full pre-check is covered separately in
 * disk-check.routes.test.ts (needs a standalone Fastify instance with an
 * injected statfsFn), job progress, and DELETE rules.
 *
 * All downloads target a local `http.createServer()` mock on an ephemeral
 * port -- never a real foreign host.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { buildServer } from '../../index.js';
import { closeDb } from '../../db/index.js';
import { buildPMTilesFixtureBuffer } from '../__fixtures__/pmtiles-fixture.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface JobBody {
  data: {
    id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    progress: number;
    bytes: number;
    totalBytes: number | null;
    error: { code: string; message: string } | null;
  };
}

describe('Region manager routes (E01-T5)', () => {
  let server: FastifyInstance;
  let mockServer: Server;
  let mockPort: number;
  let tilesDir: string;
  let catalogPath: string;
  let regionBuffer: Buffer;
  let regionHash: string;
  // When set, the mock server writes only this many bytes of the requested
  // range and then abruptly destroys the connection (simulating a dropped
  // LTE connection mid-download, W-17).
  let abortAfterBytes: number | null;
  // When set, the mock server writes the body in two chunks with a short
  // delay between them, so tests can observe an intermediate progress
  // value while the job is still 'running'.
  let slowChunked: boolean;

  function requestHandler(req: IncomingMessage, res: ServerResponse): void {
    const rangeHeader = req.headers['range'];
    let start = 0;
    if (typeof rangeHeader === 'string') {
      const match = /bytes=(\d+)-/.exec(rangeHeader);
      if (match) {
        start = parseInt(match[1], 10);
      }
    }
    const body = regionBuffer.subarray(start);

    if (typeof rangeHeader === 'string') {
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${regionBuffer.length - 1}/${regionBuffer.length}`,
        'Content-Length': String(body.length),
      });
    } else {
      res.writeHead(200, { 'Content-Length': String(body.length) });
    }

    if (abortAfterBytes !== null) {
      const cut = Math.max(0, abortAfterBytes - start);
      // Wait for the write callback (data actually handed to the socket)
      // before destroying -- destroying synchronously right after write()
      // can discard the not-yet-flushed bytes entirely, which would make
      // this simulate a 0-byte response rather than a ~50% abort.
      res.write(body.subarray(0, cut), () => {
        res.destroy();
      });
      return;
    }

    if (slowChunked && body.length > 10) {
      const mid = Math.floor(body.length / 2);
      res.write(body.subarray(0, mid));
      setTimeout(() => {
        res.end(body.subarray(mid));
      }, 60);
      return;
    }

    res.end(body);
  }

  beforeEach(async () => {
    tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-regions-'));

    regionBuffer = Buffer.alloc(200_000);
    for (let i = 0; i < regionBuffer.length; i++) {
      regionBuffer[i] = i % 256;
    }
    regionHash = sha256(regionBuffer);
    abortAfterBytes = null;
    slowChunked = false;

    mockServer = createServer(requestHandler);
    await new Promise<void>((resolveListen) => mockServer.listen(0, '127.0.0.1', resolveListen));
    const address = mockServer.address();
    if (address === null || typeof address === 'string') {
      throw new Error('mock server did not bind to a port');
    }
    mockPort = address.port;

    const catalogDir = mkdtempSync(join(tmpdir(), 'yapaja-catalog-'));
    catalogPath = join(catalogDir, 'catalog.json');
    writeFileSync(
      catalogPath,
      JSON.stringify([
        {
          id: 'mockregion',
          name: 'Mock Region',
          url: `http://127.0.0.1:${mockPort}/mockregion.pmtiles`,
          sizeBytes: regionBuffer.length,
          bounds: [9.0, 47.0, 9.6, 47.3],
          sha256: regionHash,
        },
      ]),
    );

    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = catalogPath;
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    await new Promise<void>((resolveClose) => mockServer.close(() => resolveClose()));
    closeDb();
    rmSync(tilesDir, { recursive: true, force: true });
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
  });

  async function pollJob(
    jobId: string,
    predicate: (job: JobBody['data']) => boolean,
    timeoutMs = 5000,
  ): Promise<JobBody['data']> {
    const deadline = Date.now() + timeoutMs;
    let last: JobBody['data'] | undefined;
    while (Date.now() < deadline) {
      const response = await server.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}` });
      const body = response.json() as JobBody;
      last = body.data;
      if (predicate(body.data)) {
        return body.data;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 15));
    }
    throw new Error(`Timed out waiting for job condition. Last state: ${JSON.stringify(last)}`);
  }

  describe('GET /api/v1/map/regions/catalog', () => {
    it('lists catalog entries with an installed flag reflecting disk state', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/map/regions/catalog' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Array<{ id: string; installed: boolean }> };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('mockregion');
      expect(body.data[0].installed).toBe(false);

      // Install it directly (bypassing download) and re-check the flag flips.
      writeFileSync(join(tilesDir, 'mockregion.pmtiles'), buildPMTilesFixtureBuffer({}));
      const second = await server.inject({ method: 'GET', url: '/api/v1/map/regions/catalog' });
      expect((second.json() as { data: Array<{ installed: boolean }> }).data[0].installed).toBe(true);
    });
  });

  describe('POST /api/v1/map/regions -- resumable download (W-17)', () => {
    it('resumes after an ~50% abort and finishes with the correct sha256, no leftover .part', async () => {
      abortAfterBytes = Math.floor(regionBuffer.length / 2);

      const first = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      expect(first.statusCode).toBe(202);
      const jobId1 = (first.json() as { job_id: string }).job_id;

      const errored = await pollJob(jobId1, (job) => job.status === 'error');
      expect(errored.error).toBeTruthy();

      const partFile = join(tilesDir, 'mockregion.pmtiles.part');
      expect(existsSync(partFile)).toBe(true);
      const partSize = readFileSync(partFile).length;
      expect(partSize).toBeGreaterThan(0);
      expect(partSize).toBeLessThan(regionBuffer.length);

      // Second attempt: let it complete fully this time.
      abortAfterBytes = null;
      const second = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      expect(second.statusCode).toBe(202);
      const jobId2 = (second.json() as { job_id: string }).job_id;

      const done = await pollJob(jobId2, (job) => job.status === 'done' || job.status === 'error');
      expect(done.status).toBe('done');
      expect(done.progress).toBe(1);

      expect(existsSync(partFile)).toBe(false);
      const finalFile = join(tilesDir, 'mockregion.pmtiles');
      expect(existsSync(finalFile)).toBe(true);
      expect(sha256(readFileSync(finalFile))).toBe(regionHash);
    });

    it('deletes the .part file and reports a job error on sha256 mismatch, core keeps serving', async () => {
      // Corrupt the catalog's expected hash so the download "succeeds" over
      // the wire but fails verification.
      writeFileSync(
        catalogPath,
        JSON.stringify([
          {
            id: 'mockregion',
            name: 'Mock Region',
            url: `http://127.0.0.1:${mockPort}/mockregion.pmtiles`,
            sizeBytes: regionBuffer.length,
            bounds: [9.0, 47.0, 9.6, 47.3],
            sha256: '0'.repeat(64),
          },
        ]),
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      expect(response.statusCode).toBe(202);
      const jobId = (response.json() as { job_id: string }).job_id;

      const errored = await pollJob(jobId, (job) => job.status === 'error');
      expect(errored.error?.code).toBe('HASH_MISMATCH');

      expect(existsSync(join(tilesDir, 'mockregion.pmtiles.part'))).toBe(false);
      expect(existsSync(join(tilesDir, 'mockregion.pmtiles'))).toBe(false);

      // The core process itself must still be healthy/responsive.
      const health = await server.inject({ method: 'GET', url: '/api/v1/health' });
      expect(health.statusCode).toBe(200);
    });

    it('reports 400 for a missing or invalid region_id', async () => {
      const missing = await server.inject({ method: 'POST', url: '/api/v1/map/regions', payload: {} });
      expect(missing.statusCode).toBe(400);

      const invalid = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: '../etc' },
      });
      expect(invalid.statusCode).toBe(400);
    });

    it('reports 404 for a region_id not present in the catalog', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'does-not-exist' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('reports 409 ALREADY_INSTALLED when the region is already fully installed', async () => {
      writeFileSync(join(tilesDir, 'mockregion.pmtiles'), buildPMTilesFixtureBuffer({}));
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { code: string } }).error.code).toBe('ALREADY_INSTALLED');
    });
  });

  describe('GET /api/v1/jobs/:id -- progress history', () => {
    it('shows an intermediate running/progress state before reaching done', async () => {
      slowChunked = true;
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      const jobId = (response.json() as { job_id: string }).job_id;

      const running = await pollJob(
        jobId,
        (job) => job.status === 'running' && job.progress > 0 && job.progress < 1,
      );
      expect(running.bytes).toBeGreaterThan(0);
      expect(running.bytes).toBeLessThan(regionBuffer.length);

      const done = await pollJob(jobId, (job) => job.status === 'done' || job.status === 'error');
      expect(done.status).toBe('done');
      expect(done.progress).toBe(1);
    });

    it('returns 404 for an unknown job id', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/jobs/unknown-job-id' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/map/regions/:id -- last-region rule', () => {
    it('refuses to delete the only installed region with 409', async () => {
      writeFileSync(join(tilesDir, 'solo.pmtiles'), buildPMTilesFixtureBuffer({}));

      const response = await server.inject({ method: 'DELETE', url: '/api/v1/map/regions/solo' });
      expect(response.statusCode).toBe(409);

      const list = await server.inject({ method: 'GET', url: '/api/v1/map/regions' });
      expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
    });

    it('deletes a region when another remains installed, and it disappears from the listing', async () => {
      writeFileSync(join(tilesDir, 'first.pmtiles'), buildPMTilesFixtureBuffer({}));
      writeFileSync(join(tilesDir, 'second.pmtiles'), buildPMTilesFixtureBuffer({}));

      const response = await server.inject({ method: 'DELETE', url: '/api/v1/map/regions/second' });
      expect(response.statusCode).toBe(204);

      const list = await server.inject({ method: 'GET', url: '/api/v1/map/regions' });
      const regions = (list.json() as { data: Array<{ region: string }> }).data;
      expect(regions.map((r) => r.region)).toEqual(['first']);
    });

    it('returns 404 for an unknown region', async () => {
      writeFileSync(join(tilesDir, 'first.pmtiles'), buildPMTilesFixtureBuffer({}));
      const response = await server.inject({ method: 'DELETE', url: '/api/v1/map/regions/unknown' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/jobs/:id -- cancellation', () => {
    it('cancels a running job, which then reports status error/CANCELLED', async () => {
      slowChunked = true;
      const post = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      const jobId = (post.json() as { job_id: string }).job_id;

      await pollJob(jobId, (job) => job.status === 'running');
      const cancel = await server.inject({ method: 'DELETE', url: `/api/v1/jobs/${jobId}` });
      expect(cancel.statusCode).toBe(204);

      const finished = await pollJob(jobId, (job) => job.status === 'error');
      expect(finished.error?.code).toBe('CANCELLED');
    });

    it('returns 409 when cancelling an already-finished job, 404 for unknown', async () => {
      const post = await server.inject({
        method: 'POST',
        url: '/api/v1/map/regions',
        payload: { region_id: 'mockregion' },
      });
      const jobId = (post.json() as { job_id: string }).job_id;
      await pollJob(jobId, (job) => job.status === 'done' || job.status === 'error');

      const cancel = await server.inject({ method: 'DELETE', url: `/api/v1/jobs/${jobId}` });
      expect(cancel.statusCode).toBe(409);

      const unknown = await server.inject({ method: 'DELETE', url: '/api/v1/jobs/unknown-id' });
      expect(unknown.statusCode).toBe(404);
    });
  });
});
