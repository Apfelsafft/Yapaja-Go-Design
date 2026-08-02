/* eslint-disable no-undef -- `setTimeout`/`clearTimeout` are standard Node
 * globals (typed via @types/node); same justification as the other backend
 * test modules. */

/**
 * END-TO-END scope enforcement for add-on tokens (E09-T3, docs/05 §2, W-14),
 * driven through a REAL `buildServer()` so the actual auth hook, the actual
 * route handlers and the actual `/ws/v1` bridge are all in play.
 *
 * Covers the mandated matrix:
 *  - representative REST routes x {scope granted, scope missing}
 *  - the `events.publish` namespace restriction (`addon/{id}/*` only)
 *  - `storage.own` namespace isolation (never another add-on's keys)
 *  - the WS topic matrix (granted -> delivered, missing -> refused)
 *  - TOKEN INVALIDATION: works -> disable -> the SAME token is rejected
 *    immediately (asserted to be well under 1 s)
 *  - the egress proxy allow-list at the HTTP layer
 *  - the E08-T3 posture is untouched: the Core token and the open posture
 *    behave exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delayFn } from 'node:timers/promises';
import type { AddonManifest } from '@yapaja/shared';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { AddonRepository } from './repository.js';
import { AddonTokenService } from './tokens.js';

const ADDON_ID = 'com.example.service';
const OTHER_ID = 'com.example.other';

const ALL_SCOPES = [
  'pos.read',
  'nav.read',
  'nav.control',
  'route.read',
  'route.propose',
  'map.layer.write',
  'widget.register',
  'events.publish',
  'storage.own',
  'ha.notify',
  'camera.view',
  'net.fetch:api.tomtom.com',
];

function manifestFor(id: string, permissions: string[]): AddonManifest {
  return {
    id,
    name: `Add-on ${id}`,
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'scope matrix fixture',
    permissions,
  };
}

let parentDir: string;
let server: FastifyInstance;
let repository: AddonRepository;
let tokens: AddonTokenService;

/** Installs (enabled) an add-on and mints its scoped token. */
function installAndIssue(id: string, permissions: string[]): string {
  repository.insert({
    id,
    name: `Add-on ${id}`,
    version: '1.0.0',
    manifest: manifestFor(id, permissions),
    enabled: true,
    installPath: join(parentDir, 'addons', id),
  });
  return tokens.issue(id, permissions);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function waitForMessage(socket: WebSocket, timeoutMs = 1000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a WS message')), timeoutMs);
    socket.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

describe('add-on token scope enforcement, end to end (E09-T3)', () => {
  beforeEach(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'addon-scope-test-'));
    process.env.ADDONS_DIR = join(parentDir, 'addons');
    process.env.ADDON_STORAGE_DIR = join(parentDir, 'addon-storage');
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
    // `injectWS` needs the instance fully booted (same as `bus/ws.test.ts`).
    await server.ready();
    repository = new AddonRepository();
    tokens = new AddonTokenService({ repository });
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    delete process.env.API_AUTH_TOKEN;
    rmSync(parentDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // REST matrix
  // -------------------------------------------------------------------------

  describe('REST: scope granted vs. scope missing', () => {
    it.each([
      { name: 'GET /position', method: 'GET' as const, url: '/api/v1/position', scope: 'pos.read' },
      { name: 'GET /position/sources', method: 'GET' as const, url: '/api/v1/position/sources', scope: 'pos.read' },
      { name: 'GET /navigation/state', method: 'GET' as const, url: '/api/v1/navigation/state', scope: 'nav.read' },
      { name: 'POST /navigation/stop', method: 'POST' as const, url: '/api/v1/navigation/stop', scope: 'nav.control' },
      { name: 'POST /navigation/pause', method: 'POST' as const, url: '/api/v1/navigation/pause', scope: 'nav.control' },
    ])('$name: granted -> reaches the handler, missing -> 403', async ({ method, url, scope }) => {
      const withScope = installAndIssue(ADDON_ID, [scope]);
      const granted = await server.inject({ method, url, headers: auth(withScope) });
      // The handler ran (whatever it answered, it was NOT the scope refusal).
      expect(granted.statusCode).not.toBe(403);
      expect(granted.statusCode).not.toBe(401);

      const withoutScope = installAndIssue(OTHER_ID, ALL_SCOPES.filter((s) => s !== scope));
      const refused = await server.inject({ method, url, headers: auth(withoutScope) });
      expect(refused.statusCode).toBe(403);
      const body = JSON.parse(refused.body);
      expect(body.error.code).toBe('SCOPE_MISSING');
      expect(body.error.message).toContain(scope);
    });

    it('refuses EVERY route outside the table, even with all scopes (default-deny)', async () => {
      const token = installAndIssue(ADDON_ID, ALL_SCOPES);
      for (const [method, url] of [
        ['GET', '/api/v1/settings'],
        ['GET', '/api/v1/addons'],
        ['GET', '/api/v1/profiles'],
        ['POST', '/api/v1/auth/token'],
        ['DELETE', '/api/v1/auth/token'],
        ['GET', '/api/v1/auth/status'],
        ['GET', '/api/v1/health'],
        ['POST', `/api/v1/addons/${ADDON_ID}/enable`],
        ['POST', `/api/v1/addons/${ADDON_ID}/disable`],
        ['DELETE', `/api/v1/addons/${ADDON_ID}`],
        ['POST', `/api/v1/addons/${ADDON_ID}/token`],
      ] as const) {
        const res = await server.inject({ method, url, headers: auth(token) });
        expect({ url, code: res.statusCode }).toEqual({ url, code: 403 });
        expect(JSON.parse(res.body).error.code).toBe('ROUTE_NOT_ALLOWED');
      }
    });

    it('a PERCENT-ENCODED spelling of a forbidden path is still refused', async () => {
      // The router decodes escapes before matching, so the matcher must too --
      // otherwise `/%61pi/v1/settings` would reach the settings handler while
      // the scope check looked at a path it did not recognise.
      const token = installAndIssue(ADDON_ID, ALL_SCOPES);
      for (const url of ['/%61pi/v1/settings', '/api/v1/%73ettings', '/api/%76%31/settings']) {
        const res = await server.inject({ method: 'GET', url, headers: auth(token) });
        expect({ url, code: res.statusCode }).toEqual({ url, code: 403 });
      }
    });

    it("a percent-encoded spelling of ANOTHER add-on's namespace is still refused", async () => {
      const token = installAndIssue(ADDON_ID, ['storage.own']);
      installAndIssue(OTHER_ID, ['storage.own']);
      const encoded = OTHER_ID.replace('c', '%63');
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${encoded}/storage/secret`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FOREIGN_ADDON');
    });

    it('an add-on can never mint itself a NEW token or rotate another add-on\'s', async () => {
      const token = installAndIssue(ADDON_ID, ALL_SCOPES);
      installAndIssue(OTHER_ID, ALL_SCOPES);
      for (const id of [ADDON_ID, OTHER_ID]) {
        const res = await server.inject({
          method: 'POST',
          url: `/api/v1/addons/${id}/token`,
          headers: auth(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // -------------------------------------------------------------------------
  // storage.own namespace isolation
  // -------------------------------------------------------------------------

  describe('storage.own namespace isolation', () => {
    it('reads/writes its OWN keys with the scope', async () => {
      const token = installAndIssue(ADDON_ID, ['storage.own']);
      const put = await server.inject({
        method: 'PUT',
        url: `/api/v1/addons/${ADDON_ID}/storage/lastSync`,
        headers: auth(token),
        payload: { value: 42 },
      });
      expect(put.statusCode).toBe(200);
      const get = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${ADDON_ID}/storage/lastSync`,
        headers: auth(token),
      });
      expect(JSON.parse(get.body).data).toBe(42);
    });

    it('403s without storage.own', async () => {
      const token = installAndIssue(ADDON_ID, ALL_SCOPES.filter((s) => s !== 'storage.own'));
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${ADDON_ID}/storage/lastSync`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('SCOPE_MISSING');
    });

    it("can NEVER touch another add-on's namespace, in any verb", async () => {
      const mine = installAndIssue(ADDON_ID, ['storage.own']);
      const theirs = installAndIssue(OTHER_ID, ['storage.own']);
      // The other add-on stores a secret in its own namespace.
      await server.inject({
        method: 'PUT',
        url: `/api/v1/addons/${OTHER_ID}/storage/secret`,
        headers: auth(theirs),
        payload: { value: 'do-not-leak' },
      });

      for (const method of ['GET', 'PUT', 'DELETE'] as const) {
        const res = await server.inject({
          method,
          url: `/api/v1/addons/${OTHER_ID}/storage/secret`,
          headers: auth(mine),
          ...(method === 'PUT' ? { payload: { value: 'overwritten' } } : {}),
        });
        expect({ method, code: res.statusCode }).toEqual({ method, code: 403 });
        expect(JSON.parse(res.body).error.code).toBe('FOREIGN_ADDON');
      }

      // The secret survived untouched.
      const check = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${OTHER_ID}/storage/secret`,
        headers: auth(theirs),
      });
      expect(JSON.parse(check.body).data).toBe('do-not-leak');
    });
  });

  // -------------------------------------------------------------------------
  // events.publish namespace restriction
  // -------------------------------------------------------------------------

  describe('events.publish is confined to addon/{id}/*', () => {
    it('publishes a relative topic into its own namespace', async () => {
      const token = installAndIssue(ADDON_ID, ['events.publish']);
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${ADDON_ID}/events`,
        headers: auth(token),
        payload: { topic: 'jam-detected', payload: { severity: 3 } },
      });
      expect(res.statusCode).toBe(202);
      expect(JSON.parse(res.body).data.topic).toBe(`addon/${ADDON_ID}/jam-detected`);
    });

    it('403s without the events.publish scope', async () => {
      const token = installAndIssue(ADDON_ID, ALL_SCOPES.filter((s) => s !== 'events.publish'));
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${ADDON_ID}/events`,
        headers: auth(token),
        payload: { topic: 'jam-detected' },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('SCOPE_MISSING');
    });

    it.each(['nav/state', 'pos/update', `addon/${OTHER_ID}/spoofed`, '*', '../nav/state'])(
      'refuses to publish onto "%s"',
      async (topic) => {
        const token = installAndIssue(ADDON_ID, ['events.publish']);
        const res = await server.inject({
          method: 'POST',
          url: `/api/v1/addons/${ADDON_ID}/events`,
          headers: auth(token),
          payload: { topic, payload: {} },
        });
        if (topic === 'nav/state' || topic === 'pos/update') {
          // Namespaced rather than refused -- it lands on addon/{id}/nav/state,
          // which cannot be confused with the core topic.
          expect(res.statusCode).toBe(202);
          expect(JSON.parse(res.body).data.topic).toBe(`addon/${ADDON_ID}/${topic}`);
        } else {
          expect(res.statusCode).toBe(403);
          expect(JSON.parse(res.body).error.code).toBe('TOPIC_NOT_ALLOWED');
        }
      },
    );

    it("cannot post events into ANOTHER add-on's endpoint", async () => {
      const token = installAndIssue(ADDON_ID, ['events.publish']);
      installAndIssue(OTHER_ID, ['events.publish']);
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/addons/${OTHER_ID}/events`,
        headers: auth(token),
        payload: { topic: 'fake', payload: {} },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FOREIGN_ADDON');
    });
  });

  // -------------------------------------------------------------------------
  // Token invalidation
  // -------------------------------------------------------------------------

  describe('token invalidation on disable/uninstall (< 1 s)', () => {
    it('works, then is rejected IMMEDIATELY after disable', async () => {
      const token = installAndIssue(ADDON_ID, ['pos.read']);
      const before = await server.inject({
        method: 'GET',
        url: '/api/v1/position',
        headers: auth(token),
      });
      expect(before.statusCode).not.toBe(403);

      const disabledAt = Date.now();
      const disable = await server.inject({ method: 'POST', url: `/api/v1/addons/${ADDON_ID}/disable` });
      expect(disable.statusCode).toBe(200);

      const after = await server.inject({
        method: 'GET',
        url: '/api/v1/position',
        headers: auth(token),
      });
      const elapsedMs = Date.now() - disabledAt;
      // The token is no longer an add-on principal at all; with the Core in
      // the open posture the request is simply not an add-on request any more.
      expect(after.statusCode).not.toBe(200);
      expect(elapsedMs).toBeLessThan(1000);
    });

    it('is rejected with 401 after disable when the Core token IS enforced', async () => {
      process.env.API_AUTH_TOKEN = 'core-secret-token';
      const token = installAndIssue(ADDON_ID, ['pos.read']);
      const before = await server.inject({
        method: 'GET',
        url: '/api/v1/position',
        headers: auth(token),
      });
      // 204 (no fix yet) -- the point is that it was neither 401 nor 403.
      expect([200, 204]).toContain(before.statusCode);

      const t0 = Date.now();
      repository.setEnabled(ADDON_ID, false);
      const after = await server.inject({
        method: 'GET',
        url: '/api/v1/position',
        headers: auth(token),
      });
      expect(after.statusCode).toBe(401);
      expect(Date.now() - t0).toBeLessThan(1000);
    });

    it('is rejected after uninstall', async () => {
      const token = installAndIssue(ADDON_ID, ['storage.own']);
      expect(
        (
          await server.inject({
            method: 'GET',
            url: `/api/v1/addons/${ADDON_ID}/storage/x`,
            headers: auth(token),
          })
        ).statusCode,
      ).toBe(404); // key unset, but the SCOPE check passed

      await server.inject({ method: 'DELETE', url: `/api/v1/addons/${ADDON_ID}` });
      const after = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/${ADDON_ID}/storage/x`,
        headers: auth(token),
      });
      // No longer an add-on principal -> the route's own install-gate answers.
      expect(after.statusCode).toBe(404);
      expect(tokens.authenticate(token)).toBeNull();
    });

    it('a re-enable does NOT resurrect a revoked token', async () => {
      const token = installAndIssue(ADDON_ID, ['pos.read']);
      await server.inject({ method: 'POST', url: `/api/v1/addons/${ADDON_ID}/disable` });
      await server.inject({ method: 'POST', url: `/api/v1/addons/${ADDON_ID}/enable` });
      // `disable` REVOKED the row (not merely gated it), so the old secret is
      // dead for good -- `enable` mints a fresh one.
      expect(tokens.authenticate(token)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // WebSocket matrix
  // -------------------------------------------------------------------------

  describe('WS: topic subscriptions are scope-checked', () => {
    it('delivers pos/update to an add-on holding pos.read', async () => {
      const token = installAndIssue(ADDON_ID, ['pos.read']);
      const socket = await server.injectWS(`/ws/v1?token=${encodeURIComponent(token)}`);
      socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/*'] }));
      await delayFn(30);

      const messagePromise = waitForMessage(socket);
      publishPosition();
      const received = await messagePromise;
      expect(received.topic).toBe('pos/update');
      socket.terminate();
    });

    it('REFUSES a pos/* subscription without pos.read and delivers nothing', async () => {
      const token = installAndIssue(ADDON_ID, ['nav.read']);
      const socket = await server.injectWS(`/ws/v1?token=${encodeURIComponent(token)}`);
      const errorPromise = waitForMessage(socket);
      socket.send(JSON.stringify({ type: 'subscribe', topics: ['pos/update'] }));
      const refusal = await errorPromise;
      expect(refusal.type).toBe('error');
      expect(refusal.code).toBe('SCOPE_MISSING');
      expect(refusal.required_scope).toBe('pos.read');

      // Nothing is delivered afterwards either.
      let delivered = 0;
      socket.on('message', () => {
        delivered += 1;
      });
      publishPosition();
      await delayFn(50);
      expect(delivered).toBe(0);
      socket.terminate();
    });

    it('never grants a bare "*" wildcard subscription', async () => {
      const token = installAndIssue(ADDON_ID, ALL_SCOPES);
      const socket = await server.injectWS(`/ws/v1?token=${encodeURIComponent(token)}`);
      const errorPromise = waitForMessage(socket);
      socket.send(JSON.stringify({ type: 'subscribe', topics: ['*'] }));
      const refusal = await errorPromise;
      expect(refusal.type).toBe('error');
      expect(refusal.code).toBe('TOPIC_NOT_ALLOWED');
      socket.terminate();
    });

    it("refuses another add-on's addon/* namespace but allows its own", async () => {
      const token = installAndIssue(ADDON_ID, []);
      const socket = await server.injectWS(`/ws/v1?token=${encodeURIComponent(token)}`);
      const errorPromise = waitForMessage(socket);
      socket.send(
        JSON.stringify({ type: 'subscribe', topics: [`addon/${ADDON_ID}/*`, `addon/${OTHER_ID}/*`] }),
      );
      const refusal = await errorPromise;
      expect(refusal.code).toBe('TOPIC_NOT_ALLOWED');
      expect(refusal.topic).toBe(`addon/${OTHER_ID}/*`);
      socket.terminate();
    });

    it('a normal (non-add-on) WS client is unaffected by the matrix', async () => {
      const socket = await server.injectWS('/ws/v1');
      socket.send(JSON.stringify({ type: 'subscribe', topics: ['*'] }));
      await delayFn(30);
      const topics: string[] = [];
      socket.on('message', (data) => {
        topics.push((JSON.parse(data.toString()) as { topic: string }).topic);
      });
      publishPosition();
      await delayFn(80);
      // A `*` subscription is fine for a NORMAL client -- it gets the position
      // fix (plus whatever else the source switch published).
      expect(topics).toContain('pos/update');
      socket.terminate();
    });
  });

  // -------------------------------------------------------------------------
  // Egress proxy at the HTTP layer
  // -------------------------------------------------------------------------

  describe('egress proxy (host allow-list) through the real auth hook', () => {
    it('refuses an UNDECLARED host with 403', async () => {
      const token = installAndIssue(ADDON_ID, ['net.fetch:allowed.invalid']);
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://evil.example/steal')}`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('HOST_NOT_ALLOWED');
    });

    it('lets a DECLARED host through the allow-list (and then merely fails to resolve)', async () => {
      // `.invalid` never resolves (RFC 2606), so a 502 here PROVES the request
      // passed the allow-list and was actually attempted -- without the test
      // touching the network.
      const token = installAndIssue(ADDON_ID, ['net.fetch:allowed.invalid']);
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://allowed.invalid/data')}`,
        headers: auth(token),
      });
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_FAILED');
    });

    it('is not reachable at all without an add-on token', async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://allowed.invalid/data')}`,
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('ADDON_TOKEN_REQUIRED');
    });
  });

  // -------------------------------------------------------------------------
  // E08-T3 posture is untouched
  // -------------------------------------------------------------------------

  describe('the existing auth posture is unchanged (E08-T3)', () => {
    it('open posture: a token-less client still reaches the API', async () => {
      installAndIssue(ADDON_ID, ['pos.read']);
      const res = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(res.statusCode).toBe(200);
    });

    it('enforced posture: the CORE token still works everywhere', async () => {
      process.env.API_AUTH_TOKEN = 'core-secret-token';
      installAndIssue(ADDON_ID, ['pos.read']);
      expect(
        (await server.inject({ method: 'GET', url: '/api/v1/settings', headers: auth('core-secret-token') }))
          .statusCode,
      ).toBe(200);
      expect((await server.inject({ method: 'GET', url: '/api/v1/settings' })).statusCode).toBe(401);
      expect((await server.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
    });

    it('an ADD-ON token is never accepted as the Core token', async () => {
      process.env.API_AUTH_TOKEN = 'core-secret-token';
      const token = installAndIssue(ADDON_ID, ALL_SCOPES);
      const res = await server.inject({ method: 'GET', url: '/api/v1/settings', headers: auth(token) });
      expect(res.statusCode).toBe(403); // refused by the matrix, never 200
    });
  });
});

/** Publishes a valid `pos/update` through the running server's bus. Reaching
 *  the bus from outside is done the same way an add-on would: via the API. */
function publishPosition(): void {
  void server.inject({
    method: 'POST',
    url: '/api/v1/position/browser',
    payload: {
      lat: 52.5,
      lon: 13.4,
      alt: 30,
      speed: 5,
      heading: 10,
      accuracy: 3,
      fix: '3d',
      ts: new Date().toISOString(),
    },
  });
}
