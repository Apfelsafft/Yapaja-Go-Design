/**
 * NavigationService (E04-T1, 🔴 safety-critical).
 *
 * Owns the navigation state machine (see `./stateMachine.ts`), consumes the
 * `pos/update` stream, map-matches each fix onto the active route (see
 * `./mapMatching.ts`) and publishes `nav/state` — plus `event/arrived` and,
 * on startup, `event/nav_recovered_route_available`.
 *
 * 1 Hz cadence: publishing is DRIVEN BY THE POSITION STREAM, not a second
 * timer. `PositionService` already throttles `pos/update` to ≤ 1 Hz, so one
 * `nav/state` is emitted per matched fix while navigating; every user action
 * (start/pause/resume/stop) and arrival also publishes immediately so the UI
 * never waits for the next fix. This keeps `nav/state` never staler than the
 * latest position and avoids a redundant clock.
 *
 * Monotonic progress: matched progress is clamped to be non-decreasing, so
 * `distance_remaining_m = total − progress` can only fall — it satisfies the
 * docs/03 §5 "monotonic within 15 m" invariant with zero slack even under
 * `noise_m` jitter. off_route is a sub-state of navigating: the cross-track /
 * heading rule flips navigating ⇄ off_route; the 5 s/5-fix reroute trigger is
 * E04-T4 and intentionally NOT implemented here.
 */

import type { LatLng, Maneuver, NavState, Position, Route } from '@yapaja/shared';
import { checkNavState } from '@yapaja/shared';
import type { EventBus } from '../bus/index.js';
import {
  buildRouteGeometry,
  evaluateOnRoute,
  matchPosition,
  SEARCH_WINDOW_M,
  type RouteGeometry,
} from './mapMatching.js';
import { haversineM } from './geo.js';
import { NavigationError } from './errors.js';
import { canTransition, nextState, type NavAction, type NavStatus } from './stateMachine.js';
import { InMemoryNavRecoveryStore, type NavRecoveryStore } from './recoveryStore.js';

/** Distance-to-destination threshold for arrival (metres). */
export const ARRIVAL_DISTANCE_M = 40;
/** Remaining-along-route threshold for arrival (metres). */
export const ARRIVAL_REMAINING_M = 60;

export interface NavDestination {
  latlng: LatLng;
  name: string | null;
}

/** Just the route lookup the service needs (RoutingService satisfies it). */
export interface RouteProvider {
  getCachedRoute(id: string): Route | null;
}

export interface NavigationServiceLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: NavigationServiceLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface NavigationServiceOptions {
  bus: EventBus;
  routeProvider: RouteProvider;
  recoveryStore?: NavRecoveryStore;
  logger?: NavigationServiceLogger;
  /** Override the ±window (metres) for tests; defaults to SEARCH_WINDOW_M. */
  searchWindowM?: number;
}

export interface StartInput {
  /** Reference to a route cached by the routing service. */
  route_id?: string;
  /** …or the full route object (E04-T5 destination convenience passes this). */
  route?: Route;
  /** Destination; when omitted it is derived from the route's last vertex. */
  destination?: NavDestination | null;
}

interface ManeuverAnchor {
  maneuver: Maneuver;
  progressM: number;
}

interface ActiveNavigation {
  route: Route;
  geom: RouteGeometry;
  maneuvers: ManeuverAnchor[];
  destination: NavDestination;
}

export class NavigationService {
  private readonly bus: EventBus;
  private readonly routeProvider: RouteProvider;
  private readonly recoveryStore: NavRecoveryStore;
  private readonly logger: NavigationServiceLogger;
  private readonly searchWindowM: number;

  private status: NavStatus = 'idle';
  private active: ActiveNavigation | null = null;
  private lastProgressM: number | null = null;
  private lastPosition: Position | null = null;
  private arrivedFired = false;
  private prevState: NavState | null = null;

  private readonly unsubscribe: () => void;

  constructor(opts: NavigationServiceOptions) {
    this.bus = opts.bus;
    this.routeProvider = opts.routeProvider;
    this.recoveryStore = opts.recoveryStore ?? new InMemoryNavRecoveryStore();
    this.logger = opts.logger ?? noopLogger;
    this.searchWindowM = opts.searchWindowM ?? SEARCH_WINDOW_M;

    this.unsubscribe = this.bus.subscribe('pos/update', (pos) => this.onPosition(pos));

    this.recoverOnStartup();
  }

  // --- Public control plane ------------------------------------------------

  /** Start navigating a route. Throws {@link NavigationError} (409/404/422) on failure. */
  start(input: StartInput): NavState {
    if (!canTransition(this.status, 'START')) {
      throw new NavigationError(
        409,
        'INVALID_TRANSITION',
        `Cannot start navigation from state "${this.status}" (stop first)`,
      );
    }

    const route = this.resolveRoute(input);
    const active = this.buildActive(route, input.destination ?? null);

    // idle/arrived -> routing -> navigating (route already computed).
    this.applyInternal('START');
    this.applyInternal('ROUTE_READY');

    this.active = active;
    this.lastProgressM = null;
    this.lastPosition = null;
    this.arrivedFired = false;

    this.recoveryStore.save({ route_id: route.id, destination: active.destination });
    this.logger.info('Navigation started', { route_id: route.id });

    return this.publishState();
  }

  pause(): NavState {
    this.requireTransition('PAUSE');
    return this.publishState();
  }

  resume(): NavState {
    this.requireTransition('RESUME');
    return this.publishState();
  }

  stop(): NavState {
    this.requireTransition('STOP');
    this.active = null;
    this.lastProgressM = null;
    this.lastPosition = null;
    this.arrivedFired = false;
    this.recoveryStore.clear();
    this.logger.info('Navigation stopped');
    return this.publishState();
  }

  /** Current navigation state (does not publish). */
  getState(): NavState {
    return this.buildState();
  }

  getStatus(): NavStatus {
    return this.status;
  }

  /** Unsubscribe from the bus. Call on shutdown/test teardown. */
  dispose(): void {
    this.unsubscribe();
  }

  // --- Position handling ---------------------------------------------------

  private onPosition(pos: Position): void {
    if (this.status !== 'navigating' && this.status !== 'off_route') return;
    if (!this.active) return;

    const point = { lat: pos.lat, lon: pos.lon };
    let match;
    try {
      match = matchPosition(this.active.geom, point, this.lastProgressM, this.searchWindowM);
    } catch (err) {
      // A geometry that can't be matched is a programming bug upstream; never
      // silently drop — log and skip this fix (state stays as last published).
      this.logger.error('Map-matching failed for fix', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Monotonic clamp: progress may never go backwards (distance_remaining can
    // therefore only fall). GPS noise that projects "behind" is absorbed here.
    const accepted =
      this.lastProgressM === null ? match.progressM : Math.max(match.progressM, this.lastProgressM);
    this.lastProgressM = accepted;
    this.lastPosition = pos;

    const onRoute = evaluateOnRoute({
      crossTrackM: match.crossTrackM,
      matchedHeadingDeg: match.matchedHeadingDeg,
      headingDeg: pos.heading,
      speedMs: pos.speed,
    });

    // off_route is a sub-state of navigating; flip it per the cross-track/
    // heading rule (the confirmed-deviation reroute trigger is E04-T4).
    if (this.status === 'navigating' && !onRoute) this.applyInternal('DEVIATE');
    else if (this.status === 'off_route' && onRoute) this.applyInternal('RETURN');

    if (this.checkArrival(pos, accepted)) return; // publishes its own state

    this.publishState();
  }

  /** Returns true (and fully handles publishing) when this fix triggers arrival. */
  private checkArrival(pos: Position, progressM: number): boolean {
    if (this.arrivedFired || !this.active) return false;

    const distToDest = haversineM(pos, this.active.destination.latlng);
    const remaining = Math.max(0, this.active.geom.totalLengthM - progressM);
    if (distToDest >= ARRIVAL_DISTANCE_M || remaining >= ARRIVAL_REMAINING_M) return false;

    if (!this.applyInternal('ARRIVE')) return false; // not in an arrivable state
    this.arrivedFired = true;

    const routeId = this.active.route.id;
    const destination = this.active.destination;
    this.recoveryStore.clear();
    this.logger.info('Arrived at destination', { route_id: routeId });
    this.bus.publish('event/arrived', {
      route_id: routeId,
      destination,
      ts: new Date().toISOString(),
    });
    this.publishState();
    return true;
  }

  // --- State-machine plumbing ----------------------------------------------

  /** Apply an internal action if valid; return whether it fired. Never throws. */
  private applyInternal(action: NavAction): boolean {
    const nxt = nextState(this.status, action);
    if (nxt === null) return false;
    this.status = nxt;
    return true;
  }

  /** Apply a user action or throw 409 for an invalid transition. */
  private requireTransition(action: NavAction): void {
    const nxt = nextState(this.status, action);
    if (nxt === null) {
      throw new NavigationError(
        409,
        'INVALID_TRANSITION',
        `Cannot apply "${action}" from state "${this.status}"`,
      );
    }
    this.status = nxt;
  }

  // --- Route / geometry setup ----------------------------------------------

  private resolveRoute(input: StartInput): Route {
    if (input.route) return input.route;
    if (input.route_id) {
      const cached = this.routeProvider.getCachedRoute(input.route_id);
      if (!cached) {
        throw new NavigationError(
          404,
          'ROUTE_NOT_FOUND',
          `Route ${input.route_id} not found or expired`,
        );
      }
      return cached;
    }
    throw new NavigationError(400, 'MISSING_ROUTE', 'start requires "route_id" or "route"');
  }

  private buildActive(route: Route, destination: NavDestination | null): ActiveNavigation {
    let geom: RouteGeometry;
    try {
      geom = buildRouteGeometry(route);
    } catch (err) {
      throw new NavigationError(
        422,
        'INVALID_ROUTE_GEOMETRY',
        `Route ${route.id} has unusable geometry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const maneuvers: ManeuverAnchor[] = [];
    for (const m of route.maneuvers) {
      const idx = m.begin_shape_index;
      if (idx >= 0 && idx < geom.cumulative.length) {
        maneuvers.push({ maneuver: m, progressM: geom.cumulative[idx] });
      }
    }
    maneuvers.sort((a, b) => a.progressM - b.progressM);

    const resolvedDest: NavDestination =
      destination ?? { latlng: { ...geom.points[geom.points.length - 1] }, name: null };

    return { route, geom, maneuvers, destination: resolvedDest };
  }

  // --- NavState assembly + publishing --------------------------------------

  private buildState(): NavState {
    const active = this.active;
    const progress = this.lastProgressM ?? 0;

    let nextManeuver: Maneuver | null = null;
    let distanceToManeuver: number | null = null;
    let distanceRemaining: number | null = null;
    let destination: NavState['destination'] = null;
    let routeId: string | null = null;

    // Every state that owns a route (all but `idle`) reports route-relative
    // fields; only `idle` (stopped) nulls them out.
    if (active && this.status !== 'idle') {
      routeId = active.route.id;
      distanceRemaining = Math.max(0, active.geom.totalLengthM - progress);
      destination = active.destination;
      const upcoming = active.maneuvers.find((a) => a.progressM > progress);
      if (upcoming) {
        nextManeuver = upcoming.maneuver;
        distanceToManeuver = Math.max(0, upcoming.progressM - progress);
      }
    }

    const speedKmh = this.lastPosition?.speed != null ? this.lastPosition.speed * 3.6 : null;
    const altitudeM = this.lastPosition?.alt ?? null;

    return {
      status: this.status,
      route_id: routeId,
      next_maneuver: nextManeuver,
      distance_to_maneuver_m: distanceToManeuver,
      distance_remaining_m: distanceRemaining,
      duration_remaining_s: null, // E04-T2
      eta: null, // E04-T2
      speed_kmh: speedKmh,
      speed_limit_kmh: null, // E04-T3
      altitude_m: altitudeM,
      destination,
    };
  }

  private publishState(): NavState {
    const state = this.buildState();

    // Self-check against the docs/03 §5 invariants (no silent bad data): the
    // monotonic clamp should make this always pass; a violation is logged so
    // it can't slip by unnoticed.
    const plausibility = checkNavState(state, this.prevState ?? undefined);
    if (!plausibility.ok) {
      this.logger.warn('nav/state failed plausibility self-check', {
        violations: plausibility.violations,
      });
    }

    this.bus.publish('nav/state', state);
    this.prevState = state;
    return state;
  }

  // --- Restart recovery (W-19) ---------------------------------------------

  private recoverOnStartup(): void {
    const record = this.recoveryStore.load();
    if (!record) return;

    const route = this.routeProvider.getCachedRoute(record.route_id);
    if (!route) {
      // Route no longer cached (expired) — drop the stale record, stay idle.
      this.recoveryStore.clear();
      return;
    }

    // No ghost navigation: status stays idle. Offer resume via an event.
    this.logger.info('Recovered navigable route on startup', { route_id: record.route_id });
    this.bus.publish('event/nav_recovered_route_available', {
      route_id: record.route_id,
      destination: record.destination,
    });
  }
}
