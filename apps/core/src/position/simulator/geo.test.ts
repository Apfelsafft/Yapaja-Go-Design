/**
 * Unit tests for geo.ts: haversine distance, bearing, linear interpolation,
 * destination-point projection.
 */

import { describe, it, expect } from 'vitest';
import { bearingDeg, destinationPoint, haversineDistanceM, interpolateLatLon } from './geo.js';

describe('haversineDistanceM', () => {
  it('matches the classic definition of the meter: pole-to-equator quarter meridian ~= 10,000 km', () => {
    // Historically the meter was defined so that pole-to-equator = 10,000 km
    // exactly (on an idealized sphere/ellipsoid). Our spherical model
    // (R=6371000) gives (pi/2)*R =~ 10,007.5 km -- within 1% of that
    // reference, independent of and not derived from our own haversine code.
    const distance = haversineDistanceM({ lat: 0, lon: 0 }, { lat: 90, lon: 0 });
    const quarterMeridianRef = 10_000_000; // meters
    expect(Math.abs(distance - quarterMeridianRef) / quarterMeridianRef).toBeLessThan(0.01);
  });

  it('is zero for identical points', () => {
    expect(haversineDistanceM({ lat: 49.45, lon: 11.08 }, { lat: 49.45, lon: 11.08 })).toBeCloseTo(0, 6);
  });

  it('is symmetric', () => {
    const a = { lat: 49.45, lon: 11.08 };
    const b = { lat: 49.6, lon: 11.3 };
    expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
  });

  it('round-trips with destinationPoint within 1% (Haversine correctness)', () => {
    const start = { lat: 49.45, lon: 11.08 };
    for (const [bearing, dist] of [
      [0, 500],
      [90, 1200],
      [180, 300],
      [270, 5000],
      [45, 2500],
    ] as const) {
      const dest = destinationPoint(start, bearing, dist);
      const measured = haversineDistanceM(start, dest);
      expect(Math.abs(measured - dist) / dist).toBeLessThan(0.01);
    }
  });
});

describe('bearingDeg', () => {
  it('is 90 degrees for due-east travel along the equator', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 3);
  });

  it('is 0 degrees for due-north travel', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 3);
  });

  it('is 180 degrees for due-south travel', () => {
    expect(bearingDeg({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 3);
  });

  it('is 270 degrees for due-west travel along the equator', () => {
    expect(bearingDeg({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 3);
  });

  it('is always in [0, 360)', () => {
    const a = { lat: 49.45, lon: 11.08 };
    const b = { lat: 49.449, lon: 11.079 };
    const b2 = bearingDeg(a, b);
    expect(b2).toBeGreaterThanOrEqual(0);
    expect(b2).toBeLessThan(360);
  });
});

describe('interpolateLatLon', () => {
  it('returns the start point at f=0 and end point at f=1', () => {
    const a = { lat: 49.45, lon: 11.08 };
    const b = { lat: 49.55, lon: 11.2 };
    expect(interpolateLatLon(a, b, 0)).toEqual(a);
    expect(interpolateLatLon(a, b, 1)).toEqual(b);
  });

  it('returns the exact midpoint at f=0.5', () => {
    const mid = interpolateLatLon({ lat: 0, lon: 0 }, { lat: 2, lon: 4 }, 0.5);
    expect(mid.lat).toBeCloseTo(1, 9);
    expect(mid.lon).toBeCloseTo(2, 9);
  });

  it('clamps f outside [0, 1]', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 10, lon: 10 };
    expect(interpolateLatLon(a, b, -1)).toEqual(a);
    expect(interpolateLatLon(a, b, 2)).toEqual(b);
  });
});

describe('destinationPoint', () => {
  it('projects the intended bearing back out (round trip with bearingDeg)', () => {
    const start = { lat: 49.45, lon: 11.08 };
    for (const bearing of [0, 30, 90, 180, 270, 359]) {
      const dest = destinationPoint(start, bearing, 1000);
      expect(bearingDeg(start, dest)).toBeCloseTo(bearing, 0);
    }
  });

  it('keeps longitude within [-180, 180]', () => {
    const dest = destinationPoint({ lat: 0, lon: 179.9999 }, 90, 50000);
    expect(dest.lon).toBeGreaterThanOrEqual(-180);
    expect(dest.lon).toBeLessThanOrEqual(180);
  });
});
