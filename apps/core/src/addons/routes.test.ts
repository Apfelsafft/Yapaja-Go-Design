/**
 * Integration tests for the add-on install/lifecycle routes (E09-T1),
 * exercised through Fastify `inject()` against a real `buildServer()`
 * instance -- mirrors `favorites/routes.test.ts`'s setup.
 *
 * Covers: the full two-step scope-confirm install flow (upload source),
 * sha256 mismatch rejection, incompatible `core_api` rejection, every
 * malicious-tarball attack rejected at the HTTP layer, a URL-source
 * install against a local mock HTTP server, and the enable/disable/
 * uninstall lifecycle end to end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { Buffer } from 'node:buffer';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { readPackageVersion } from '../version.js';
import { buildTarball, buildValidAddonTarball } from './__fixtures__/buildTarball.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** A `core_api` range guaranteed NOT to be satisfied by `version`, however
 *  it resolves in this environment (`readPackageVersion()` falls back to
 *  "0.0.0" under vitest -- see `version.ts`'s doc comment -- so this must
 *  stay derived rather than hardcoded). */
function incompatibleCoreApiRange(version: string): string {
  const major = parseInt(version.split('.')[0] ?? '0', 10);
  return `^${major + 1}.0.0`;
}

let addonsDir: string;
let addonsStorageDir: string;
let coreVersion: string;

describe('Add-on install/lifecycle routes (E09-T1)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const parent = mkdtempSync(join(tmpdir(), 'addon-routes-test-'));
    addonsDir = join(parent, 'addons');
    addonsStorageDir = join(parent, 'addon-storage');
    process.env.ADDONS_DIR = addonsDir;
    process.env.ADDON_STORAGE_DIR = addonsStorageDir;
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
    coreVersion = await readPackageVersion();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    rmSync(join(addonsDir, '..'), { recursive: true, force: true });
  });

  describe('two-step scope-confirm install (upload source)', () => {
    it('installs a valid add-on end to end, disabled by default, then enable/disable/list/uninstall work', async () => {
      const { bytes, manifest } = await buildValidAddonTarball({ manifest: { core_api: coreVersion } });

      const installRes = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: bytes.toString('base64') },
      });
      expect(installRes.statusCode).toBe(202);
      const installBody = JSON.parse(installRes.body);
      expect(installBody.data.manifest.id).toBe(manifest.id);
      expect(installBody.data.permissions).toEqual(manifest.permissions);
      expect(installBody.data.pending_id).toBeTruthy();

      // Nothing installed yet.
      const listBefore = await server.inject({ method: 'GET', url: '/api/v1/addons' });
      expect(JSON.parse(listBefore.body).data).toEqual([]);

      const confirmRes = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/install/${installBody.data.pending_id}/confirm`,
      });
      expect(confirmRes.statusCode).toBe(201);
      const confirmBody = JSON.parse(confirmRes.body);
      expect(confirmBody.data.id).toBe(manifest.id);
      expect(confirmBody.data.enabled).toBe(false);

      const listAfter = await server.inject({ method: 'GET', url: '/api/v1/addons' });
      expect(JSON.parse(listAfter.body).data).toHaveLength(1);

      const enableRes = await server.inject({ method: 'POST', url: `/api/v1/addons/${manifest.id}/enable` });
      expect(enableRes.statusCode).toBe(200);
      expect(JSON.parse(enableRes.body).data.enabled).toBe(true);

      // E09-T8: "In Home Assistant verfügbar" -- default true, toggles
      // independently of `enabled`, never a 404 for an id that DOES exist.
      expect(JSON.parse(enableRes.body).data.mqtt_enabled).toBe(true);
      const mqttDisableRes = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${manifest.id}/mqtt/disable`,
      });
      expect(mqttDisableRes.statusCode).toBe(200);
      expect(JSON.parse(mqttDisableRes.body).data.mqtt_enabled).toBe(false);
      expect(JSON.parse(mqttDisableRes.body).data.enabled).toBe(true); // untouched
      const mqttEnableRes = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${manifest.id}/mqtt/enable`,
      });
      expect(mqttEnableRes.statusCode).toBe(200);
      expect(JSON.parse(mqttEnableRes.body).data.mqtt_enabled).toBe(true);

      const disableRes = await server.inject({ method: 'POST', url: `/api/v1/addons/${manifest.id}/disable` });
      expect(disableRes.statusCode).toBe(200);
      expect(JSON.parse(disableRes.body).data.enabled).toBe(false);

      const uninstallRes = await server.inject({ method: 'DELETE', url: `/api/v1/addons/${manifest.id}` });
      expect(uninstallRes.statusCode).toBe(204);

      const listFinal = await server.inject({ method: 'GET', url: '/api/v1/addons' });
      expect(JSON.parse(listFinal.body).data).toEqual([]);
      expect(existsSync(join(addonsDir, manifest.id))).toBe(false);
    });

    it('confirming a bogus pendingId returns 404', async () => {
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/install/does-not-exist/confirm' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('PENDING_NOT_FOUND');
    });

    it('enable/disable/uninstall on an unknown id all return 404', async () => {
      for (const req of [
        { method: 'POST' as const, url: '/api/v1/addons/nope/enable' },
        { method: 'POST' as const, url: '/api/v1/addons/nope/disable' },
        { method: 'POST' as const, url: '/api/v1/addons/nope/mqtt/enable' },
        { method: 'POST' as const, url: '/api/v1/addons/nope/mqtt/disable' },
        { method: 'DELETE' as const, url: '/api/v1/addons/nope' },
      ]) {
        const res = await server.inject(req);
        expect(res.statusCode).toBe(404);
      }
    });
  });

  describe('sha256 verification (upload source)', () => {
    it('rejects a mismatched sha256 with a clear 400', async () => {
      const { bytes } = await buildValidAddonTarball({ manifest: { core_api: coreVersion } });
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: bytes.toString('base64'), sha256: 'f'.repeat(64) },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('SHA256_MISMATCH');
    });

    it('accepts a matching sha256', async () => {
      const { bytes } = await buildValidAddonTarball({ manifest: { core_api: coreVersion } });
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: bytes.toString('base64'), sha256: sha256(bytes) },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe('core_api compatibility (Wargame W-11)', () => {
    it('rejects an incompatible core_api range with a clear message', async () => {
      const { bytes } = await buildValidAddonTarball({
        manifest: { core_api: incompatibleCoreApiRange(coreVersion) },
      });
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: bytes.toString('base64') },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INCOMPATIBLE_CORE_API');
      expect(body.error.message).toContain('core_api');
    });
  });

  describe('malicious tarballs are rejected at the HTTP layer', () => {
    async function installPayload(entries: Parameters<typeof buildTarball>[0]): Promise<{ source: 'upload'; data: string }> {
      const bytes = await buildTarball(entries);
      return { source: 'upload', data: bytes.toString('base64') };
    }

    it('rejects a path-traversal tarball', async () => {
      const payload = await installPayload([
        { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
        { name: '../../tmp/evil', content: 'pwned' },
      ]);
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/install', payload });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });

    it('rejects an absolute-path tarball', async () => {
      const payload = await installPayload([
        { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
        { name: '/etc/evil', content: 'pwned' },
      ]);
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/install', payload });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });

    it('rejects a symlink-entry tarball', async () => {
      const payload = await installPayload([
        { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
        { name: 'escape', type: 'symlink', linkname: '/etc/passwd' },
      ]);
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/install', payload });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });

    it('rejects a hardlink-entry tarball', async () => {
      const payload = await installPayload([
        { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
        { name: 'hard', type: 'link', linkname: '/etc/passwd' },
      ]);
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/install', payload });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });

    it('rejects a zip-bomb tarball (uncompressed cap)', async () => {
      const bytes = await buildTarball(
        [
          { name: 'yapaja-addon.json', content: JSON.stringify({ id: 'x' }) },
          { name: 'bomb.bin', content: Buffer.alloc(60 * 1024 * 1024, 0) },
        ],
        { gzip: true },
      );
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: bytes.toString('base64') },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });

    it('rejects garbage bytes that are not a tarball at all', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'upload', data: Buffer.from('not a tarball').toString('base64') },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('TARBALL_REJECTED');
    });
  });

  describe('URL/registry source install', () => {
    let mockServer: Server;
    let mockPort: number;
    let tarballBytes: Buffer;

    beforeEach(async () => {
      const built = await buildValidAddonTarball({
        manifest: { id: 'com.example.url-install', core_api: coreVersion },
      });
      tarballBytes = built.bytes;
      mockServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Length': String(tarballBytes.length) });
        res.end(tarballBytes);
      });
      await new Promise<void>((resolveListen) => mockServer.listen(0, '127.0.0.1', resolveListen));
      const address = mockServer.address();
      if (address === null || typeof address === 'string') throw new Error('mock server did not bind');
      mockPort = address.port;
    });

    afterEach(async () => {
      await new Promise<void>((resolveClose) => mockServer.close(() => resolveClose()));
    });

    it('requires a sha256 for a URL install', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: { source: 'url', url: `http://127.0.0.1:${mockPort}/addon.tar.gz` },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    });

    it('downloads, verifies sha256, and installs through the same two-step flow', async () => {
      const installRes = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: {
          source: 'url',
          url: `http://127.0.0.1:${mockPort}/addon.tar.gz`,
          sha256: sha256(tarballBytes),
        },
      });
      expect(installRes.statusCode).toBe(202);
      const pendingId = JSON.parse(installRes.body).data.pending_id;

      const confirmRes = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/install/${pendingId}/confirm`,
      });
      expect(confirmRes.statusCode).toBe(201);
      expect(JSON.parse(confirmRes.body).data.id).toBe('com.example.url-install');
    });

    it('rejects a wrong sha256 for a URL install', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/addons/install',
        payload: {
          source: 'url',
          url: `http://127.0.0.1:${mockPort}/addon.tar.gz`,
          sha256: 'a'.repeat(64),
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('SHA256_MISMATCH');
    });
  });
});
