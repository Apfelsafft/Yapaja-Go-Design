/**
 * Unit tests for mutations.ts: outage windowing, seeded gaussian noise, and
 * one-shot jump displacement.
 */

import { describe, it, expect } from 'vitest';
import { haversineDistanceM } from './geo.js';
import { mulberry32 } from './rng.js';
import { applyGaussianNoise, applyJumpOffset, isWithinOutage } from './mutations.js';

describe('isWithinOutage', () => {
  it('is false when no outage is configured', () => {
    expect(isWithinOutage(5, undefined)).toBe(false);
  });

  it('is true for t within [at_s, at_s + duration_s)', () => {
    const outage = { at_s: 10, duration_s: 5 };
    expect(isWithinOutage(9.999, outage)).toBe(false);
    expect(isWithinOutage(10, outage)).toBe(true);
    expect(isWithinOutage(14.999, outage)).toBe(true);
    expect(isWithinOutage(15, outage)).toBe(false);
  });
});

describe('applyGaussianNoise', () => {
  const pos = { lat: 49.45, lon: 11.08 };

  it('is deterministic for a given seed', () => {
    const a = applyGaussianNoise(pos, mulberry32(5), 10);
    const b = applyGaussianNoise(pos, mulberry32(5), 10);
    expect(a).toEqual(b);
  });

  it('produces different offsets for different seeds', () => {
    const a = applyGaussianNoise(pos, mulberry32(5), 10);
    const b = applyGaussianNoise(pos, mulberry32(6), 10);
    expect(a).not.toEqual(b);
  });

  it('is a no-op in expectation at 0 std-dev', () => {
    const a = applyGaussianNoise(pos, mulberry32(5), 0);
    expect(a.lat).toBeCloseTo(pos.lat, 12);
    expect(a.lon).toBeCloseTo(pos.lon, 12);
  });

  it('shifts the position by a plausible magnitude (mean displacement scales with noise_m)', () => {
    const n = 500;
    let totalDisplacementSmall = 0;
    let totalDisplacementLarge = 0;
    const rngSmall = mulberry32(11);
    const rngLarge = mulberry32(11);
    for (let i = 0; i < n; i++) {
      totalDisplacementSmall += haversineDistanceM(pos, applyGaussianNoise(pos, rngSmall, 3));
      totalDisplacementLarge += haversineDistanceM(pos, applyGaussianNoise(pos, rngLarge, 30));
    }
    const meanSmall = totalDisplacementSmall / n;
    const meanLarge = totalDisplacementLarge / n;
    expect(meanLarge).toBeGreaterThan(meanSmall * 5); // roughly 10x noise_m -> roughly 10x displacement
  });
});

describe('applyJumpOffset', () => {
  it('displaces the position by ~offset_m meters', () => {
    const pos = { lat: 49.45, lon: 11.08 };
    const jumped = applyJumpOffset(pos, 90, 500);
    const distance = haversineDistanceM(pos, jumped);
    expect(Math.abs(distance - 500) / 500).toBeLessThan(0.01);
  });

  it('offsets perpendicular to the given heading (not further along the direction of travel)', () => {
    const pos = { lat: 49.45, lon: 11.08 };
    const heading = 0; // due north
    const jumped = applyJumpOffset(pos, heading, 500);
    // A perpendicular (east) offset from due-north travel should barely
    // change latitude while changing longitude substantially.
    expect(Math.abs(jumped.lat - pos.lat)).toBeLessThan(0.001);
    expect(Math.abs(jumped.lon - pos.lon)).toBeGreaterThan(0.001);
  });
});
