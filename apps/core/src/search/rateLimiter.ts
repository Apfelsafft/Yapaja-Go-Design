/* eslint-disable no-undef -- `setTimeout`/`clearTimeout` are standard Node 22
 * globals; same justification as routing/valhallaClient.ts. */

/**
 * Simple FIFO rate limiter: serializes `acquire()` callers so consecutive
 * requests are spaced at least `minIntervalMs` apart. Used by
 * `NominatimBackend` to honor Nominatim's "max 1 req/s" usage policy.
 *
 * The clock is injectable so tests can drive it with Vitest fake timers
 * instead of waiting on a real wall clock.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateLimiter {
  private readonly minIntervalMs: number;
  private readonly clock: Clock;
  /** Chains every `acquire()` call so concurrent callers queue up FIFO
   *  instead of racing the clock independently. */
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = -Infinity;

  constructor(minIntervalMs: number, clock: Clock = systemClock) {
    this.minIntervalMs = minIntervalMs;
    this.clock = clock;
  }

  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.takeSlot());
    // Keep the queue alive even if a caller's turn somehow throws.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async takeSlot(): Promise<void> {
    const now = this.clock.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) {
      await this.clock.sleep(wait);
    }
    this.lastRequestAt = this.clock.now();
  }
}
