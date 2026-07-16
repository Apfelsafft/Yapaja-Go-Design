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

import type { LatLng, Maneuver, NavState, Position, Route, VehicleProfile } from '@yapaja/shared';
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
import {
  buildManeuverAnchors,
  buildTimeSegments,
  computeEtaDuration,
  etaTimestamp,
  initialCalibrationState,
  plannedDurationBetweenM,
  updateCalibration,
  type CalibrationState,
  type ManeuverAnchor,
  type TimeSegment,
} from './eta.js';

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

/**
 * Just the profile lookup the ETA avg-speed floor needs (E04-T2;
 * ProfileService satisfies it). Optional: when omitted, no floor is applied
 * (matches pre-E04-T2 behaviour exactly for callers/tests that don't pass one).
 */
export interface ActiveProfileLookup {
  getActive(): VehicleProfile | null;
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
  /** ETA avg-speed floor input (E04-T2). Omit for "no floor" (e.g. most unit tests). */
  profileProvider?: ActiveProfileLookup;
}

export interface StartInput {
  /** Reference to a route cached by the routing service. */
  route_id?: string;
  /** …or the full route object (E04-T5 destination convenience passes this). */
  route?: Route;
  /** Destination; when omitted it is derived from the route's last vertex. */
  destination?: NavDestination | null;
}

interface ActiveNavigation {
  route: Route;
  geom: RouteGeometry;
  maneuvers: ManeuverAnchor[];
  /** Progress-ordered planned-time segments, ETA's base input (E04-T2). */
  timeSegments: TimeSegment[];
  destination: NavDestination;
}

export class NavigationService {
  private readonly bus: EventBus;
  private readonly routeProvider: RouteProvider;
  private readonly recoveryStore: NavRecoveryStore;
  private readonly logger: NavigationServiceLogger;
  private readonly searchWindowM: number;
  private readonly profileProvider: ActiveProfileLookup | null;

  private status: NavStatus = 'idle';
  private active: ActiveNavigation | null = null;
  private lastProgressM: number | null = null;
  private lastPosition: Position | null = null;
  private arrivedFired = false;
  private prevState: NavState | null = null;

  // --- E04-T2 ETA state ------------------------------------------------------
  /** Running calibration factor (EWMA of actual/planned pace), reset per navigation. */
  private calibration: CalibrationState = initialCalibrationState();
  /** Wall-clock ms of the last calibration-eligible tick; null before the first one. */
  private lastEtaTickMs: number | null = null;
  /** Last PUBLISHED duration_remaining_s; the non-increasing publish clamp's basis. */
  private lastDurationRemainingS: number | null = null;

  private readonly unsubscribe: () => void;

  constructor(opts: NavigationServiceOptions) {
    this.bus = opts.bus;
    this.routeProvider = opts.routeProvider;
    this.recoveryStore = opts.recoveryStore ?? new InMemoryNavRecoveryStore();
    this.logger = opts.logger ?? noopLogger;
    this.searchWindowM = opts.searchWindowM ?? SEARCH_WINDOW_M;
    this.profileProvider = opts.profileProvider ?? null;

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
    this.calibration = initialCalibrationState();
    this.lastEtaTickMs = null;
    this.lastDurationRemainingS = null;

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
    this.calibration = initialCalibrationState();
    this.lastEtaTickMs = null;
    this.lastDurationRemainingS = null;
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

  /**
   * Current ETA calibration factor (E04-T2). Not part of `NavState`/the REST
   * contract -- a debug/test introspection seam only (e.g. asserting the
   * factor stays frozen across a standstill), matching this class's other
   * `get*()` accessors.
   */
  getCalibrationFactor(): number {
    return this.calibration.factor;
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
    const prevProgressM = this.lastProgressM;
    const accepted =
      prevProgressM === null ? match.progressM : Math.max(match.progressM, prevProgressM);
    this.lastProgressM = accepted;
    this.lastPosition = pos;

    this.tickCalibration(prevProgressM, accepted, pos);

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

  /**
   * Feed one map-matched tick into the calibration EWMA (E04-T2). A no-op on
   * the first fix of a navigation (no previous tick to diff against) and
   * whenever `eta.ts#updateCalibration` itself decides to freeze (standstill,
   * unreliable speed, degenerate dt) — see that function's doc comment.
   */
  private tickCalibration(prevProgressM: number | null, newProgressM: number, pos: Position): void {
    const nowMs = Date.now();
    if (prevProgressM !== null && this.lastEtaTickMs !== null && this.active) {
      const actualDtS = (nowMs - this.lastEtaTickMs) / 1000;
      const plannedDtS = plannedDurationBetweenM(this.active.timeSegments, prevProgressM, newProgressM);
      const speedKmh = pos.speed != null ? pos.speed * 3.6 : null;
      this.calibration = updateCalibration(this.calibration, { actualDtS, plannedDtS, speedKmh });
    }
    this.lastEtaTickMs = nowMs;
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

    const maneuvers = buildManeuverAnchors(route, geom);
    // E04-T2: precompute the planned-time segments once per navigation (not
    // per tick) -- they only depend on the route, not on progress.
    const timeSegments = buildTimeSegments(maneuvers, geom.totalLengthM, route.duration_s);

    const resolvedDest: NavDestination =
      destination ?? { latlng: { ...geom.points[geom.points.length - 1] }, name: null };

    return { route, geom, maneuvers, timeSegments, destination: resolvedDest };
  }

  // --- NavState assembly + publishing --------------------------------------

  private buildState(): NavState {
    const active = this.active;
    const progress = this.lastProgressM ?? 0;

    let nextManeuver: Maneuver | null = null;
    let distanceToManeuver: number | null = null;
    let distanceRemaining: number | null = null;
    let durationRemaining: number | null = null;
    let eta: string | null = null;
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

      // E04-T2: base planned remaining * calibration factor, floored by
      // remaining-distance/avg_speed (see eta.ts#computeEtaDuration).
      const avgSpeedKmh = this.profileProvider?.getActive()?.avg_speed_kmh ?? null;
      const { durationRemainingS: rawDuration } = computeEtaDuration({
        segments: active.timeSegments,
        totalLengthM: active.geom.totalLengthM,
        progressM: progress,
        calibration: this.calibration,
        avgSpeedKmh,
      });

      // Publish-time clamp: NEVER let duration_remaining_s creep UP while
      // navigating (docs/03 §5's monotonicity invariant, checkNavState, has
      // zero tolerance for it) — a recalibration tick can otherwise nudge the
      // raw computation upward for a moment (see eta.ts#updateCalibration's
      // doc comment). The `eta` TIMESTAMP still recedes forward in real time
      // even while duration_remaining_s holds flat here: that's exactly how a
      // red-light stop (acceptance scenario 3) or a slower-than-planned
      // stretch (scenario 2) is meant to show up -- the countdown just stops
      // ticking down as fast (or, at a standstill, not at all).
      durationRemaining =
        this.lastDurationRemainingS === null
          ? rawDuration
          : Math.min(rawDuration, this.lastDurationRemainingS);
      this.lastDurationRemainingS = durationRemaining;

      eta = etaTimestamp(Date.now(), durationRemaining);
    }

    const speedKmh = this.lastPosition?.speed != null ? this.lastPosition.speed * 3.6 : null;
    const altitudeM = this.lastPosition?.alt ?? null;

    return {
      status: this.status,
      route_id: routeId,
      next_maneuver: nextManeuver,
      distance_to_maneuver_m: distanceToManeuver,
      distance_remaining_m: distanceRemaining,
      duration_remaining_s: durationRemaining,
      eta,
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
