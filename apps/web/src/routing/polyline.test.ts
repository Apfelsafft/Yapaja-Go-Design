/**
 * Unit tests for the web-side polyline6 decoder (E03-T3).
 *
 * The fixture string was generated with the SAME algorithm as the core's
 * encoder (`apps/core/src/routing/polyline.ts` `encodePolyline6`) against a
 * fixed set of known coordinates, so decoding it back and comparing against
 * those coordinates is a genuine round-trip check of the bit-twiddling, not
 * a tautology against this module's own code.
 */

import { describe, it, expect } from 'vitest';
import { decodePolyline6 } from './polyline.js';

// Known fixture: 4 points (lat, lon), encoded via the core's
// `encodePolyline6` (1e6 precision factor).
const FIXTURE_ENCODED = '_cvm|A_gu_O_dIw_WwvIg~X~lV_rG';
const FIXTURE_POINTS_LATLON: Array<{ lat: number; lon: number }> = [
  { lat: 49.0, lon: 8.4 },
  { lat: 49.0052, lon: 8.4123 },
  { lat: 49.0107, lon: 8.4256 },
  { lat: 48.9987, lon: 8.43 },
];

describe('decodePolyline6', () => {
  it('decodes a known fixture to [lon, lat] pairs within 1e-6', () => {
    const decoded = decodePolyline6(FIXTURE_ENCODED);

    expect(decoded).toHaveLength(FIXTURE_POINTS_LATLON.length);
    decoded.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(FIXTURE_POINTS_LATLON[i].lon, 6);
      expect(lat).toBeCloseTo(FIXTURE_POINTS_LATLON[i].lat, 6);
    });
  });

  it('returns coordinates in [lon, lat] (GeoJSON) order, not [lat, lon]', () => {
    const [[lon, lat]] = decodePolyline6(FIXTURE_ENCODED);
    // lon (~8.4) and lat (~49.0) are far enough apart that a swapped-order
    // bug would fail this immediately.
    expect(lon).toBeCloseTo(8.4, 6);
    expect(lat).toBeCloseTo(49.0, 6);
  });

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline6('')).toEqual([]);
  });

  it('decodes a single-point polyline (no delta accumulation needed)', () => {
    // Encodes {lat: 0, lon: 0} -> both deltas are 0 -> "??" (63,63 -> value 0).
    const decoded = decodePolyline6('??');
    expect(decoded).toEqual([[0, 0]]);
  });
});
