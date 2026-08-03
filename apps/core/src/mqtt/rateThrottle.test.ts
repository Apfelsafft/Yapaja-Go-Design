/**
 * Unit tests for the `yapaja/position` publish-rate throttle (E08-T1,
 * mandatory unit test: "Raten-Drossel" / rate-throttle, docs/03 §4 "1 Hz
 * fahrend / 0,1 Hz stehend").
 */
import { describe, it, expect } from 'vitest';
import {
  DRIVING_SPEED_MS,
  PositionPublishThrottle,
  AddonEventRateLimiter,
  ADDON_EVENT_RATE_LIMIT_PER_SECOND,
} from './rateThrottle.js';

describe('PositionPublishThrottle', () => {
  it('publishes the very first call regardless of speed', () => {
    const throttle = new PositionPublishThrottle();
    expect(throttle.shouldPublish(0, 0)).toBe(true);
  });

  describe('driving (speed above DRIVING_SPEED_MS): 1 Hz', () => {
    it('publishes again after 1000ms but not sooner', () => {
      const throttle = new PositionPublishThrottle();
      const speed = DRIVING_SPEED_MS + 5; // clearly "driving"
      expect(throttle.shouldPublish(speed, 0)).toBe(true);
      expect(throttle.shouldPublish(speed, 500)).toBe(false);
      expect(throttle.shouldPublish(speed, 999)).toBe(false);
      expect(throttle.shouldPublish(speed, 1000)).toBe(true);
    });

    it('keeps publishing at 1 Hz across many ticks', () => {
      const throttle = new PositionPublishThrottle();
      const speed = 20; // ~72 km/h, clearly driving
      const published: number[] = [];
      for (let t = 0; t <= 5000; t += 250) {
        if (throttle.shouldPublish(speed, t)) published.push(t);
      }
      expect(published).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    });
  });

  describe('stopped (speed at/below DRIVING_SPEED_MS): 0.1 Hz', () => {
    it('does not publish again before 10000ms', () => {
      const throttle = new PositionPublishThrottle();
      expect(throttle.shouldPublish(0, 0)).toBe(true);
      expect(throttle.shouldPublish(0, 1000)).toBe(false); // would be fine while driving, not while stopped
      expect(throttle.shouldPublish(0, 9999)).toBe(false);
      expect(throttle.shouldPublish(0, 10_000)).toBe(true);
    });

    it('speed exactly at the DRIVING_SPEED_MS boundary counts as stopped', () => {
      const throttle = new PositionPublishThrottle();
      expect(throttle.shouldPublish(DRIVING_SPEED_MS, 0)).toBe(true);
      expect(throttle.shouldPublish(DRIVING_SPEED_MS, 1000)).toBe(false);
    });

    it('null (unknown) speed is treated as stopped -- the conservative choice', () => {
      const throttle = new PositionPublishThrottle();
      expect(throttle.shouldPublish(null, 0)).toBe(true);
      expect(throttle.shouldPublish(null, 1000)).toBe(false);
      expect(throttle.shouldPublish(null, 10_000)).toBe(true);
    });
  });

  it('switching from driving to stopped mid-stream re-throttles at the slower rate', () => {
    const throttle = new PositionPublishThrottle();
    expect(throttle.shouldPublish(10, 0)).toBe(true); // driving, publishes
    // Vehicle just stopped; only 1000ms elapsed since the last publish -- the
    // NEW (stopped) 10s interval applies to this decision and hasn't elapsed yet.
    expect(throttle.shouldPublish(0, 1000)).toBe(false);
    expect(throttle.shouldPublish(0, 9999)).toBe(false);
    expect(throttle.shouldPublish(0, 10_000)).toBe(true);
  });

  it('reset() clears the throttle so the next call always publishes', () => {
    const throttle = new PositionPublishThrottle();
    expect(throttle.shouldPublish(0, 0)).toBe(true);
    expect(throttle.shouldPublish(0, 1)).toBe(false);
    throttle.reset();
    expect(throttle.shouldPublish(0, 2)).toBe(true);
  });
});

/**
 * `AddonEventRateLimiter` unit tests (E09-T8, mandatory "Limit-Unit" test,
 * docs/05 §2 "5 msg/s pro Add-on"). The end-to-end "the rate limit
 * demonstrably bites, wired through the real MqttBridge + a real broker" is
 * separately proven in `addonEvents.integration.test.ts`; this file only
 * exercises the pure counting logic in isolation.
 */
describe('AddonEventRateLimiter', () => {
  it(`allows exactly ${ADDON_EVENT_RATE_LIMIT_PER_SECOND} publishes per second, refuses the rest`, () => {
    const limiter = new AddonEventRateLimiter();
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push(limiter.allow('addon-a', 0));
    expect(results).toEqual([true, true, true, true, true, false, false, false]);
  });

  it('resets the budget once the 1000ms window elapses', () => {
    const limiter = new AddonEventRateLimiter();
    for (let i = 0; i < ADDON_EVENT_RATE_LIMIT_PER_SECOND; i++) {
      expect(limiter.allow('addon-a', 100)).toBe(true);
    }
    expect(limiter.allow('addon-a', 200)).toBe(false); // still inside the same window
    expect(limiter.allow('addon-a', 1099)).toBe(false); // 999ms after the window opened at 100
    expect(limiter.allow('addon-a', 1100)).toBe(true); // a fresh window opens here
  });

  it('gives every add-on its OWN independent budget -- a flooding add-on cannot starve another', () => {
    const limiter = new AddonEventRateLimiter();
    for (let i = 0; i < ADDON_EVENT_RATE_LIMIT_PER_SECOND; i++) {
      expect(limiter.allow('chatty-addon', 0)).toBe(true);
    }
    // `chatty-addon`'s budget is exhausted for this window...
    expect(limiter.allow('chatty-addon', 10)).toBe(false);
    // ...but `quiet-addon` is completely unaffected, same window, same instant.
    expect(limiter.allow('quiet-addon', 10)).toBe(true);
  });

  it('reset() clears every add-on window', () => {
    const limiter = new AddonEventRateLimiter();
    for (let i = 0; i < ADDON_EVENT_RATE_LIMIT_PER_SECOND; i++) limiter.allow('addon-a', 0);
    expect(limiter.allow('addon-a', 10)).toBe(false);
    limiter.reset();
    expect(limiter.allow('addon-a', 20)).toBe(true);
  });
});
