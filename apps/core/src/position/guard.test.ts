/**
 * Unit tests for PlausibilityGuard (docs/07-testing-qa.md §3a, wargame W-02).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Position } from '@yapaja/shared';
import { PlausibilityGuard } from './guard.js';

const BASE_TS = Date.parse('2026-07-10T10:00:00.000Z');

function tsAt(offsetS: number): string {
  return new Date(BASE_TS + offsetS * 1000).toISOString();
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    lat: 52.5,
    lon: 13.4,
    alt: 34,
    speed: 10,
    heading: 90,
    accuracy: 5,
    source: 'gpsd',
    fix: '3d',
    ts: tsAt(0),
    ...overrides,
  };
}

/** ~0.111 deg longitude at this latitude is roughly 7.5 km -- plenty to trip
 * the 300 m/s jump threshold over a short elapsed time. */
const FAR_LON = 13.4 + 0.5;

describe('PlausibilityGuard', () => {
  let guard: PlausibilityGuard;

  beforeEach(() => {
    guard = new PlausibilityGuard();
  });

  it('accepts the first fix unconditionally (no baseline to compare against)', () => {
    const result = guard.evaluate(makePosition());
    expect(result.accept).toBe(true);
    expect(result.position).toEqual(makePosition());
  });

  it('rejects fix:"none" and never touches jump-streak state', () => {
    const result = guard.evaluate(makePosition({ fix: 'none' }));
    expect(result.accept).toBe(false);
    expect(result.reason).toBe('no_fix');
  });

  describe('value-range violations (via checkPosition)', () => {
    it('rejects speed >= 250 km/h (69.44 m/s)', () => {
      const result = guard.evaluate(makePosition({ speed: 70 })); // 252 km/h
      expect(result.accept).toBe(false);
      expect(result.reason).toMatch(/^range_violation/);
    });

    it('accepts speed just under 250 km/h', () => {
      const result = guard.evaluate(makePosition({ speed: 69 })); // 248.4 km/h
      expect(result.accept).toBe(true);
    });

    it('rejects altitude at/over the 4900 m boundary', () => {
      const result = guard.evaluate(makePosition({ alt: 4900 }));
      expect(result.accept).toBe(false);
    });

    it('rejects altitude at/under the -450 m boundary', () => {
      const result = guard.evaluate(makePosition({ alt: -450 }));
      expect(result.accept).toBe(false);
    });

    it('accepts altitude just inside the (-450, 4900) range', () => {
      expect(guard.evaluate(makePosition({ alt: 4899 })).accept).toBe(true);
      expect(guard.evaluate(makePosition({ alt: -449 })).accept).toBe(true);
    });
  });

  describe('accuracy marking (not a rejection rule)', () => {
    it('accepts accuracy > 100 m but flags it "inaccurate"', () => {
      const result = guard.evaluate(makePosition({ accuracy: 150 }));
      expect(result.accept).toBe(true);
      expect(result.position?.accuracy).toBe(150);
      expect(result.reason).toBe('inaccurate');
    });

    it('does not flag accuracy exactly at 100 m', () => {
      const result = guard.evaluate(makePosition({ accuracy: 100 }));
      expect(result.accept).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('does not flag a normal accuracy value', () => {
      const result = guard.evaluate(makePosition({ accuracy: 5 }));
      expect(result.accept).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('jump detection (implied speed > 300 m/s between accepted fixes)', () => {
    it('rejects a fix implying > 300 m/s from the last accepted fix', () => {
      guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      // ~7.5 km away, 1 second later -> ~7500 m/s implied speed.
      const jump = guard.evaluate(makePosition({ lat: 52.5, lon: FAR_LON, ts: tsAt(1) }));
      expect(jump.accept).toBe(false);
      expect(jump.reason).toBe('jump');
    });

    it('accepts a fix implying a plausible speed (well under 300 m/s)', () => {
      guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      // ~10 m/s * 10 s = ~100 m -- far below the jump threshold.
      const next = guard.evaluate(makePosition({ lat: 52.5009, lon: 13.4, ts: tsAt(10) }));
      expect(next.accept).toBe(true);
    });

    it('rejects up to 3 consecutive jumps, then accepts the 4th as the new baseline (W-02)', () => {
      const baseline = guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      expect(baseline.accept).toBe(true);

      const jumpFix = (offsetS: number): Position =>
        makePosition({ lat: 52.5, lon: FAR_LON, ts: tsAt(offsetS) });

      const r1 = guard.evaluate(jumpFix(1));
      const r2 = guard.evaluate(jumpFix(2));
      const r3 = guard.evaluate(jumpFix(3));
      expect([r1.accept, r2.accept, r3.accept]).toEqual([false, false, false]);
      expect([r1.reason, r2.reason, r3.reason]).toEqual(['jump', 'jump', 'jump']);

      const r4 = guard.evaluate(jumpFix(4));
      expect(r4.accept).toBe(true);
      expect(r4.position?.lon).toBe(FAR_LON);
    });

    it('resets the jump-reject streak after any accepted fix', () => {
      guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      const jumpFix = (offsetS: number): Position =>
        makePosition({ lat: 52.5, lon: FAR_LON, ts: tsAt(offsetS) });

      expect(guard.evaluate(jumpFix(1)).accept).toBe(false);
      expect(guard.evaluate(jumpFix(2)).accept).toBe(false);
      // Plausible fix near the original baseline resets the streak.
      expect(guard.evaluate(makePosition({ lat: 52.5001, lon: 13.4, ts: tsAt(3) })).accept).toBe(
        true,
      );

      // A subsequent jump must again go through its own 3-strike sequence,
      // not immediately be accepted as if the earlier streak still counted.
      const r1 = guard.evaluate(jumpFix(4));
      const r2 = guard.evaluate(jumpFix(5));
      const r3 = guard.evaluate(jumpFix(6));
      expect([r1.accept, r2.accept, r3.accept]).toEqual([false, false, false]);
      expect(guard.evaluate(jumpFix(7)).accept).toBe(true);
    });

    it('reset() clears the baseline so the next fix is unconditionally accepted', () => {
      guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      guard.reset();
      const jump = guard.evaluate(makePosition({ lat: 52.5, lon: FAR_LON, ts: tsAt(1) }));
      expect(jump.accept).toBe(true);
    });

    it('does not evaluate a jump when elapsed time is non-positive (duplicate/out-of-order ts)', () => {
      guard.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(5) }));
      const result = guard.evaluate(makePosition({ lat: 52.5, lon: FAR_LON, ts: tsAt(5) }));
      expect(result.accept).toBe(true);
    });

    it('honors a custom jumpSpeedThresholdMs / maxConsecutiveJumpRejects', () => {
      const strict = new PlausibilityGuard({ jumpSpeedThresholdMs: 5, maxConsecutiveJumpRejects: 1 });
      strict.evaluate(makePosition({ lat: 52.5, lon: 13.4, ts: tsAt(0) }));
      // ~55 m in 1s = 55 m/s > 5 m/s threshold.
      const r1 = strict.evaluate(makePosition({ lat: 52.5005, lon: 13.4, ts: tsAt(1) }));
      expect(r1.accept).toBe(false);
      // Second consecutive "jump" (relative to the still-unmoved baseline) must be accepted (cap=1).
      const r2 = strict.evaluate(makePosition({ lat: 52.5005, lon: 13.4, ts: tsAt(2) }));
      expect(r2.accept).toBe(true);
    });
  });
});
