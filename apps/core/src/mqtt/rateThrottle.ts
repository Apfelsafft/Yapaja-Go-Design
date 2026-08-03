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

/**
 * Add-on `events.publish` -> MQTT rate limit (E09-T8, docs/05 §2 "5 msg/s
 * pro Add-on"): a FIXED-WINDOW counter, independently keyed per add-on id --
 * one chatty/amok add-on can never consume another add-on's budget (each id
 * gets its own window in {@link windows}), the same isolation principle
 * `watchdog.ts` applies per-PROCESS for CPU/RSS (W-14), just for MQTT
 * publish volume instead.
 *
 * Fixed-window (not a token bucket/leaky bucket) ON PURPOSE: it is the
 * simplest rule that still satisfies "5 msg/s demonstrably bites" -- exactly
 * 5 publishes are let through in any given 1000ms window keyed to the FIRST
 * call that opens it, the 6th+ in that window are refused. A token bucket
 * would allow bursting above 5 by borrowing from idle time; a fixed window
 * does not, which is the more conservative (harder-to-flood) choice for a
 * shared MQTT broker/HA integration. Pure and timer-free like
 * {@link PositionPublishThrottle} above -- the caller supplies `nowMs`, so
 * this is trivially unit-testable without fake timers.
 */
export const ADDON_EVENT_RATE_LIMIT_PER_SECOND = 5;
const ADDON_EVENT_WINDOW_MS = 1000;

interface RateWindow {
  windowStartMs: number;
  count: number;
}

export class AddonEventRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  /**
   * Returns true iff a publish for `addonId` should happen NOW -- and, when
   * it does (allowed OR refused), records the attempt so later calls in the
   * same window are counted. The very first call for a fresh window always
   * publishes.
   */
  allow(addonId: string, nowMs: number): boolean {
    let w = this.windows.get(addonId);
    if (!w || nowMs - w.windowStartMs >= ADDON_EVENT_WINDOW_MS) {
      w = { windowStartMs: nowMs, count: 0 };
      this.windows.set(addonId, w);
    }
    w.count += 1;
    return w.count <= ADDON_EVENT_RATE_LIMIT_PER_SECOND;
  }

  /** Test/maintenance helper: drops every add-on's window state. */
  reset(): void {
    this.windows.clear();
  }
}
