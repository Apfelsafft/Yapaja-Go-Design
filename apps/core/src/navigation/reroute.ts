/**
 * Deviation detection & reroute policy (E04-T4, 🔴 safety-critical).
 *
 * This module is PURE (no clocks, no bus, no I/O — every timestamp is passed
 * in): the async orchestration (calling `RoutingService.createRoutes`, timers,
 * rebuilding geometry) lives in `./service.ts`, mirroring the `mapMatching.ts`
 * / `eta.ts` split. Two pieces live here, each unit-testable against fixed
 * time series:
 *
 *  1. {@link DeviationDetector} — turns a stream of per-fix on/off-route
 *     samples into a CONFIRMED deviation. A single blip never confirms; the
 *     violation must be sustained over BOTH ≥5 s AND ≥5 fixes. Combined with
 *     the map-matcher's 30 m cross-track threshold this is what makes 15 m GPS
 *     noise inert (noise stays on-route → detector never accumulates) while a
 *     genuine move onto a parallel road (cross-track grows past 30 m and stays
 *     there) confirms.
 *
 *  2. {@link RerouteGuard} — the debounce (≤1 reroute/10 s) and loop guard
 *     (W-05: 3 reroutes within 5 min inside the same ~200 m radius ⇒ stop
 *     auto-rerouting that spot and suggest "avoid segment").
 */

import type { LatLng } from '@yapaja/shared';
import { haversineM } from './geo.js';

// --- thresholds (E04-T4 spec) ----------------------------------------------

/** A deviation must be sustained at least this long before it confirms. */
export const CONFIRM_MIN_MS = 5000;
/** …AND across at least this many consecutive off-route fixes. */
export const CONFIRM_MIN_FIXES = 5;
/** Debounce: at most one reroute attempt per this many milliseconds. */
export const REROUTE_DEBOUNCE_MS = 10_000;
/** Loop window: reroutes are only "clustered" if within this span (5 min). */
export const LOOP_WINDOW_MS = 5 * 60_000;
/** Loop guard trips when this many reroutes cluster in the window+radius. */
export const LOOP_MIN_REROUTES = 3;
/** Two deviations count as "the same spot" within this radius (metres). */
export const LOOP_RADIUS_M = 200;
/** Retry cadence when a reroute fails because the router is unavailable. */
export const RETRY_INTERVAL_MS = 15_000;

// --- 1. Deviation confirmation state machine --------------------------------

export interface DeviationSample {
  /** Was this fix on-route per the E04-T1 cross-track/heading rule? */
  onRoute: boolean;
  /** Wall-clock timestamp of the fix, milliseconds. */
  tsMs: number;
}

export type DeviationPhase = 'on_route' | 'pending' | 'confirmed';

export interface DeviationUpdate {
  phase: DeviationPhase;
  /**
   * True ONLY on the fix that first reaches confirmation in the current
   * off-route streak — the edge to publish `route/deviation` on (so it fires
   * once per streak, not on every subsequent sustained off-route fix).
   */
  justConfirmed: boolean;
}

/**
 * Confirms a deviation over ≥{@link CONFIRM_MIN_MS} AND ≥{@link CONFIRM_MIN_FIXES}.
 *
 * The streak clock starts on the FIRST off-route fix; confirmation needs both
 * the fix COUNT and the elapsed TIME to clear their thresholds, so at ~1 Hz a
 * genuine deviation confirms after ~6 fixes / 5 s. Any on-route fix resets the
 * streak — this is exactly why a 1–2 fix blip (or 15 m noise that never leaves
 * the 30 m corridor) can never confirm. Non-latching: once confirmed it keeps
 * reporting `confirmed` every subsequent off-route fix (so the caller can retry
 * a debounced reroute on a later fix without losing the confirmation); the
 * caller calls {@link reset} after acting so the NEW route starts a fresh streak.
 */
export class DeviationDetector {
  private streakStartMs: number | null = null;
  private streakFixes = 0;
  private confirmed = false;

  update(sample: DeviationSample): DeviationUpdate {
    if (sample.onRoute) {
      this.reset();
      return { phase: 'on_route', justConfirmed: false };
    }

    if (this.streakStartMs === null) this.streakStartMs = sample.tsMs;
    this.streakFixes += 1;
    const elapsedMs = sample.tsMs - this.streakStartMs;

    const meets = this.streakFixes >= CONFIRM_MIN_FIXES && elapsedMs >= CONFIRM_MIN_MS;
    if (meets) {
      const justConfirmed = !this.confirmed;
      this.confirmed = true;
      return { phase: 'confirmed', justConfirmed };
    }
    return { phase: 'pending', justConfirmed: false };
  }

  reset(): void {
    this.streakStartMs = null;
    this.streakFixes = 0;
    this.confirmed = false;
  }

  /** Whether a deviation is currently confirmed (used to gate failure retries). */
  get isConfirmed(): boolean {
    return this.confirmed;
  }
}

// --- 2. Debounce + loop guard ----------------------------------------------

interface RerouteRecord {
  tsMs: number;
  at: LatLng;
}

/**
 * Enforces the debounce and W-05 loop guard. Pure state (no clocks) — the
 * caller passes `nowMs`.
 *
 * Loop semantics (deliberate reading of "3 Reroutes in 5 min im selben
 * 200-m-Umkreis"): the 1st and 2nd clustered reroutes are performed normally;
 * the 3rd clustered confirmed deviation is recognised as a loop — instead of
 * issuing a pointless 3rd reroute the caller emits `event/reroute_loop` and
 * this guard BLOCKS the spot so auto-rerouting there stops. Only SUCCESSFUL
 * reroutes feed the cluster count (a Valhalla-down failure that merely retries
 * is not the vehicle looping).
 */
export class RerouteGuard {
  private lastAttemptMs: number | null = null;
  private readonly successes: RerouteRecord[] = [];
  private readonly blocked: LatLng[] = [];

  /** Debounce gate: has enough time elapsed since the last reroute attempt? */
  canAttempt(nowMs: number): boolean {
    return this.lastAttemptMs === null || nowMs - this.lastAttemptMs >= REROUTE_DEBOUNCE_MS;
  }

  /** Record that a reroute was attempted at `nowMs` (drives the debounce). */
  noteAttempt(nowMs: number): void {
    this.lastAttemptMs = nowMs;
  }

  /** Is this spot flagged as a loop (auto-reroute disabled here)? */
  isBlocked(at: LatLng): boolean {
    return this.blocked.some((spot) => haversineM(spot, at) <= LOOP_RADIUS_M);
  }

  /**
   * Would a reroute at `at`/`nowMs` be the {@link LOOP_MIN_REROUTES}-th in the
   * cluster? If so, block the spot and return true (caller emits the loop event
   * and does NOT reroute). Otherwise return false (caller proceeds).
   */
  checkLoop(nowMs: number, at: LatLng): boolean {
    this.prune(nowMs);
    const clustered = this.successes.filter((r) => haversineM(r.at, at) <= LOOP_RADIUS_M).length;
    if (clustered + 1 >= LOOP_MIN_REROUTES) {
      this.blocked.push({ ...at });
      return true;
    }
    return false;
  }

  /** Record a SUCCESSFUL reroute (feeds the loop cluster count). */
  noteSuccess(nowMs: number, at: LatLng): void {
    this.prune(nowMs);
    this.successes.push({ tsMs: nowMs, at: { ...at } });
  }

  /** Clear all state (per-navigation reset). */
  reset(): void {
    this.lastAttemptMs = null;
    this.successes.length = 0;
    this.blocked.length = 0;
  }

  private prune(nowMs: number): void {
    for (let i = this.successes.length - 1; i >= 0; i--) {
      if (nowMs - this.successes[i].tsMs > LOOP_WINDOW_MS) this.successes.splice(i, 1);
    }
  }
}
