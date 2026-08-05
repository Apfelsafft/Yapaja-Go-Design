/**
 * Unit tests for the ETA-Plausibilität judgement (`eta.ts`, E10-T3).
 *
 * These run without a Core, a Valhalla or a simulator, so the threshold logic
 * of the nightly ETA case is provable in the normal `pnpm golden-routes` run —
 * exactly the split `bbox.test.ts` uses for the restriction geometry.
 */

import { describe, it, expect } from 'vitest';
import { evaluateEta, expectedWallClockS, type EtaObservation } from './eta.js';

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0);

/** A 1000 s trip promised to end at T0 + 1000 s. */
function obs(overrides: Partial<EtaObservation> = {}): EtaObservation {
  return {
    initialEtaMs: T0 + 1000_000,
    actualArrivalMs: T0 + 1000_000,
    plannedDurationS: 1000,
    ...overrides,
  };
}

describe('evaluateEta', () => {
  it('passes when the arrival lands exactly on the promised ETA', () => {
    const v = evaluateEta(obs(), 0.05);
    expect(v.errorS).toBe(0);
    expect(v.errorFraction).toBe(0);
    expect(v.pass).toBe(true);
  });

  it('normalises the error by the planned duration, not by the timestamp', () => {
    // 40 s late on a 1000 s trip = 4 %, NOT 40 s relative to an epoch value.
    const v = evaluateEta(obs({ actualArrivalMs: T0 + 1040_000 }), 0.05);
    expect(v.errorS).toBeCloseTo(40, 6);
    expect(v.errorFraction).toBeCloseTo(0.04, 6);
    expect(v.pass).toBe(true);
  });

  it('fails when the arrival is more than the budget LATE', () => {
    const v = evaluateEta(obs({ actualArrivalMs: T0 + 1100_000 }), 0.05);
    expect(v.errorFraction).toBeCloseTo(0.1, 6);
    expect(v.pass).toBe(false);
    expect(v.summary).toContain('late');
  });

  it('fails when the arrival is more than the budget EARLY (an over-promise is a defect too)', () => {
    const v = evaluateEta(obs({ actualArrivalMs: T0 + 900_000 }), 0.05);
    expect(v.errorS).toBeCloseTo(-100, 6);
    expect(v.errorFraction).toBeCloseTo(0.1, 6);
    expect(v.pass).toBe(false);
    expect(v.summary).toContain('early');
  });

  it('treats the budget as inclusive at the boundary', () => {
    const v = evaluateEta(obs({ actualArrivalMs: T0 + 1050_000 }), 0.05);
    expect(v.errorFraction).toBeCloseTo(0.05, 9);
    expect(v.pass).toBe(true);
  });

  it('throws on a non-positive planned duration instead of dividing by zero', () => {
    expect(() => evaluateEta(obs({ plannedDurationS: 0 }), 0.05)).toThrow(/plannedDurationS/);
    expect(() => evaluateEta(obs({ plannedDurationS: -5 }), 0.05)).toThrow(/plannedDurationS/);
  });

  it('throws on non-finite observations rather than reporting a verdict', () => {
    expect(() => evaluateEta(obs({ initialEtaMs: Number.NaN }), 0.05)).toThrow(/initialEtaMs/);
    expect(() => evaluateEta(obs({ actualArrivalMs: Number.POSITIVE_INFINITY }), 0.05)).toThrow(
      /actualArrivalMs/,
    );
  });

  it('rejects a non-positive or non-finite budget', () => {
    expect(() => evaluateEta(obs(), 0)).toThrow(/maxErrorFraction/);
    expect(() => evaluateEta(obs(), Number.NaN)).toThrow(/maxErrorFraction/);
  });
});

describe('expectedWallClockS', () => {
  it('is the planned duration plus margin at factor 1.0', () => {
    expect(expectedWallClockS(300, 1.0, 60)).toBe(360);
  });

  it('shrinks with a larger speed factor', () => {
    expect(expectedWallClockS(300, 5, 0)).toBe(60);
  });

  it('rejects nonsensical inputs', () => {
    expect(() => expectedWallClockS(0, 1)).toThrow(/plannedDurationS/);
    expect(() => expectedWallClockS(300, 0)).toThrow(/speedFactor/);
  });
});
