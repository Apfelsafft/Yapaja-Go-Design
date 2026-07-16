/**
 * ETA & remaining-duration math (E04-T2). Pure -- no clocks, no bus, no I/O --
 * so every claim here is unit-testable against fixed inputs, mirroring the
 * `mapMatching.ts` split (pure geometry/math vs. `service.ts` owning time and
 * state). `NavigationService` is the only caller: it owns the wall clock, the
 * running {@link CalibrationState}, and the publish-time "never let
 * duration_remaining_s creep up while navigating" clamp -- see that file's
 * `buildState()` doc comment for why the clamp lives there and not here (it
 * needs the previously-published value, which a pure function can't hold).
 *
 * Pipeline (docs/03 §1/§5, Wargame W-22):
 *  1. {@link buildManeuverAnchors} / {@link buildTimeSegments} turn the
 *     route's per-maneuver Valhalla times into contiguous progress-ordered
 *     time segments.
 *  2. {@link remainingPlannedDurationS} sums the planned time from the
 *     current progress to the route end, interpolating the
 *     partially-traversed segment.
 *  3. {@link updateCalibration} maintains a running EWMA of actual/planned
 *     pace (~10 min window), clamped to [0.7, 1.5], FROZEN at standstill.
 *  4. {@link computeEtaDuration} multiplies (2) by (3)'s factor, then floors
 *     the result by remaining-distance/avg_speed (never more optimistic than
 *     the vehicle profile's average speed over long distances).
 *  5. {@link etaTimestamp} turns a duration into `now + duration`, UTC
 *     ISO-8601 with offset (`Z`) -- Core stays UTC-only; a local-time
 *     *formatter* for display is `packages/shared/src/formatEta.ts`, shared
 *     with the future web UI (E07).
 */

import type { Maneuver, Route } from '@yapaja/shared';
import type { RouteGeometry } from './mapMatching.js';

// --- 1. Maneuver anchors + planned-time segments ----------------------------

export interface ManeuverAnchor {
  maneuver: Maneuver;
  /** Metres from route start to this maneuver's `begin_shape_index`. */
  progressM: number;
}

/** Anchor every maneuver onto the route's cumulative-progress axis, sorted ascending. */
export function buildManeuverAnchors(
  route: Pick<Route, 'maneuvers'>,
  geom: Pick<RouteGeometry, 'cumulative'>,
): ManeuverAnchor[] {
  const anchors: ManeuverAnchor[] = [];
  for (const maneuver of route.maneuvers) {
    const idx = maneuver.begin_shape_index;
    if (idx >= 0 && idx < geom.cumulative.length) {
      anchors.push({ maneuver, progressM: geom.cumulative[idx] });
    }
  }
  anchors.sort((a, b) => a.progressM - b.progressM);
  return anchors;
}

export interface TimeSegment {
  /** Progress (m) at the start of this segment. */
  startM: number;
  /** Progress (m) at the end of this segment. */
  endM: number;
  /** Valhalla-planned duration (s) to traverse this segment. */
  plannedDurationS: number;
}

/**
 * Turn maneuver anchors into contiguous `[startM, endM)` time segments
 * spanning the whole route. Each maneuver's own `duration_s` (Valhalla's
 * per-maneuver `time`, mapped in `routing/mapResponse.ts`) is that segment's
 * planned duration. If ANY maneuver is missing it (older cached route,
 * hand-built test fixture, or a route computed before this field existed) we
 * fall back to splitting `totalDurationS` proportionally by distance for
 * EVERY segment -- a route either has full per-maneuver timing or none;
 * mixing exact and estimated numbers across segments would make the
 * remaining-duration curve jump around for no physical reason.
 */
export function buildTimeSegments(
  anchors: ManeuverAnchor[],
  totalLengthM: number,
  totalDurationS: number,
): TimeSegment[] {
  const safeTotalDurationS = Math.max(0, totalDurationS);
  if (totalLengthM <= 0) return [];
  if (anchors.length === 0) {
    return [{ startM: 0, endM: totalLengthM, plannedDurationS: safeTotalDurationS }];
  }

  const allHaveDuration = anchors.every((a) => a.maneuver.duration_s !== undefined);

  const segments: TimeSegment[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const startM = i === 0 ? 0 : anchors[i].progressM;
    const rawEndM = i + 1 < anchors.length ? anchors[i + 1].progressM : totalLengthM;
    const endM = Math.max(startM, rawEndM);
    const lengthM = endM - startM;
    const plannedDurationS = allHaveDuration
      ? Math.max(0, anchors[i].maneuver.duration_s as number)
      : totalLengthM > 0
        ? safeTotalDurationS * (lengthM / totalLengthM)
        : 0;
    segments.push({ startM, endM, plannedDurationS });
  }
  return segments;
}

// --- 2. Remaining planned duration -----------------------------------------

/**
 * Remaining planned duration (s) from `progressM` to the route end,
 * interpolating the partially-traversed segment linearly by distance.
 * Monotonically non-increasing in `progressM` for a well-formed
 * (contiguous, non-negative) segment list -- also doubles as the "planned
 * time to cover [a,b]" building block for calibration, see
 * {@link plannedDurationBetweenM}.
 */
export function remainingPlannedDurationS(segments: TimeSegment[], progressM: number): number {
  let remaining = 0;
  for (const seg of segments) {
    if (seg.endM <= progressM) continue; // fully behind current progress
    if (seg.startM >= progressM) {
      remaining += seg.plannedDurationS; // fully ahead
      continue;
    }
    // Straddles progress: interpolate the remaining fraction linearly by distance.
    const span = seg.endM - seg.startM;
    const fracRemaining = span > 0 ? (seg.endM - progressM) / span : 0;
    remaining += seg.plannedDurationS * fracRemaining;
  }
  return Math.max(0, remaining);
}

/** Planned time (s) to cover `[fromM, toM]`, i.e. the calibration tick's "expected" duration. */
export function plannedDurationBetweenM(segments: TimeSegment[], fromM: number, toM: number): number {
  if (toM <= fromM) return 0;
  return Math.max(0, remainingPlannedDurationS(segments, fromM) - remainingPlannedDurationS(segments, toM));
}

// --- 3. Calibration factor (EWMA of actual/planned pace) -------------------

/** EWMA time constant, seconds (~ the last 10 min of driving dominate the running factor). */
export const CALIBRATION_TAU_S = 600;
/** Hard clamp on the calibration factor (E04-T2 spec). */
export const CALIBRATION_MIN_FACTOR = 0.7;
export const CALIBRATION_MAX_FACTOR = 1.5;
/**
 * Below this ground speed the calibration factor is FROZEN: a red-light stop
 * must not fold into it, otherwise a 3-minute stop would send the
 * actual/planned ratio towards infinity and wreck the ETA once moving again
 * (E04-T2 spec, acceptance scenario 3). Deliberately its own constant, not a
 * re-export of `mapMatching.ts`'s `STATIONARY_SPEED_MS` -- that one gates the
 * on-route heading test, this one gates calibration; they're conceptually
 * independent knobs that happen to sit in a similar range.
 */
export const CALIBRATION_FREEZE_SPEED_KMH = 5;

export interface CalibrationState {
  /** Current multiplicative correction: duration_remaining = planned * factor. */
  factor: number;
}

export function initialCalibrationState(): CalibrationState {
  return { factor: 1 };
}

export interface CalibrationTickInput {
  /** Wall-clock time elapsed since the previous tick, seconds. */
  actualDtS: number;
  /** Valhalla-planned time to cover the distance actually travelled this tick, seconds. */
  plannedDtS: number;
  /** Ground speed in km/h for THIS tick, or null if unknown. */
  speedKmh: number | null;
}

/**
 * One EWMA update. Pure: same inputs -> same output. Uses the continuous-time
 * form `alpha = 1 - exp(-dt/tau)` so irregular tick spacing (GPS fixes are
 * ~1 Hz but not exact) still yields a consistent ~10-minute window instead of
 * over/under-weighting slow ticks.
 *
 * FREEZES (returns `state` unchanged, i.e. a no-op) when:
 *  - `speedKmh` is below {@link CALIBRATION_FREEZE_SPEED_KMH} or unknown --
 *    standstill / red light / unreliable speed reading, don't fold it in;
 *  - `actualDtS` or `plannedDtS` is non-positive -- no reliable signal (first
 *    tick, clock jitter, a tick whose matched progress didn't advance).
 *
 * The instantaneous ratio is itself clamped to `[MIN,MAX]` before blending so
 * one noisy tick (e.g. a near-zero `plannedDtS` denominator right after a
 * maneuver boundary) can't yank the running factor by more than one EWMA step
 * allows -- this is what keeps `duration_remaining_s` from ever taking a
 * large one-tick jump, on top of (not instead of) NavigationService's own
 * publish-time non-increasing clamp.
 */
export function updateCalibration(
  state: CalibrationState,
  input: CalibrationTickInput,
): CalibrationState {
  if (input.actualDtS <= 0 || input.plannedDtS <= 0) return state;
  if (input.speedKmh === null || input.speedKmh < CALIBRATION_FREEZE_SPEED_KMH) return state;

  const rawRatio = input.actualDtS / input.plannedDtS;
  const ratio = Math.min(CALIBRATION_MAX_FACTOR, Math.max(CALIBRATION_MIN_FACTOR, rawRatio));
  const alpha = 1 - Math.exp(-input.actualDtS / CALIBRATION_TAU_S);
  const blended = state.factor + alpha * (ratio - state.factor);
  const factor = Math.min(CALIBRATION_MAX_FACTOR, Math.max(CALIBRATION_MIN_FACTOR, blended));
  return { factor };
}

// --- 4./5. ETA assembly ------------------------------------------------------

export interface EtaComputationInput {
  segments: TimeSegment[];
  totalLengthM: number;
  progressM: number;
  calibration: CalibrationState;
  /** Active vehicle profile's average speed, km/h, or null when unavailable (no floor applied). */
  avgSpeedKmh: number | null;
}

export interface EtaComputation {
  /** Raw planned remaining duration BEFORE calibration/floor, seconds. */
  basePlannedRemainingS: number;
  /** Calibrated + avg-speed-floored remaining duration, seconds (integer, >= 0). */
  durationRemainingS: number;
}

/**
 * Base planned remaining duration, calibrated by the running factor, floored
 * by remaining-distance/avg_speed (E04-T2 spec steps 1-3). Does NOT touch the
 * wall clock and does NOT apply the publish-time non-increasing clamp -- both
 * are `NavigationService.buildState()`'s job, since they need the
 * previously-published value / current time, which this pure function
 * deliberately does not receive.
 */
export function computeEtaDuration(input: EtaComputationInput): EtaComputation {
  const basePlannedRemainingS = remainingPlannedDurationS(input.segments, input.progressM);
  const calibrated = basePlannedRemainingS * input.calibration.factor;

  const remainingM = Math.max(0, input.totalLengthM - input.progressM);
  let durationS = calibrated;
  if (input.avgSpeedKmh !== null && input.avgSpeedKmh > 0) {
    const floorS = remainingM / (input.avgSpeedKmh / 3.6);
    durationS = Math.max(durationS, floorS);
  }

  return {
    basePlannedRemainingS,
    durationRemainingS: Math.max(0, Math.round(durationS)),
  };
}

/** `now + durationRemainingS`, UTC ISO-8601 WITH offset (W-22: `Date#toISOString`'s trailing `Z`). */
export function etaTimestamp(nowMs: number, durationRemainingS: number): string {
  return new Date(nowMs + Math.max(0, durationRemainingS) * 1000).toISOString();
}
