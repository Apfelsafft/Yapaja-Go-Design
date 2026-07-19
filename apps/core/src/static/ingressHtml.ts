/**
 * HA-Ingress `<base href>` injection (E08-T4, docs/04 §3, W-15).
 *
 * When Home Assistant serves this add-on through Ingress, it reverse-proxies
 * requests under a per-install path prefix (e.g.
 * `/api/hassio_ingress/<token>`) and forwards that prefix to us on every
 * request as the `X-Ingress-Path` header. The web bundle is built with
 * relative asset URLs (`base: './'`, W-15), so the ONE thing the browser
 * still needs to resolve those relative URLs (and the WS connection, and API
 * calls) against the ingress prefix is a `<base href>` tag in `index.html`.
 * Since the bundle is static, that tag has to be injected server-side, per
 * request, from the header HA sends us.
 *
 * SECURITY: `X-Ingress-Path` is attacker-controllable in principle (any
 * client can set arbitrary request headers), so it must never be reflected
 * into HTML verbatim -- that would be a textbook header-to-HTML injection.
 * `sanitizeIngressPath` only accepts a narrow, safe path shape (leading `/`,
 * then letters/digits/`_`/`-`/`/`) and rejects everything else outright
 * (including anything containing `"`, `<`, `>`, `&`, `'`), so the accepted
 * value is always safe to interpolate directly into a `href="..."`
 * attribute without further escaping.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Only a plain absolute path made of URL-safe "segment" characters is
 * accepted. No query strings, no fragments, no `.`/`..`, no quotes or angle
 * brackets -- anything else is rejected wholesale (fail closed: unchanged
 * `index.html`) rather than sanitized/escaped, so there is no encoding edge
 * case to get wrong.
 */
export const INGRESS_PATH_PATTERN = /^\/[A-Za-z0-9_\-/]*$/;

/** Defensive upper bound; HA ingress paths are short (`/api/hassio_ingress/<token>`). */
const MAX_INGRESS_PATH_LENGTH = 512;

/**
 * Validates a raw `X-Ingress-Path` header value. Returns the value unchanged
 * when it is safe to use, or `null` when it must be rejected (missing,
 * wrong type, empty, too long, or containing anything outside the allowed
 * character set) -- `null` means "serve index.html unchanged".
 */
export function sanitizeIngressPath(rawHeaderValue: unknown): string | null {
  if (typeof rawHeaderValue !== 'string') return null;
  if (rawHeaderValue.length === 0 || rawHeaderValue.length > MAX_INGRESS_PATH_LENGTH) return null;
  if (!INGRESS_PATH_PATTERN.test(rawHeaderValue)) return null;
  return rawHeaderValue;
}

const HEAD_OPEN_TAG = /<head[^>]*>/i;

/**
 * Splices `<base href="<ingressPath>/">` right after the opening `<head>`
 * tag. `ingressPath` MUST already be validated by {@link sanitizeIngressPath}
 * -- this function does not re-validate, it only normalizes the trailing
 * slash (`<base href>` needs a directory-style URL, HA does not guarantee
 * one). When no `<head>` tag is found the HTML is returned unchanged (fail
 * safe rather than producing malformed markup).
 */
export function injectBaseHref(html: string, ingressPath: string): string {
  const match = HEAD_OPEN_TAG.exec(html);
  if (!match) return html;
  const insertAt = match.index + match[0].length;
  const base = ingressPath.endsWith('/') ? ingressPath : `${ingressPath}/`;
  const baseTag = `<base href="${base}">`;
  return html.slice(0, insertAt) + baseTag + html.slice(insertAt);
}

/** Reads the (possibly multi-valued) `x-ingress-path` request header as a single string. */
export function readIngressPathHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['x-ingress-path'];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Serves `<publicDir>/index.html`, injecting `<base href>` when (and only
 * when) a valid `X-Ingress-Path` header is present. Used for both `GET /`
 * and the SPA `setNotFoundHandler` fallback in `index.ts` so ingress
 * base-href injection is consistent across every path that ends up serving
 * the SPA shell.
 *
 * Mirrors the existing "must still behave when public/ doesn't exist" rule:
 * if `index.html` is missing (dev, or a misconfigured deploy) this replies
 * 404 exactly like the previous `reply.sendFile('index.html')` /
 * `@fastify/static` behavior did.
 */
export async function serveIndexHtml(
  publicDir: string,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const indexPath = join(publicDir, 'index.html');
  if (!existsSync(indexPath)) {
    reply.code(404).send({ error: 'Not Found' });
    return;
  }

  const html = readFileSync(indexPath, 'utf-8');
  const ingressPath = sanitizeIngressPath(readIngressPathHeader(request));
  const body = ingressPath ? injectBaseHref(html, ingressPath) : html;

  reply.header('content-type', 'text/html; charset=utf-8').send(body);
}
