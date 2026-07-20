/**
 * REST surface for the `storage.own` scope (E09-T2). Prefix: `/api/v1`.
 *
 *  - GET    /addons/:id/storage/:key  -> `{ data: <value> }` (404 if unset)
 *  - PUT    /addons/:id/storage/:key  -> body `{ value }`, upserts, `{ data }`
 *  - DELETE /addons/:id/storage/:key  -> 204
 *
 * The add-on id is a validated path parameter and every operation is scoped to
 * it server-side (`AddonStorageService` prefixes by id) -- an add-on can only
 * ever read/write its OWN keys. The route additionally requires the add-on to
 * be INSTALLED (a lookup miss is a 404), so storage for a never-installed /
 * uninstalled id is inaccessible.
 *
 * NOTE: this is the HOST's storage channel. The sandboxed add-on iframe itself
 * cannot call this endpoint directly (its CSP forbids all `connect-src`); it
 * goes through the host bridge, which supplies the PINNED add-on id -- so the
 * id here is never attacker-chosen from inside the sandbox. The endpoint's own
 * id-validation + install-gate is defense in depth on top of that.
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { AddonRepository } from './repository.js';
import { AddonStorageService, AddonStorageError } from './storageService.js';

interface StorageParams {
  id: string;
  key: string;
}

function err(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export interface AddonStoragePluginOptions {
  repository?: AddonRepository;
  storage?: AddonStorageService;
}

export const addonStoragePlugin: FastifyPluginAsync<AddonStoragePluginOptions> = async (fastify, opts) => {
  const repository = opts.repository ?? new AddonRepository();
  const storage = opts.storage ?? new AddonStorageService();

  /** Guard: the add-on must exist. Returns true if the request may proceed. */
  const requireInstalled = (id: string, reply: FastifyReply): boolean => {
    const record = repository.getById(id);
    if (!record) {
      reply.code(404).send(err('NOT_FOUND', `No add-on installed with id "${id}"`));
      return false;
    }
    return true;
  };

  fastify.get<{ Params: StorageParams }>('/addons/:id/storage/:key', async (request, reply) => {
    const { id, key } = request.params;
    if (!requireInstalled(id, reply)) return;
    try {
      const value = storage.get(id, key);
      if (value === undefined) {
        reply.code(404).send(err('NOT_FOUND', `Storage key "${key}" not set`));
        return;
      }
      reply.code(200).send({ data: value });
    } catch (e) {
      if (e instanceof AddonStorageError) reply.code(400).send(err(e.code, e.message));
      else throw e;
    }
  });

  fastify.put<{ Params: StorageParams; Body: { value?: unknown } }>(
    '/addons/:id/storage/:key',
    async (request, reply) => {
      const { id, key } = request.params;
      if (!requireInstalled(id, reply)) return;
      const body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('value' in body)) {
        reply.code(400).send(err('VALIDATION_ERROR', 'Body must be a JSON object with a "value" field'));
        return;
      }
      try {
        storage.set(id, key, body.value);
        reply.code(200).send({ data: body.value });
      } catch (e) {
        if (e instanceof AddonStorageError) reply.code(400).send(err(e.code, e.message));
        else throw e;
      }
    },
  );

  fastify.delete<{ Params: StorageParams }>('/addons/:id/storage/:key', async (request, reply) => {
    const { id, key } = request.params;
    if (!requireInstalled(id, reply)) return;
    try {
      storage.delete(id, key);
      reply.code(204).send();
    } catch (e) {
      if (e instanceof AddonStorageError) reply.code(400).send(err(e.code, e.message));
      else throw e;
    }
  });
};
