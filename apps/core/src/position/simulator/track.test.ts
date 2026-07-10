/**
 * Unit tests for track.ts: building tracks from GPX (with/without <time>)
 * and from polyline6+profile, sampling interpolation correctness
 * (distance/time -> speed, heading), and the detour mutation's geometry.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseGpxTrackPoints } from './gpx.js';
import { bearingDeg, haversineDistanceM } from './geo.js';
import {
  applyDetour,
  buildTrackFromGpx,
  buildTrackFromPolyline,
  sampleTrack,
  DEFAULT_FALLBACK_SPEED_MS,
} from './track.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('buildTrackFromGpx - respects <time> when present', () => {
  const gpxPoints = parseGpxTrackPoints(readFixture('city.gpx'));
  const track = buildTrackFromGpx(gpxPoints);

  it('derives total duration from the first/last timestamps', () => {
    const expectedS =
      (Date.parse(gpxPoints[gpxPoints.length - 1].time as string) - Date.parse(gpxPoints[0].time as string)) / 1000;
    expect(track.totalDurationS).toBeCloseTo(expectedS, 3);
  });

  it('derives total distance via haversine, matching the sum of segment distances (±1%)', () => {
    let expected = 0;
    for (let i = 1; i < gpxPoints.length; i++) {
      expected += haversineDistanceM(gpxPoints[i - 1], gpxPoints[i]);
    }
    expect(Math.abs(track.totalDistanceM - expected) / expected).toBeLessThan(0.01);
    // Sanity: matches the ~590m the fixture was generated with.
    expect(track.totalDistanceM).toBeGreaterThan(580);
    expect(track.totalDistanceM).toBeLessThan(600);
  });
});

describe('sampleTrack - interpolation correctness (city.gpx)', () => {
  const gpxPoints = parseGpxTrackPoints(readFixture('city.gpx'));
  const track = buildTrackFromGpx(gpxPoints);

  it('returns the exact first point at t=0', () => {
    const sample = sampleTrack(track, 0);
    expect(sample).not.toBeNull();
    expect(sample?.lat).toBeCloseTo(gpxPoints[0].lat, 9);
    expect(sample?.lon).toBeCloseTo(gpxPoints[0].lon, 9);
  });

  it('reports plausible speed (m/s) on the first (due-east, 8 m/s) segment, within 5%', () => {
    // First segment spans t in [0, 18.75)s at a constant 8 m/s (fixture
    // generation parameters, see city.gpx's header comment).
    const sample = sampleTrack(track, 5);
    expect(sample).not.toBeNull();
    expect(Math.abs((sample?.speedMs ?? 0) - 8) / 8).toBeLessThan(0.05);
  });

  it('reports heading within 15 degrees of the true segment bearing on a straight segment', () => {
    const a = gpxPoints[0];
    const b = gpxPoints[1];
    const trueBearing = bearingDeg(a, b);
    const sample = sampleTrack(track, 5);
    expect(sample).not.toBeNull();
    const diff = Math.abs(((sample!.headingDeg - trueBearing + 540) % 360) - 180);
    expect(diff).toBeLessThan(15);
  });

  it('interpolates position at the segment midpoint (linear along the segment)', () => {
    // First segment duration ~18.75s; sample at half that.
    const segDurationS = track.points[1].cumTimeS - track.points[0].cumTimeS;
    const sample = sampleTrack(track, segDurationS / 2);
    expect(sample).not.toBeNull();
    const expectedLon = (gpxPoints[0].lon + gpxPoints[1].lon) / 2;
    expect(sample?.lon).toBeCloseTo(expectedLon, 5);
    expect(sample?.lat).toBeCloseTo(gpxPoints[0].lat, 5); // due-east leg: lat unchanged
  });

  it('returns null once past the end of the track', () => {
    expect(sampleTrack(track, track.totalDurationS + 1)).toBeNull();
  });

  it('returns the last point exactly at t=totalDurationS', () => {
    const sample = sampleTrack(track, track.totalDurationS);
    expect(sample).not.toBeNull();
    const last = gpxPoints[gpxPoints.length - 1];
    expect(sample?.lat).toBeCloseTo(last.lat, 6);
    expect(sample?.lon).toBeCloseTo(last.lon, 6);
  });
});

describe('buildTrackFromGpx - falls back to target speed when no <time> is present', () => {
  it('derives duration from distance/fallbackSpeedMs', () => {
    const gpxPoints = parseGpxTrackPoints(
      `<gpx><trk><trkseg><trkpt lat="49.45" lon="11.08"/><trkpt lat="49.46" lon="11.08"/></trkseg></trk></gpx>`,
    );
    const track = buildTrackFromGpx(gpxPoints, { fallbackSpeedMs: 10 });
    const expectedDurationS = track.totalDistanceM / 10;
    expect(track.totalDurationS).toBeCloseTo(expectedDurationS, 6);
  });

  it('uses DEFAULT_FALLBACK_SPEED_MS when no fallbackSpeedMs is given', () => {
    const gpxPoints = parseGpxTrackPoints(
      `<gpx><trk><trkseg><trkpt lat="49.45" lon="11.08"/><trkpt lat="49.46" lon="11.08"/></trkseg></trk></gpx>`,
    );
    const track = buildTrackFromGpx(gpxPoints);
    expect(track.totalDurationS).toBeCloseTo(track.totalDistanceM / DEFAULT_FALLBACK_SPEED_MS, 6);
  });
});

describe('buildTrackFromPolyline', () => {
  const waypoints = [
    { lat: 49.45, lon: 11.08 },
    { lat: 49.46, lon: 11.09 },
    { lat: 49.47, lon: 11.1 },
  ];

  it('applies a constant speed profile to every segment', () => {
    const track = buildTrackFromPolyline(waypoints, { kind: 'constant', speedMs: 20 });
    const seg0 = track.points[1].cumDistanceM - track.points[0].cumDistanceM;
    const seg1 = track.points[2].cumDistanceM - track.points[1].cumDistanceM;
    expect(track.points[1].cumTimeS).toBeCloseTo(seg0 / 20, 6);
    expect(track.totalDurationS).toBeCloseTo((seg0 + seg1) / 20, 6);
  });

  it('applies a per-segment speed list', () => {
    const track = buildTrackFromPolyline(waypoints, { kind: 'list', speedsMs: [10, 30] });
    const seg0 = track.points[1].cumDistanceM - track.points[0].cumDistanceM;
    const seg1 = track.points[2].cumDistanceM - track.points[1].cumDistanceM;
    expect(track.points[1].cumTimeS).toBeCloseTo(seg0 / 10, 6);
    expect(track.totalDurationS).toBeCloseTo(seg0 / 10 + seg1 / 30, 6);
  });

  it('throws when the speed list length does not match segment count', () => {
    expect(() => buildTrackFromPolyline(waypoints, { kind: 'list', speedsMs: [10] })).toThrow();
  });
});

describe('applyDetour', () => {
  const gpxPoints = parseGpxTrackPoints(readFixture('city.gpx'));
  const originalTrack = buildTrackFromGpx(gpxPoints);

  it('keeps the track identical up to and including atIndex', () => {
    const detoured = applyDetour(originalTrack, 2);
    for (let i = 0; i <= 2; i++) {
      expect(detoured.points[i]).toEqual(originalTrack.points[i]);
    }
  });

  it('diverges from the original path by roughly detourDistanceM after the turn', () => {
    const detoured = applyDetour(originalTrack, 2, 300);
    const detourEnd = detoured.points[detoured.points.length - 1];
    // Compare against where the *original* track would have been at the
    // same elapsed simulated time -- the whole point of a detour mutation
    // is that it's no longer near the original route.
    const originalAtSameTime = sampleTrack(originalTrack, detourEnd.cumTimeS);
    const distanceFromOriginalPath = originalAtSameTime
      ? haversineDistanceM(detourEnd, originalAtSameTime)
      : haversineDistanceM(detourEnd, originalTrack.points[originalTrack.points.length - 1]);
    expect(distanceFromOriginalPath).toBeGreaterThan(200);
  });

  it('turns off the original heading by 90 degrees at the detour point', () => {
    const originalHeading = bearingDeg(originalTrack.points[2], originalTrack.points[3]);
    const detoured = applyDetour(originalTrack, 2, 300);
    const newHeading = bearingDeg(detoured.points[2], detoured.points[3]);
    const diff = Math.abs(((newHeading - (originalHeading + 90) + 540) % 360) - 180);
    expect(diff).toBeLessThan(1);
  });

  it('rejects an out-of-range at_index', () => {
    expect(() => applyDetour(originalTrack, -1)).toThrow();
    expect(() => applyDetour(originalTrack, originalTrack.points.length - 1)).toThrow();
  });
});
