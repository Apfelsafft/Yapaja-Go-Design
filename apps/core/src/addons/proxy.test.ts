/**
 * Egress-proxy tests (E09-T3, docs/05 §2 `net.fetch:<host>`, W-14).
 *
 * Two layers:
 *  1. `validateProxyTarget` -- the pure hostname check, hammered with every
 *     spoofing variant (query-string decoys, suffix look-alikes, userinfo,
 *     case/trailing-dot/IDN-ish tricks, non-HTTP schemes, private pivots).
 *  2. The route itself over Fastify `inject()` with an INJECTED fetch, so the
 *     allow/deny behaviour and the redirect re-validation are exercised
 *     without touching the network.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Buffer } from 'node:buffer';
import {
  addonProxyPlugin,
  normalizeHostname,
  parseAllowedHosts,
  validateProxyTarget,
  isPrivateOrLoopbackHost,
  type ProxyFetchLike,
  type ProxyFetchResponse,
} from './proxy.js';
import type { AddonPrincipal } from './scopeMatrix.js';

const DECLARED = parseAllowedHosts(['api.tomtom.com']);

describe('validateProxyTarget -- the host allow-list (E09-T3)', () => {
  it('allows a declared host', () => {
    const result = validateProxyTarget('https://api.tomtom.com/traffic?key=1', DECLARED);
    expect(result.ok).toBe(true);
  });

  it('allows a declared host case-insensitively and with a trailing dot', () => {
    expect(validateProxyTarget('https://API.TomTom.COM/x', DECLARED).ok).toBe(true);
    expect(validateProxyTarget('https://api.tomtom.com./x', DECLARED).ok).toBe(true);
  });

  describe('spoofing variants -- every one must be refused', () => {
    it.each([
      // The declared host appears only in the QUERY STRING.
      ['https://evil.com/?x=api.tomtom.com', 'HOST_NOT_ALLOWED'],
      ['https://evil.com/api.tomtom.com/path', 'HOST_NOT_ALLOWED'],
      ['https://evil.com/#api.tomtom.com', 'HOST_NOT_ALLOWED'],
      // SUFFIX look-alike: a naive endsWith/includes check would pass these.
      ['https://api.tomtom.com.evil.com/x', 'HOST_NOT_ALLOWED'],
      ['https://evil-api.tomtom.com.attacker.net/x', 'HOST_NOT_ALLOWED'],
      ['https://notapi.tomtom.com/x', 'HOST_NOT_ALLOWED'],
      // Prefix look-alike (a naive startsWith would pass).
      ['https://api.tomtom.com.co/x', 'HOST_NOT_ALLOWED'],
      // USERINFO: hostname is really evil.com.
      ['https://api.tomtom.com@evil.com/x', 'USERINFO_NOT_ALLOWED'],
      ['https://api.tomtom.com:secret@evil.com/x', 'USERINFO_NOT_ALLOWED'],
      // ... even towards the declared host itself (credential leak).
      ['https://user:pw@api.tomtom.com/x', 'USERINFO_NOT_ALLOWED'],
      // Backslash confusion (browsers normalise `\` to `/`, so does WHATWG URL).
      ['https://evil.com\\@api.tomtom.com/', 'HOST_NOT_ALLOWED'],
      // Non-HTTP schemes.
      ['file:///etc/passwd', 'PROTOCOL_NOT_ALLOWED'],
      ['ftp://api.tomtom.com/x', 'PROTOCOL_NOT_ALLOWED'],
      ['data:text/html,<script>1</script>', 'PROTOCOL_NOT_ALLOWED'],
      // Not a URL at all / relative.
      ['/api/v1/settings', 'INVALID_URL'],
      ['api.tomtom.com/x', 'INVALID_URL'],
      ['', 'INVALID_URL'],
      // Loopback / private pivots back into the Core or the LAN.
      ['http://127.0.0.1:8080/api/v1/settings', 'PRIVATE_HOST_NOT_ALLOWED'],
      ['http://localhost:8080/api/v1/settings', 'PRIVATE_HOST_NOT_ALLOWED'],
      ['http://[::1]:8080/x', 'PRIVATE_HOST_NOT_ALLOWED'],
      ['http://192.168.1.5/x', 'PRIVATE_HOST_NOT_ALLOWED'],
      ['http://10.0.0.9/x', 'PRIVATE_HOST_NOT_ALLOWED'],
      ['http://169.254.169.254/latest/meta-data/', 'PRIVATE_HOST_NOT_ALLOWED'],
    ])('refuses %s (%s)', (url, code) => {
      const result = validateProxyTarget(url, DECLARED);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    });

    it('refuses a declared PRIVATE host too, unless explicitly opted in', () => {
      const local = parseAllowedHosts(['192.168.1.50']);
      expect(validateProxyTarget('http://192.168.1.50/cam', local).ok).toBe(false);
      expect(
        validateProxyTarget('http://192.168.1.50/cam', local, { allowPrivateHosts: true }).ok,
      ).toBe(true);
    });

    it('refuses everything when the add-on declared no host at all', () => {
      const result = validateProxyTarget('https://api.tomtom.com/x', []);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('HOST_NOT_ALLOWED');
    });
  });

  describe('declared ports', () => {
    it('enforces a declared port', () => {
      const withPort = parseAllowedHosts(['api.example.com:8443']);
      expect(validateProxyTarget('https://api.example.com:8443/x', withPort).ok).toBe(true);
      expect(validateProxyTarget('https://api.example.com/x', withPort).ok).toBe(false);
      expect(validateProxyTarget('https://api.example.com:9999/x', withPort).ok).toBe(false);
    });

    it('a host-only declaration accepts the default ports', () => {
      expect(validateProxyTarget('https://api.tomtom.com/x', DECLARED).ok).toBe(true);
      expect(validateProxyTarget('http://api.tomtom.com:80/x', DECLARED).ok).toBe(true);
      expect(validateProxyTarget('https://api.tomtom.com:8443/x', DECLARED).ok).toBe(true);
    });
  });

  describe('helpers', () => {
    it('normalizeHostname lowercases, unwraps IPv6 brackets, drops trailing dots', () => {
      expect(normalizeHostname('API.Example.COM.')).toBe('api.example.com');
      expect(normalizeHostname('[::1]')).toBe('::1');
    });

    it('parseAllowedHosts drops malformed declarations', () => {
      expect(parseAllowedHosts(['', '  ', 'host:notaport'])).toEqual([]);
      expect(parseAllowedHosts(['a.example.com', 'b.example.com:8080'])).toEqual([
        { hostname: 'a.example.com', port: null },
        { hostname: 'b.example.com', port: '8080' },
      ]);
    });

    it('isPrivateOrLoopbackHost covers the usual pivots but not public hosts', () => {
      expect(isPrivateOrLoopbackHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('172.20.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('172.32.0.1')).toBe(false);
      expect(isPrivateOrLoopbackHost('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('fe80::1')).toBe(true);
      expect(isPrivateOrLoopbackHost('api.tomtom.com')).toBe(false);
      expect(isPrivateOrLoopbackHost('8.8.8.8')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------

function response(status: number, headers: Record<string, string>, body = ''): ProxyFetchResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    arrayBuffer: async () => {
      const buf = Buffer.from(body, 'utf8');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    },
  };
}

function principal(hosts: string[]): AddonPrincipal {
  return {
    addonId: 'com.example.traffic',
    scopes: new Set(hosts.map((h) => `net.fetch:${h}`)),
    netFetchDeclarations: hosts,
  };
}

describe('GET /api/v1/addons/proxy (E09-T3)', () => {
  let server: FastifyInstance;
  let calls: string[];
  let responder: (url: string) => ProxyFetchResponse;
  let currentPrincipal: AddonPrincipal | null;

  beforeEach(async () => {
    calls = [];
    currentPrincipal = principal(['api.tomtom.com']);
    responder = () => response(200, { 'content-type': 'application/json' }, '{"ok":true}');
    const fetchImpl: ProxyFetchLike = async (url) => {
      calls.push(url);
      return responder(url);
    };
    server = Fastify();
    // Stand-in for the real auth hook (exercised end-to-end in
    // `scopeEnforcement.test.ts`): attach whatever principal the case needs.
    server.addHook('onRequest', async (request) => {
      if (currentPrincipal) request.addonPrincipal = currentPrincipal;
    });
    await server.register(addonProxyPlugin, { prefix: '/api/v1', fetchImpl });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  const proxy = (url: string): Promise<{ statusCode: number; body: string }> =>
    server.inject({ method: 'GET', url: `/api/v1/addons/proxy?url=${encodeURIComponent(url)}` });

  it('proxies a DECLARED host', async () => {
    const res = await proxy('https://api.tomtom.com/traffic?bbox=1,2,3,4');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(calls).toEqual(['https://api.tomtom.com/traffic?bbox=1,2,3,4']);
  });

  it('refuses an UNDECLARED host with 403 and never calls out', async () => {
    const res = await proxy('https://evil.com/steal');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('HOST_NOT_ALLOWED');
    expect(calls).toEqual([]);
  });

  it.each([
    'https://evil.com/?x=api.tomtom.com',
    'https://api.tomtom.com.evil.com/x',
    'https://api.tomtom.com@evil.com/x',
    'http://127.0.0.1:8080/api/v1/settings',
  ])('refuses the spoofing variant %s', async (url) => {
    const res = await proxy(url);
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('requires an ADD-ON token -- a Core-token caller gets 403', async () => {
    currentPrincipal = null;
    const res = await proxy('https://api.tomtom.com/x');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('ADDON_TOKEN_REQUIRED');
  });

  it('refuses when the add-on declared no net.fetch host at all', async () => {
    currentPrincipal = principal([]);
    const res = await proxy('https://api.tomtom.com/x');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('rejects a missing/invalid url parameter with 400', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/v1/addons/proxy' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_URL');
  });

  describe('redirects', () => {
    it('follows a redirect to a DECLARED host, re-validating the hop', async () => {
      responder = (url) =>
        url.endsWith('/start')
          ? response(302, { location: 'https://api.tomtom.com/final' })
          : response(200, { 'content-type': 'text/plain' }, 'arrived');
      const res = await proxy('https://api.tomtom.com/start');
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('arrived');
      expect(calls).toEqual(['https://api.tomtom.com/start', 'https://api.tomtom.com/final']);
    });

    it('REFUSES a redirect to an undeclared host (the open-redirect exfil path)', async () => {
      responder = () => response(302, { location: 'https://evil.com/collect' });
      const res = await proxy('https://api.tomtom.com/start');
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('HOST_NOT_ALLOWED');
      // The second hop was never fetched.
      expect(calls).toEqual(['https://api.tomtom.com/start']);
    });

    it('refuses a redirect to a loopback address', async () => {
      responder = () => response(307, { location: 'http://127.0.0.1:8080/api/v1/settings' });
      const res = await proxy('https://api.tomtom.com/start');
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('PRIVATE_HOST_NOT_ALLOWED');
    });

    it('resolves a RELATIVE Location against the current hop', async () => {
      responder = (url) =>
        url.endsWith('/start') ? response(301, { location: '/moved' }) : response(200, {}, 'ok');
      const res = await proxy('https://api.tomtom.com/start');
      expect(res.statusCode).toBe(200);
      expect(calls[1]).toBe('https://api.tomtom.com/moved');
    });

    it('gives up after too many redirect hops', async () => {
      responder = () => response(302, { location: 'https://api.tomtom.com/loop' });
      const res = await proxy('https://api.tomtom.com/loop');
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).error.code).toBe('TOO_MANY_REDIRECTS');
    });
  });

  it('never forwards the caller\'s Authorization header upstream', async () => {
    let seenHeaders: Record<string, string> = {};
    await server.close();
    server = Fastify();
    server.addHook('onRequest', async (request) => {
      request.addonPrincipal = principal(['api.tomtom.com']);
    });
    await server.register(addonProxyPlugin, {
      prefix: '/api/v1',
      fetchImpl: async (_url, init) => {
        seenHeaders = init.headers;
        return response(200, {}, 'ok');
      },
    });
    await server.ready();
    await server.inject({
      method: 'GET',
      url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://api.tomtom.com/x')}`,
      headers: { authorization: 'Bearer super-secret-addon-token', cookie: 'token=abc' },
    });
    expect(Object.keys(seenHeaders).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(seenHeaders).map((k) => k.toLowerCase())).not.toContain('cookie');
  });

  it('maps an upstream failure to 502 rather than leaking a stack', async () => {
    await server.close();
    server = Fastify();
    server.addHook('onRequest', async (request) => {
      request.addonPrincipal = principal(['api.tomtom.com']);
    });
    await server.register(addonProxyPlugin, {
      prefix: '/api/v1',
      fetchImpl: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    await server.ready();
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://api.tomtom.com/x')}`,
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_FAILED');
  });

  it('caps the proxied response size', async () => {
    await server.close();
    server = Fastify();
    server.addHook('onRequest', async (request) => {
      request.addonPrincipal = principal(['api.tomtom.com']);
    });
    await server.register(addonProxyPlugin, {
      prefix: '/api/v1',
      maxResponseBytes: 8,
      fetchImpl: async () => response(200, {}, 'far too much data'),
    });
    await server.ready();
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/addons/proxy?url=${encodeURIComponent('https://api.tomtom.com/x')}`,
    });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('RESPONSE_TOO_LARGE');
  });
});
