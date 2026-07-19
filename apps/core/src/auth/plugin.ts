/**
 * Fastify auth plugin (E08-T3): a single root `onRequest` hook that enforces
 * the Core API bearer token, plus the token-rotation routes.
 *
 * Scope of the guard:
 *  - ONLY `/api/*` requests are guarded. Static SPA assets (the bundled web UI
 *    shell) and the SPA fallback stay OPEN so a browser can always load the UI;
 *    all actual data access goes through `/api/*`, which IS guarded. The
 *    `/ws/v1` WebSocket authenticates separately inside `bus/ws.ts` (a browser
 *    can't set an `Authorization` header on a WS upgrade -> query-token/cookie).
 *  - The OPEN LIST is explicit and minimal: `/api/v1/health` (the liveness
 *    probe -- must answer without a token) and `/api/v1/auth/status` (leaks only
 *    boolean posture flags, no secret, so the UI can discover whether auth is on).
 *
 * Registered via `fastify-plugin` so the root `onRequest` hook it adds is NOT
 * trapped in this plugin's encapsulation context and therefore applies to every
 * route registered AFTER it -- which is why `buildServer` registers this plugin
 * BEFORE all the API route plugins.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { randomBytes } from 'node:crypto';
import type { ApiError } from '@yapaja/shared';
import { AuthGuard, AUTH_TOKEN_SETTINGS_KEY, parseBearerToken } from './authGuard.js';

/** Paths under `/api/` that never require a token. */
export const OPEN_API_PATHS: readonly string[] = ['/api/v1/health', '/api/v1/auth/status'];

/** Just the settings ops the rotation route needs; `SettingsService` satisfies it. */
export interface AuthSettingsStore {
  get(key: string): unknown;
  patch(values: Record<string, unknown>): Record<string, unknown>;
}

export interface AuthPluginOptions {
  guard: AuthGuard;
  /** Settings store used by `POST /auth/token` to persist a rotated token. */
  settings: AuthSettingsStore;
  /** Overridable open-list; defaults to {@link OPEN_API_PATHS}. */
  openPaths?: readonly string[];
}

function unauthorized(message: string): ApiError {
  return { error: { code: 'UNAUTHORIZED', message } };
}

function pathOf(url: string): string {
  const qIndex = url.indexOf('?');
  return qIndex === -1 ? url : url.slice(0, qIndex);
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { guard, settings } = opts;
  const openPaths = new Set(opts.openPaths ?? OPEN_API_PATHS);

  // The enforcement hook. Runs for EVERY request; short-circuits everything
  // that isn't a guarded `/api/*` path.
  fastify.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request.url);
    // Only API routes are guarded; static assets / SPA fallback / `/ws/v1`
    // (authenticated in its own plugin) are intentionally out of scope.
    if (!path.startsWith('/api/')) return;
    if (openPaths.has(path)) return;
    // Open posture (no token configured) or ingress mode -> allow.
    if (!guard.isEnforced()) return;

    const provided = parseBearerToken(request.headers['authorization']);
    if (!guard.verify(provided)) {
      // Deliberately generic: never echo the provided/expected token (kept out
      // of logs too -- the plausibility "token never in logs" test).
      return reply.code(401).send(unauthorized('Missing or invalid bearer token'));
    }
  });

  // GET /api/v1/auth/status -- OPEN. Reveals only whether auth is enforced and
  // whether we're in ingress mode; never the token itself. Absolute path (this
  // fp-wrapped plugin registers on the root instance, like `busWebsocketPlugin`).
  fastify.get('/api/v1/auth/status', async (_request, reply) => {
    return reply
      .code(200)
      .send({ data: { enforced: guard.isEnforced(), ingress: guard.isIngressMode() } });
  });

  // POST /api/v1/auth/token -- GUARDED once a token exists (bootstrap-open when
  // none is set yet). Generates a fresh cryptographically-random token, stores
  // it in Settings (`auth.token`), and returns it in the response body ONCE.
  // This response body is the only place the raw token is surfaced; it is never
  // logged. In ingress mode auth is off, so this stays open there too (an
  // operator can still mint a token for out-of-ingress access).
  fastify.post('/api/v1/auth/token', async (_request, reply) => {
    const token = randomBytes(32).toString('base64url');
    settings.patch({ [AUTH_TOKEN_SETTINGS_KEY]: token });
    return reply.code(200).send({ data: { token } });
  });

  // DELETE /api/v1/auth/token -- GUARDED (needs the current token). Clears the
  // configured token, returning the API to the open posture. Useful for
  // recovery / intentionally disabling auth.
  fastify.delete('/api/v1/auth/token', async (_request, reply) => {
    settings.patch({ [AUTH_TOKEN_SETTINGS_KEY]: null });
    return reply.code(200).send({ data: { enforced: guard.isEnforced() } });
  });
};

export const authPlugin = fp(authPluginImpl, { name: 'auth-plugin' });
