/* eslint-disable no-undef -- `URL`, `AbortController`, `AbortSignal`,
 * `setTimeout`/`clearTimeout` and `fetch` are standard Node 22 globals (typed
 * via @types/node); the shared eslint `globals` list predates this backend
 * module and only covers console/process/DOM. Same justification as
 * routing/valhallaClient.ts. */

/**
 * Egress proxy with a per-add-on host ALLOW-LIST (E09-T3, docs/05 §2
 * `net.fetch:<host>` -- "Outbound-HTTP nur zu deklarierten Hosts (Service-Typ;
 * Core erzwingt via Proxy)", Wargame W-14).
 *
 *   GET /api/v1/addons/proxy?url=https://api.tomtom.com/traffic?...
 *
 * Reachable ONLY with a scoped add-on token (the Core API token gets a 403 --
 * this endpoint exists solely to give add-ons a sanctioned, auditable egress
 * path), and only for hosts the add-on's manifest declared as
 * `net.fetch:<host>`. Everything else is refused with 403 and logged.
 *
 * HONEST LIMITATION -- read this before assuming the proxy is a network jail:
 * Node's permission model (`--permission`, see `service-host.ts`) restricts the
 * FILESYSTEM, not the network. A Core-spawned Node add-on can therefore still
 * open its own outbound socket and bypass this proxy. What the proxy buys is
 * (a) the declared-host contract being enforced and observable for well-behaved
 * add-ons, (b) an add-on never needing raw network code, and (c) a single
 * choke point that logs egress. REAL egress containment requires a network
 * namespace / firewall around the add-on process -- i.e. `runtime: external`
 * with its own container (docs/05 §7), which is exactly what the architecture
 * prescribes for anything untrusted or heavy. This is stated in the add-on
 * author docs rather than pretended away.
 *
 * THE HOSTNAME CHECK IS THE WHOLE SECURITY BOUNDARY, so it is deliberately
 * paranoid and lives in one pure, unit-tested function
 * ({@link validateProxyTarget}) rather than inline in the handler:
 *  - the URL is PARSED (`new URL`), never string-matched -- so
 *    `https://evil.com/?x=api.tomtom.com` compares `evil.com`, and
 *    `https://api.tomtom.com.evil.com` compares `api.tomtom.com.evil.com`;
 *    neither is an exact match for a declared `api.tomtom.com`.
 *  - USERINFO is rejected outright: `https://api.tomtom.com@evil.com` parses
 *    to hostname `evil.com` (the classic look-alike), and even a benign
 *    `https://user:pw@declared.host` is refused so credentials never leak.
 *  - only `http:`/`https:` schemes (no `file:`, `data:`, `gopher:`).
 *  - the hostname is normalised (lowercase, trailing dot stripped, IPv6
 *    brackets removed) and compared with `===` against the declared set --
 *    never `includes`/`endsWith`, so no suffix/substring confusion.
 *  - loopback/link-local/private literals are refused by default, so a
 *    declared `net.fetch:127.0.0.1` cannot be turned into an SSRF pivot back
 *    into the Core's own (possibly open-posture) API.
 *  - REDIRECTS are followed manually and EVERY hop is re-validated with the
 *    same function; a redirect to an undeclared host is a 403.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import type { AddonPrincipal } from './scopeMatrix.js';

/** Minimal structural `fetch`, injectable so tests never touch the network. */
export type ProxyFetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; redirect: 'manual'; signal?: AbortSignal },
) => Promise<ProxyFetchResponse>;

export interface ProxyFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ProxyDenyCode =
  | 'INVALID_URL'
  | 'PROTOCOL_NOT_ALLOWED'
  | 'USERINFO_NOT_ALLOWED'
  | 'PRIVATE_HOST_NOT_ALLOWED'
  | 'HOST_NOT_ALLOWED';

export type ProxyValidation =
  | { ok: true; url: URL }
  | { ok: false; code: ProxyDenyCode; message: string };

/** A `net.fetch:<host>` declaration, split into host + optional port. */
export interface AllowedHost {
  hostname: string;
  /** When the declaration carried `:port`, the target MUST use that port. */
  port: string | null;
}

/** Lowercase, strip the FQDN trailing dot, strip IPv6 brackets. */
export function normalizeHostname(raw: string): string {
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  while (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * Turns an add-on's `net.fetch:<host>[:port]` permissions into the allow-list.
 * Anything malformed (empty host) is dropped rather than silently widening.
 */
export function parseAllowedHosts(declarations: readonly string[]): AllowedHost[] {
  const out: AllowedHost[] = [];
  for (const raw of declarations) {
    const decl = raw.trim();
    if (decl === '') continue;
    let hostPart = decl;
    let port: string | null = null;
    if (decl.startsWith('[')) {
      // Bracketed IPv6, optionally `[::1]:8443`.
      const close = decl.indexOf(']');
      if (close === -1) continue;
      hostPart = decl.slice(0, close + 1);
      const rest = decl.slice(close + 1);
      if (rest.startsWith(':')) port = rest.slice(1);
      else if (rest !== '') continue;
    } else {
      const colon = decl.indexOf(':');
      // A bare IPv6 literal (several colons) is treated as a host, not host:port.
      if (colon !== -1 && decl.indexOf(':', colon + 1) === -1) {
        hostPart = decl.slice(0, colon);
        port = decl.slice(colon + 1);
      }
    }
    const hostname = normalizeHostname(hostPart);
    if (hostname === '') continue;
    if (port !== null && !/^\d+$/.test(port)) continue;
    out.push({ hostname, port });
  }
  return out;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Loopback / link-local / private / unspecified LITERALS. DNS names that
 * merely RESOLVE to such an address are NOT caught here (that would need a
 * resolve-then-pin, out of scope) -- the operator-confirmed allow-list is the
 * primary control; this is the second layer that stops the obvious pivot.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
  if (hostname === '::1' || hostname === '::' || hostname === '0.0.0.0') return true;
  // Unique-local (fc00::/7) and link-local (fe80::/10) IPv6.
  if (/^f[cd][0-9a-f]{0,2}:/.test(hostname)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(hostname)) return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1).
  const mapped = /^::ffff:(.+)$/.exec(hostname);
  if (mapped) return isPrivateOrLoopbackHost(mapped[1]);
  const m = IPV4_RE.exec(hostname);
  if (!m) return false;
  const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export interface ValidateProxyTargetOptions {
  /** Escape hatch for a LAN-only deployment that deliberately declares e.g.
   *  `net.fetch:192.168.1.50` for a local camera/sensor. Default false. */
  allowPrivateHosts?: boolean;
}

/**
 * THE check. Pure, total, and the only place a proxy target is ever judged --
 * used both for the initial URL and for every redirect hop.
 */
export function validateProxyTarget(
  rawUrl: string,
  allowed: readonly AllowedHost[],
  opts: ValidateProxyTargetOptions = {},
): ProxyValidation {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { ok: false, code: 'INVALID_URL', message: 'A "url" query parameter is required' };
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'Not a valid absolute URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'PROTOCOL_NOT_ALLOWED',
      message: `Only http/https may be proxied, got "${url.protocol}"`,
    };
  }
  // `https://api.tomtom.com@evil.com` -> hostname is evil.com. Refusing
  // userinfo outright removes the whole class of look-alike URLs (and stops
  // credentials from being forwarded).
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      code: 'USERINFO_NOT_ALLOWED',
      message: 'URLs with embedded credentials (user:pass@host) are never proxied',
    };
  }
  const hostname = normalizeHostname(url.hostname);
  if (hostname === '') {
    return { ok: false, code: 'INVALID_URL', message: 'URL has no hostname' };
  }
  if (!opts.allowPrivateHosts && isPrivateOrLoopbackHost(hostname)) {
    return {
      ok: false,
      code: 'PRIVATE_HOST_NOT_ALLOWED',
      message: `Host "${hostname}" is loopback/link-local/private and is never proxied`,
    };
  }
  // EXACT hostname comparison -- never a suffix or substring test.
  const match = allowed.find(
    (a) => a.hostname === hostname && (a.port === null || a.port === (url.port || defaultPort(url.protocol))),
  );
  if (!match) {
    return {
      ok: false,
      code: 'HOST_NOT_ALLOWED',
      message: `Host "${hostname}" is not declared in this add-on's net.fetch:<host> permissions`,
    };
  }
  return { ok: true, url };
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}

/** Response body cap: an add-on must not be able to blow up Core memory. */
export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Per-hop timeout. */
export const PROXY_TIMEOUT_MS = 10_000;
/** Redirect hops followed (each one re-validated). */
export const MAX_PROXY_REDIRECTS = 3;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export interface AddonProxyPluginOptions {
  /** Injectable transport; defaults to the global `fetch`. */
  fetchImpl?: ProxyFetchLike;
  /** See {@link ValidateProxyTargetOptions}; also settable via
   *  `ADDON_PROXY_ALLOW_PRIVATE_HOSTS=1`. */
  allowPrivateHosts?: boolean;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

function err(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export const addonProxyPlugin: FastifyPluginAsync<AddonProxyPluginOptions> = async (fastify, opts) => {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as ProxyFetchLike);
  const allowPrivateHosts =
    opts.allowPrivateHosts ?? process.env.ADDON_PROXY_ALLOW_PRIVATE_HOSTS === '1';
  const maxResponseBytes = opts.maxResponseBytes ?? MAX_PROXY_RESPONSE_BYTES;
  const timeoutMs = opts.timeoutMs ?? PROXY_TIMEOUT_MS;

  fastify.get<{ Querystring: { url?: string } }>('/addons/proxy', async (request, reply) => {
    // Only an ADD-ON principal may use the proxy. The scope matrix already
    // allows this route for add-ons; this is the "not the Core token" half.
    const principal: AddonPrincipal | undefined = request.addonPrincipal;
    if (!principal) {
      reply.code(403).send(err('ADDON_TOKEN_REQUIRED', 'The add-on egress proxy requires a scoped add-on token'));
      return;
    }

    const allowed = parseAllowedHosts(principal.netFetchDeclarations);
    if (allowed.length === 0) {
      request.log.warn({ addon_id: principal.addonId }, 'add-on egress refused: no net.fetch:<host> declared');
      reply
        .code(403)
        .send(err('HOST_NOT_ALLOWED', 'This add-on declares no net.fetch:<host> permission'));
      return;
    }

    let current = validateProxyTarget(request.query.url ?? '', allowed, { allowPrivateHosts });
    if (!current.ok) {
      request.log.warn(
        { addon_id: principal.addonId, code: current.code, url: request.query.url },
        'add-on egress refused by the host allow-list',
      );
      reply.code(current.code === 'INVALID_URL' ? 400 : 403).send(err(current.code, current.message));
      return;
    }

    let target = current.url;
    for (let hop = 0; ; hop++) {
      let response: ProxyFetchResponse;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchImpl(target.toString(), {
          method: 'GET',
          // NOTHING from the incoming request is forwarded except a plain
          // Accept -- above all never the `Authorization` header (which
          // carries the add-on's own token) and never cookies.
          headers: { accept: request.headers['accept'] ?? '*/*', 'user-agent': 'YapajaGo-AddonProxy' },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (e) {
        request.log.warn(
          { addon_id: principal.addonId, host: target.hostname, error: e instanceof Error ? e.message : String(e) },
          'add-on egress request failed',
        );
        reply.code(502).send(err('UPSTREAM_FAILED', e instanceof Error ? e.message : 'Upstream request failed'));
        return;
      } finally {
        clearTimeout(timer);
      }

      if (!isRedirectStatus(response.status)) {
        const buf = await response.arrayBuffer();
        if (buf.byteLength > maxResponseBytes) {
          reply
            .code(502)
            .send(err('RESPONSE_TOO_LARGE', `Upstream response exceeds the ${maxResponseBytes}-byte proxy cap`));
          return;
        }
        const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
        reply.header('Content-Type', contentType);
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.code(response.status);
        return reply.send(globalThis.Buffer.from(buf));
      }

      // --- redirect: re-validate the next hop with the SAME function -------
      if (hop >= MAX_PROXY_REDIRECTS) {
        reply.code(502).send(err('TOO_MANY_REDIRECTS', 'Upstream redirected too many times'));
        return;
      }
      const location = response.headers.get('location');
      if (!location) {
        reply.code(502).send(err('UPSTREAM_FAILED', 'Redirect without a Location header'));
        return;
      }
      let next: string;
      try {
        next = new URL(location, target).toString();
      } catch {
        reply.code(502).send(err('UPSTREAM_FAILED', 'Redirect Location is not a valid URL'));
        return;
      }
      current = validateProxyTarget(next, allowed, { allowPrivateHosts });
      if (!current.ok) {
        request.log.warn(
          { addon_id: principal.addonId, code: current.code, location: next },
          'add-on egress refused: redirect target not declared',
        );
        reply.code(403).send(err(current.code, `Redirect refused: ${current.message}`));
        return;
      }
      target = current.url;
    }
  });
};
