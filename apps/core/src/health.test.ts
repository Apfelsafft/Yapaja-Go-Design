/**
 * `/api/v1/health` -- am ECHTEN Server.
 *
 * Vorher stand hier ein eigens gebauter Fastify mit fest eingetragener
 * Version:
 *
 *     fastify.get('/api/v1/health', async () => ({ version: '0.0.1', ... }));
 *
 * Der Test prueft dann seine eigene Attrappe. Der laufende Server meldete
 * derweil `"version":"0.0.0"` -- und dieser Test war gruen, waehrend genau
 * die Angabe fehlte, die man in einer Fehlermeldung zuerst braucht.
 *
 * Jetzt wird `buildServer()` gestartet und die Antwort geprueft, die auch das
 * Geraet ausliefert.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';
import { closeDb } from './db/index.js';
import { ADDON_VERSION_ENV, UNKNOWN_VERSION } from './version.js';

interface HealthResponse {
  status: string;
  version: string;
  services: Record<string, unknown>;
}

describe('Health Endpoint', () => {
  let server: FastifyInstance;
  const savedVersion = process.env[ADDON_VERSION_ENV];

  beforeEach(() => {
    process.env.DB_PATH = ':memory:';
    closeDb();
  });

  afterEach(async () => {
    await server?.close();
    closeDb();
    if (savedVersion === undefined) delete process.env[ADDON_VERSION_ENV];
    else process.env[ADDON_VERSION_ENV] = savedVersion;
  });

  async function health(): Promise<HealthResponse> {
    server = await buildServer();
    const response = await server.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    return response.json() as HealthResponse;
  }

  it('antwortet mit dem erwarteten Schema', async () => {
    const json = await health();
    expect(json.status).toBe('ok');
    expect(typeof json.version).toBe('string');
    expect(typeof json.services).toBe('object');
  });

  it('meldet die Add-on-Version, die das Image gesetzt hat', async () => {
    // Genau der gemeldete Fehler: hier stand immer '0.0.0'.
    process.env[ADDON_VERSION_ENV] = '0.5.2';
    expect((await health()).version).toBe('0.5.2');
  });

  it('meldet nie den Rueckfallwert 0.0.0', async () => {
    // Auch ohne Add-on-Env muss etwas Brauchbares dastehen (die Core-Version).
    // '0.0.0' hiesse: gar nichts gelesen -- und sieht trotzdem nach Auskunft aus.
    delete process.env[ADDON_VERSION_ENV];
    expect((await health()).version).not.toBe(UNKNOWN_VERSION);
  });
});
