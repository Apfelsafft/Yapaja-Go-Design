/**
 * REST surface of the `security` event channel (E09-T6, W-10). Prefix: `/api/v1`.
 *
 *   GET  /api/v1/security/events   -> the recorded (blocked) attempts
 *   POST /api/v1/security/events   -> the HOST forwards a browser-side detection
 *
 * AUTHORIZATION -- BOTH ROUTES ARE DENIED TO ADD-ON PRINCIPALS.
 * -----------------------------------------------------------
 * Neither path appears in `addons/scopeMatrix.ts#ADDON_ROUTE_RULES`, so the
 * matrix's DEFAULT-DENY refuses an add-on token with 403 without this module
 * having to check anything itself -- exactly the property that table exists
 * for. `securityRoutes.test.ts` asserts it explicitly for both verbs rather
 * than trusting the default to stay in place. On top of that, the handlers
 * below reject `request.addonPrincipal` outright: if a future edit ever added
 * these paths to the matrix by mistake, the routes would still refuse.
 *
 * Otherwise the ordinary E08-T3 Core-token guard applies (`auth/plugin.ts`),
 * i.e. these are operator/UI endpoints.
 *
 * WHY `POST` EXISTS AT ALL, AND WHY IT IS HOST-TRUSTED-ONLY
 * --------------------------------------------------------
 * Some sandbox violations are only observable INSIDE the browser: an add-on
 * iframe reaching for `window.parent.document`, or a `fetch()` to a foreign
 * host that the add-on CSP (`connect-src 'none'`, see `addons/ui-host.ts`)
 * blocks. The Core never sees those. The web app's add-on host
 * (`apps/web/src/addons/bridge.ts` + `hostDeps.ts`) is TRUSTED first-party
 * code running outside the sandbox, so it is the component that detects and
 * forwards them here.
 *
 * That trust boundary is honest about what it buys:
 *  - The vector id is validated against the fixed
 *    `SECURITY_VECTORS` list, `addonId` is a plain string, and `detail` is
 *    redacted+truncated by `SecurityEventLog#record`, so a caller can neither
 *    invent new vector kinds nor smuggle a secret into the log.
 *  - The endpoint can only ADD entries to a bounded ring buffer. It cannot
 *    read, delete, weaken or bypass any enforcement decision anywhere.
 *  - An ADD-ON can never call it (403, asserted by test).
 *  - Two of the vectors it carries (`ui.parent_dom_access`,
 *    `ui.foreign_host_fetch`) are, in the last hop, SELF-REPORTED by the
 *    add-on to the host: the browser blocks the access inside the iframe and
 *    the add-on's own code is what notices. A malicious add-on can therefore
 *    stay SILENT about its own attempt. That is acceptable because the BLOCK
 *    never depends on the report -- the block is the opaque origin
 *    (`sandbox="allow-scripts"` without `allow-same-origin`) and the CSP, and
 *    the E09-T6 suite proves each block independently and out-of-band (the
 *    add-on's own DOM read via CDP, and a network tracker showing zero
 *    foreign requests). The report adds AUDITABILITY, not containment. See
 *    `e2e/security/README.md` for the per-vector evidence table.
 *  - A malicious add-on also cannot forge a report for ANOTHER add-on: the
 *    bridge pins `addonId` to the iframe it owns before forwarding.
 *
 * Worst case, a compromised first-party page can write noise into a bounded,
 * read-only-elsewhere audit buffer. That is a strictly smaller problem than
 * having no record of browser-side violations at all.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import {
  SECURITY_VECTORS,
  SecurityEventLog,
  isSecurityVector,
  securityEventLog,
  type SecurityViolation,
} from './securityEvents.js';

function err(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export interface SecurityPluginOptions {
  /** Injectable for tests; defaults to the process-wide singleton. */
  log?: SecurityEventLog;
}

interface EventsQuery {
  vector?: string;
  addon_id?: string;
  limit?: string;
}

interface ReportBody {
  vector?: unknown;
  addon_id?: unknown;
  detail?: unknown;
}

interface EventsReply {
  data: SecurityViolation[];
  /** The full vector vocabulary, so a client (and the E09-T6 suite) can
   *  discover what CAN be reported without importing Core internals. */
  vectors: readonly string[];
}

export const securityPlugin: FastifyPluginAsync<SecurityPluginOptions> = async (fastify, opts) => {
  const log = opts.log ?? securityEventLog;

  fastify.get<{ Querystring: EventsQuery; Reply: EventsReply | ApiError }>(
    '/security/events',
    async (request, reply) => {
      // Defense in depth on top of the scope matrix's default-deny.
      if (request.addonPrincipal) {
        reply
          .code(403)
          .send(err('ROUTE_NOT_ALLOWED', 'The security event log is never readable by an add-on'));
        return;
      }
      const rawLimit = request.query.limit;
      const limit = rawLimit !== undefined && /^\d+$/.test(rawLimit) ? parseInt(rawLimit, 10) : undefined;
      reply.code(200).send({
        data: log.list({ vector: request.query.vector, addonId: request.query.addon_id, limit }),
        vectors: SECURITY_VECTORS,
      });
    },
  );

  fastify.post<{ Body: ReportBody }>('/security/events', async (request, reply) => {
    if (request.addonPrincipal) {
      reply
        .code(403)
        .send(err('ROUTE_NOT_ALLOWED', 'An add-on may never write to the security event log'));
      return;
    }
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      reply.code(400).send(err('VALIDATION_ERROR', 'Body must be a JSON object'));
      return;
    }
    if (!isSecurityVector(body.vector)) {
      reply
        .code(400)
        .send(err('VALIDATION_ERROR', `"vector" must be one of the known security vectors`));
      return;
    }
    const addonId = typeof body.addon_id === 'string' && body.addon_id !== '' ? body.addon_id : null;
    const detail = typeof body.detail === 'string' ? body.detail : '';
    const violation = log.record(body.vector, addonId, detail);
    reply.code(202).send({ data: violation });
  });
};
