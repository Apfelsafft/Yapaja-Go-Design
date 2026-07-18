/**
 * Shared "resolve a destination (latlng or geocoded query), compute a route to
 * it with the active/given profile, optionally start navigating right away"
 * pipeline (E04-T5).
 *
 * Factored out of `POST /navigation/destination`'s route handler so E08-T1's
 * `yapaja/cmd/destination` / `yapaja/cmd/favorite` MQTT commands reuse the
 * EXACT SAME sequence of service calls (SearchService -> RoutingService ->
 * NavigationService) instead of re-implementing it -- "call the same
 * services, don't duplicate business logic" (docs/03 §4, E08-T1 task brief).
 * `navigation/routes.ts`'s handler is now a thin wrapper around this function
 * (request-body parsing + HTTP status mapping only); this module owns zero
 * HTTP concerns.
 *
 * All failure paths throw a typed error carrying `httpStatus`/`code`/
 * `message` -- `NavigationError` (from `start()`), `RoutingError` (from
 * `createRoutes()`), or the new {@link DestinationError} for everything else
 * (validation / geocoding / missing collaborator). REST maps `.httpStatus`
 * straight to a reply; the MQTT bridge just reads `.code`/`.message` for
 * `cmd/result`'s `error` field.
 */

import type { LatLng, Route, NavState, RouteRequest, SearchResult } from '@yapaja/shared';
import { validateLatLng } from '@yapaja/shared';
import { isRoutingError } from '../routing/errors.js';
import { isNavigationError } from './errors.js';
import type {
  ActiveProfileLookup,
  NavigationService,
  NavigationServiceLogger,
  RerouteProvider,
} from './service.js';

/** Just the geocode lookup the destination pipeline needs (E04-T5); the
 *  shared `SearchService` satisfies it. */
export interface DestinationSearchProvider {
  search(query: { q: string; limit: number; lat?: number; lon?: number }): Promise<SearchResult[]>;
}

/** Typed error for every failure in this pipeline that isn't already a
 *  `NavigationError`/`RoutingError` (validation, geocoding, missing
 *  collaborators). Same `httpStatus`/`code`/`message` shape as those two. */
export class DestinationError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = 'DestinationError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function isDestinationError(err: unknown): err is DestinationError {
  return err instanceof DestinationError;
}

export interface ResolveDestinationInput {
  /** An explicit coordinate; wins over `query` when both are given. */
  latlng?: LatLng;
  /** Geocoded via `searchProvider` (top hit only) when `latlng` is absent. */
  query?: string;
  /** Overrides the active profile for this request. */
  profileId?: string;
  /** Start navigating immediately once a route is computed. */
  autostart?: boolean;
}

export interface DestinationResolverDeps {
  navigationService: NavigationService;
  rerouteProvider?: RerouteProvider;
  profileProvider?: ActiveProfileLookup;
  searchProvider?: DestinationSearchProvider;
  logger: NavigationServiceLogger;
}

export interface ResolveDestinationResult {
  route: Route;
  navState: NavState;
}

export async function resolveDestinationAndRoute(
  deps: DestinationResolverDeps,
  input: ResolveDestinationInput,
): Promise<ResolveDestinationResult> {
  const { navigationService, rerouteProvider, profileProvider, searchProvider, logger } = deps;

  if (input.latlng === undefined && !input.query) {
    throw new DestinationError(400, 'VALIDATION_ERROR', 'Must include "latlng" or "query"');
  }
  if (input.latlng !== undefined && !validateLatLng(input.latlng)) {
    throw new DestinationError(400, 'VALIDATION_ERROR', 'Invalid "latlng"');
  }

  // 1. Resolve the destination: an explicit `latlng` wins; otherwise geocode
  // `query` via the shared SearchService and take the top hit.
  let destLatLng: LatLng;
  let destName: string | null = null;
  if (input.latlng !== undefined) {
    destLatLng = input.latlng;
  } else {
    if (!searchProvider) {
      throw new DestinationError(
        501,
        'SEARCH_NOT_CONFIGURED',
        'Geocoding by "query" is not available on this server',
      );
    }
    let results: SearchResult[];
    try {
      results = await searchProvider.search({ q: input.query as string, limit: 1 });
    } catch (err) {
      logger.error('destination geocode failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new DestinationError(502, 'GEOCODE_FAILED', 'Geocoding service failed unexpectedly');
    }
    const top = results[0];
    if (!top) {
      throw new DestinationError(404, 'NO_GEOCODE_RESULT', `No location found for "${input.query}"`);
    }
    destLatLng = top.latlng;
    destName = top.name;
  }

  // 2. Resolve the profile: explicit `profileId` wins, else the active one.
  const profileId = input.profileId ?? profileProvider?.getActive()?.id ?? null;
  if (!profileId) {
    throw new DestinationError(409, 'NO_ACTIVE_PROFILE', 'No active vehicle profile and none given');
  }

  // 3. Compute a route to it.
  if (!rerouteProvider) {
    throw new DestinationError(501, 'ROUTING_NOT_CONFIGURED', 'Routing is not available on this server');
  }
  const routeRequest: RouteRequest = {
    origin: 'current',
    destination: destLatLng,
    waypoints: [],
    profile_id: profileId,
    alternatives: 0,
  };
  let routes: Route[];
  try {
    routes = await rerouteProvider.createRoutes(routeRequest);
  } catch (err) {
    if (isRoutingError(err)) throw err;
    logger.error('destination routing failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    throw new DestinationError(500, 'INTERNAL_ERROR', 'Unexpected routing error');
  }
  const route = routes[0];
  if (!route) {
    throw new DestinationError(404, 'NO_ROUTE', 'No route found to destination');
  }

  // 4. Optionally start navigating right away.
  let navState = navigationService.getState();
  if (input.autostart) {
    try {
      navState = navigationService.start({
        route,
        destination: { latlng: destLatLng, name: destName },
        reroute: { profile_id: profileId },
      });
    } catch (err) {
      if (isNavigationError(err)) throw err;
      logger.error('destination autostart failed', {
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new DestinationError(500, 'INTERNAL_ERROR', 'Unexpected navigation error');
    }
  }

  return { route, navState };
}
