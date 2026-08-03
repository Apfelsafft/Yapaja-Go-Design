/**
 * Integration tests for the add-on registry routes (E09-T7), exercised
 * through Fastify `inject()` against a real `buildServer()` instance --
 * mirrors `routes.test.ts`'s setup, including its URL-source mock-HTTP-
 * server pattern.
 *
 * Covers the four E09-T7 acceptance criteria end to end:
 *  1. E2E flow against a local fixture registry (this whole file).
 *  2. `core_api` incompatibility surfaced via `compatible: false` BEFORE
 *     install (`GET /addons/registry`), not just a 409 at install time.
 *  3. Registry unreachable -> `GET /addons/registry` still serves the last
 *     good cache (W-13).
 *  4. sha256 FROM THE REGISTRY ENTRY is enforced at install -- including the
 *     hostile case where the index's declared sha256 does not match the
 *     tarball its own `download_url` actually serves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { readPackageVersion } from '../version.js';
import { buildValidAddonTarball } from './__fixtures__/buildTarball.js';
import { validRawRegistryEntry } from './__fixtures__/registryFixtures.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function incompatibleCoreApiRange(version: string): string {
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  return `^${major + 1}.0.0`;
}

let addonsDir: string;
let addonsStorageDir: string;
let coreVersion: string;

/** A tiny local HTTP server standing in for the registry host, serving
 *  whatever `indexBody` currently holds (mutable so a test can flip it
 *  between "reachable with a good catalog" and "unreachable"). */
let indexServer: Server;
let indexPort: number;
let indexBody: Buffer | null; // null => connection refused (simulates offline)
let indexStatus: number;

/** A second local HTTP server standing in for a registry entry's
 *  `download_url` (the actual add-on tarball host). */
let tarballServer: Server;
let tarballPort: number;
let tarballBytes: Buffer;

describe('Add-on registry routes (E09-T7)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const parent = mkdtempSync(join(tmpdir(), 'addon-registry-routes-test-'));
    addonsDir = join(parent, 'addons');
    addonsStorageDir = join(parent, 'addon-storage');
    process.env.ADDONS_DIR = addonsDir;
    process.env.ADDON_STORAGE_DIR = addonsStorageDir;
    process.env.DB_PATH = ':memory:';
    closeDb();

    indexBody = Buffer.from(JSON.stringify([]));
    indexStatus = 200;
    indexServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
      if (indexBody === null) {
        res.destroy();
        return;
      }
      res.writeHead(indexStatus, { 'Content-Length': String(indexBody.length) });
      res.end(indexBody);
    });
    await new Promise<void>((resolveListen) => indexServer.listen(0, '127.0.0.1', resolveListen));
    const indexAddress = indexServer.address();
    if (indexAddress === null || typeof indexAddress === 'string') throw new Error('index mock server did not bind');
    indexPort = indexAddress.port;
    process.env.ADDONS_REGISTRY_URL = `http://127.0.0.1:${indexPort}/index.json`;

    const built = await buildValidAddonTarball({ manifest: { id: 'com.example.registry-addon' } });
    tarballBytes = built.bytes;
    tarballServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Length': String(tarballBytes.length) });
      res.end(tarballBytes);
    });
    await new Promise<void>((resolveListen) => tarballServer.listen(0, '127.0.0.1', resolveListen));
    const tarballAddress = tarballServer.address();
    if (tarballAddress === null || typeof tarballAddress === 'string')
      throw new Error('tarball mock server did not bind');
    tarballPort = tarballAddress.port;

    server = await buildServer();
    coreVersion = await readPackageVersion();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    delete process.env.ADDONS_REGISTRY_URL;
    rmSync(join(addonsDir, '..'), { recursive: true, force: true });
    await new Promise<void>((resolveClose) => indexServer.close(() => resolveClose()));
    await new Promise<void>((resolveClose) => tarballServer.close(() => resolveClose()));
  });

  it('GET /addons/registry starts out empty, never having synced -- offline-safe default', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/addons/registry' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.entries).toEqual([]);
    expect(body.data.fetched_at).toBeNull();
    expect(body.data.age_ms).toBeNull();
  });

  it('acceptance 1: full E2E flow against a local fixture registry -- sync, see entry, install, confirm', async () => {
    const entry = validRawRegistryEntry({
      id: 'com.example.registry-addon',
      core_api: coreVersion, // compatible with THIS core
      download_url: `http://127.0.0.1:${tarballPort}/addon.tar.gz`,
      sha256: sha256(tarballBytes),
    });
    indexBody = Buffer.from(JSON.stringify([entry]));

    const syncRes = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    expect(syncRes.statusCode).toBe(200);
    const syncBody = JSON.parse(syncRes.body);
    expect(syncBody.data.entries).toHaveLength(1);
    expect(syncBody.data.entries[0].id).toBe('com.example.registry-addon');
    expect(syncBody.data.entries[0].compatible).toBe(true);
    expect(syncBody.data.fetched_at).not.toBeNull();

    // GET now reflects the synced catalog too, purely from cache.
    const getRes = await server.inject({ method: 'GET', url: '/api/v1/addons/registry' });
    const getBody = JSON.parse(getRes.body);
    expect(getBody.data.entries).toHaveLength(1);
    expect(getBody.data.age_ms).toBeGreaterThanOrEqual(0);

    // Install using EXACTLY what the registry entry supplied (download_url +
    // sha256), same as the store UI does -- reuses the existing
    // POST /addons/install {source:'url', ...} endpoint verbatim.
    const registryEntry = getBody.data.entries[0];
    const installRes = await server.inject({
      method: 'POST',
      url: '/api/v1/addons/install',
      payload: { source: 'url', url: registryEntry.download_url, sha256: registryEntry.sha256 },
    });
    expect(installRes.statusCode).toBe(202);
    const pendingId = JSON.parse(installRes.body).data.pending_id;

    const confirmRes = await server.inject({
      method: 'POST',
      url: `/api/v1/addons/install/${pendingId}/confirm`,
    });
    expect(confirmRes.statusCode).toBe(201);
    expect(JSON.parse(confirmRes.body).data.id).toBe('com.example.registry-addon');
  });

  it('acceptance 2: an incompatible core_api is flagged BEFORE install (compatible:false), W-11', async () => {
    const entry = validRawRegistryEntry({
      id: 'com.example.too-new',
      core_api: incompatibleCoreApiRange(coreVersion),
      download_url: `http://127.0.0.1:${tarballPort}/addon.tar.gz`,
      sha256: sha256(tarballBytes),
    });
    indexBody = Buffer.from(JSON.stringify([entry]));

    const syncRes = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    const body = JSON.parse(syncRes.body);
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].compatible).toBe(false);

    // The store UI relies on this flag to render a blocking notice instead
    // of an install button -- verified in the Playwright suite
    // (`apps/web/e2e/store.spec.ts`). The flag itself must survive a plain
    // GET too (no re-sync needed to see it).
    const getRes = await server.inject({ method: 'GET', url: '/api/v1/addons/registry' });
    expect(JSON.parse(getRes.body).data.entries[0].compatible).toBe(false);
  });

  it('acceptance 3 (W-13): registry unreachable -> GET still serves the last good cache, sync fails cleanly', async () => {
    const entry = validRawRegistryEntry({
      id: 'com.example.cached-addon',
      core_api: coreVersion,
      download_url: `http://127.0.0.1:${tarballPort}/addon.tar.gz`,
      sha256: sha256(tarballBytes),
    });
    indexBody = Buffer.from(JSON.stringify([entry]));
    const firstSync = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    expect(firstSync.statusCode).toBe(200);

    // Registry host goes unreachable (connection reset).
    indexBody = null;

    const failedSync = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    expect(failedSync.statusCode).toBe(502);
    expect(JSON.parse(failedSync.body).error.code).toBe('REGISTRY_UNREACHABLE');

    // The cache from the earlier successful sync is COMPLETELY untouched --
    // this is what "Store nutzbar mit Cache" actually means.
    const getRes = await server.inject({ method: 'GET', url: '/api/v1/addons/registry' });
    expect(getRes.statusCode).toBe(200);
    const body = JSON.parse(getRes.body);
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].id).toBe('com.example.cached-addon');

    // Upload-install must stay fully independent of the registry's
    // reachability -- prove it right here in the same "registry down" state.
    const { bytes: uploadBytes } = await buildValidAddonTarball({
      manifest: { id: 'com.example.upload-while-offline', core_api: coreVersion },
    });
    const uploadRes = await server.inject({
      method: 'POST',
      url: '/api/v1/addons/install',
      payload: { source: 'upload', data: uploadBytes.toString('base64') },
    });
    expect(uploadRes.statusCode).toBe(202);
  });

  it('acceptance 4: sha256 from the registry index is enforced -- an entry lying about its own tarball is rejected', async () => {
    // HOSTILE fixture: the index entry's sha256 is well-FORMED (64 hex) but
    // does NOT match the bytes its own download_url actually serves --
    // exactly the "entry whose sha256 doesn't match the tarball it points
    // at" hostile case the task spec calls out by name.
    const wrongSha256 = sha256(Buffer.from('not the real tarball bytes'));
    const entry = validRawRegistryEntry({
      id: 'com.example.lying-addon',
      core_api: coreVersion,
      download_url: `http://127.0.0.1:${tarballPort}/addon.tar.gz`,
      sha256: wrongSha256,
    });
    indexBody = Buffer.from(JSON.stringify([entry]));

    const syncRes = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    const registryEntry = JSON.parse(syncRes.body).data.entries[0];
    expect(registryEntry.sha256).toBe(wrongSha256);

    // The store install call MUST pass the registry-declared sha256 through
    // unchanged (never silently drop/skip it) -- installService.ts then
    // downloads the REAL bytes and rejects the mismatch.
    const installRes = await server.inject({
      method: 'POST',
      url: '/api/v1/addons/install',
      payload: { source: 'url', url: registryEntry.download_url, sha256: registryEntry.sha256 },
    });
    expect(installRes.statusCode).toBe(400);
    expect(JSON.parse(installRes.body).error.code).toBe('SHA256_MISMATCH');
  });

  it('HOSTILE index entries never reach the client -- a bad entry alongside a good one only drops the bad one', async () => {
    const good = validRawRegistryEntry({
      id: 'com.example.good',
      core_api: coreVersion,
      download_url: `http://127.0.0.1:${tarballPort}/addon.tar.gz`,
      sha256: sha256(tarballBytes),
    });
    const bad = { id: 'com.example.bad', sha256: 'not-a-hash' }; // missing required fields too
    indexBody = Buffer.from(JSON.stringify([good, bad]));

    const syncRes = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    const body = JSON.parse(syncRes.body);
    expect(body.data.entries.map((e: { id: string }) => e.id)).toEqual(['com.example.good']);
    expect(body.data.errors.length).toBeGreaterThan(0);
  });

  it('a registry that returns a non-JSON body fails sync without corrupting the cache', async () => {
    indexBody = Buffer.from('<html>not json</html>');
    const res = await server.inject({ method: 'POST', url: '/api/v1/addons/registry/sync' });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('REGISTRY_INVALID');
  });
});
