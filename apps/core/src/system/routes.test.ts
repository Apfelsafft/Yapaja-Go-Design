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

describe('GET /api/v1/system/preflight (feat/gui-install-path)', () => {
  const GB = 1024 ** 3;

  async function appWith(deps: Parameters<typeof systemPlugin>[1]['preflightDeps']) {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, { dataDir: '/fake/data/dir', preflightDeps: deps });
    return app;
  }

  it('reicht den Bericht durch, so wie die Prüfung ihn erzeugt hat', async () => {
    const app = await appWith({
      env: {
        TILES_DIR: '/data/tiles',
        MQTT_BROKER_URL: 'mqtt://x:1883',
        GPSD_ENABLED: 'true',
      },
      listDir: async () => ['liechtenstein.pmtiles'],
      fileSize: async () => 1024,
      tcpProbe: async () => true,
      httpProbe: async () => true,
      totalMem: () => 16 * GB,
      diskFree: async () => 40 * GB,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { status: string; checks: unknown[]; checkedAt: string } };
    expect(body.data.status).toBe('ok');
    expect(body.data.checks).toHaveLength(7);
    expect(body.data.checkedAt).toBe('2026-09-01T10:00:00.000Z');

    await app.close();
  });

  // Der wichtigste Test dieser Datei. Eine unvollständige Installation ist
  // GENAU der Fall, für den diese Seite existiert -- wenn sie dann einen
  // Fehlerstatus liefert, verschluckt generische Fehlerbehandlung im Client
  // (oder ein Reverse Proxy) die Erklärung, die der Betreiber gerade
  // braucht. Der Zustand gehört in den Rumpf, nicht in den HTTP-Status.
  it('antwortet auch bei kaputter Installation mit 200 -- der Zustand steht im Rumpf', async () => {
    const app = await appWith({
      env: {},
      listDir: async () => {
        throw new Error('ENOENT');
      },
      fileSize: async () => null,
      tcpProbe: async () => false,
      httpProbe: async () => false,
      totalMem: () => 8 * GB,
      diskFree: async () => 1 * GB,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { status: string; checks: Array<{ id: string; status: string; remedy?: string }> };
    };
    expect(body.data.status).toBe('fail');
    const tiles = body.data.checks.find((c) => c.id === 'tiles');
    expect(tiles?.status).toBe('fail');
    expect(tiles?.remedy).toBeTruthy();

    await app.close();
  });

  it('läuft ohne injizierte Sonden gegen die echte Umgebung, ohne zu werfen', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, {});
    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { checks: Array<{ id: string }> } };
    expect(body.data.checks.map((c) => c.id)).toContain('tiles');
    await app.close();
  });
});
