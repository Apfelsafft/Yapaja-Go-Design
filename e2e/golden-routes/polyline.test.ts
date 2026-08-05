/**
 * Round-trip tests for the polyline6 codec (E10-T3 added the encoder).
 *
 * The DECODER is safety-critical — every restriction assertion decodes the
 * Core's geometry before testing it against the forbidden box — so the
 * encoder added for the stub router must be provably its exact inverse.
 * Otherwise the runbook smoke test could "prove" a gate works against
 * geometry the real suite would read differently.
 */

import { describe, it, expect } from 'vitest';
import { decodePolyline6, encodePolyline6, type LonLat } from './polyline.js';

function roundTrip(coords: LonLat[]): LonLat[] {
  return decodePolyline6(encodePolyline6(coords));
}

function expectClose(actual: LonLat[], expected: LonLat[]): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i][0]).toBeCloseTo(expected[i][0], 6);
    expect(actual[i][1]).toBeCloseTo(expected[i][1], 6);
  }
}

describe('encodePolyline6 / decodePolyline6', () => {
  it('round-trips a simple ascending track', () => {
    const coords: LonLat[] = [
      [11.0, 48.0],
      [11.002, 48.0],
      [11.004, 48.001],
      [11.01, 48.0],
    ];
    expectClose(roundTrip(coords), coords);
  });

  it('round-trips negative and mixed-sign coordinates', () => {
    const coords: LonLat[] = [
      [-8.4, -49.0],
      [-8.401, 49.0],
      [8.4, -49.0001],
    ];
    expectClose(roundTrip(coords), coords);
  });

  it('round-trips the LI corridor coordinates the suite actually uses', () => {
    const coords: LonLat[] = [
      [9.5209, 47.141],
      [9.5175, 47.1495],
      [9.5093, 47.1665],
    ];
    expectClose(roundTrip(coords), coords);
  });

  it('handles the degenerate cases', () => {
    expect(encodePolyline6([])).toBe('');
    expect(decodePolyline6('')).toEqual([]);
    expectClose(roundTrip([[9.5, 47.1]]), [[9.5, 47.1]]);
  });

  it('decodes the pre-existing fixture unchanged (encoder did not disturb the decoder)', () => {
    const coords = decodePolyline6('_cvm|A_gu_O_dIw_WwvIg~X~lV_rG');
    expect(coords.length).toBe(4);
    expect(coords[0][0]).toBeCloseTo(8.4, 3);
    expect(coords[0][1]).toBeCloseTo(49.0, 3);
  });
});
