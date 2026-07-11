/**
 * Fastify routes for the RoutingService (E03-T2).
 * Prefix: /api/v1 (see docs/03-api-spec.md).
 *
 *  - POST /routes      body `RouteRequest` -> `{ data: Route[] }`
 *  - GET  /routes/:id  -> `{ data: Route }` | 404
 *
 * The Valhalla transport is injectable (`fetchImpl` / `client`) so tests can
 * intercept the outgoing request and drive every error path without a live
 * Valhalla backend.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { ApiError, RouteRequest } from '@yapaja/shared';
import { validateRouteRequest } from '@yapaja/shared';
import { isRoutingError } from './errors.js';
import {
  RoutingService,
  type PositionLookup,
  type ProfileLookup,
} from './service.js';
import type { RouteCacheOptions } from './cache.js';
import {
  ValhallaClient,
  type FetchLike,
  type RoutingLogger,
  type ValhallaClientLike,
} from './valhallaClient.js';

export interface RoutingRoutesOptions {
  positionService: PositionLookup;
  profileService: ProfileLookup;
  /** Base Valhalla URL; falls back to the client default (env-driven at call site). */
  valhallaUrl?: string;
  /** Test seam: pre-built client wins over `fetchImpl`/`valhallaUrl`. */
  client?: ValhallaClientLike;
  /** Test seam: injectable HTTP transport for the built-in ValhallaClient. */
  fetchImpl?: FetchLike;
  logger?: RoutingLogger;
  cache?: RouteCacheOptions;
}

function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

export const routingPlugin: FastifyPluginAsync<RoutingRoutesOptions> = async (fastify, opts) => {
  const logger: RoutingLogger = opts.logger ?? {
    info: (msg, meta) => fastify.log.info(meta ?? {}, msg),
    warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg),
    error: (msg, meta) => fastify.log.error(meta ?? {}, msg),
  };

  const client: ValhallaClientLike =
    opts.client ??
    new ValhallaClient({
      baseUrl: opts.valhallaUrl,
      fetchImpl: opts.fetchImpl,
      logger,
    });

  const service = new RoutingService({
    client,
    profileService: opts.profileService,
    positionService: opts.positionService,
    logger,
    cache: opts.cache,
  });

  // POST /routes
  fastify.post<{ Body: unknown; Reply: { data: unknown } | ApiError }>(
    '/routes',
    async (request, reply) => {
      const body = request.body;
      if (!validateRouteRequest(body)) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Invalid RouteRequest body'));
      }

      // `validateRouteRequest` is a type guard for RouteRequest.
      const routeRequest: RouteRequest = body;

      try {
        const routes = await service.createRoutes(routeRequest);
        return reply.code(200).send({ data: routes });
      } catch (err) {
        if (isRoutingError(err)) {
          return reply.code(err.httpStatus).send(errorResponse(err.code, err.message));
        }
        logger.error('Unexpected error computing routes', {
          reason: err instanceof Error ? err.message : String(err),
        });
        return reply
          .code(500)
          .send(errorResponse('INTERNAL_ERROR', 'Unexpected error computing routes'));
      }
    },
  );

  // GET /routes/:id
  fastify.get<{ Params: { id: string }; Reply: { data: unknown } | ApiError }>(
    '/routes/:id',
    async (request, reply) => {
      const route = service.getCachedRoute(request.params.id);
      if (!route) {
        return reply
          .code(404)
          .send(errorResponse('ROUTE_NOT_FOUND', `Route ${request.params.id} not found or expired`));
      }
      return reply.code(200).send({ data: route });
    },
  );
};
