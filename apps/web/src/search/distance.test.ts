import { describe, it, expect } from 'vitest';
import { haversineMeters } from './distance.js';

// 1 degree of arc along ANY great circle on a sphere of radius R is exactly
// R * (pi/180) meters -- this holds for a meridian (moving in latitude, any
// longitude) AND for the equator (moving in longitude at lat=0), since both
// are great circles. That gives an exact, closed-form reference value to
// check the Haversine implementation against, rather than an approximate
// real-world city-to-city distance.
const EARTH_RADIUS_M = 6_371_000;
const ONE_DEGREE_ARC_M = EARTH_RADIUS_M * (Math.PI / 180);

function withinOnePercent(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) / expected < 0.01;
}

describe('haversineMeters', () => {
  it('is 0 for identical points', () => {
    expect(haversineMeters({ lat: 47.141, lon: 9.5215 }, { lat: 47.141, lon: 9.5215 })).toBe(0);
  });

  it('matches the exact meridian arc length for a 1 degree latitude change (±1%)', () => {
    const d = haversineMeters({ lat: 10, lon: 20 }, { lat: 11, lon: 20 });
    expect(withinOnePercent(d, ONE_DEGREE_ARC_M)).toBe(true);
  });

  it('matches the exact equatorial arc length for a 1 degree longitude change at the equator (±1%)', () => {
    const d = haversineMeters({ lat: 0, lon: 20 }, { lat: 0, lon: 21 });
    expect(withinOnePercent(d, ONE_DEGREE_ARC_M)).toBe(true);
  });

  it('is symmetric (from->to === to->from)', () => {
    const a = { lat: 47.141, lon: 9.5215 };
    const b = { lat: 48.8566, lon: 2.3522 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('matches a known real-world distance within ±1% (Vaduz -> Bern, ~158.6 km great-circle)', () => {
    const vaduz = { lat: 47.141, lon: 9.5215 };
    const bern = { lat: 46.948, lon: 7.4474 };
    const d = haversineMeters(vaduz, bern);
    expect(withinOnePercent(d, 158_611)).toBe(true);
  });
});
