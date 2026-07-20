import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { addonStoragePlugin } from './storageRoutes.js';
import { AddonStorageService, type AddonStorageSettings } from './storageService.js';
import type { AddonRepository, AddonRecord } from './repository.js';

const INSTALLED = 'com.example.installed';

function makeSettings(): AddonStorageSettings {
  const store: Record<string, unknown> = {};
  return {
    get: (key) => store[key],
    patch: (values) => {
      Object.assign(store, values);
      return { ...store };
    },
  };
}

const repository = {
  getById: (id: string): AddonRecord | null =>
    id === INSTALLED ? ({ id, enabled: true } as unknown as AddonRecord) : null,
} as unknown as AddonRepository;

async function buildApp() {
  const app = Fastify();
  await app.register(addonStoragePlugin, {
    prefix: '/api/v1',
    repository,
    storage: new AddonStorageService(makeSettings()),
  });
  await app.ready();
  return app;
}

describe('addonStoragePlugin', () => {
  it('PUT then GET round-trips a value for an installed add-on', async () => {
    const app = await buildApp();
    const put = await app.inject({ method: 'PUT', url: `/api/v1/addons/${INSTALLED}/storage/lastSync`, payload: { value: 42 } });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: `/api/v1/addons/${INSTALLED}/storage/lastSync` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual({ data: 42 });
    await app.close();
  });

  it('404s GET for an unset key', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/v1/addons/${INSTALLED}/storage/nope` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('404s any storage op for a non-installed add-on', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: `/api/v1/addons/com.example.ghost/storage/k`, payload: { value: 1 } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects a PUT without a value field', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: `/api/v1/addons/${INSTALLED}/storage/k`, payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('DELETE removes a key', async () => {
    const app = await buildApp();
    await app.inject({ method: 'PUT', url: `/api/v1/addons/${INSTALLED}/storage/k`, payload: { value: 'x' } });
    const del = await app.inject({ method: 'DELETE', url: `/api/v1/addons/${INSTALLED}/storage/k` });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/v1/addons/${INSTALLED}/storage/k` });
    expect(get.statusCode).toBe(404);
    await app.close();
  });
});
