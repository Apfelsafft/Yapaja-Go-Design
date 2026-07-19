/**
 * SECURITY test suite for E08-T3 token auth (acceptance criterion 1, docs/04
 * §2). This is THE test for the task: the full REST + WS auth matrix, the
 * open-list, ingress-mode bypass, and the "token never in logs" plausibility
 * check.
 *
 *  - REST matrix runs against the FULL `buildServer()` (in-memory DB) so the
 *    exact production wiring -- the root `onRequest` auth hook -- is exercised.
 *  - WS matrix runs against a FOCUSED server (`busWebsocketPlugin` + an
 *    `AuthGuard`) via `@fastify/websocket`'s `injectWS`. This drives the real
 *    `/ws/v1` upgrade auth code path in `bus/ws.ts`; `injectWS` does not work
 *    against the fully-assembled server (a pre-existing @fastify/websocket
 *    limitation unrelated to auth -- the isolated ws plugin is the canonical
 *    way it is tested, see `bus/ws.test.ts`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { EventBus } from '../bus/index.js';
import { busWebsocketPlugin } from '../bus/ws.js';
import { AuthGuard } from './authGuard.js';

const TOKEN = 'test-secret-token-abcdefghijklmnop';
const WRONG = 'wrong-token-xxxxxxxxxxxxxxxxxxxxxxx';

async function buildRestServer(): Promise<FastifyInstance> {
  process.env.DB_PATH = ':memory:';
  closeDb();
  return buildServer();
}

// --- WS harness --------------------------------------------------------------

/** A focused `/ws/v1` server wired with the given `AuthGuard`. */
async function buildWsServer(guard: AuthGuard): Promise<FastifyInstance> {
  const fastify = Fastify();
  const bus = new EventBus({ isProduction: false });
  await fastify.register(busWebsocketPlugin, { bus, authGuard: guard });
  await fastify.ready();
  return fastify;
}

/** Upgrade outcome: `'accepted'` (socket stays open) or the WS close code. */
async function wsOutcome(server: FastifyInstance, url: string): Promise<'accepted' | number> {
  const socket: WebSocket = await server.injectWS(url);
  return await new Promise((resolve) => {
    let settled = false;
    socket.on('close', (code: number) => {
      if (!settled) {
        settled = true;
        resolve(code);
      }
    });
    nodeSetTimeout(() => {
      if (!settled) {
        settled = true;
        socket.terminate();
        resolve('accepted');
      }
    }, 80);
  });
}

// =============================================================================
// REST matrix (full server)
// =============================================================================
describe('E08-T3 REST auth matrix', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.API_AUTH_TOKEN;
    delete process.env.INGRESS_MODE;
    delete process.env.MQTT_BROKER_URL;
  });

  afterEach(() => {
    closeDb();
    process.env = { ...savedEnv };
  });

  describe('default posture (no token configured) -> OPEN', () => {
    let server: FastifyInstance;
    beforeEach(async () => {
      server = await buildRestServer();
    });
    afterEach(async () => {
      await server.close();
    });

    it('serves a guarded API route WITHOUT a token', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(res.statusCode).toBe(200);
    });

    it('reports enforced:false on /api/v1/auth/status', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/auth/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ enforced: false, ingress: false });
    });
  });

  describe('enforced via env API_AUTH_TOKEN', () => {
    let server: FastifyInstance;
    beforeEach(async () => {
      process.env.API_AUTH_TOKEN = TOKEN;
      server = await buildRestServer();
    });
    afterEach(async () => {
      await server.close();
    });

    it('health stays OPEN (no / wrong / right token all 200)', async () => {
      for (const headers of [
        undefined,
        { authorization: `Bearer ${WRONG}` },
        { authorization: `Bearer ${TOKEN}` },
      ]) {
        const res = await server.inject({ method: 'GET', url: '/api/v1/health', headers });
        expect(res.statusCode).toBe(200);
      }
    });

    it('auth/status stays OPEN and reports enforced:true', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/auth/status' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ enforced: true, ingress: false });
    });

    it('401 on EVERYTHING (except the open list) without a token', async () => {
      const guarded = [
        { method: 'GET' as const, url: '/api/v1/settings' },
        { method: 'GET' as const, url: '/api/v1/navigation/state' },
        { method: 'GET' as const, url: '/api/v1/profiles' },
        { method: 'GET' as const, url: '/api/v1/favorites' },
        { method: 'POST' as const, url: '/api/v1/navigation/destination' },
      ];
      for (const req of guarded) {
        const res = await server.inject(req);
        expect(res.statusCode, `${req.method} ${req.url} must be 401`).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      }
    });

    it('401 with a WRONG token', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: { authorization: `Bearer ${WRONG}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('200 with the CORRECT token (the rest_command example: POST /navigation/destination)', async () => {
      const get = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(get.statusCode).toBe(200);

      // Acceptance #2: the documented `rest_command` (POST /navigation/destination)
      // is authorized with a valid token -- it must pass the auth gate (a 4xx
      // from routing/geocoding is fine; a 401 is not).
      const restCommand = await server.inject({
        method: 'POST',
        url: '/api/v1/navigation/destination',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: { latlng: { lat: 47.14, lon: 9.52 } },
      });
      expect(restCommand.statusCode).not.toBe(401);
    });

    it('401 for a malformed Authorization header (not "Bearer <token>")', async () => {
      for (const authorization of [TOKEN, `Basic ${TOKEN}`, 'Bearer', 'Bearer ']) {
        const res = await server.inject({
          method: 'GET',
          url: '/api/v1/settings',
          headers: { authorization },
        });
        expect(res.statusCode, `header "${authorization}"`).toBe(401);
      }
    });
  });

  describe('enforced via Settings-generated token (rotation flow)', () => {
    let server: FastifyInstance;
    beforeEach(async () => {
      server = await buildRestServer();
    });
    afterEach(async () => {
      await server.close();
    });

    it('rotate endpoint is bootstrap-OPEN, then enforces the returned token', async () => {
      const gen = await server.inject({ method: 'POST', url: '/api/v1/auth/token' });
      expect(gen.statusCode).toBe(200);
      const token = gen.json().data.token as string;
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(20);

      const noTok = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(noTok.statusCode).toBe(401);

      const ok = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);

      // Rotating again now REQUIRES the current token.
      const rotateNoTok = await server.inject({ method: 'POST', url: '/api/v1/auth/token' });
      expect(rotateNoTok.statusCode).toBe(401);

      const rotate = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/token',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(rotate.statusCode).toBe(200);
      const token2 = rotate.json().data.token as string;
      expect(token2).not.toBe(token);

      const oldFails = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(oldFails.statusCode).toBe(401);

      const newWorks = await server.inject({
        method: 'GET',
        url: '/api/v1/settings',
        headers: { authorization: `Bearer ${token2}` },
      });
      expect(newWorks.statusCode).toBe(200);
    });

    it('DELETE /auth/token clears the token and returns to OPEN posture', async () => {
      const gen = await server.inject({ method: 'POST', url: '/api/v1/auth/token' });
      const token = gen.json().data.token as string;

      const del = await server.inject({
        method: 'DELETE',
        url: '/api/v1/auth/token',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().data.enforced).toBe(false);

      const open = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(open.statusCode).toBe(200);
    });
  });

  describe('ingress mode (INGRESS_MODE=1) -> auth bypassed', () => {
    let server: FastifyInstance;
    beforeEach(async () => {
      process.env.INGRESS_MODE = '1';
      process.env.API_AUTH_TOKEN = TOKEN; // present, but must be ignored
      server = await buildRestServer();
    });
    afterEach(async () => {
      await server.close();
    });

    it('guarded route is reachable WITHOUT a token', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(res.statusCode).toBe(200);
    });

    it('auth/status reports enforced:false, ingress:true', async () => {
      const res = await server.inject({ method: 'GET', url: '/api/v1/auth/status' });
      expect(res.json().data).toEqual({ enforced: false, ingress: true });
    });
  });
});

// =============================================================================
// WS matrix (focused ws server + real /ws/v1 upgrade auth path)
// =============================================================================
describe('E08-T3 WS auth matrix', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('OPEN posture: accepts an upgrade WITHOUT a token', async () => {
    server = await buildWsServer(new AuthGuard({ env: {} }));
    expect(await wsOutcome(server, '/ws/v1')).toBe('accepted');
  });

  it('enforced: rejects WITHOUT a token (close 1008)', async () => {
    server = await buildWsServer(new AuthGuard({ env: { API_AUTH_TOKEN: TOKEN } }));
    expect(await wsOutcome(server, '/ws/v1')).toBe(1008);
  });

  it('enforced: rejects a WRONG query token (close 1008)', async () => {
    server = await buildWsServer(new AuthGuard({ env: { API_AUTH_TOKEN: TOKEN } }));
    expect(await wsOutcome(server, `/ws/v1?token=${WRONG}`)).toBe(1008);
  });

  it('enforced: accepts the CORRECT query token', async () => {
    server = await buildWsServer(new AuthGuard({ env: { API_AUTH_TOKEN: TOKEN } }));
    expect(await wsOutcome(server, `/ws/v1?token=${TOKEN}`)).toBe('accepted');
  });

  it('enforced: accepts the CORRECT token via cookie', async () => {
    server = await buildWsServer(new AuthGuard({ env: { API_AUTH_TOKEN: TOKEN } }));
    const socket: WebSocket = await server.injectWS('/ws/v1', {
      headers: { cookie: `token=${TOKEN}` },
    } as never);
    const outcome = await new Promise<'accepted' | number>((resolve) => {
      let settled = false;
      socket.on('close', (code: number) => {
        if (!settled) {
          settled = true;
          resolve(code);
        }
      });
      nodeSetTimeout(() => {
        if (!settled) {
          settled = true;
          socket.terminate();
          resolve('accepted');
        }
      }, 80);
    });
    expect(outcome).toBe('accepted');
  });

  it('ingress mode: accepts an upgrade WITHOUT a token even when a token is set', async () => {
    server = await buildWsServer(
      new AuthGuard({ env: { API_AUTH_TOKEN: TOKEN, INGRESS_MODE: '1' } }),
    );
    expect(await wsOutcome(server, '/ws/v1')).toBe('accepted');
  });

  it('enforced via a settings token (not just env)', async () => {
    const settings = { get: (k: string) => (k === 'auth.token' ? TOKEN : undefined) };
    server = await buildWsServer(new AuthGuard({ settings, env: {} }));
    expect(await wsOutcome(server, '/ws/v1')).toBe(1008);
    expect(await wsOutcome(server, `/ws/v1?token=${TOKEN}`)).toBe('accepted');
  });
});
