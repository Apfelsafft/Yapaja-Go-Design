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

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ApiError, RouteRequest } from '@yapaja/shared';
import { validateRouteRequest } from '@yapaja/shared';
import { isRoutingError, type RoutingError } from './errors.js';
import { type InstalledRegionsProvider } from './coverageCheck.js';
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
import { listRegions } from '../map/regions.js';
import { loadCatalog } from '../map/regions/catalog.js';
import { resolveTilesDir } from '../map/paths.js';

export interface RoutingRoutesOptions {
  positionService: PositionLookup;
  profileService: ProfileLookup;
  /** Base Valhalla URL; falls back to the client default (env-driven at call site). */
  valhallaUrl?: string;
  /** Test seam: pre-built client wins over `fetchImpl`/`valhallaUrl`. */
  client?: ValhallaClientLike;
  /** Test seam: injectable HTTP transport for the built-in ValhallaClient. */
  fetchImpl?: FetchLike;
  /** Test seam: injectable regions provider (E03-T6). */
  regionsProvider?: InstalledRegionsProvider;
  /**
   * Pre-built service seam (E04-T1): when provided it is used as-is, so the
   * same `RoutingService` instance (and its route cache) can be shared with
   * the navigation plugin. Falls back to building one from the options above.
   */
  service?: RoutingService;
  logger?: RoutingLogger;
  cache?: RouteCacheOptions;
}

/**
 * Construct a `RoutingService` from plugin options, wiring the Valhalla client
 * and the installed-regions provider. Exported so `buildServer` can build ONE
 * instance and share it between the routing and navigation plugins (E04-T1),
 * rather than each plugin owning a private service + route cache.
 */
export function buildRoutingService(
  fastify: FastifyInstance,
  opts: RoutingRoutesOptions,
): RoutingService {
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

  const regionsProvider: InstalledRegionsProvider =
    opts.regionsProvider ?? {
      async getInstalledRegions() {
        const tilesDir = resolveTilesDir();
        const regions = await listRegions(tilesDir, fastify.log);
        return regions.map((r) => ({
          id: r.region,
          name: r.region,
          bounds: r.bounds,
        }));
      },
      async getCatalogRegions() {
        const catalog = await loadCatalog();
        return catalog.map((c) => ({
          id: c.id,
          name: c.name,
          bounds: c.bounds,
        }));
      },
    };

  return new RoutingService({
    client,
    profileService: opts.profileService,
    positionService: opts.positionService,
    regionsProvider,
    logger,
    cache: opts.cache,
  });
}

function errorResponse(
  code: string,
  message: string,
  extras?: { missing_region_hint?: string; details?: Record<string, unknown> },
): ApiError {
  return {
    error: {
      code,
      message,
      ...(extras?.missing_region_hint ? { missing_region_hint: extras.missing_region_hint } : {}),
      ...(extras?.details ? { details: extras.details } : {}),
    },
  };
}

export const routingPlugin: FastifyPluginAsync<RoutingRoutesOptions> = async (fastify, opts) => {
  const logger: RoutingLogger = opts.logger ?? {
    info: (msg, meta) => fastify.log.info(meta ?? {}, msg),
    warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg),
    error: (msg, meta) => fastify.log.error(meta ?? {}, msg),
  };

  const service = opts.service ?? buildRoutingService(fastify, { ...opts, logger });

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
          const typedErr = err as RoutingError & {
            missing_region_hint?: string;
            details?: Record<string, unknown>;
          };
          return reply.code(err.httpStatus).send(
            errorResponse(err.code, err.message, {
              missing_region_hint: typedErr.missing_region_hint,
              details: typedErr.details,
            }),
          );
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
