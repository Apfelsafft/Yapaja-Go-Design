/* eslint-disable no-undef -- setTimeout/clearTimeout are standard Node globals
 * (typed via @types/node); the shared eslint config's `globals` list predates
 * this backend module. Same justification as position/service.ts. */

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

import type {
  LatLng,
  Maneuver,
  NavState,
  Position,
  Route,
  RouteAvoidOverrides,
  RouteRequest,
  VehicleProfile,
} from '@yapaja/shared';
import { checkNavState } from '@yapaja/shared';
import type { EventBus } from '../bus/index.js';
import {
  DeviationDetector,
  RerouteGuard,
  RETRY_INTERVAL_MS,
} from './reroute.js';
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
import {
  InMemoryNavRecoveryStore,
  type NavRecoveryRecord,
  type NavRecoveryStore,
} from './recoveryStore.js';
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
import {
  buildSayText,
  buildSpeedSegmentAnchors,
  findActiveSpeedLimitKmh,
  findUpcomingManeuver,
  initialAnnouncementState,
  tickAnnouncement,
  type AnnouncementState,
  type SpeedSegmentAnchor,
} from './instructions.js';

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
 * The reroute entry point the service needs (E04-T4). `RoutingService`
 * satisfies it — the SAME shared instance already provided as `routeProvider`,
 * so production wires one object for both. Optional: when absent (older
 * callers, most unit tests) the service behaves exactly as E04-T1 — it flips
 * navigating ⇄ off_route but never launches a reroute.
 */
export interface RerouteProvider {
  createRoutes(request: RouteRequest): Promise<Route[]>;
}

/**
 * Optional reroute context threaded through `start` (E04-T4). Carries the
 * ORIGINAL route request's remaining waypoints and the E03-T4 temporary
 * avoidances so a reroute reproduces them; the active profile comes from
 * `profileProvider` and the final destination from the active navigation.
 * Absent ⇒ reroute with no avoidances / no waypoints (graceful). E04-T5 wires
 * this from the frontend's navigation-start payload.
 */
export interface RerouteContext {
  /** Remaining waypoints to still visit (passed through as-is; E04-T5 prunes visited ones). */
  waypoints?: LatLng[];
  /** E03-T4 temporary avoidances to reproduce on reroute. */
  exclude_locations?: LatLng[];
  exclude_polygons?: LatLng[][];
  avoid_overrides?: RouteAvoidOverrides;
  /** Fallback profile id when no `profileProvider` active profile is available. */
  profile_id?: string;
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
  /** Reroute entry point (E04-T4). Omit to disable auto-rerouting (E04-T1 behaviour). */
  rerouteProvider?: RerouteProvider;
}

export interface StartInput {
  /** Reference to a route cached by the routing service. */
  route_id?: string;
  /** …or the full route object (E04-T5 destination convenience passes this). */
  route?: Route;
  /** Destination; when omitted it is derived from the route's last vertex. */
  destination?: NavDestination | null;
  /** Optional reroute context (E04-T4): waypoints + E03-T4 avoidances to reproduce on reroute. */
  reroute?: RerouteContext;
}

interface ActiveNavigation {
  route: Route;
  geom: RouteGeometry;
  maneuvers: ManeuverAnchor[];
  /** Progress-ordered planned-time segments, ETA's base input (E04-T2). */
  timeSegments: TimeSegment[];
  /** Progress-anchored speed-limit segments, E04-T3's `speed_limit_kmh` input. */
  speedSegments: SpeedSegmentAnchor[];
  destination: NavDestination;
}

export class NavigationService {
  private readonly bus: EventBus;
  private readonly routeProvider: RouteProvider;
  private readonly recoveryStore: NavRecoveryStore;
  private readonly logger: NavigationServiceLogger;
  private readonly searchWindowM: number;
  private readonly profileProvider: ActiveProfileLookup | null;
  private readonly rerouteProvider: RerouteProvider | null;

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

  // --- E04-T3 announcement-engine state ---------------------------------------
  /** Per-maneuver "which thresholds already fired" tracker (Wargame W-23), reset per navigation. */
  private announcementState: AnnouncementState = initialAnnouncementState();

  // --- E04-T4 rerouting state -------------------------------------------------
  /** Confirms a deviation over 5 s / 5 fixes before a reroute is launched. */
  private readonly detector = new DeviationDetector();
  /** Debounce (≤1/10 s) + W-05 loop guard. */
  private readonly rerouteGuard = new RerouteGuard();
  /** Waypoints + avoidances to reproduce on reroute (from `start`, E04-T5 wires it). */
  private rerouteContext: RerouteContext | null = null;
  /** True while a `createRoutes` call is in flight (prevents overlapping reroutes). */
  private rerouteInFlight = false;
  /** Pending 15 s failure-retry timer, or null. */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deviation position captured for the pending retry (retries reuse it). */
  private pendingRetryAt: LatLng | null = null;

  private readonly unsubscribe: () => void;

  constructor(opts: NavigationServiceOptions) {
    this.bus = opts.bus;
    this.routeProvider = opts.routeProvider;
    this.recoveryStore = opts.recoveryStore ?? new InMemoryNavRecoveryStore();
    this.logger = opts.logger ?? noopLogger;
    this.searchWindowM = opts.searchWindowM ?? SEARCH_WINDOW_M;
    this.profileProvider = opts.profileProvider ?? null;
    this.rerouteProvider = opts.rerouteProvider ?? null;

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
    this.announcementState = initialAnnouncementState();
    this.resetRerouteState();
    this.rerouteContext = input.reroute ?? null;

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
    this.announcementState = initialAnnouncementState();
    this.resetRerouteState();
    this.rerouteContext = null;
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
   * W-19 reload-recovery info: the last active navigation's route reference,
   * available ONLY while `idle` (nothing to "recover" once a live session —
   * navigating/off_route/paused — already exists; that case needs no prompt,
   * the frontend just reconnects to it directly) and only while the
   * referenced route is still in the routing cache. Mirrors exactly what
   * `recoverOnStartup` already checked before publishing
   * `event/nav_recovered_route_available` — this is the SAME check, exposed
   * as a plain getter (E04-T5) so `GET /navigation/state` can surface it over
   * REST. A bus event alone can't do this: it fires once, synchronously, at
   * construction time, before any WS client could possibly have subscribed
   * yet — so a page reload that happens any time after Core boot would
   * otherwise never learn about the recoverable route at all.
   */
  getRecoverableRoute(): NavRecoveryRecord | null {
    if (this.status !== 'idle') return null;
    const record = this.recoveryStore.load();
    if (!record) return null;
    if (!this.routeProvider.getCachedRoute(record.route_id)) return null;
    return record;
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
    this.clearRetryTimer();
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
    // heading rule (E04-T1). The CONFIRMED-deviation reroute trigger (E04-T4)
    // is separate: `maybeReroute` runs the 5 s/5-fix detector and, on
    // confirmation, launches the reroute lifecycle.
    if (this.status === 'navigating' && !onRoute) this.applyInternal('DEVIATE');
    else if (this.status === 'off_route' && onRoute) this.applyInternal('RETURN');

    this.maybeReroute(onRoute, match.crossTrackM, pos);

    this.tickAnnouncements(accepted, pos);

    if (this.checkArrival(pos, accepted)) return; // publishes its own state

    this.publishState();
  }

  /**
   * One announcement-engine tick (E04-T3): finds the currently upcoming
   * maneuver at `progressM` (SAME rule `buildState()` uses for
   * `next_maneuver`), feeds it through `instructions.ts#tickAnnouncement`,
   * and -- when it decides a NEW threshold was crossed -- publishes
   * `nav/instruction`. A no-op (state stays as-is) whenever there's no
   * upcoming maneuver (idle/arrived/past the last one) or no threshold newly
   * crossed this tick.
   */
  private tickAnnouncements(progressM: number, pos: Position): void {
    if (!this.active) return;

    const upcoming = findUpcomingManeuver(this.active.maneuvers, progressM);
    const maneuver = upcoming?.maneuver ?? null;
    const maneuverKey = upcoming ? `${this.active.route.id}:${upcoming.maneuver.index}` : null;
    const distanceToManeuverM = upcoming ? Math.max(0, upcoming.progressM - progressM) : null;

    const result = tickAnnouncement(this.announcementState, {
      maneuver,
      maneuverKey,
      distanceToManeuverM,
      speedMs: pos.speed,
    });
    this.announcementState = result.state;

    if (!result.fire) return;

    const say = buildSayText(
      {
        maneuver: result.fire.maneuver,
        distanceM: result.fire.distanceM,
        immediate: result.fire.immediate,
      },
      'de',
    );
    this.bus.publish('nav/instruction', {
      maneuver: result.fire.maneuver,
      distance_m: result.fire.distanceM,
      say,
    });
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

  // --- E04-T4 deviation detection & rerouting ------------------------------

  /**
   * Feed one fix into the deviation detector and, on a CONFIRMED deviation
   * (5 s/5 fixes), run the reroute policy: publish `route/deviation`, apply the
   * debounce + loop guard, then launch a reroute (or a loop-suggestion event).
   *
   * A no-op unless a `rerouteProvider` is wired and we're actively navigating;
   * also parks while a failure-retry is pending (that timer paces attempts) or
   * a reroute is already in flight.
   */
  private maybeReroute(onRoute: boolean, crossTrackM: number, pos: Position): void {
    if (!this.rerouteProvider || !this.active) return;
    if (this.status !== 'navigating' && this.status !== 'off_route') return;

    const nowMs = Date.now();
    const update = this.detector.update({ onRoute, tsMs: nowMs });

    if (update.justConfirmed) {
      this.bus.publish('route/deviation', {
        at: { lat: pos.lat, lon: pos.lon },
        cross_track_m: crossTrackM,
        ts: new Date(nowMs).toISOString(),
      });
    }

    if (update.phase !== 'confirmed') return;
    // A pending retry already owns the reroute cadence; don't double-fire.
    if (this.retryTimer !== null || this.rerouteInFlight) return;

    const at: LatLng = { lat: pos.lat, lon: pos.lon };
    // W-05: this spot was already flagged as a reroute loop — auto-reroute off.
    if (this.rerouteGuard.isBlocked(at)) return;
    // Debounce: at most one reroute attempt per 10 s.
    if (!this.rerouteGuard.canAttempt(nowMs)) return;

    // W-05 loop guard: the 3rd clustered reroute within 5 min/200 m is a loop —
    // suggest "avoid segment" instead of rerouting, and stop auto-rerouting here.
    if (this.rerouteGuard.checkLoop(nowMs, at)) {
      this.logger.warn('Reroute loop detected — suggesting avoid_segment', { at });
      this.bus.publish('event/reroute_loop', {
        suggestion: 'avoid_segment',
        at,
        ts: new Date(nowMs).toISOString(),
      });
      // Fresh streak so a later genuine deviation elsewhere can still confirm.
      this.detector.reset();
      return;
    }

    this.rerouteGuard.noteAttempt(nowMs);
    void this.executeReroute(pos, at, false);
  }

  /**
   * Perform one reroute attempt (async). On success: seamlessly hand the
   * navigation onto the new route (see {@link applyReroute}). On failure
   * (Valhalla down / no route): KEEP the old route, publish
   * `event/reroute_failed`, and schedule a 15 s retry.
   */
  private async executeReroute(pos: Position, at: LatLng, isRetry: boolean): Promise<void> {
    if (!this.rerouteProvider || !this.active) return;

    const request = this.buildRerouteRequest(pos);
    if (!request) return; // no profile to route with — logged in builder

    this.rerouteInFlight = true;
    try {
      const routes = await this.rerouteProvider.createRoutes(request);
      const primary = routes[0];
      if (!primary) throw new Error('reroute returned no route');

      // Still navigating? (a stop/arrival during the in-flight window wins.)
      if (this.status !== 'navigating' && this.status !== 'off_route') return;

      this.rerouteGuard.noteSuccess(Date.now(), at);
      this.clearRetryTimer();
      this.applyReroute(primary, pos);
      this.logger.info('Reroute applied', { route_id: primary.id, retry: isRetry });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn('Reroute failed — keeping old route, will retry', { reason });
      this.bus.publish('event/reroute_failed', {
        reason,
        ts: new Date().toISOString(),
        retry_in_ms: RETRY_INTERVAL_MS,
      });
      this.pendingRetryAt = at;
      this.scheduleRetry();
    } finally {
      this.rerouteInFlight = false;
    }
  }

  /** Build the reroute `RouteRequest`, or null when no profile is available. */
  private buildRerouteRequest(pos: Position): RouteRequest | null {
    const active = this.active;
    if (!active) return null;

    const profileId = this.profileProvider?.getActive()?.id ?? this.rerouteContext?.profile_id ?? null;
    if (!profileId) {
      this.logger.warn('Cannot reroute: no active profile / profile_id available');
      return null;
    }

    const ctx = this.rerouteContext;
    const request: RouteRequest = {
      origin: { lat: pos.lat, lon: pos.lon },
      destination: { ...active.destination.latlng },
      waypoints: ctx?.waypoints ?? [],
      profile_id: profileId,
      alternatives: 0,
    };
    // W-05: forward-facing — pass the current heading so Valhalla starts on an
    // edge in the direction of travel (no spurious "Bitte wenden").
    if (pos.heading !== null && Number.isFinite(pos.heading)) request.heading = pos.heading;
    // E03-T4 avoidances (present only when the start payload carried them).
    if (ctx?.exclude_locations) request.exclude_locations = ctx.exclude_locations;
    if (ctx?.exclude_polygons) request.exclude_polygons = ctx.exclude_polygons;
    if (ctx?.avoid_overrides) request.avoid_overrides = ctx.avoid_overrides;
    return request;
  }

  /**
   * Seamless handoff onto a freshly computed route. RESETS the map-matching
   * progress, the maneuver/announcement index, the deviation detector and the
   * publish-time duration clamp; KEEPS the ETA calibration factor (the vehicle
   * is the same, only the road ahead changed). Re-matches the current position
   * onto the new geometry, returns to `navigating`, and publishes
   * `route/updated { reason: 'reroute' }` followed by a fresh `nav/state`.
   */
  private applyReroute(route: Route, pos: Position): void {
    const active = this.buildActive(route, this.active?.destination ?? null);
    this.active = active;

    // Reset per-route progress/announcement state; KEEP calibration.
    this.lastProgressM = null;
    this.arrivedFired = false;
    this.lastDurationRemainingS = null;
    this.announcementState = initialAnnouncementState();
    this.detector.reset();

    // Re-match the current fix onto the NEW route (whole-route search) so the
    // first published state already carries correct progress and next_maneuver.
    try {
      const m = matchPosition(active.geom, { lat: pos.lat, lon: pos.lon }, null, this.searchWindowM);
      this.lastProgressM = m.progressM;
    } catch (err) {
      this.logger.error('Post-reroute re-match failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Return to navigating (off_route -> navigating); already-navigating is a no-op.
    if (this.status === 'off_route') this.applyInternal('RETURN');

    this.recoveryStore.save({ route_id: route.id, destination: active.destination });
    this.bus.publish('route/updated', { reason: 'reroute', route_id: route.id });
    this.publishState();
  }

  /** Schedule (or leave running) the 15 s failure-retry timer. */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.retryReroute();
    }, RETRY_INTERVAL_MS);
  }

  /**
   * Failure-retry tick: retry the reroute if we're still navigating AND still
   * confirmed off-route. If the vehicle returned to route (or navigation
   * stopped) in the meantime, drop the retry.
   */
  private async retryReroute(): Promise<void> {
    if (this.status !== 'navigating' && this.status !== 'off_route') {
      this.pendingRetryAt = null;
      return;
    }
    if (!this.detector.isConfirmed || !this.lastPosition || !this.pendingRetryAt) {
      this.pendingRetryAt = null;
      return; // vehicle recovered — nothing to retry
    }
    await this.executeReroute(this.lastPosition, this.pendingRetryAt, true);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.pendingRetryAt = null;
  }

  /** Reset all E04-T4 reroute state (per start/stop). */
  private resetRerouteState(): void {
    this.detector.reset();
    this.rerouteGuard.reset();
    this.rerouteInFlight = false;
    this.clearRetryTimer();
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
    // E04-T3: same "precompute once per navigation" reasoning for speed
    // limits. `route.speed_limits` is empty today (routing/mapResponse.ts
    // doesn't populate it yet) -> anchors stay [] -> lookup always null, never 0.
    const speedSegments = buildSpeedSegmentAnchors(route.speed_limits, geom);

    const resolvedDest: NavDestination =
      destination ?? { latlng: { ...geom.points[geom.points.length - 1] }, name: null };

    return { route, geom, maneuvers, timeSegments, speedSegments, destination: resolvedDest };
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
    let speedLimitKmh: number | null = null;

    // Every state that owns a route (all but `idle`) reports route-relative
    // fields; only `idle` (stopped) nulls them out.
    if (active && this.status !== 'idle') {
      routeId = active.route.id;
      distanceRemaining = Math.max(0, active.geom.totalLengthM - progress);
      destination = active.destination;
      const upcoming = findUpcomingManeuver(active.maneuvers, progress);
      if (upcoming) {
        nextManeuver = upcoming.maneuver;
        distanceToManeuver = Math.max(0, upcoming.progressM - progress);
      }
      // E04-T3: active SpeedSegment by progress -> speed_limit_kmh. Empty
      // `speed_limits` (or a gap between segments) -> null, never 0.
      speedLimitKmh = findActiveSpeedLimitKmh(active.speedSegments, progress);

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
      speed_limit_kmh: speedLimitKmh,
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
