import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildServer } from './index.js';

describe('Server startup without public/ directory', () => {
  it('starts and answers /api/v1/health with 200 when publicDir does not exist', async () => {
    const fastify = await buildServer({
      publicDir: join(tmpdir(), 'yapaja-does-not-exist-' + Date.now()),
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { status: string; services: Record<string, unknown> };
    expect(json.status).toBe('ok');
    expect(typeof json.services).toBe('object');

    await fastify.close();
  });
});

describe('Static serving with public/ directory', () => {
  let publicDir: string;

  beforeAll(() => {
    publicDir = mkdtempSync(join(tmpdir(), 'yapaja-public-'));
    writeFileSync(
      join(publicDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>Yapaja Go</title></head><body></body></html>'
    );
  });

  afterAll(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  it('serves index.html under / with 200', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Yapaja Go');

    await fastify.close();
  });

  it('falls back to index.html for unknown non-API paths (SPA fallback)', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({ method: 'GET', url: '/unbekannt' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Yapaja Go');

    await fastify.close();
  });

  it('still answers /api/v1/health with 200 when public/ exists', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);

    await fastify.close();
  });
});

// E08-T4 (docs/04 §3, W-15): HA-Ingress `<base href>` injection -- "Flow 9
// simulation". HA's ingress proxy forwards the per-install path prefix via
// `X-Ingress-Path`; the served index.html must declare it as `<base href>` so
// the (relative-URL, W-15) SPA bundle resolves assets/API/WS against the
// ingress path. Covers both `GET /` and the SPA fallback (setNotFoundHandler),
// since both go through `serveIndexHtml` (apps/core/src/static/ingressHtml.ts).
describe('HA-Ingress <base href> injection (Flow 9 simulation, E08-T4)', () => {
  let publicDir: string;

  beforeAll(() => {
    publicDir = mkdtempSync(join(tmpdir(), 'yapaja-ingress-'));
    writeFileSync(
      join(publicDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>Yapaja Go</title></head><body></body></html>'
    );
  });

  afterAll(() => {
    rmSync(publicDir, { recursive: true, force: true });
  });

  it('GET / with X-Ingress-Path injects <base href> into <head>', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/api/hassio_ingress/abc123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<base href="/api/hassio_ingress/abc123/">');
    // Injected strictly inside <head>, before the existing content.
    expect(response.body.indexOf('<base href=')).toBeLessThan(response.body.indexOf('<title>'));

    await fastify.close();
  });

  it('SPA fallback with X-Ingress-Path injects <base href> too', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({
      method: 'GET',
      url: '/route/somewhere',
      headers: { 'x-ingress-path': '/api/hassio_ingress/abc123' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<base href="/api/hassio_ingress/abc123/">');

    await fastify.close();
  });

  it('GET / WITHOUT X-Ingress-Path serves index.html unchanged (no <base> injected)', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('<base');
    expect(response.body).toBe(
      '<!DOCTYPE html><html><head><title>Yapaja Go</title></head><body></body></html>'
    );

    await fastify.close();
  });

  it('a malicious X-Ingress-Path is NOT reflected into the response (no injection)', async () => {
    const fastify = await buildServer({ publicDir });

    const malicious = '/x"><script>alert(1)</script>';
    const response = await fastify.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': malicious },
    });

    expect(response.statusCode).toBe(200);
    // Neither the raw header bytes nor a <base> tag show up anywhere in the
    // response -- the malicious value fails the allow-list regex, so the
    // page is served completely unchanged (fail closed).
    expect(response.body).not.toContain('<script>');
    expect(response.body).not.toContain('alert(1)');
    expect(response.body).not.toContain('"><script>');
    expect(response.body).not.toContain('<base');
    expect(response.body).toBe(
      '<!DOCTYPE html><html><head><title>Yapaja Go</title></head><body></body></html>'
    );

    await fastify.close();
  });

  it('a path-traversal-shaped X-Ingress-Path (".." / query string) is rejected', async () => {
    const fastify = await buildServer({ publicDir });

    const response = await fastify.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-ingress-path': '/../../etc/passwd?x=1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('<base');

    await fastify.close();
  });
});
