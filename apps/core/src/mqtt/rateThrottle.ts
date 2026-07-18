/**
 * `yapaja/position` publish-rate throttle (E08-T1, docs/03 §4): 1 Hz while
 * driving, 0.1 Hz (every 10 s) while stopped. Pure, timer-free logic (unlike
 * `PositionService#publishThrottled`, which owns a trailing-edge timer for
 * the internal `pos/update` bus topic) -- the MQTT bridge only needs a
 * leading-edge "is it time yet?" decision because it's fed by an
 * already-throttled `pos/update` stream (at most 1 Hz), so no fix is ever
 * lost by simply dropping the ones that arrive too soon.
 */

/**
 * Ground speed above which a fix counts as "driving" for the publish-rate
 * decision. Mirrors the cutoff `navigation/mapMatching.ts`'s
 * `STATIONARY_SPEED_MS` (1.5 m/s ≈ 5.4 km/h) uses for "GPS heading
 * unreliable while stopped/crawling" -- kept as an independent constant here
 * (not imported) so the mqtt module has no dependency on navigation
 * internals; the two concerns just happen to share a sensible cutoff.
 */
export const DRIVING_SPEED_MS = 1.5;

const DRIVING_INTERVAL_MS = 1000; // 1 Hz
const STOPPED_INTERVAL_MS = 10_000; // 0.1 Hz

export class PositionPublishThrottle {
  private lastPublishAtMs: number | null = null;

  /**
   * Returns true iff a `yapaja/position` publish for the given ground speed
   * should happen NOW -- and, when it does, records `nowMs` so the next call
   * is throttled against it. The very first call always publishes (nothing
   * to throttle against yet). `speedMs === null` (unknown speed) is treated
   * as "stopped" -- the more conservative (lower) publish rate.
   */
  shouldPublish(speedMs: number | null, nowMs: number): boolean {
    const intervalMs =
      speedMs !== null && speedMs > DRIVING_SPEED_MS ? DRIVING_INTERVAL_MS : STOPPED_INTERVAL_MS;
    if (this.lastPublishAtMs === null || nowMs - this.lastPublishAtMs >= intervalMs) {
      this.lastPublishAtMs = nowMs;
      return true;
    }
    return false;
  }

  /** Resets the throttle so the next call always publishes; mainly for tests. */
  reset(): void {
    this.lastPublishAtMs = null;
  }
}
