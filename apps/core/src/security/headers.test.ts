/**
 * E10-T4 Pflicht-Test "Header-Check-Test" (docs/07 §7).
 *
 * The release gate names three things by name -- CSP, `nosniff` and
 * `frame-ancestors` -- so each is asserted here on the REAL assembled server
 * (`buildServer()`), not on a hand-rolled Fastify instance: the point of the
 * check is that the headers are present on every surface the device actually
 * exposes (SPA shell, static asset, SPA fallback, JSON API, error replies),
 * which is a property of the wiring in `index.ts`, not of the plugin alone.
 *
 * The negative half matters just as much: the add-on UI host's stricter CSP
 * (E09-T2/W-10) must NOT be replaced by the app-wide one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import {
  buildAppCsp,
  resolveFrameAncestors,
  securityHeadersPlugin,
  DEFAULT_FRAME_ANCESTORS,
} from './headers.js';

/** Parses a CSP header into `directive -> value` for exact-value assertions. */
function parseCsp(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const space = trimmed.indexOf(' ');
    if (space === -1) {
      out[trimmed] = '';
      continue;
    }
    out[trimmed.slice(0, space)] = trimmed.slice(space + 1);
  }
  return out;
}

describe('buildAppCsp (E10-T4)', () => {
  const csp = parseCsp(buildAppCsp());

  it('names every directive the release gate requires', () => {
    expect(csp['default-src']).toBe("'self'");
    expect(csp['frame-ancestors']).toBe("'self'");
    expect(csp['object-src']).toBe("'none'");
  });

  it("keeps script-src free of 'unsafe-inline' / 'unsafe-eval'", () => {
    // The bundle emits external module scripts only, so the directive that
    // actually stops XSS stays strict. If a future change needs an inline
    // script, it must use a nonce/hash -- not weaken this.
    expect(csp['script-src']).toBe("'self'");
  });

  it('allows exactly the sources the real bundle needs and nothing wider', () => {
    // MapLibre: blob workers + blob/data images.
    expect(csp['worker-src']).toContain('blob:');
    expect(csp['img-src']).toContain('blob:');
    // React inline style attributes -- documented concession, styles only.
    expect(csp['style-src']).toContain("'unsafe-inline'");
    // Offline device: no outbound origin is reachable from the page.
    expect(csp['connect-src']).toBe("'self'");
    // No wildcard host source anywhere in the policy.
    expect(buildAppCsp()).not.toContain('*');
    expect(buildAppCsp()).not.toContain('http://');
  });

  it("allows base-uri 'self' so HA-ingress <base href> injection still works", () => {
    // W-15 / static/ingressHtml.ts injects a same-origin <base href>.
    expect(csp['base-uri']).toBe("'self'");
  });

  it('honours a configured frame-ancestors override', () => {
    const custom = parseCsp(buildAppCsp({ frameAncestors: "'self' https://dash.lan" }));
    expect(custom['frame-ancestors']).toBe("'self' https://dash.lan");
  });
});

describe('resolveFrameAncestors', () => {
  it('defaults when unset', () => {
    expect(resolveFrameAncestors({})).toBe(DEFAULT_FRAME_ANCESTORS);
  });

  it('falls back to the default for a blank value (never emits an empty directive)', () => {
    // An empty directive makes the whole policy malformed, and browsers drop
    // a malformed policy entirely -- i.e. blank must fail CLOSED, not open.
    expect(resolveFrameAncestors({ YAPAJA_FRAME_ANCESTORS: '   ' })).toBe(DEFAULT_FRAME_ANCESTORS);
  });

  it('uses a configured value', () => {
    expect(resolveFrameAncestors({ YAPAJA_FRAME_ANCESTORS: "'none'" })).toBe("'none'");
  });
});

describe('security headers on the assembled server (E10-T4)', () => {
  let publicDir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    publicDir = mkdtempSync(join(tmpdir(), 'yapaja-sec-headers-'));
    writeFileSync(
      join(publicDir, 'index.html'),
      '<!doctype html><html><head><title>Yapaja Go</title></head><body></body></html>',
    );
    writeFileSync(join(publicDir, 'asset.js'), 'export const x = 1;\n');
    process.env.DB_PATH = ':memory:';
    closeDb();
    app = await buildServer({ publicDir });
  });

  afterAll(async () => {
    await app.close();
    rmSync(publicDir, { recursive: true, force: true });
  });

  // Every surface the device exposes, including the two error paths.
  const surfaces: Array<{ name: string; url: string; expectedStatus: number }> = [
    { name: 'SPA shell (GET /)', url: '/', expectedStatus: 200 },
    { name: 'static asset', url: '/asset.js', expectedStatus: 200 },
    { name: 'SPA deep-link fallback', url: '/route/deep-link', expectedStatus: 200 },
    { name: 'open API route', url: '/api/v1/health', expectedStatus: 200 },
    { name: 'API 404 error reply', url: '/api/v1/does-not-exist', expectedStatus: 404 },
  ];

  for (const surface of surfaces) {
    it(`sets CSP + nosniff + frame-ancestors on the ${surface.name}`, async () => {
      const res = await app.inject({ method: 'GET', url: surface.url });
      expect(res.statusCode).toBe(surface.expectedStatus);

      expect(res.headers['x-content-type-options']).toBe('nosniff');

      const header = res.headers['content-security-policy'];
      expect(typeof header).toBe('string');
      const csp = parseCsp(header as string);
      expect(csp['frame-ancestors']).toBe("'self'");
      expect(csp['default-src']).toBe("'self'");
      expect(csp['script-src']).toBe("'self'");

      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  }
});

describe('security headers do not weaken the add-on sandbox CSP (E09-T2/W-10)', () => {
  it('leaves an already-set, stricter CSP untouched', async () => {
    const app = Fastify();
    await app.register(securityHeadersPlugin);
    // Stands in for `addons/ui-host.ts`, which sets its own policy in-handler.
    app.get('/addons/x/ui/index.html', async (_request, reply) => {
      reply.header('Content-Security-Policy', "default-src 'self'; connect-src 'none'");
      return reply.send('ok');
    });

    const res = await app.inject({ method: 'GET', url: '/addons/x/ui/index.html' });
    const csp = parseCsp(res.headers['content-security-policy'] as string);

    // The sandbox policy survives verbatim -- crucially `connect-src 'none'`,
    // which the app-wide policy would have relaxed to 'self'.
    expect(csp['connect-src']).toBe("'none'");
    // ...while the non-CSP baseline headers are still added on top.
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    await app.close();
  });
});
