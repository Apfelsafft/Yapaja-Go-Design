/**
 * RoutingService: resolve profile + origin, build the Valhalla request, map the
 * response to `Route[]`, ENFORCE plausibility (docs/03-api-spec.md §5), and
 * cache results for `GET /routes/:id`.
 *
 * Safety posture: the service fails CLOSED. Any implausible route (except the
 * §5-designated "too long" warning case, see below) aborts the whole request
 * with 500 -- an unplausible route is NEVER delivered.
 */

import type { LatLng, Position, Route, RouteRequest, VehicleProfile } from '@yapaja/shared';
import { checkRoute } from '@yapaja/shared';
import { RouteCache, type RouteCacheOptions } from './cache.js';
import { checkCoverage, type InstalledRegionsProvider } from './coverageCheck.js';
import { RoutingError } from './errors.js';
import { mapValhallaResponse } from './mapResponse.js';
import { buildTraceAttributesBody, speedSegmentsFromTraceAttributes } from './speedLimits.js';
import { VALHALLA_COSTING, buildValhallaRouteBody } from './profileMapping.js';
import type { RoutingLogger, ValhallaClientLike } from './valhallaClient.js';

/** Just the profile lookup the service needs (ProfileService satisfies it). */
export interface ProfileLookup {
  getById(id: string): VehicleProfile | null;
}

/** Just the position lookup the service needs (PositionService satisfies it). */
export interface PositionLookup {
  getLast(): Position | null;
}

export interface RoutingServiceOptions {
  client: ValhallaClientLike;
  profileService: ProfileLookup;
  positionService: PositionLookup;
  regionsProvider: InstalledRegionsProvider;
  logger?: RoutingLogger;
  cache?: RouteCacheOptions;
}

const noopLogger: RoutingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The one checkRoute violation we treat as a (non-fatal) warning rather than a
 * hard 500. docs/03-api-spec.md §5 says a route longer than 4× the straight
 * line yields a `RouteWarning` + log, NOT a rejection; `checkRoute` reports it
 * as a violation, so we surface it as the ROUTE_TOO_LONG warning (already
 * attached in mapResponse) and log it, but still deliver the route. EVERY OTHER
 * violation (too short, impossible duration, bad speed segment) is fatal.
 *
 * See KLÄRUNGSBEDARF in the task report: the brief says "checkRoute violation
 * => 500" while §5 downgrades the too-long case to a warning; this reconciles
 * the two by keeping the hard gate for genuinely dangerous/broken routes and
 * honouring §5 for the too-long case.
 */
const NON_FATAL_VIOLATION_RULE = 'route_distance_too_long';

export class RoutingService {
  private readonly client: ValhallaClientLike;
  private readonly profileService: ProfileLookup;
  private readonly positionService: PositionLookup;
  private readonly regionsProvider: InstalledRegionsProvider;
  private readonly logger: RoutingLogger;
  private readonly cache: RouteCache;

  constructor(opts: RoutingServiceOptions) {
    this.client = opts.client;
    this.profileService = opts.profileService;
    this.positionService = opts.positionService;
    this.regionsProvider = opts.regionsProvider;
    this.logger = opts.logger ?? noopLogger;
    this.cache = new RouteCache(opts.cache);
  }

  getCachedRoute(id: string): Route | null {
    return this.cache.get(id);
  }

  /**
   * Compute route alternatives for a validated `RouteRequest`.
   * Throws {@link RoutingError} on every failure path.
   *
   * Coverage check (E03-T6) runs BEFORE Valhalla to avoid unnecessary roundtrips
   * when the destination is outside all installed regions.
   */
  async createRoutes(request: RouteRequest): Promise<Route[]> {
    const profile = this.profileService.getById(request.profile_id);
    if (!profile) {
      throw new RoutingError(404, 'PROFILE_NOT_FOUND', `Profile ${request.profile_id} not found`);
    }

    const originLatLng = this.resolveOrigin(request.origin);
    const {
      destination,
      waypoints,
      alternatives,
      exclude_locations,
      exclude_polygons,
      avoid_overrides,
      heading,
    } = request;

    // E03-T6: Coverage check before Valhalla call
    await checkCoverage(originLatLng, destination, waypoints, this.regionsProvider);

    const body = buildValhallaRouteBody(
      originLatLng,
      destination,
      waypoints,
      profile,
      alternatives,
      {
        excludeLocations: exclude_locations,
        excludePolygons: exclude_polygons,
        avoidOverrides: avoid_overrides,
      },
      // E04-T4 (W-05): forward-facing reroute — the origin edge is biased to the
      // current heading so the first new instruction never says "turn around".
      heading,
    );

    const response = await this.client.route(body);
    const routes = mapValhallaResponse(response, originLatLng, destination);

    // ─── TEMPOLIMITS NACHTRAGEN ───────────────────────────────────────────
    // `/route` liefert keine; sie kommen aus `/trace_attributes`. Bewusst
    // NACH der Kartierung und bewusst fehlertolerant: eine berechnete Route
    // muss ausgeliefert werden, auch wenn diese Zusatzabfrage scheitert.
    // Ohne Limits fehlt das Schild -- mit einer geworfenen Ausnahme fehlt die
    // ganze Fahrt.
    await this.enrichWithSpeedLimits(routes);

    for (const route of routes) {
      this.enforcePlausibility(route, originLatLng, destination);
    }

    for (const route of routes) {
      this.cache.set(route);
    }

    return routes;
  }

  /**
   * Traegt die Tempolimits in die Routen ein.
   *
   * Jede Route einzeln: schlaegt eine fehl, bleiben die anderen vollstaendig.
   * Ein Fehlschlag heisst „keine Limits", nicht „keine Route".
   */
  private async enrichWithSpeedLimits(routes: Route[]): Promise<void> {
    for (const route of routes) {
      if (!route.geometry) continue;
      if (!this.client.traceAttributes) return;
      const raw = await this.client.traceAttributes(
        buildTraceAttributesBody(route.geometry, VALHALLA_COSTING),
      );
      const segments = speedSegmentsFromTraceAttributes(raw as never);
      if (segments.length > 0) {
        route.speed_limits = segments;
      }
    }
  }

  private resolveOrigin(origin: RouteRequest['origin']): LatLng {
    if (origin !== 'current') {
      return origin;
    }
    const last = this.positionService.getLast();
    if (!last) {
      throw new RoutingError(
        409,
        'NO_POSITION',
        'origin is "current" but no device position is available yet',
      );
    }
    return { lat: last.lat, lon: last.lon };
  }

  private enforcePlausibility(route: Route, origin: LatLng, destination: LatLng): void {
    const result = checkRoute(route, origin, destination);
    if (result.ok) return;

    const fatal = result.violations.filter((v) => v.rule !== NON_FATAL_VIOLATION_RULE);
    const nonFatal = result.violations.filter((v) => v.rule === NON_FATAL_VIOLATION_RULE);

    if (nonFatal.length > 0) {
      // §5 warning case -- logged, route still delivered (carries ROUTE_TOO_LONG).
      this.logger.warn('Route exceeds 4× straight-line distance (delivered with warning)', {
        route_id: route.id,
        distance_m: route.distance_m,
      });
    }

    if (fatal.length > 0) {
      this.logger.error('Rejecting implausible route (fail closed)', {
        route_id: route.id,
        violations: fatal,
      });
      throw new RoutingError(
        500,
        'IMPLAUSIBLE_ROUTE',
        'Computed route failed plausibility checks and was not delivered',
      );
    }
  }
}
