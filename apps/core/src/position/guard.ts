/**
 * PlausibilityGuard: stateful runtime plausibility filter for position
 * fixes, run *before* a fix is handed to `PositionService.pushFix()`
 * (docs/07-testing-qa.md §3a, ADR-007, wargame W-02).
 *
 * It is a reusable, source-agnostic module (any `PositionSource` may run its
 * fixes through it) -- the gpsd source (E02-T3) is the first caller, wired
 * up in `./gpsd/index.ts`.
 *
 * Rules (docs/07 §3a / docs/03 §5):
 *  - `fix: 'none'` is never accepted (defense in depth -- sources should
 *    already avoid emitting these, see gpsd's mode 0/1 handling, but the
 *    guard enforces it independently since it's meant to protect *any*
 *    source, not just a well-behaved one).
 *  - Value-range violations (speed, altitude, heading -- via
 *    `@yapaja/shared`'s `checkPosition`) are rejected.
 *  - Jump/drift detection: implied ground speed between this fix and the
 *    last *accepted* fix (great-circle distance / elapsed time) > 300 m/s
 *    ⇒ reject. Exception (W-02, ferry/transport/device-restart case): after
 *    `maxConsecutiveJumpRejects` (default 3) consecutive jump-rejections,
 *    the next fix is accepted unconditionally and becomes the new baseline
 *    -- a real jump would otherwise wedge the guard forever.
 *  - `accuracy > 100 m` does NOT cause rejection -- the fix is accepted and
 *    flagged via `reason: 'inaccurate'` so callers/UI can mark it as
 *    imprecise (the `Position.accuracy` field itself already carries the
 *    number; frontend consumers such as `PositionPuck` already render a
 *    "gray puck" past this exact threshold, see apps/web/src/position).
 *
 * Note on scope: this task deliberately does not introduce a new
 * `system/plausibility` bus topic (docs/07 §3a mentions one) -- wiring a
 * new bus topic touches `apps/core/src/bus/index.ts`, outside this task's
 * declared file scope. Guard decisions are surfaced via the returned
 * `GuardResult.reason` and the caller's logger instead; see
 * KLÄRUNGSBEDARF in the task write-up.
 */

import { checkPosition, type Position } from '@yapaja/shared';

export interface GuardOptions {
  /** Implied-speed jump threshold in m/s. Default 300 (docs/07 §3a). */
  jumpSpeedThresholdMs?: number;
  /** Consecutive jump-rejections tolerated before accepting the next fix as a new baseline. Default 3. */
  maxConsecutiveJumpRejects?: number;
  /** Accuracy (meters) above which an accepted fix is flagged 'inaccurate'. Default 100. */
  inaccuracyThresholdM?: number;
}

export type GuardRejectReason = 'no_fix' | 'range_violation' | 'jump';
export type GuardAcceptReason = 'inaccurate';

export interface GuardResult {
  accept: boolean;
  /** Present iff `accept` is true. */
  position?: Position;
  /**
   * Present when rejected (why), or when accepted with a caveat worth
   * logging (currently only 'inaccurate'). Absent for a "clean" accept.
   */
  reason?: GuardRejectReason | GuardAcceptReason | string;
}

const DEFAULT_JUMP_SPEED_THRESHOLD_MS = 300;
const DEFAULT_MAX_CONSECUTIVE_JUMP_REJECTS = 3;
const DEFAULT_INACCURACY_THRESHOLD_M = 100;

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters (haversine formula). Kept local -- see the
 * near-identical private helper in packages/shared/src/plausibility.ts and
 * apps/core/src/position/simulator/geo.ts; both are documented as
 * intentionally module-local rather than shared, same rationale here. */
function haversineDistanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Stateful, per-source plausibility filter. Construct one instance *per
 * source* (a shared instance across sources would compare fixes from
 * unrelated sources against each other, which makes no sense for jump
 * detection) and feed every incoming fix through `evaluate()` before
 * calling `PositionService.pushFix()`.
 */
export class PlausibilityGuard {
  private readonly jumpSpeedThresholdMs: number;
  private readonly maxConsecutiveJumpRejects: number;
  private readonly inaccuracyThresholdM: number;

  private lastAccepted: Position | null = null;
  private consecutiveJumpRejects = 0;

  constructor(opts: GuardOptions = {}) {
    this.jumpSpeedThresholdMs = opts.jumpSpeedThresholdMs ?? DEFAULT_JUMP_SPEED_THRESHOLD_MS;
    this.maxConsecutiveJumpRejects =
      opts.maxConsecutiveJumpRejects ?? DEFAULT_MAX_CONSECUTIVE_JUMP_REJECTS;
    this.inaccuracyThresholdM = opts.inaccuracyThresholdM ?? DEFAULT_INACCURACY_THRESHOLD_M;
  }

  /** Evaluates one fix against the guard's rules, updating internal state on accept. */
  evaluate(position: Position): GuardResult {
    if (position.fix === 'none') {
      return { accept: false, reason: 'no_fix' };
    }

    const range = checkPosition(position);
    if (!range.ok) {
      return {
        accept: false,
        reason: `range_violation:${range.violations.map((v) => v.rule).join(',')}`,
      };
    }

    if (this.lastAccepted) {
      const dtS = (Date.parse(position.ts) - Date.parse(this.lastAccepted.ts)) / 1000;
      // A non-positive or unparseable elapsed time means no reliable implied
      // speed can be computed (duplicate/out-of-order timestamp) -- fall
      // through to acceptance rather than guessing.
      if (Number.isFinite(dtS) && dtS > 0) {
        const distanceM = haversineDistanceM(this.lastAccepted, position);
        const impliedSpeedMs = distanceM / dtS;
        if (impliedSpeedMs > this.jumpSpeedThresholdMs) {
          if (this.consecutiveJumpRejects < this.maxConsecutiveJumpRejects) {
            this.consecutiveJumpRejects += 1;
            return { accept: false, reason: 'jump' };
          }
          // maxConsecutiveJumpRejects consecutive jumps already rejected:
          // accept this one as the new "ground truth" (W-02 ferry/transport/
          // restart case) -- falls through to the acceptance path below,
          // which also resets the streak.
        }
      }
    }

    this.consecutiveJumpRejects = 0;
    this.lastAccepted = position;

    const inaccurate = position.accuracy !== null && position.accuracy > this.inaccuracyThresholdM;
    return { accept: true, position, reason: inaccurate ? 'inaccurate' : undefined };
  }

  /**
   * Clears the guard's jump-detection baseline (last accepted fix,
   * consecutive-reject streak). The next `evaluate()` call is unconditionally
   * accepted (range/no_fix checks still apply). Useful when the owning
   * source establishes a fresh connection -- see `GpsdSource`, which resets
   * its guard on every successful (re)connect so a fix from *before* an
   * outage is never compared against one from *after* it.
   */
  reset(): void {
    this.lastAccepted = null;
    this.consecutiveJumpRejects = 0;
  }
}
