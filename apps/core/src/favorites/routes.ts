/**
 * Fastify routes for favorites + search/destination history (E05-T3).
 * Prefix: /api/v1 (see docs/03-api-spec.md §2 "Suche & Favoriten").
 *
 *  - GET    /favorites          -> `{ data: Favorite[] }`, sort_order asc
 *  - POST   /favorites          -> create (`replace: true` to replace an
 *                                   existing `home` favorite, else 409)
 *  - PUT    /favorites/reorder  -> persist a full drag-order id list
 *  - PUT    /favorites/:id      -> update (same `replace` semantics)
 *  - DELETE /favorites/:id      -> 204
 *
 *  - GET    /history            -> `{ data: HistoryEntry[] }`, newest first
 *  - POST   /history             -> record a query and/or a picked destination
 *  - DELETE /history/:id        -> delete one entry, 204
 *  - DELETE /history            -> clear all, 204
 */
import type { FastifyPluginAsync } from 'fastify';
import type { ApiError, Favorite, HistoryEntry } from '@yapaja/shared';
import { validateFavorite, getValidationErrorsFavorite } from '@yapaja/shared';
import { FavoriteError, FavoriteService } from './service.js';
import { HistoryError, HistoryService } from './historyService.js';

interface FavoriteRouteParams {
  id: string;
}

interface FavoriteListReply {
  data: Favorite[];
}

interface FavoriteDetailReply {
  data: Favorite;
}

interface HistoryListReply {
  data: HistoryEntry[];
}

interface HistoryDetailReply {
  data: HistoryEntry;
}

interface ValidationErrorDetails extends Record<string, unknown> {
  fields: Record<string, string>;
}

function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

/** Validates a favorite create/update body against the shared `Favorite`
 *  schema, mirroring `profiles/routes.ts`'s `validateProfileInput`: server-
 *  managed fields (`id`, and `sort_order` when omitted) are filled with
 *  placeholders before validation so the schema's `required` list is
 *  satisfied without the client having to supply them. */
function validateFavoriteInput(
  data: Record<string, unknown>,
): { valid: boolean; errors?: ValidationErrorDetails } {
  const temp = {
    ...data,
    id: 'temp-id',
    sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
  };
  if (!validateFavorite(temp)) {
    const errors = getValidationErrorsFavorite(temp);
    const fieldErrors: Record<string, string> = {};
    for (const error of errors) {
      const match = error.match(/Favorite\[([^\]]+)\]:\s*(.*?)(?:\s*\(|$)/);
      if (match && match[1] && match[2]) {
        fieldErrors[match[1]] = match[2];
      }
    }
    return { valid: false, errors: { fields: fieldErrors } };
  }
  return { valid: true };
}

interface FavoriteWriteBody {
  name?: unknown;
  latlng?: unknown;
  icon?: unknown;
  category?: unknown;
  sort_order?: unknown;
  /** Confirms replacing an existing `home` favorite (docs/03 "ersetzen mit
   *  Bestätigung"). Never part of the `Favorite` schema itself. */
  replace?: boolean;
}

function handleFavoriteError(err: unknown, reply: { code: (n: number) => { send: (b: ApiError) => void } }): void {
  const error = err as FavoriteError;
  if (error.code === 'HOME_ALREADY_EXISTS') {
    reply.code(409).send(createErrorResponse(error.code, error.message));
    return;
  }
  if (error.code === 'NOT_FOUND') {
    reply.code(404).send(createErrorResponse(error.code, error.message));
    return;
  }
  reply.code(400).send(createErrorResponse('WRITE_ERROR', error.message ?? 'Unknown error'));
}

export const favoritesPlugin: FastifyPluginAsync = async (fastify) => {
  const favoriteService = new FavoriteService();
  const historyService = new HistoryService();

  // ---- Favorites -----------------------------------------------------

  fastify.get<{ Reply: FavoriteListReply }>('/favorites', async (_request, reply) => {
    reply.code(200).send({ data: favoriteService.getAll() });
  });

  fastify.post<{ Body: FavoriteWriteBody; Reply: FavoriteDetailReply | ApiError }>(
    '/favorites',
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid request body'));
      }

      const { replace, ...rest } = body;
      const validation = validateFavoriteInput(rest as Record<string, unknown>);
      if (!validation.valid) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Favorite validation failed', validation.errors));
      }

      try {
        const favorite = favoriteService.create(
          rest as unknown as Parameters<FavoriteService['create']>[0],
          { replace: replace === true },
        );
        reply.code(201).send({ data: favorite });
      } catch (err) {
        handleFavoriteError(err, reply);
      }
    },
  );

  // Static route registered before the `:id` param route it could otherwise
  // be shadowed by (Fastify's router handles this correctly regardless of
  // order, but this keeps the file's route list readable top-to-bottom).
  fastify.put<{ Body: { ids?: unknown }; Reply: FavoriteListReply | ApiError }>(
    '/favorites/reorder',
    async (request, reply) => {
      const ids = request.body?.ids;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', '"ids" must be an array of strings'));
      }
      const favorites = favoriteService.reorder(ids);
      reply.code(200).send({ data: favorites });
    },
  );

  fastify.put<{ Params: FavoriteRouteParams; Body: FavoriteWriteBody; Reply: FavoriteDetailReply | ApiError }>(
    '/favorites/:id',
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply.code(400).send(createErrorResponse('VALIDATION_ERROR', 'Invalid request body'));
      }

      const { replace, id: _ignoredId, ...rest } = body as FavoriteWriteBody & { id?: unknown };

      const existing = favoriteService.getById(id);
      if (!existing) {
        return reply.code(404).send(createErrorResponse('NOT_FOUND', `Favorite ${id} not found`));
      }

      // Validate the FULL resulting object (existing + patch) so a partial
      // update can't sneak in an invalid combination, mirroring the
      // full-object validation profiles/routes.ts performs on create.
      const merged = { ...existing, ...rest };
      const validation = validateFavoriteInput(merged as unknown as Record<string, unknown>);
      if (!validation.valid) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Favorite validation failed', validation.errors));
      }

      try {
        const favorite = favoriteService.update(id, rest as Parameters<FavoriteService['update']>[1], {
          replace: replace === true,
        });
        reply.code(200).send({ data: favorite });
      } catch (err) {
        handleFavoriteError(err, reply);
      }
    },
  );

  // `Reply` includes `undefined` because the success path is a bodiless 204.
  // fastify 5 types `reply.send(payload)` with a REQUIRED argument (v4 allowed
  // the zero-arg form), so a 204 is written as `.send(undefined)` -- same wire
  // behaviour, now expressed in the type.
  fastify.delete<{ Params: FavoriteRouteParams; Reply: ApiError | undefined }>(
    '/favorites/:id',
    async (request, reply) => {
      const { id } = request.params;
      try {
        favoriteService.delete(id);
        reply.code(204).send(undefined);
      } catch (err) {
        handleFavoriteError(err, reply);
      }
    },
  );

  // ---- History ----------------------------------------------------------

  fastify.get<{ Reply: HistoryListReply }>('/history', async (_request, reply) => {
    reply.code(200).send({ data: historyService.getAll() });
  });

  fastify.post<{
    Body: { query?: unknown; destination?: unknown };
    Reply: HistoryDetailReply | ApiError;
  }>('/history', async (request, reply) => {
    const body = request.body ?? {};
    const query = typeof body.query === 'string' ? body.query : null;
    const destination = (body.destination ?? null) as HistoryEntry['destination'];

    if (query === null && destination === null) {
      return reply
        .code(400)
        .send(createErrorResponse('VALIDATION_ERROR', 'Either "query" or "destination" is required'));
    }

    try {
      // Never accepts a client-supplied `ts` -- always server time (matches
      // profiles ignoring `is_active` on write).
      const entry = historyService.add({ query, destination });
      reply.code(201).send({ data: entry });
    } catch (err) {
      const error = err as HistoryError;
      reply.code(400).send(createErrorResponse(error.code ?? 'WRITE_ERROR', error.message));
    }
  });

  // Bodiless 204 on success -- see the note on `DELETE /favorites/:id` above.
  fastify.delete<{ Params: FavoriteRouteParams; Reply: ApiError | undefined }>(
    '/history/:id',
    async (request, reply) => {
      const { id } = request.params;
      try {
        historyService.deleteOne(id);
        reply.code(204).send(undefined);
      } catch (err) {
        const error = err as HistoryError;
        if (error.code === 'NOT_FOUND') {
          return reply.code(404).send(createErrorResponse(error.code, error.message));
        }
        reply.code(400).send(createErrorResponse('DELETE_ERROR', error.message));
      }
    },
  );

  fastify.delete('/history', async (_request, reply) => {
    historyService.clear();
    reply.code(204).send(undefined);
  });
};
