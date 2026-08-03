/**
 * `GET`/`POST /api/v1/security/events` (E09-T6, W-10), driven through a REAL
 * `buildServer()` so the actual auth hook and the actual add-on scope matrix
 * decide -- the whole point of the "add-on principals are default-denied here"
 * assertions below is that NOTHING in `security/routes.ts` has to remember to
 * check; the matrix's default-deny does it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddonManifest } from '@yapaja/shared';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { AddonRepository } from '../addons/repository.js';
import { AddonTokenService } from '../addons/tokens.js';
import { SECURITY_VECTORS, securityEventLog, type SecurityViolation } from './securityEvents.js';

const ADDON_ID = 'com.example.evil';

let parentDir: string;
let server: FastifyInstance;

function manifestFor(id: string, permissions: string[]): AddonManifest {
  return {
    id,
    name: `Add-on ${id}`,
    version: '1.0.0',
    core_api: '^0.0.0',
    author: 'Test',
    license: 'MIT',
    description: 'security route fixture',
    permissions,
  };
}

/** Installs an ENABLED add-on with EVERY scope and mints its token -- so a
 *  403 below can only be the route table's default-deny, never a missing scope. */
function installFullyScopedAddon(): string {
  const permissions = [
    'pos.read',
    'nav.read',
    'nav.control',
    'route.read',
    'route.propose',
    'map.layer.write',
    'widget.register',
    'events.publish',
    'storage.own',
    'ha.notify',
    'camera.view',
  ];
  const repository = new AddonRepository();
  repository.insert({
    id: ADDON_ID,
    name: 'Evil',
    version: '1.0.0',
    manifest: manifestFor(ADDON_ID, permissions),
    enabled: true,
    installPath: join(parentDir, 'addons', ADDON_ID),
  });
  return new AddonTokenService({ repository }).issue(ADDON_ID, permissions);
}

describe('security event routes (E09-T6)', () => {
  beforeEach(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'security-routes-test-'));
    process.env.ADDONS_DIR = join(parentDir, 'addons');
    process.env.ADDON_STORAGE_DIR = join(parentDir, 'addon-storage');
    process.env.DB_PATH = ':memory:';
    closeDb();
    securityEventLog.clear();
    server = await buildServer();
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    securityEventLog.clear();
    delete process.env.ADDONS_DIR;
    delete process.env.ADDON_STORAGE_DIR;
    rmSync(parentDir, { recursive: true, force: true });
  });

  it('GET returns the recorded violations plus the vector vocabulary', async () => {
    securityEventLog.record('core.scope_denied', ADDON_ID, 'GET /api/v1/settings');

    const res = await server.inject({ method: 'GET', url: '/api/v1/security/events' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: SecurityViolation[]; vectors: string[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ vector: 'core.scope_denied', addonId: ADDON_ID });
    expect(body.vectors).toEqual([...SECURITY_VECTORS]);
  });

  it('GET supports vector / addon_id / limit filters', async () => {
    securityEventLog.record('core.scope_denied', 'a', '1');
    securityEventLog.record('tarball.symlink', 'b', '2');
    securityEventLog.record('core.scope_denied', 'a', '3');

    const byVector = await server.inject({
      method: 'GET',
      url: '/api/v1/security/events?vector=core.scope_denied',
    });
    expect((byVector.json() as { data: SecurityViolation[] }).data.map((e) => e.detail)).toEqual(['1', '3']);

    const byAddon = await server.inject({ method: 'GET', url: '/api/v1/security/events?addon_id=b' });
    expect((byAddon.json() as { data: SecurityViolation[] }).data.map((e) => e.detail)).toEqual(['2']);

    const limited = await server.inject({ method: 'GET', url: '/api/v1/security/events?limit=1' });
    expect((limited.json() as { data: SecurityViolation[] }).data.map((e) => e.detail)).toEqual(['3']);
  });

  it('POST records a host-forwarded browser-side violation', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/security/events',
      payload: {
        vector: 'ui.parent_dom_access',
        addon_id: ADDON_ID,
        detail: 'window.parent.document threw SecurityError',
      },
    });
    expect(res.statusCode).toBe(202);
    expect(securityEventLog.list({ vector: 'ui.parent_dom_access' })).toHaveLength(1);
  });

  it('POST rejects an unknown vector id (400) and records nothing', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/security/events',
      payload: { vector: 'ui.totally_made_up', addon_id: ADDON_ID, detail: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(securityEventLog.size).toBe(0);
  });

  it('POST redacts a secret that slipped into `detail`', async () => {
    await server.inject({
      method: 'POST',
      url: '/api/v1/security/events',
      payload: { vector: 'ui.foreign_host_fetch', addon_id: ADDON_ID, detail: 'sent Bearer leaked-value' },
    });
    const stored = securityEventLog.list()[0];
    expect(stored.detail).not.toContain('leaked-value');
  });

  // ---- THE add-on default-deny assertions (task acceptance) ---------------

  it('an ADD-ON token is refused (403) on GET /security/events', async () => {
    const token = installFullyScopedAddon();
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/security/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'ROUTE_NOT_ALLOWED' } });
  });

  it('an ADD-ON token is refused (403) on POST /security/events', async () => {
    const token = installFullyScopedAddon();
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/security/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { vector: 'ui.parent_dom_access', addon_id: 'com.example.someone-else', detail: 'forged' },
    });
    expect(res.statusCode).toBe(403);
    // ... and the forged entry was NOT recorded.
    expect(securityEventLog.list({ vector: 'ui.parent_dom_access' })).toHaveLength(0);
  });

  it('the add-on refusal on the security routes is ITSELF recorded', async () => {
    const token = installFullyScopedAddon();
    await server.inject({
      method: 'GET',
      url: '/api/v1/security/events',
      headers: { authorization: `Bearer ${token}` },
    });
    const denied = securityEventLog.list({ vector: 'core.scope_denied' });
    expect(denied.length).toBeGreaterThanOrEqual(1);
    expect(denied[denied.length - 1].addonId).toBe(ADDON_ID);
    expect(denied[denied.length - 1].detail).toContain('/api/v1/security/events');
  });
});
