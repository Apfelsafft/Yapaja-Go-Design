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
import {
  AuthGuard,
  AUTH_TOKEN_SETTINGS_KEY,
  normalizeRequestPath,
  parseBearerToken,
} from './authGuard.js';
import { securityEventLog, type SecurityVector } from '../security/securityEvents.js';

/** Paths under `/api/` that never require a token. */
export const OPEN_API_PATHS: readonly string[] = ['/api/v1/health', '/api/v1/auth/status'];

/** Just the settings ops the rotation route needs; `SettingsService` satisfies it. */
export interface AuthSettingsStore {
  get(key: string): unknown;
  patch(values: Record<string, unknown>): Record<string, unknown>;
}

/**
 * E09-T3: the SECOND principal type. A bearer token may also be a scoped
 * ADD-ON token; such a request authenticates as that add-on and is then
 * authorized against the server-side route->scope table
 * (`addons/scopeMatrix.ts`), default-deny. Structural on purpose -- the auth
 * module has no import edge into the add-on module.
 */
export interface AddonAuthHook {
  authenticate(token: string | null | undefined): AddonPrincipalLike | null;
  authorizeRequest(
    principal: AddonPrincipalLike,
    method: string,
    path: string,
  ): { allowed: true } | { allowed: false; code: string; message: string; requiredScope?: string };
}

export interface AddonPrincipalLike {
  addonId: string;
  scopes: ReadonlySet<string>;
  netFetchDeclarations: readonly string[];
}

export interface AuthPluginOptions {
  guard: AuthGuard;
  /** Settings store used by `POST /auth/token` to persist a rotated token. */
  settings: AuthSettingsStore;
  /** Overridable open-list; defaults to {@link OPEN_API_PATHS}. */
  openPaths?: readonly string[];
  /** E09-T3 add-on-token principal; omit to disable add-on auth entirely. */
  addonAuth?: AddonAuthHook;
}

function unauthorized(message: string): ApiError {
  return { error: { code: 'UNAUTHORIZED', message } };
}

function forbidden(code: string, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * The path this hook makes its decisions on. PERCENT-DECODED per segment
 * (`normalizeRequestPath`) so it is the same path fastify's router matches --
 * see the doc there: comparing the RAW url would let `GET /%61pi/v1/settings`
 * skip the guard entirely while still reaching the `/api/v1/settings` handler.
 */
function pathOf(url: string): string {
  return normalizeRequestPath(url);
}

/**
 * E09-T6: maps ONE scope-matrix refusal onto the security vector that best
 * describes what the add-on actually attempted. The refusal DECISION is not
 * touched here -- this only classifies an already-made "no" for the audit log.
 *
 *  - a `/navigation/*` attempt is the W-10 headline case ("an add-on may
 *    propose, never activate"), so it gets its own vector,
 *  - an `ownAddonOnly` violation on a storage path is a namespace escape,
 *  - everything else is the generic default-deny.
 */
export function classifyAddonRefusal(code: string, path: string): SecurityVector {
  if (path.startsWith('/api/v1/navigation/')) return 'route.activate_without_confirm';
  if (code === 'FOREIGN_ADDON' && /^\/api\/v1\/addons\/[^/]+\/storage\//.test(path)) {
    return 'storage.foreign_namespace';
  }
  // ONLY the add-on event-publish endpoint -- deliberately anchored, so an
  // unrelated path that merely contains the word "events" (e.g. this task's
  // own `/api/v1/security/events`) is never mis-filed as a topic escape.
  if (code === 'FOREIGN_ADDON' && /^\/api\/v1\/addons\/[^/]+\/events$/.test(path)) {
    return 'events.foreign_topic';
  }
  return 'core.scope_denied';
}

const authPluginImpl: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const { guard, settings, addonAuth } = opts;
  const openPaths = new Set(opts.openPaths ?? OPEN_API_PATHS);

  // The enforcement hook. Runs for EVERY request; short-circuits everything
  // that isn't a guarded `/api/*` path.
  fastify.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request.url);
    // Only API routes are guarded; static assets / SPA fallback / `/ws/v1`
    // (authenticated in its own plugin) are intentionally out of scope.
    if (!path.startsWith('/api/')) return;

    // E09-T3: the ADD-ON principal is resolved FIRST and independently of
    // `guard.isEnforced()`. That matters: on a token-less (open-posture)
    // install the Core API is open to LAN clients, but an add-on presenting
    // its scoped token must STILL be confined to its scope matrix -- an
    // add-on token must never be a wider credential than no token at all.
    // It is also checked before the open-list, so an add-on hitting
    // `/api/v1/auth/status` is judged by the matrix like everything else.
    if (addonAuth) {
      const bearer = parseBearerToken(request.headers['authorization']);
      const principal = bearer ? addonAuth.authenticate(bearer) : null;
      if (principal) {
        request.addonPrincipal = principal;
        // BUGFIX (found by the E09-T6 security suite): pass the RAW url here,
        // NOT the already-percent-decoded `path`. `authorizeAddonRequest` ->
        // `matchAddonRoute` decodes each segment ITSELF (that is the whole
        // point -- it must see exactly what fastify's router sees). Handing it
        // `path` decoded a SECOND time: a storage key like `..%2Fother`
        // (legitimately one segment, and one the storage layer then refuses on
        // its own terms) became `../other`, i.e. two extra path segments, so
        // NO rule matched and the request was refused as ROUTE_NOT_ALLOWED
        // instead of reaching the handler.
        //
        // The old behaviour was fail-CLOSED (a 403 too many, never a 403 too
        // few -- an extra decode can only ADD separators, and a rule can never
        // be matched by a path with more segments than it has), so this was a
        // correctness/observability defect rather than a bypass: the refusal
        // was filed under the wrong vector and a legitimate percent-encoded
        // key could not be used. Decoding exactly once, here, is what keeps
        // the guard and the router looking at the same path.
        const decision = addonAuth.authorizeRequest(principal, request.method, request.url);
        if (!decision.allowed) {
          // LOGGED (W-14): every refused add-on call is visible to the
          // operator. The token itself is never part of the log line.
          request.log.warn(
            {
              addon_id: principal.addonId,
              method: request.method,
              path,
              code: decision.code,
              required_scope: decision.requiredScope,
            },
            'add-on request refused by the scope matrix',
          );
          // E09-T6 (W-10): the SAME refusal, additionally recorded as a
          // first-class `security` event. Never carries the token.
          securityEventLog.record(
            classifyAddonRefusal(decision.code, path),
            principal.addonId,
            `${decision.code}: ${request.method} ${path}` +
              (decision.requiredScope ? ` (requires scope "${decision.requiredScope}")` : ''),
          );
          return reply.code(403).send(forbidden(decision.code, decision.message));
        }
        // Authenticated + authorized as an add-on -- the Core-token check
        // below does not apply (an add-on never holds the Core token).
        return;
      }
    }

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
