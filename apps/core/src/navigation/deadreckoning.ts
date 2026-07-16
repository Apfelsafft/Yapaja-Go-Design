/**
 * Route-aware Dead-Reckoning provider (E04-T6, Wargame W-01 "GPS-Verlust").
 *
 * Implements the `DeadReckoningProvider` interface scaffolded by E02-T5
 * (`../position/deadReckoning.ts`): while `navigating`/`off_route`, on GPS
 * loss, walks the vehicle forward ALONG THE ROUTE POLYLINE from the last
 * matched progress at the last STABLE speed -- never straight-line off the
 * road on a curve, and never past the next maneuver when the turn ahead is
 * unclear (docs/08 W-01's "nie um die Ecke raten").
 *
 * Split mirrors the rest of `navigation/`: {@link extrapolateAlongRoute} /
 * `pointAtProgress` are PURE geometry (no clocks, no bus, no I/O), directly
 * unit-testable against fixed route fixtures -- same reasoning as
 * `mapMatching.ts`. {@link RouteAwareDeadReckoningProvider} is the thin
 * adapter wired into `DeadReckoningController` (see `index.ts`); it never
 * imports `NavigationService` directly (would create a service.ts <->
 * deadreckoning.ts cycle, since `NavigationService` also implements
 * {@link DeadReckoningRouteSource}) -- same "small interface, injected"
 * pattern `NavigationService` itself already uses for `RouteProvider`/
 * `RerouteProvider`.
 */

import type { Position } from '@yapaja/shared';
import type { DeadReckoningProvider } from '../position/deadReckoning.js';
import { bearingDeg } from './geo.js';
import type { RouteGeometry } from './mapMatching.js';

/**
 * Extrapolation stops after this many ms without a real fix (W-01, docs/08).
 * Shared by `DeadReckoningController`'s own tick-loop cutoff (`index.ts`
 * passes it as `maxWindowMs`) AND `NavigationService`'s independent
 * gps-loss -> `paused` timeout, so both halves of the "max 30s" rule agree
 * on the exact same number rather than two hand-copied literals drifting
 * apart.
 */
export const MAX_DEAD_RECKONING_WINDOW_MS = 30_000;

/**
 * Everything {@link RouteAwareDeadReckoningProvider} needs to extrapolate one
 * tick, as a snapshot taken FRESH on every call. `NavigationService` (the
 * sole production implementation of {@link DeadReckoningRouteSource}) never
 * mutates its matched progress while GPS is lost (no real fixes arrive to
 * move it), so `progressM`/`nextManeuverProgressM` stay a stable anchor
 * across the whole outage -- only `elapsedMs` (owned by
 * `DeadReckoningController`) grows from tick to tick.
 */
export interface DeadReckoningContext {
  geom: RouteGeometry;
  /** Last matched progress (m) BEFORE GPS was lost -- the extrapolation anchor. */
  progressM: number;
  /**
   * Progress (m) of the next upcoming maneuver, or `null` if there is none
   * ahead. Extrapolation is clamped here: never advance the guessed
   * position past an unresolved turn.
   */
  nextManeuverProgressM: number | null;
  /** Last STABLE (smoothed, not instantaneous/noisy) ground speed, m/s, or `null` if unknown. */
  lastStableSpeedMs: number | null;
}

/**
 * Supplies the live {@link DeadReckoningContext}, or `null` when there is no
 * active route to extrapolate along (idle/paused-by-user/arrived, or no
 * matched progress yet) -- W-01's "ohne aktive Route" branch: the provider
 * then declines (returns `null` from `extrapolate`), exactly like
 * `noopDeadReckoningProvider`, so the puck freezes rather than guesses.
 */
export interface DeadReckoningRouteSource {
  getActiveForDeadReckoning(): DeadReckoningContext | null;
}

export interface ExtrapolatedRoutePoint {
  lat: number;
  lon: number;
  headingDeg: number;
  /** The (already clamped) progress (m) this point sits at. */
  progressM: number;
}

/**
 * Interpolate the point at `progressM` along `geom`'s polyline.
 *
 * A route segment is a straight line in (lat, lon) space, and the map-
 * matcher's cross-track projection (`mapMatching.ts#projectPointOntoSegment`)
 * projects onto that SAME line using a local equirectangular frame centred on
 * the segment's start vertex. Linearly interpolating lat/lon between the two
 * vertices by the same fraction `t` therefore lands EXACTLY on that
 * projection line -- cross-track is zero up to floating-point error, by
 * construction, not merely approximately. This is what keeps a dead-reckoned
 * point ON the polyline through a curve: at each vertex the tangent (and
 * therefore the extrapolated heading) simply switches to the next segment's
 * bearing, so the guessed position follows the bend instead of cutting across it.
 */
function pointAtProgress(geom: RouteGeometry, progressM: number): ExtrapolatedRoutePoint {
  const { points, cumulative } = geom;
  const lastSegmentIndex = points.length - 2;

  let i = 0;
  while (i < lastSegmentIndex && cumulative[i + 1] < progressM) i++;

  const a = points[i];
  const b = points[i + 1];
  const segStart = cumulative[i];
  const segEnd = cumulative[i + 1];
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? Math.min(1, Math.max(0, (progressM - segStart) / segLen)) : 0;

  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    headingDeg: bearingDeg(a, b),
    progressM,
  };
}

export interface ExtrapolateAlongRouteInput {
  geom: RouteGeometry;
  /** Progress (m) at the moment GPS was lost -- the walk's starting point. */
  progressM: number;
  /**
   * Ground speed (m/s) to extrapolate at; must be finite and > 0 -- a
   * stationary/unknown speed can't be extrapolated meaningfully (the caller
   * declines rather than guessing a fabricated rate).
   */
  speedMs: number;
  /** Milliseconds elapsed since GPS was lost. */
  elapsedMs: number;
  /**
   * Clamp: never advance past this progress (m) -- the next maneuver's
   * anchor, so an unresolved turn is never guessed around (docs/08 W-01).
   * `null` for "no upcoming maneuver to clamp against" (still clamped at the
   * route end regardless).
   */
  clampProgressM: number | null;
}

/**
 * Walk `speedMs * elapsedMs` forward from `progressM` along `geom`'s
 * polyline, clamped at `clampProgressM` (the next maneuver) and at the route
 * end -- whichever comes first. Returns `null` for degenerate inputs (a
 * geometry that can't be walked, or a non-positive speed/negative elapsed
 * time) -- the caller (the {@link DeadReckoningProvider} adapter) treats
 * `null` exactly like "can't extrapolate", same as having no active route.
 */
export function extrapolateAlongRoute(
  input: ExtrapolateAlongRouteInput,
): ExtrapolatedRoutePoint | null {
  const { geom, progressM, speedMs, elapsedMs, clampProgressM } = input;
  if (geom.points.length < 2 || geom.totalLengthM <= 0) return null;
  if (!Number.isFinite(speedMs) || speedMs <= 0) return null;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;

  const startM = Math.min(Math.max(progressM, 0), geom.totalLengthM);
  let targetM = startM + speedMs * (elapsedMs / 1000);

  if (clampProgressM !== null && Number.isFinite(clampProgressM)) {
    targetM = Math.min(targetM, Math.max(0, clampProgressM));
  }
  targetM = Math.min(targetM, geom.totalLengthM);
  targetM = Math.max(targetM, 0);

  return pointAtProgress(geom, targetM);
}

/**
 * Wires {@link extrapolateAlongRoute} into E02-T5's `DeadReckoningProvider`
 * contract (`../position/deadReckoning.ts`). `routeSource` is
 * `NavigationService` in production (see `index.ts`), kept behind the
 * {@link DeadReckoningRouteSource} interface to avoid the import cycle noted
 * in the module docstring.
 */
export class RouteAwareDeadReckoningProvider implements DeadReckoningProvider {
  constructor(private readonly routeSource: DeadReckoningRouteSource) {}

  extrapolate(lastFix: Position, elapsedMs: number): Position | null {
    const ctx = this.routeSource.getActiveForDeadReckoning();
    if (!ctx) return null; // No active route to walk -- puck freezes (W-01).

    // Prefer the smoothed "last stable" speed; fall back to the last real
    // fix's own instantaneous speed only if no stable reading exists yet
    // (e.g. GPS lost on the very first fix of a navigation).
    const speedMs = ctx.lastStableSpeedMs ?? lastFix.speed;
    if (speedMs === null || !Number.isFinite(speedMs) || speedMs <= 0) return null;

    const point = extrapolateAlongRoute({
      geom: ctx.geom,
      progressM: ctx.progressM,
      speedMs,
      elapsedMs,
      clampProgressM: ctx.nextManeuverProgressM,
    });
    if (!point) return null;

    return {
      ...lastFix,
      lat: point.lat,
      lon: point.lon,
      heading: point.headingDeg,
      speed: speedMs,
      ts: new Date().toISOString(),
    };
  }
}

// --- Last-stable-speed tracking (an EWMA, NOT the noisy instantaneous reading) --

/** EWMA time constant for the "last stable speed" smoothing, seconds. */
export const STABLE_SPEED_TAU_S = 5;

export interface StableSpeedState {
  emaMs: number | null;
  lastTickMs: number | null;
}

export function initialStableSpeedState(): StableSpeedState {
  return { emaMs: null, lastTickMs: null };
}

/**
 * One EWMA update of the "last stable speed" used as the dead-reckoning
 * extrapolation rate. Fed only from REAL (map-matched) fixes -- never from
 * `pos/extrapolated` ones, which would be circular (extrapolating a speed
 * derived from an extrapolated fix). Mirrors `eta.ts#updateCalibration`'s
 * continuous-time EWMA shape (`alpha = 1 - exp(-dt/tau)`) so irregular fix
 * spacing still yields a consistent ~5s smoothing window. A `null`/negative/
 * non-finite reading is ignored (state carried over unchanged) rather than
 * corrupting the running average.
 */
export function updateStableSpeed(
  state: StableSpeedState,
  speedMs: number | null,
  nowMs: number,
): StableSpeedState {
  if (speedMs === null || !Number.isFinite(speedMs) || speedMs < 0) return state;
  if (state.emaMs === null || state.lastTickMs === null) {
    return { emaMs: speedMs, lastTickMs: nowMs };
  }
  const dtS = Math.max(0, (nowMs - state.lastTickMs) / 1000);
  const alpha = dtS > 0 ? 1 - Math.exp(-dtS / STABLE_SPEED_TAU_S) : 0;
  const blended = state.emaMs + alpha * (speedMs - state.emaMs);
  return { emaMs: blended, lastTickMs: nowMs };
}
