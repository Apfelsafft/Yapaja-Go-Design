/**
 * Integration test for GET /api/v1/system/resources (E08-T5) -- registers
 * `systemPlugin` directly on a standalone Fastify instance (not the full
 * `buildServer()`, mirroring `map/regions/disk-check.routes.test.ts`) so an
 * injected statfs/os can prove the endpoint reports REAL measured values
 * (the plausibility requirement) rather than a hardcoded number.
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { systemPlugin } from './routes.js';

describe('GET /api/v1/system/resources (E08-T5, W-12/W-18)', () => {
  it('returns the injected statfs/os values verbatim, correctly converted to bytes', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 250_000, blocks: 1_000_000, bsize: 4096 }),
      freeMemFn: () => 2_147_483_648, // 2 GiB
      totalMemFn: () => 8_589_934_592, // 8 GiB
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/resources' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Record<string, number> };
    expect(body.data).toEqual({
      disk_free_bytes: 250_000 * 4096,
      disk_total_bytes: 1_000_000 * 4096,
      mem_free_bytes: 2_147_483_648,
      mem_total_bytes: 8_589_934_592,
    });

    await app.close();
  });

  it('two different injected snapshots produce two different responses (not a hardcoded constant)', async () => {
    const appLow: FastifyInstance = Fastify({ logger: false });
    await appLow.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 10, blocks: 100, bsize: 1024 }),
      freeMemFn: () => 100,
      totalMemFn: () => 200,
    });
    const appHigh: FastifyInstance = Fastify({ logger: false });
    await appHigh.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 999_999, blocks: 9_999_999, bsize: 1024 }),
      freeMemFn: () => 999_999,
      totalMemFn: () => 1_999_999,
    });

    const low = (await appLow.inject({ method: 'GET', url: '/api/v1/system/resources' })).json() as {
      data: Record<string, number>;
    };
    const high = (await appHigh.inject({ method: 'GET', url: '/api/v1/system/resources' })).json() as {
      data: Record<string, number>;
    };

    expect(low.data).not.toEqual(high.data);

    await appLow.close();
    await appHigh.close();
  });

  it('defaults dataDir to resolveTilesDir() and calls the real fs.statfs/os when no deps are injected', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    const prevTilesDir = process.env.TILES_DIR;
    process.env.TILES_DIR = process.cwd(); // guaranteed to exist
    try {
      await app.register(systemPlugin, {});
      const response = await app.inject({ method: 'GET', url: '/api/v1/system/resources' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Record<string, number> };
      expect(body.data.disk_free_bytes).toBeGreaterThan(0);
      expect(body.data.mem_total_bytes).toBeGreaterThan(0);
    } finally {
      if (prevTilesDir === undefined) delete process.env.TILES_DIR;
      else process.env.TILES_DIR = prevTilesDir;
      await app.close();
    }
  });
});
