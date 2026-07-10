/**
 * Unit tests for the minimal GPX parser against the three committed
 * fixtures (city, country, tunnel) and a handful of hand-crafted edge cases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { GpxParseError, parseGpxTrackPoints } from './gpx.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8');
}

describe('parseGpxTrackPoints - city.gpx', () => {
  const points = parseGpxTrackPoints(readFixture('city.gpx'));

  it('parses all 6 track points in document order', () => {
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ lat: 49.45, lon: 11.08, ele: 310.0, time: '2026-01-01T08:00:00.000Z' });
    expect(points[5]).toEqual({ lat: 49.44991, lon: 11.082213, ele: 311.0, time: '2026-01-01T08:01:40.607Z' });
  });

  it('has strictly increasing timestamps', () => {
    const times = points.map((p) => Date.parse(p.time as string));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it('all points fall within the PMTiles fixture bounds (lon 5.8..15.1, lat 47.2..55.1)', () => {
    for (const p of points) {
      expect(p.lon).toBeGreaterThanOrEqual(5.8);
      expect(p.lon).toBeLessThanOrEqual(15.1);
      expect(p.lat).toBeGreaterThanOrEqual(47.2);
      expect(p.lat).toBeLessThanOrEqual(55.1);
    }
  });
});

describe('parseGpxTrackPoints - country.gpx', () => {
  const points = parseGpxTrackPoints(readFixture('country.gpx'));

  it('parses all 4 track points', () => {
    expect(points).toHaveLength(4);
    expect(points[0].lat).toBeCloseTo(49.3, 6);
    expect(points[0].lon).toBeCloseTo(10.9, 6);
  });

  it('has decreasing elevation (downhill leg, as authored)', () => {
    expect(points[points.length - 1].ele).toBeLessThan(points[0].ele as number);
  });
});

describe('parseGpxTrackPoints - tunnel.gpx', () => {
  const points = parseGpxTrackPoints(readFixture('tunnel.gpx'));

  it('parses all 6 track points, marking the tunnel section (indices 1..3) via elevation gain', () => {
    expect(points).toHaveLength(6);
    // The tunnel fixture's documented tunnel section is indices 1..3 (see
    // the XML comment in the fixture); elevation still increases smoothly
    // across it since GPX <ele> is authored, not GPS-derived here.
    expect(points[1].ele).toBeLessThan(points[3].ele as number);
  });
});

describe('parseGpxTrackPoints - edge cases', () => {
  it('parses self-closing trkpt tags without ele/time', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="1.0" lon="2.0"/>
      <trkpt lat="1.1" lon="2.1"/>
    </trkseg></trk></gpx>`;
    const points = parseGpxTrackPoints(gpx);
    expect(points).toEqual([
      { lat: 1.0, lon: 2.0, ele: null, time: null },
      { lat: 1.1, lon: 2.1, ele: null, time: null },
    ]);
  });

  it('throws GpxParseError for empty input', () => {
    expect(() => parseGpxTrackPoints('')).toThrow(GpxParseError);
  });

  it('throws GpxParseError when fewer than 2 trkpt are present', () => {
    const gpx = `<gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`;
    expect(() => parseGpxTrackPoints(gpx)).toThrow(GpxParseError);
  });

  it('throws GpxParseError for a trkpt missing lat/lon', () => {
    const gpx = `<gpx><trk><trkseg><trkpt lon="2"/><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`;
    expect(() => parseGpxTrackPoints(gpx)).toThrow(GpxParseError);
  });
});
