import { describe, it, expect } from 'vitest';
import { buildAvoidSquare } from './exclusionGeometry.js';

/** Haversine distance in meters, only used to check the test fixture. */
function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

describe('buildAvoidSquare', () => {
  it('returns a closed ring (first point === last point)', () => {
    const ring = buildAvoidSquare({ lat: 48.2, lon: 9.3 });
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });

  it('each corner is ~200 m from the center (within 1% tolerance) for the default radius', () => {
    const center = { lat: 48.2, lon: 9.3 };
    const ring = buildAvoidSquare(center);
    for (const corner of ring.slice(0, 4)) {
      const d = haversine(center, corner);
      expect(d).toBeGreaterThan(200 * 0.99);
      expect(d).toBeLessThan(283 * 1.01); // corner-to-center is radius*sqrt(2)
    }
  });

  it('honors a custom radius', () => {
    const center = { lat: 0, lon: 0 };
    const ring = buildAvoidSquare(center, 500);
    const d = haversine(center, ring[0]);
    expect(d).toBeGreaterThan(500 * 0.99);
    expect(d).toBeLessThan(707 * 1.01);
  });

  it('produces a proper rectangle: north corners share latitude, east corners share longitude', () => {
    const center = { lat: 48.2, lon: 9.3 };
    const [nw, ne, se, sw] = buildAvoidSquare(center);
    expect(nw.lat).toBeCloseTo(ne.lat, 10);
    expect(sw.lat).toBeCloseTo(se.lat, 10);
    expect(nw.lon).toBeCloseTo(sw.lon, 10);
    expect(ne.lon).toBeCloseTo(se.lon, 10);
    expect(nw.lat).toBeGreaterThan(sw.lat);
    expect(ne.lon).toBeGreaterThan(nw.lon);
  });

  it('is centered on the input point', () => {
    const center = { lat: 10, lon: 20 };
    const [nw, ne, , sw] = buildAvoidSquare(center);
    expect((nw.lat + sw.lat) / 2).toBeCloseTo(center.lat, 6);
    expect((nw.lon + ne.lon) / 2).toBeCloseTo(center.lon, 6);
  });
});
