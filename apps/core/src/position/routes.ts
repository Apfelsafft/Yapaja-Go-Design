/**
 * Fastify routes for position status & source control.
 * Prefix: /api/v1/position (see docs/03-api-spec.md §2 "Position")
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError, Position } from '@yapaja/shared';
import { validatePosition } from '@yapaja/shared';
import { POSITION_SOURCE_NAMES, type PositionService, type PositionSourceName } from './service.js';

export interface PositionRoutesOptions {
  service: PositionService;
}

interface SourcesReply {
  sources: ReturnType<PositionService['getSources']>;
  active: PositionSourceName | null;
  forced: PositionSourceName | null;
}

type SourceSelection = PositionSourceName | 'auto';
const SOURCE_SELECTIONS: readonly string[] = [...POSITION_SOURCE_NAMES, 'auto'];

function isSourceSelection(value: unknown): value is SourceSelection {
  return typeof value === 'string' && SOURCE_SELECTIONS.includes(value);
}

// Body for POST /position/browser: the client reports everything except
// `source`, which the endpoint fixes to 'browser' itself.
type BrowserFixBody = Omit<Position, 'source'>;

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

export const positionPlugin: FastifyPluginAsync<PositionRoutesOptions> = async (fastify, opts) => {
  const { service } = opts;

  // GET /position - last known position, or 204 if none yet
  fastify.get('/position', async (_request, reply) => {
    const last = service.getLast();
    if (!last) {
      reply.code(204).send();
      return;
    }
    reply.code(200).send(last);
  });

  // GET /position/sources - available sources + status + active/forced source
  fastify.get<{ Reply: SourcesReply }>('/position/sources', async (_request, reply) => {
    reply.code(200).send({
      sources: service.getSources(),
      active: service.getActiveSource(),
      forced: service.getForcedSource(),
    });
  });

  // PUT /position/source - force (or release, via 'auto') a source
  fastify.put<{
    Body: { source?: unknown };
    Reply: { forced: PositionSourceName | null; active: PositionSourceName | null } | ApiError;
  }>('/position/source', async (request, reply) => {
    const body = request.body ?? {};
    const { source } = body;

    if (!isSourceSelection(source)) {
      return reply
        .code(400)
        .send(
          createErrorResponse(
            'VALIDATION_ERROR',
            `source must be one of ${SOURCE_SELECTIONS.join(', ')}`,
          ),
        );
    }

    service.setForcedSource(source === 'auto' ? null : source);
    reply.code(200).send({ forced: service.getForcedSource(), active: service.getActiveSource() });
  });

  // POST /position/browser - browser reports a geolocation fix
  fastify.post<{ Body: BrowserFixBody; Reply: { data: Position } | ApiError }>(
    '/position/browser',
    async (request, reply) => {
      if (!service.isSourceSelectable('browser')) {
        return reply
          .code(409)
          .send(
            createErrorResponse(
              'SOURCE_NOT_SELECTABLE',
              'Position source is forced to a source other than browser',
            ),
          );
      }

      const body = request.body;
      if (!body || typeof body !== 'object') {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Invalid request body'));
      }

      const candidate: Position = { ...body, source: 'browser' };
      if (!validatePosition(candidate)) {
        return reply
          .code(400)
          .send(createErrorResponse('VALIDATION_ERROR', 'Invalid position payload'));
      }

      service.pushFix('browser', candidate);
      reply.code(200).send({ data: candidate });
    },
  );
};
