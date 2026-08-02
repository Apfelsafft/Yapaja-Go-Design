/**
 * Route tests for the add-on service surfaces (E09-T3): the operator-facing
 * token issuance (the `runtime: external` path, docs/05 §1B/§7), the service/
 * watchdog status endpoint, and the `ha.notify` bridge. Driven through a real
 * `buildServer()` so the auth hook and the wiring in `index.ts` are included.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddonManifest } from '@yapaja/shared';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import { AddonTokenService } from './tokens.js';

const EXTERNAL_ID = 'com.example.signdetect';

function manifestFor(id: string, overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id,
    name: 'Sign Detector',
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'runs in its own container (docs/05 §7)',
    permissions: ['pos.read', 'events.publish', 'ha.notify'],
    service: { runtime: 'external', entry: 'service/main.js' },
    ...overrides,
  };
}

let parentDir: string;
let server: FastifyInstance;
let repository: AddonRepository;
let tokens: AddonTokenService;

function install(id: string, enabled: boolean, manifest = manifestFor(id)): void {
  repository.insert({
    id,
    name: manifest.name,
    version: manifest.version,
    manifest,
    enabled,
    installPath: join(parentDir, 'addons', id),
  });
}

describe('add-on service routes (E09-T3)', () => {
  beforeEach(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'addon-service-routes-'));
    process.env.ADDONS_DIR = join(parentDir, 'addons');
    process.env.ADDON_STORAGE_DIR = join(parentDir, 'addon-storage');
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
    await server.ready();
    repository = new AddonRepository();
    tokens = new AddonTokenService({ repository });
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    rmSync(parentDir, { recursive: true, force: true });
  });

  describe('POST /addons/:id/token (the runtime:external path)', () => {
    it('mints a usable scoped token, surfaced exactly once', async () => {
      install(EXTERNAL_ID, true);
      const res = await server.inject({ method: 'POST', url: `/api/v1/addons/${EXTERNAL_ID}/token` });
      expect(res.statusCode).toBe(200);
      const token = JSON.parse(res.body).data.token as string;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const principal = tokens.authenticate(token);
      expect(principal?.addonId).toBe(EXTERNAL_ID);
      expect(principal?.scopes.has('pos.read')).toBe(true);

      // The token is never echoed anywhere else -- the status endpoint only
      // reports THAT one exists.
      const status = await server.inject({ method: 'GET', url: `/api/v1/addons/${EXTERNAL_ID}/service` });
      expect(status.body).not.toContain(token);
      expect(JSON.parse(status.body).data.token_issued_at).toBeTruthy();
    });

    it('ROTATES on every call -- the previous token dies at once', async () => {
      install(EXTERNAL_ID, true);
      const first = JSON.parse(
        (await server.inject({ method: 'POST', url: `/api/v1/addons/${EXTERNAL_ID}/token` })).body,
      ).data.token as string;
      const second = JSON.parse(
        (await server.inject({ method: 'POST', url: `/api/v1/addons/${EXTERNAL_ID}/token` })).body,
      ).data.token as string;
      expect(second).not.toBe(first);
      expect(tokens.authenticate(first)).toBeNull();
      expect(tokens.authenticate(second)).not.toBeNull();
    });

    it('refuses to issue a token for a DISABLED add-on', async () => {
      install(EXTERNAL_ID, false);
      const res = await server.inject({ method: 'POST', url: `/api/v1/addons/${EXTERNAL_ID}/token` });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe('ADDON_DISABLED');
    });

    it('404s for an unknown add-on', async () => {
      const res = await server.inject({ method: 'POST', url: '/api/v1/addons/com.nope/token' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /addons/:id/service', () => {
    it('reports an external add-on as never running', async () => {
      install(EXTERNAL_ID, true);
      await server.inject({ method: 'POST', url: `/api/v1/addons/${EXTERNAL_ID}/enable` });
      const status = JSON.parse(
        (await server.inject({ method: 'GET', url: `/api/v1/addons/${EXTERNAL_ID}/service` })).body,
      ).data;
      expect(status).toMatchObject({
        addon_id: EXTERNAL_ID,
        runtime: 'external',
        external: true,
        running: false,
        pid: null,
        throttled: false,
        restarts: 0,
        crashes_in_window: 0,
        auto_disabled_reason: null,
      });
      // Enabling an external add-on still provisions its credential.
      expect(status.token_issued_at).toBeTruthy();
    });

    it('is readable BY the add-on itself, but not for another add-on', async () => {
      install(EXTERNAL_ID, true);
      install('com.example.other', true, manifestFor('com.example.other'));
      const token = tokens.issue(EXTERNAL_ID, manifestFor(EXTERNAL_ID).permissions);

      const own = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${EXTERNAL_ID}/service`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(own.statusCode).toBe(200);

      const foreign = await server.inject({
        method: 'GET',
        url: '/api/v1/addons/com.example.other/service',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(foreign.statusCode).toBe(403);
      expect(JSON.parse(foreign.body).error.code).toBe('FOREIGN_ADDON');
    });

    it('404s for an unknown add-on', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/addons/com.nope/service' });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /addons/:id/notifications (ha.notify)', () => {
    it('accepts a notification with the scope', async () => {
      install(EXTERNAL_ID, true);
      const token = tokens.issue(EXTERNAL_ID, ['ha.notify']);
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${EXTERNAL_ID}/notifications`,
        headers: { authorization: `Bearer ${token}` },
        payload: { title: 'Tempolimit', message: '80 erkannt' },
      });
      expect(res.statusCode).toBe(202);
    });

    it('403s without the ha.notify scope', async () => {
      install(EXTERNAL_ID, true);
      const token = tokens.issue(EXTERNAL_ID, ['pos.read']);
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${EXTERNAL_ID}/notifications`,
        headers: { authorization: `Bearer ${token}` },
        payload: { message: 'nope' },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('SCOPE_MISSING');
    });

    it('rejects an empty/missing message', async () => {
      install(EXTERNAL_ID, true);
      const token = tokens.issue(EXTERNAL_ID, ['ha.notify']);
      for (const payload of [{}, { message: '' }, { message: '   ' }, { message: 42 }]) {
        const res = await server.inject({
          method: 'POST',
          url: `/api/v1/addons/${EXTERNAL_ID}/notifications`,
          headers: { authorization: `Bearer ${token}` },
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
    });
  });

  describe('POST /addons/:id/events payload cap', () => {
    it('rejects an oversized payload', async () => {
      install(EXTERNAL_ID, true);
      const token = tokens.issue(EXTERNAL_ID, ['events.publish']);
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${EXTERNAL_ID}/events`,
        headers: { authorization: `Bearer ${token}` },
        payload: { topic: 'flood', payload: { blob: 'x'.repeat(70 * 1024) } },
      });
      expect(res.statusCode).toBe(413);
      expect(JSON.parse(res.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });
});
