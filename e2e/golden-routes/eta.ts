/**
 * Pure evaluation logic for the ETA-Plausibilitätsfall (docs/07 §3b,
 * automated in E10-T3).
 *
 * Split out of `runner.test.ts` for the same reason `bbox.ts` is: the actual
 * judgement ("is this ETA good enough?") must be unit-testable against fixed
 * inputs, not only reachable through a live Core + Valhalla + a minutes-long
 * simulator run. `runner.test.ts` does the I/O (route, navigate, drive, poll)
 * and hands the three observed numbers to {@link evaluateEta}.
 *
 * No clocks, no network, no state — every number comes in as an argument.
 */

/** The three numbers a live ETA run produces. */
export interface EtaObservation {
  /**
   * `Date.parse()` of the FIRST non-null `eta` the Core published after
   * navigation started (epoch ms, UTC — the Core is UTC-only, W-22).
   */
  initialEtaMs: number;
  /** Wall-clock instant (epoch ms) at which nav status became `arrived`. */
  actualArrivalMs: number;
  /** The route's planned duration (s) as returned by the routing call. */
  plannedDurationS: number;
}

export interface EtaVerdict {
  /** Signed deviation in seconds: positive = arrived LATER than promised. */
  errorS: number;
  /** |errorS| relative to the planned duration. */
  errorFraction: number;
  /** True when `errorFraction` is within the case's budget. */
  pass: boolean;
  /** Human-readable one-liner for the audit log. */
  summary: string;
}

/**
 * Compare the promised arrival against the actual one.
 *
 * The error is normalised by the PLANNED DURATION, not by the ETA timestamp
 * or by wall-clock-since-start: docs/07 §3b says the arrival time may deviate
 * by less than 5 % — 5 % *of the trip*, which is the only scale-free reading.
 * Normalising by an epoch timestamp would make the budget meaninglessly huge;
 * normalising by elapsed wall clock would let a run that finishes early hide a
 * large absolute error.
 *
 * Throws (rather than returning `pass: false`) on inputs that cannot express a
 * verdict at all — a non-finite number or a non-positive planned duration is a
 * broken measurement, not a failed ETA, and must never be reported as either
 * a pass or a legitimate safety-relevant failure.
 */
export function evaluateEta(obs: EtaObservation, maxErrorFraction: number): EtaVerdict {
  for (const [name, value] of Object.entries(obs)) {
    if (!Number.isFinite(value)) {
      throw new Error(`evaluateEta: ${name} is not a finite number (got ${String(value)})`);
    }
  }
  if (!Number.isFinite(maxErrorFraction) || maxErrorFraction <= 0) {
    throw new Error(`evaluateEta: maxErrorFraction must be a positive number (got ${maxErrorFraction})`);
  }
  if (obs.plannedDurationS <= 0) {
    throw new Error(
      `evaluateEta: plannedDurationS must be > 0 to normalise the error (got ${obs.plannedDurationS})`,
    );
  }

  const errorS = (obs.actualArrivalMs - obs.initialEtaMs) / 1000;
  const errorFraction = Math.abs(errorS) / obs.plannedDurationS;
  const pass = errorFraction <= maxErrorFraction;

  const sign = errorS >= 0 ? 'late' : 'early';
  const summary =
    `planned=${obs.plannedDurationS.toFixed(0)}s ` +
    `error=${errorS.toFixed(1)}s (${sign}) ` +
    `=> ${(errorFraction * 100).toFixed(2)}% of planned, budget ${(maxErrorFraction * 100).toFixed(0)}%`;

  return { errorS, errorFraction, pass, summary };
}

/**
 * Upper bound on the wall clock an ETA case may consume, derived from the
 * route it actually got. At `speed_factor` f, a route planned for `d` seconds
 * replays in `d / f` seconds of wall clock; the margin absorbs startup,
 * polling granularity and the arrival threshold.
 *
 * Returned so the runner can fail FAST and explicitly ("this route is too
 * long for the configured cap") instead of silently blocking a nightly job
 * until the job timeout kills it with no diagnosis.
 */
export function expectedWallClockS(plannedDurationS: number, speedFactor: number, marginS = 60): number {
  if (!Number.isFinite(plannedDurationS) || plannedDurationS <= 0) {
    throw new Error(`expectedWallClockS: plannedDurationS must be > 0 (got ${plannedDurationS})`);
  }
  if (!Number.isFinite(speedFactor) || speedFactor <= 0) {
    throw new Error(`expectedWallClockS: speedFactor must be > 0 (got ${speedFactor})`);
  }
  return plannedDurationS / speedFactor + marginS;
}
