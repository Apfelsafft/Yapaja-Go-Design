/**
 * Unit tests for rng.ts: mulberry32 determinism and gaussianSample shape.
 */

import { describe, it, expect } from 'vitest';
import { gaussianSample, mulberry32 } from './rng.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const seq1 = Array.from({ length: 10 }, mulberry32(42));
    const seq2 = Array.from({ length: 10 }, mulberry32(42));
    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const seq1 = Array.from({ length: 10 }, mulberry32(1));
    const seq2 = Array.from({ length: 10 }, mulberry32(2));
    expect(seq1).not.toEqual(seq2);
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('gaussianSample', () => {
  it('is deterministic for a deterministic rng (same seed -> same samples)', () => {
    // Two independently seeded rngs, each driving its own gaussianSample
    // sequence -- must be byte-identical for the noise mutation to be
    // reproducible across simulator runs sharing a seed.
    const rng1 = mulberry32(7);
    const rng2 = mulberry32(7);
    const seqA = Array.from({ length: 20 }, () => gaussianSample(rng1));
    const seqB = Array.from({ length: 20 }, () => gaussianSample(rng2));
    expect(seqA).toEqual(seqB);
  });

  it('approximates a standard normal distribution (mean~0, stddev~1) over many samples', () => {
    const rng = mulberry32(99);
    const n = 5000;
    const samples = Array.from({ length: n }, () => gaussianSample(rng));
    const mean = samples.reduce((s, v) => s + v, 0) / n;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(Math.abs(stddev - 1)).toBeLessThan(0.1);
  });
});
