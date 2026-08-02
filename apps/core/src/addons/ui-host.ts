/**
 * Serves an enabled add-on's UI assets under `/addons/{id}/ui/**` behind a
 * STRICT Content-Security-Policy (E09-T2, docs/05 §1A, Wargame W-10).
 *
 * Threat model -- this is the FIRST half of the add-on sandbox (the second is
 * the `sandbox="allow-scripts"` iframe + postMessage bridge on the web side):
 *
 *  - Only an add-on that is BOTH installed AND `enabled` gets its UI served.
 *    A disabled/uninstalled add-on's UI 404s -- this is exactly the
 *    "layers/widgets disappear on disable" guarantee, enforced at the source.
 *    `enabled` is read LIVE from the DB row on every request (never cached),
 *    so a `POST /addons/:id/disable` takes effect immediately.
 *
 *  - Every response carries a strict CSP: `default-src 'self'` (plus the
 *    add-on's own path), NO external hosts, and `connect-src 'none'` -- the
 *    add-on UI CANNOT fetch/XHR/WebSocket ANYWHERE. Its ONLY channel to the
 *    outside world is the postMessage bridge (host-side, scope-checked).
 *    `frame-ancestors 'self'` means only our own host page may frame it.
 *
 *  - Path safety reuses `paths.ts#resolveAddonDir` + `resolveEntryPath` (the
 *    same traversal-safe resolvers the install pipeline uses) so a crafted
 *    request path can never escape the add-on's own `ui/` subdirectory. Only
 *    the `ui/` subtree is ever served -- never the manifest, never the
 *    `service/` code.
 *
 * This route lives OUTSIDE `/api/*` (it's public-ish UI assets, gated on
 * `enabled`, reachable by a plain iframe navigation that can't send an auth
 * header) and is a REAL registered route, so it always wins over the SPA
 * not-found fallback in `index.ts` -- add-on UIs are never served the main
 * app's `index.html`.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, existsSync, statSync } from 'fs';
import { extname } from 'path';
import { resolveAddonsRootDir, resolveAddonDir, resolveEntryPath } from './paths.js';
import { AddonRepository } from './repository.js';

/** Minimal, explicit content-type map for the asset kinds an add-on UI can
 *  ship. Anything not listed is served as `application/octet-stream` with
 *  `nosniff`, so an unexpected type is never sniffed into an executable one. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Builds the strict CSP for an add-on UI response. `selfPath` is the add-on's
 * OWN absolute UI base URL (e.g. `http://host/addons/{id}/ui/`) -- included
 * alongside `'self'` so the policy is scoped to the add-on's own path even
 * when the sandboxed iframe runs in an opaque origin (where a bare `'self'`
 * can be ambiguous). `'unsafe-inline'` is permitted for the add-on's OWN
 * scripts/styles ONLY: the add-on code is already untrusted and fully
 * isolated (opaque origin, no parent access, no cookies) by the iframe
 * sandbox, so inline execution within its own sandbox is not a host-security
 * concern -- while `connect-src 'none'` + no external host sources are what
 * actually matter (no data exfiltration path except the scope-checked bridge).
 */
export function buildAddonCsp(selfPath: string): string {
  return [
    `default-src 'self' ${selfPath}`,
    `script-src 'self' 'unsafe-inline' ${selfPath}`,
    `style-src 'self' 'unsafe-inline' ${selfPath}`,
    `img-src 'self' data: ${selfPath}`,
    `font-src 'self' data: ${selfPath}`,
    // The add-on UI reaches the outside world ONLY via the postMessage bridge.
    // No fetch/XHR/WebSocket/EventSource to anywhere -- not even same-origin.
    `connect-src 'none'`,
    // Only OUR host page may frame the add-on UI.
    `frame-ancestors 'self'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `object-src 'none'`,
    `worker-src 'none'`,
  ].join('; ');
}

function applySecurityHeaders(request: FastifyRequest, reply: FastifyReply, id: string): void {
  const scheme = (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol;
  const host = request.headers.host ?? '';
  const selfPath = `${scheme}://${host}/addons/${id}/ui/`;
  reply.header('Content-Security-Policy', buildAddonCsp(selfPath));
  reply.header('X-Content-Type-Options', 'nosniff');
  // Never let an add-on UI asset become the frame of a hostile top-level page.
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  // UI assets can change on update; never let a stale copy linger.
  reply.header('Cache-Control', 'no-cache');
}

export interface AddonUiHostPluginOptions {
  /** Injectable for tests; defaults to a repository over the shared DB. */
  repository?: AddonRepository;
  /** Injectable add-ons root dir; defaults to `resolveAddonsRootDir()`. */
  addonsRootDir?: string;
}

/**
 * Registers `GET /addons/:id/ui/*` (and the bare `/addons/:id/ui/` ->
 * `index.html`). Serves ONLY the `ui/` subtree of an ENABLED add-on.
 */
export const addonUiHostPlugin: FastifyPluginAsync<AddonUiHostPluginOptions> = async (fastify, opts) => {
  const repository = opts.repository ?? new AddonRepository();
  const addonsRootDir = opts.addonsRootDir ?? resolveAddonsRootDir();

  const handler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const { id } = request.params as { id: string; '*'?: string };
    const rawSubPath = (request.params as { '*'?: string })['*'] ?? '';

    // The CSP/security headers apply to EVERY response on this route --
    // including the 404s below -- so a probe never gets a header-less answer.
    applySecurityHeaders(request, reply, id);

    // 1. Validate the id + resolve the add-on directory (traversal-safe).
    const addonDir = resolveAddonDir(addonsRootDir, id);
    if (!addonDir) {
      reply.code(404).type('text/plain').send('Not found');
      return;
    }

    // 2. Live enabled-gate: unknown OR disabled add-on -> 404 (residue-free
    //    disable). Read fresh from the DB on every request.
    const record = repository.getById(id);
    if (!record || !record.enabled) {
      reply.code(404).type('text/plain').send('Not found');
      return;
    }

    // 3. Resolve the requested asset INSIDE the add-on's own `ui/` subtree.
    //    A bare/trailing-slash path serves `index.html`.
    const uiDir = resolveEntryPath(addonDir, 'ui');
    if (!uiDir) {
      reply.code(404).type('text/plain').send('Not found');
      return;
    }
    const subPath = rawSubPath === '' || rawSubPath.endsWith('/') ? `${rawSubPath}index.html` : rawSubPath;
    const filePath = resolveEntryPath(uiDir, subPath);
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      reply.code(404).type('text/plain').send('Not found');
      return;
    }

    reply.header('Content-Type', contentTypeFor(filePath));
    reply.code(200);
    return reply.send(createReadStream(filePath));
  };

  fastify.get('/addons/:id/ui/', handler);
  fastify.get('/addons/:id/ui/*', handler);
};
