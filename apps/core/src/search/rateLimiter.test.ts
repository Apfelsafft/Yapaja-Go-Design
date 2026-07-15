/**
 * Tests for RateLimiter (used by NominatimBackend to honor its
 * max-1-req/s usage policy). Uses Vitest fake timers so waits are asserted
 * deterministically instead of on a real wall clock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets the first acquire() through immediately', async () => {
    const limiter = new RateLimiter(1000);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBe(0);
  });

  it('a second immediate acquire() waits at least the full interval', async () => {
    const limiter = new RateLimiter(1000);
    await limiter.acquire();

    let secondResolved = false;
    const second = limiter.acquire().then(() => {
      secondResolved = true;
    });

    // Just under the interval: still waiting.
    await vi.advanceTimersByTimeAsync(999);
    expect(secondResolved).toBe(false);

    // Crossing the interval: now resolves.
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(secondResolved).toBe(true);
  });

  it('does not delay a second call that arrives after the interval has already elapsed', async () => {
    const limiter = new RateLimiter(1000);
    await limiter.acquire();

    await vi.advanceTimersByTimeAsync(1500);

    const before = Date.now();
    await limiter.acquire();
    expect(Date.now() - before).toBe(0);
  });

  it('queues 3 back-to-back callers so each is spaced >= minIntervalMs apart', async () => {
    const limiter = new RateLimiter(1000);
    const timestamps: number[] = [];

    const calls = [1, 2, 3].map(() =>
      limiter.acquire().then(() => {
        timestamps.push(Date.now());
      }),
    );

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(calls);

    expect(timestamps).toHaveLength(3);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(1000);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(1000);
  });
});
