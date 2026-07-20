import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { addonUiHostPlugin } from './ui-host.js';
import type { AddonRepository, AddonRecord } from './repository.js';

/**
 * The UI host serves an ENABLED add-on's `ui/` subtree behind a strict CSP.
 * A disabled/unknown add-on 404s; the served subtree can't be escaped.
 */

const ADDON_ID = 'com.example.demo';
let rootDir: string;
let enabled = true;

/** Minimal repository stub: only `enabled`/existence matter to the plugin. */
const repository = {
  getById: (id: string): AddonRecord | null =>
    id === ADDON_ID ? ({ id, enabled } as unknown as AddonRecord) : null,
} as unknown as AddonRepository;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(addonUiHostPlugin, { repository, addonsRootDir: rootDir });
  await app.ready();
  return app;
}

beforeAll(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'addon-uihost-'));
  const uiDir = join(rootDir, ADDON_ID, 'ui');
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>demo</title><body>hi</body>');
  writeFileSync(join(uiDir, 'app.js'), 'console.log("addon")');
  // A sensitive file OUTSIDE the ui/ subtree that must never be served.
  writeFileSync(join(rootDir, ADDON_ID, 'yapaja-addon.json'), '{"secret":true}');
});

afterAll(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

describe('addonUiHostPlugin', () => {
  it('serves the entry HTML of an enabled add-on with a strict CSP', async () => {
    enabled = true;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/addons/${ADDON_ID}/ui/index.html` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'none'"); // no direct network -- bridge only
    expect(csp).toContain("frame-ancestors 'self'"); // only our host may frame it
    expect(csp).not.toContain('*'); // no wildcard host
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('serves the bare ui/ path as index.html', async () => {
    enabled = true;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/addons/${ADDON_ID}/ui/` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('hi');
    await app.close();
  });

  it('serves a JS asset with the right content type + CSP', async () => {
    enabled = true;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/addons/${ADDON_ID}/ui/app.js` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['content-security-policy']).toBeTruthy();
    await app.close();
  });

  it('404s a DISABLED add-on (layers/widgets/UI disappear on disable)', async () => {
    enabled = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/addons/${ADDON_ID}/ui/index.html` });
    expect(res.statusCode).toBe(404);
    // The CSP still rides along even on the 404.
    expect(res.headers['content-security-policy']).toBeTruthy();
    await app.close();
  });

  it('404s an unknown add-on id', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/addons/com.example.nope/ui/index.html` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses to serve OUTSIDE the ui/ subtree (path traversal blocked)', async () => {
    enabled = true;
    const app = await buildApp();
    // Encoded ../../ traversal aimed at the manifest one level up from ui/.
    const res = await app.inject({ method: 'GET', url: `/addons/${ADDON_ID}/ui/..%2f..%2fyapaja-addon.json` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('secret');
    await app.close();
  });
});
