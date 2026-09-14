/**
 * Integration tests for the settings routes via HTTP injection (E07-T1).
 * Mirrors `apps/core/src/favorites/routes.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Settings Routes Integration', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
  });

  describe('GET /api/v1/settings', () => {
    it('returns an empty object initially', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({});
    });
  });

  describe('GET /api/v1/settings/:key', () => {
    it('returns 404 for an unset key', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/units' });
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('NOT_FOUND');
    });

    it('returns a single key after it was set via PATCH', async () => {
      await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { units: 'metric' },
      });
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/units' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toBe('metric');
    });
  });

  describe('PATCH /api/v1/settings', () => {
    it('creates and round-trips a key', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { units: 'metric' },
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({ units: 'metric' });
    });

    it('merges additional keys without dropping previously-set ones', async () => {
      await server.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { units: 'metric' } });
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { theme: 'dark' },
      });
      expect(JSON.parse(response.body).data).toEqual({ units: 'metric', theme: 'dark' });
    });

    it('round-trips the layouts key (widget-shell persistence, E07-T1)', async () => {
      const layouts = {
        explore: { mode: 'explore', slots: { 'top-bar': [{ instanceId: 'x1', widgetId: 'clock', size: 'S' }] }, updatedAt: 12345 },
        drive: { mode: 'drive', slots: {}, updatedAt: 999 },
      };
      const patchResponse = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: { layouts },
      });
      expect(patchResponse.statusCode).toBe(200);
      expect(JSON.parse(patchResponse.body).data.layouts).toEqual(layouts);

      const getResponse = await server.inject({ method: 'GET', url: '/api/v1/settings/layouts' });
      expect(getResponse.statusCode).toBe(200);
      expect(JSON.parse(getResponse.body).data).toEqual(layouts);
    });

    it('rejects a non-object body', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/v1/settings',
        payload: [1, 2, 3],
      });
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/settings/defaults', () => {
    it('meldet "keine Vorgabe", wenn kein Add-on eine macht (Standalone-Betrieb)', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data).toEqual({ theme: null });
    });

    it('kommt dem Schluesselweg nicht in die Quere -- "defaults" ist keine Einstellung namens "defaults"', async () => {
      // Ohne diese Zusicherung koennte die Route den Weg /settings/:key
      // verdecken und ein Schluessel "defaults" waere unerreichbar.
      await server.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { units: 'metric' } });
      const response = await server.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
      expect(JSON.parse(response.body).data).toEqual({ theme: null });
    });
  });
});

describe('GET /api/v1/settings/defaults mit gesetzter Add-on-Option', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
    closeDb();
    delete process.env.THEME_MODE;
  });

  async function starteMit(themeMode: string | undefined): Promise<FastifyInstance> {
    process.env.DB_PATH = ':memory:';
    if (themeMode === undefined) delete process.env.THEME_MODE;
    else process.env.THEME_MODE = themeMode;
    closeDb();
    return buildServer();
  }

  it('reicht THEME_MODE aus der Add-on-Konfiguration durch', async () => {
    server = await starteMit('dark');
    const response = await server.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
    expect(JSON.parse(response.body).data).toEqual({ theme: { mode: 'dark' } });
  });

  it('behandelt einen leeren Wert wie "keine Vorgabe" -- bashio liefert fuer eine ungesetzte Option einen leeren String', async () => {
    server = await starteMit('   ');
    const response = await server.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
    expect(JSON.parse(response.body).data).toEqual({ theme: null });
  });

  it('schreibt die Vorgabe NICHT in den Einstellungsspeicher -- sonst waere sie von einer Wahl nicht zu unterscheiden', async () => {
    // Genau das ist der Grund fuer den eigenen Weg: landete die Vorgabe im
    // Speicher, bliebe ein spaeteres Aendern der Option wirkungslos.
    server = await starteMit('dark');
    // Erst den Vorgabe-Weg wirklich BENUTZEN -- sonst prueft der Test nur,
    // dass ein frischer Speicher leer ist, und nicht, dass der Weg nichts
    // hineinschreibt.
    const vorgabe = await server.inject({ method: 'GET', url: '/api/v1/settings/defaults' });
    expect(JSON.parse(vorgabe.body).data).toEqual({ theme: { mode: 'dark' } });
    const response = await server.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(JSON.parse(response.body).data).toEqual({});
  });
});
