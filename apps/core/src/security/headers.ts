/**
 * Baseline security response headers for EVERYTHING the Core serves
 * (E10-T4, docs/07 §7 "Sicherheit", docs/00 Rechtliches/Sicherheit).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before E10-T4 exactly ONE surface carried security headers: the add-on UI
 * host (`addons/ui-host.ts`, E09-T2/W-10), which locks untrusted add-on code
 * into a near-empty policy. The Core's OWN surfaces -- the bundled SPA shell,
 * its JS/CSS/tile assets and every `/api/*` JSON reply -- shipped with no CSP,
 * no `nosniff` and no framing rule at all. That is the wrong way round: the
 * add-on sandbox was hardened while the page that HOSTS the sandbox was not.
 * This plugin closes that gap with one root `onSend` hook, so a newly added
 * route cannot forget to opt in.
 *
 * RELATION TO THE ADD-ON CSP -- deliberately NOT overridden
 * --------------------------------------------------------
 * `addons/ui-host.ts` sets its own, much stricter policy (`connect-src 'none'`
 * etc.). This hook therefore only sets `Content-Security-Policy` when the
 * response does not already carry one, so the add-on policy always wins. The
 * two policies are not merged: browsers intersect multiple CSP headers, and an
 * intersection of "app policy" and "sandbox policy" would be an implicit
 * third policy nobody reviewed.
 *
 * THE POLICY, DIRECTIVE BY DIRECTIVE
 * ----------------------------------
 * Calibrated against the REAL production bundle (`apps/web/dist`), not
 * guessed -- the E2E suite serves exactly those artifacts through this server,
 * so a too-tight directive shows up as a failing flow, not as a silent
 * breakage on the device.
 *
 *  - `default-src 'self'`      -- everything is same-origin; the device is
 *                                 offline-first and loads NOTHING from a CDN.
 *  - `script-src 'self'`       -- Vite emits external module scripts only;
 *                                 there is no inline script in `index.html`
 *                                 (checked: `<script type="module" src=...>`),
 *                                 so no `'unsafe-inline'` is needed here --
 *                                 the directive that actually stops XSS.
 *  - `style-src` + `'unsafe-inline'` -- REQUIRED, and the one concession:
 *                                 React renders `style={{...}}` as inline
 *                                 style ATTRIBUTES (drag transforms in the
 *                                 widget shell, the region-download progress
 *                                 bar, the compass rotation). CSP cannot
 *                                 distinguish those from injected styles
 *                                 without hashing every one of them. Style
 *                                 injection alone is not script execution.
 *  - `img-src` + `data: blob:` -- MapLibre decodes sprites/tiles into blob and
 *                                 data URLs.
 *  - `connect-src 'self'`      -- REST + the `/ws/v1` WebSocket. Same-origin
 *                                 `ws:`/`wss:` is covered by `'self'` (CSP3).
 *                                 No outbound host is allowed: an add-on's
 *                                 egress goes through the server-side proxy
 *                                 (`addons/proxy.ts`), never from this page.
 *  - `worker-src`/`child-src` + `blob:` -- MapLibre spawns its render workers
 *                                 from a blob URL.
 *  - `frame-src 'self'`        -- the add-on `<iframe>` (`AddonHost.tsx`),
 *                                 whose src is our own `/addons/:id/ui/`.
 *  - `frame-ancestors 'self'`  -- who may frame US. `'self'` is correct for
 *                                 BOTH deployments: standalone/kiosk (top
 *                                 level, nothing frames us) and the HA add-on,
 *                                 where ingress reverse-proxies us UNDER Home
 *                                 Assistant's own origin, so the framing HA
 *                                 dashboard and this response share an origin.
 *                                 Overridable for operators who embed the app
 *                                 in a third-party dashboard on another origin
 *                                 (see {@link SecurityHeaderOptions}).
 *  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` -- close the
 *                                 classic plugin/base-tag/form-exfil holes.
 *                                 `base-uri` must allow `'self'` rather than
 *                                 `'none'`: HA ingress injection writes a
 *                                 same-origin `<base href>` into `index.html`
 *                                 (`static/ingressHtml.ts`, W-15).
 *
 * `X-Content-Type-Options: nosniff` is the second half of the pair the release
 * gate names explicitly: without it a browser may sniff a JSON/asset response
 * into an executable type, which would route around `script-src` entirely.
 */

import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export interface SecurityHeaderOptions {
  /**
   * Value for the CSP `frame-ancestors` directive. Defaults to `'self'`.
   * An operator embedding Yapaja Go in a dashboard on a DIFFERENT origin sets
   * `YAPAJA_FRAME_ANCESTORS` to that origin (e.g. `'self' https://dash.lan`);
   * the empty/unset case keeps the safe default rather than falling open.
   */
  frameAncestors?: string;
}

/** The `frame-ancestors` value used when nothing is configured. */
export const DEFAULT_FRAME_ANCESTORS = "'self'";

/**
 * Reads the `frame-ancestors` override from the environment. Anything blank is
 * treated as "not configured" -- an empty CSP directive would be a syntax
 * error and browsers drop the whole policy when one is malformed, so falling
 * back to the default here is fail-CLOSED, not fail-open.
 */
export function resolveFrameAncestors(env: Record<string, string | undefined>): string {
  const raw = env.YAPAJA_FRAME_ANCESTORS;
  if (typeof raw !== 'string') return DEFAULT_FRAME_ANCESTORS;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_FRAME_ANCESTORS;
}

/** Builds the Core's own Content-Security-Policy. See the module doc. */
export function buildAppCsp(opts: SecurityHeaderOptions = {}): string {
  const frameAncestors = opts.frameAncestors ?? DEFAULT_FRAME_ANCESTORS;
  return [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `frame-src 'self'`,
    `frame-ancestors ${frameAncestors}`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

const securityHeadersPluginImpl: FastifyPluginAsync<SecurityHeaderOptions> = async (
  fastify,
  opts,
) => {
  const csp = buildAppCsp({
    frameAncestors: opts.frameAncestors ?? resolveFrameAncestors(process.env),
  });

  // `onSend` (not `onRequest`): it is the last hook before the payload goes
  // out and it runs for EVERY reply -- route handlers, the `@fastify/static`
  // stream, the SPA not-found fallback and error replies alike. An
  // `onRequest` hook would miss nothing today but would silently stop
  // covering any future route that replies from an earlier hook.
  fastify.addHook('onSend', async (_request, reply, payload) => {
    // The add-on UI host's stricter policy always wins -- never merged.
    if (!reply.getHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', csp);
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    // Belt-and-braces companion to `frame-ancestors` for the (older) clients
    // that only understand this one. Kept consistent with the CSP default;
    // when an operator widens `frame-ancestors` to another origin, XFO's
    // coarse grammar cannot express that, so it is dropped instead of
    // contradicting the CSP (browsers that understand both prefer the CSP,
    // but a stale SAMEORIGIN would break the very embedding just allowed).
    if (!reply.getHeader('x-frame-options') && csp.includes(`frame-ancestors 'self'`)) {
      reply.header('X-Frame-Options', 'SAMEORIGIN');
    }
    // No URL of this device (which can contain a region/route id) should ever
    // leak to a third party. There is no third party offline, but a kiosk
    // browser configured with a start page elsewhere is a real deployment.
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
};

/**
 * Registered via `fastify-plugin` so the hook lands on the ROOT instance and
 * therefore also covers routes registered by plugins in their own
 * encapsulation contexts.
 */
export const securityHeadersPlugin = fp(securityHeadersPluginImpl, {
  name: 'security-headers-plugin',
});
