/**
 * Fastify routes for the NavigationService (E04-T1).
 * Prefix: /api/v1 (docs/03 §2 "Routing & Navigation").
 *
 *  - POST /navigation/start   body `{ route_id }` | `{ route, destination?, reroute? }`
 *  - POST /navigation/pause  | resume | stop
 *  - GET  /navigation/state
 *  - POST /navigation/destination (E04-T5)  body `{ latlng | query, profile_id?, autostart? }`
 *
 * Invalid state-machine transitions surface as HTTP 409 (NavigationError).
 */

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ApiError, LatLng, RouteAvoidOverrides } from '@yapaja/shared';
import { validateLatLng, validateRoute } from '@yapaja/shared';
import { isNavigationError } from './errors.js';
import { isRoutingError } from '../routing/errors.js';
import {
  NavigationService,
  type ActiveProfileLookup,
  type ClientPresence,
  type NavDestination,
  type RerouteContext,
  type RerouteProvider,
  type RouteProvider,
  type StartInput,
} from './service.js';
import type { EventBus } from '../bus/index.js';
import type { NavRecoveryStore } from './recoveryStore.js';
import type { NavigationServiceLogger } from './service.js';
import {
  resolveDestinationAndRoute,
  isDestinationError,
  type DestinationSearchProvider,
} from './destinationResolver.js';

export type { DestinationSearchProvider } from './destinationResolver.js';

export interface NavigationRoutesOptions {
  bus: EventBus;
  routeProvider: RouteProvider;
  recoveryStore?: NavRecoveryStore;
  /** ETA avg-speed floor input (E04-T2), see `NavigationService`. Also the
   *  fallback active-profile lookup for `POST /navigation/destination`
   *  (E04-T5) when the request body omits `profile_id`. */
  profileProvider?: ActiveProfileLookup;
  /** Reroute entry point (E04-T4); the shared RoutingService satisfies it.
   *  E04-T5's `POST /navigation/destination` reuses this SAME seam
   *  (`createRoutes`) to compute the initial route to a `latlng`/`query` --
   *  it's the identical operation a reroute performs, just triggered by the
   *  convenience endpoint instead of a confirmed deviation. */
  rerouteProvider?: RerouteProvider;
  /** Geocoder for `POST /navigation/destination`'s `query` field (E04-T5). */
  searchProvider?: DestinationSearchProvider;
  /** E06-T3: "is a UI client connected?" signal, see `NavigationService`. */
  clientPresence?: ClientPresence;
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

function isLatLngArray(value: unknown): value is LatLng[] {
  return Array.isArray(value) && value.every((v) => validateLatLng(v));
}

function isPolygonArray(value: unknown): value is LatLng[][] {
  return Array.isArray(value) && value.every((ring) => isLatLngArray(ring));
}

function isAvoidOverrides(value: unknown): value is RouteAvoidOverrides {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (['motorway', 'toll', 'ferry', 'unpaved'] as const).every(
    (key) => obj[key] === undefined || typeof obj[key] === 'boolean',
  );
}

/**
 * Parses the optional `reroute` field of `POST /navigation/start` (E04-T5)
 * into a `RerouteContext` -- the waypoints + E03-T4 avoidances the frontend's
 * routing store already tracked for the route being started, so an
 * auto-reroute (E04-T4) reproduces them instead of silently dropping them.
 * `undefined` -> absent (no context, exactly pre-E04-T5 behaviour);
 * `undefined` is ALSO returned for a malformed value so the caller can 400 --
 * mirrors `parseDestination`'s two-undefined-meanings pattern (checked via
 * `body.reroute !== undefined` at the call site, same as `destination`).
 */
function parseReroute(value: unknown): RerouteContext | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;

  const ctx: RerouteContext = {};
  if (obj.waypoints !== undefined) {
    if (!isLatLngArray(obj.waypoints)) return undefined;
    ctx.waypoints = obj.waypoints;
  }
  if (obj.exclude_locations !== undefined) {
    if (!isLatLngArray(obj.exclude_locations)) return undefined;
    ctx.exclude_locations = obj.exclude_locations;
  }
  if (obj.exclude_polygons !== undefined) {
    if (!isPolygonArray(obj.exclude_polygons)) return undefined;
    ctx.exclude_polygons = obj.exclude_polygons;
  }
  if (obj.avoid_overrides !== undefined) {
    if (!isAvoidOverrides(obj.avoid_overrides)) return undefined;
    ctx.avoid_overrides = obj.avoid_overrides;
  }
  if (obj.profile_id !== undefined) {
    if (typeof obj.profile_id !== 'string') return undefined;
    ctx.profile_id = obj.profile_id;
  }
  return ctx;
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
      clientPresence: opts.clientPresence,
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

      // E04-T5: the frontend's routing store passes its waypoints/avoidances/
      // active profile through here so an auto-reroute (E04-T4) reproduces
      // them instead of silently dropping them.
      const reroute = parseReroute(body.reroute);
      if (reroute === undefined && body.reroute !== undefined) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Invalid "reroute" in request body'));
      }
      if (reroute !== undefined) start.reroute = reroute;

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

  // POST /navigation/profile_change/confirm (E06-T3): the user answered "Ja"
  // to the "Mit '‹name›' neu berechnen?" confirmation banner -- reroute with
  // the (already active) new profile. 409 NO_PENDING_PROFILE_CHANGE when
  // nothing is currently awaiting confirmation (stale click / already resolved).
  fastify.post(
    '/navigation/profile_change/confirm',
    control(() => service.confirmProfileChange()),
  );

  // GET /navigation/state
  //
  // W-19: additive `recovered_route` envelope field (NOT part of the
  // `NavState` contract itself -- that type is fixed by docs/03 §1/the
  // shared JSON schema) carrying the last active navigation's route
  // reference whenever one is recoverable (idle + still-cached route, see
  // `NavigationService#getRecoverableRoute`). This is the ONLY way the
  // frontend can ever learn about it: `event/nav_recovered_route_available`
  // fires once, synchronously, at Core construction time -- long before any
  // browser tab's reload could possibly have a WS subscription open to catch
  // it. "REST then WS" (docs/08 W-19) is exactly this: fetch the current
  // state (plus any pending recovery) on load, THEN let the WS take over.
  fastify.get('/navigation/state', async (_request, reply) => {
    const recovered = service.getRecoverableRoute();
    return reply
      .code(200)
      .send({ data: service.getState(), ...(recovered ? { recovered_route: recovered } : {}) });
  });

  // POST /navigation/destination (E04-T5): convenience for HA/add-ons (and
  // now the reload-recovery prompt) -- resolve a destination from `latlng` OR
  // a geocoded `query`, compute a route to it with the active (or given)
  // profile, and optionally start navigating immediately, all in one call
  // (`autostart: true` needs zero further UI interaction).
  fastify.post<{ Body: unknown; Reply: { data: unknown } | ApiError }>(
    '/navigation/destination',
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      const latlngRaw = body.latlng;
      if (latlngRaw !== undefined && !validateLatLng(latlngRaw)) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Invalid "latlng" in request body'));
      }
      const query = typeof body.query === 'string' ? body.query.trim() : undefined;
      if (body.query !== undefined && query === undefined) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', '"query" must be a string'));
      }
      if (latlngRaw === undefined && !query) {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', 'Body must include "latlng" or "query"'));
      }
      if (body.profile_id !== undefined && typeof body.profile_id !== 'string') {
        return reply
          .code(400)
          .send(errorResponse('VALIDATION_ERROR', '"profile_id" must be a string'));
      }

      // Delegates to the shared resolve-geocode-route-optionally-start
      // pipeline (E08-T1 factored this out so the MQTT `cmd/destination` /
      // `cmd/favorite` commands reuse the exact same service calls -- see
      // `destinationResolver.ts`'s doc comment).
      try {
        const { route, navState } = await resolveDestinationAndRoute(
          {
            navigationService: service,
            rerouteProvider: opts.rerouteProvider,
            profileProvider: opts.profileProvider,
            searchProvider: opts.searchProvider,
            logger,
          },
          {
            latlng: latlngRaw !== undefined ? (latlngRaw as LatLng) : undefined,
            query,
            profileId: typeof body.profile_id === 'string' ? body.profile_id : undefined,
            autostart: body.autostart === true,
          },
        );
        return reply.code(200).send({ data: { route, nav_state: navState } });
      } catch (err) {
        if (isDestinationError(err) || isRoutingError(err) || isNavigationError(err)) {
          return reply.code(err.httpStatus).send(errorResponse(err.code, err.message));
        }
        logger.error('Unexpected destination error', {
          reason: err instanceof Error ? err.message : String(err),
        });
        return reply.code(500).send(errorResponse('INTERNAL_ERROR', 'Unexpected error'));
      }
    },
  );
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
