import { describe, it, expect } from 'vitest';
import { haversineMeters, totalDistanceMeters } from './distance.js';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters({ lat: 47.4, lon: 9.6 }, { lat: 47.4, lon: 9.6 })).toBe(0);
  });

  it('matches a known reference distance (roughly, within 1%)', () => {
    // 1 degree of latitude is ~111.32 km, independent of longitude.
    const a = { lat: 47.0, lon: 9.5 };
    const b = { lat: 48.0, lon: 9.5 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(111_320 * 0.99);
    expect(d).toBeLessThan(111_320 * 1.01);
  });

  it('is symmetric', () => {
    const a = { lat: 47.41, lon: 9.51 };
    const b = { lat: 47.52, lon: 9.72 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 9);
  });
});

describe('totalDistanceMeters', () => {
  it('sums consecutive points within one segment', () => {
    const seg = [
      { lat: 47.0, lon: 9.5 },
      { lat: 47.0, lon: 9.51 },
      { lat: 47.0, lon: 9.52 },
    ];
    const expected = haversineMeters(seg[0], seg[1]) + haversineMeters(seg[1], seg[2]);
    expect(totalDistanceMeters([seg])).toBeCloseTo(expected, 6);
  });

  it('NEVER bridges the gap between two segments (the GPS-loss rule)', () => {
    const segA = [
      { lat: 47.0, lon: 9.5 },
      { lat: 47.0, lon: 9.51 },
    ];
    // segB starts FAR from where segA ended -- if the implementation ever
    // summed across the segment boundary, this huge jump would dominate the
    // total. It must not.
    const segB = [
      { lat: 50.0, lon: 12.0 },
      { lat: 50.0, lon: 12.01 },
    ];
    const withinSegmentOnly = haversineMeters(segA[0], segA[1]) + haversineMeters(segB[0], segB[1]);
    expect(totalDistanceMeters([segA, segB])).toBeCloseTo(withinSegmentOnly, 6);
  });

  it('ignores single-point (or empty) segments -- no distance to sum', () => {
    expect(totalDistanceMeters([[{ lat: 1, lon: 1 }], []])).toBe(0);
  });

  it('returns 0 for no segments at all', () => {
    expect(totalDistanceMeters([])).toBe(0);
  });
});
