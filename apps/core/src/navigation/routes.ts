/**
 * Fastify routes for the NavigationService (E04-T1).
 * Prefix: /api/v1 (docs/03 §2 "Routing & Navigation").
 *
 *  - POST /navigation/start   body `{ route_id }` | `{ route, destination? }`
 *  - POST /navigation/pause  | resume | stop
 *  - GET  /navigation/state
 *
 * Invalid state-machine transitions surface as HTTP 409 (NavigationError).
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ApiError, LatLng } from '@yapaja/shared';
import { validateLatLng, validateRoute } from '@yapaja/shared';
import { isNavigationError } from './errors.js';
import {
  NavigationService,
  type ActiveProfileLookup,
  type NavDestination,
  type RerouteProvider,
  type RouteProvider,
  type StartInput,
} from './service.js';
import type { EventBus } from '../bus/index.js';
import type { NavRecoveryStore } from './recoveryStore.js';
import type { NavigationServiceLogger } from './service.js';

export interface NavigationRoutesOptions {
  bus: EventBus;
  routeProvider: RouteProvider;
  recoveryStore?: NavRecoveryStore;
  /** ETA avg-speed floor input (E04-T2), see `NavigationService`. */
  profileProvider?: ActiveProfileLookup;
  /** Reroute entry point (E04-T4); the shared RoutingService satisfies it. */
  rerouteProvider?: RerouteProvider;
  /** Test seam: inject a pre-built service (wins over the options above). */
  service?: NavigationService;
  logger?: NavigationServiceLogger;
}

function errorResponse(code: string, message: string): ApiError {
  return { error: { code, message } };
}

function parseDestination(value: unknown): NavDestination | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const obj = value as { latlng?: unknown; name?: unknown };
  if (!validateLatLng(obj.latlng)) return undefined;
  const name = obj.name === undefined || obj.name === null ? null : String(obj.name);
  return { latlng: obj.latlng as LatLng, name };
}

export const navigationPlugin: FastifyPluginAsync<NavigationRoutesOptions> = async (
  fastify,
  opts,
) => {
  const logger: NavigationServiceLogger = opts.logger ?? {
    info: (msg, meta) => fastify.log.info(meta ?? {}, msg),
    warn: (msg, meta) => fastify.log.warn(meta ?? {}, msg),
    error: (msg, meta) => fastify.log.error(meta ?? {}, msg),
  };

  const service =
    opts.service ??
    new NavigationService({
      bus: opts.bus,
      routeProvider: opts.routeProvider,
      recoveryStore: opts.recoveryStore,
      profileProvider: opts.profileProvider,
      rerouteProvider: opts.rerouteProvider,
      logger,
    });

  fastify.addHook('onClose', async () => {
    // Only dispose a service we own (an injected one is the caller's to manage).
    if (!opts.service) service.dispose();
  });

  // POST /navigation/start
  fastify.post<{ Body: unknown; Reply: { data: unknown } | ApiError }>(
    '/navigation/start',
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      const start: StartInput = {};
      if (typeof body.route_id === 'string') start.route_id = body.route_id;
      if (body.route !== undefined) {
        if (!validateRoute(body.route)) {
          return reply
            .code(400)
            .send(errorResponse('VALIDATION_ERROR', 'Invalid "route" in request body'));
        }
        start.route = body.route;
      }
      if (start.route_id === undefined && start.route === undefined) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Body must include "route_id" or "route"'));
      }

      const destination = parseDestination(body.destination);
      if (destination === undefined && body.destination !== undefined) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Invalid "destination" in request body'));
      }
      if (destination !== undefined) start.destination = destination;

      try {
        const state = service.start(start);
        return reply.code(200).send({ data: state });
      } catch (err) {
        return sendNavError(reply, err, logger);
      }
    },
  );

  const control =
    (run: () => unknown) =>
    async (_request: unknown, reply: FastifyReply): Promise<FastifyReply> => {
      try {
        return reply.code(200).send({ data: run() });
      } catch (err) {
        return sendNavError(reply, err, logger);
      }
    };

  fastify.post('/navigation/pause', control(() => service.pause()));
  fastify.post('/navigation/resume', control(() => service.resume()));
  fastify.post('/navigation/stop', control(() => service.stop()));

  // GET /navigation/state
  fastify.get('/navigation/state', async (_request, reply) => {
    return reply.code(200).send({ data: service.getState() });
  });
};

// --- helpers ---------------------------------------------------------------

function sendNavError(
  reply: FastifyReply,
  err: unknown,
  logger: NavigationServiceLogger,
): FastifyReply {
  if (isNavigationError(err)) {
    return reply.code(err.httpStatus).send(errorResponse(err.code, err.message));
  }
  logger.error('Unexpected navigation error', {
    reason: err instanceof Error ? err.message : String(err),
  });
  return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Unexpected navigation error'));
}
