/**
 * Integration test for the disk-full pre-check (W-18) wired through the
 * real POST /api/v1/map/regions route -- as opposed to disk.test.ts, which
 * unit-tests checkDiskSpace() in isolation.
 *
 * Registers `regionsPlugin` directly on a standalone Fastify instance (not
 * the full `buildServer()`) so an injected `statfsImpl` can simulate a
 * near-full disk without needing a real small filesystem or touching the
 * production wiring in index.ts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { regionsPlugin } from './routes.js';

describe('POST /api/v1/map/regions -- disk-full pre-check (W-18)', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setUpCatalog(sizeBytes: number): void {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-diskcheck-tiles-'));
    const catalogDir = mkdtempSync(join(tmpdir(), 'yapaja-diskcheck-catalog-'));
    tempDirs.push(tilesDir, catalogDir);

    const catalogPath = join(catalogDir, 'catalog.json');
    writeFileSync(
      catalogPath,
      JSON.stringify([
        {
          id: 'bigregion',
          name: 'Big Region',
          url: 'http://127.0.0.1:1/unused.pmtiles', // never actually requested
          sizeBytes,
          bounds: [0, 0, 1, 1],
        },
      ]),
    );

    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = catalogPath;
  }

  it('rejects with 409 INSUFFICIENT_SPACE and a correct calculation when free space is too small', async () => {
    setUpCatalog(1_000_000_000); // needs 1 GB

    app = Fastify({ logger: false });
    // ~409,600 bytes free -- nowhere near 1GB + margin.
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 100, bsize: 4096 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions',
      payload: { region_id: 'bigregion' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: { code: string; details: Record<string, number> } };
    expect(body.error.code).toBe('INSUFFICIENT_SPACE');
    expect(body.error.details.freeBytes).toBe(100 * 4096);
    expect(body.error.details.requiredBytes).toBe(1_000_000_000);
  });

  it('allows the download to start (202) when free space comfortably covers required + margin', async () => {
    setUpCatalog(1000); // tiny region

    app = Fastify({ logger: false });
    // ~40 GB free.
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions',
      payload: { region_id: 'bigregion' },
    });

    // The mock catalog's URL (127.0.0.1:1) isn't a real server, so the
    // download itself will fail asynchronously after we've already gotten
    // our 202 -- irrelevant to this test, which only asserts the disk
    // check let the request past the pre-check.
    expect(response.statusCode).toBe(202);
    expect(response.json()).toHaveProperty('job_id');
  });
});
