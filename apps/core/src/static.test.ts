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
