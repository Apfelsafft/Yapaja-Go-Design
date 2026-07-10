/**
 * Unit tests for polyline6 encode/decode against hand-derived reference
 * strings (Google Encoded Polyline Algorithm Format, precision factor 1e6),
 * plus an encode<->decode round-trip check.
 *
 * Reference derivation for "AA" (single point, delta from origin (0,0)):
 *  - scaled delta lat = round(0.000001 * 1e6) = 1
 *  - signed-encode(1): value = 1<<1 = 2; 2 < 0x20 -> emit chr(2+63) = chr(65) = 'A'
 *  - same for lon -> 'A'
 *  => "AA" decodes to [{lat: 0.000001, lon: 0.000001}]
 *
 * Reference derivation for "AAA@" (two points, second point's lon delta -1):
 *  - point 2 lat delta = +1 -> 'A' (as above)
 *  - point 2 lon delta = -1: value = ~(-1<<1) = ~(-2) = 1; 1 < 0x20 ->
 *    emit chr(1+63) = chr(64) = '@'
 *  => "AAA@" decodes to [{lat:0.000001, lon:0.000001}, {lat:0.000002, lon:0}]
 */

import { describe, it, expect } from 'vitest';
import { decodePolyline6, encodePolyline6 } from './polyline.js';

describe('decodePolyline6', () => {
  it('decodes a single-point reference string', () => {
    const points = decodePolyline6('AA');
    expect(points).toEqual([{ lat: 0.000001, lon: 0.000001 }]);
  });

  it('decodes a two-point reference string with a negative delta', () => {
    const points = decodePolyline6('AAA@');
    expect(points).toEqual([
      { lat: 0.000001, lon: 0.000001 },
      { lat: 0.000002, lon: 0 },
    ]);
  });

  it('decodes an empty string to an empty list', () => {
    expect(decodePolyline6('')).toEqual([]);
  });
});

describe('encodePolyline6 / decodePolyline6 round trip', () => {
  it('round-trips a realistic short track within fixture bounds', () => {
    const original = [
      { lat: 49.45, lon: 11.08 },
      { lat: 49.451079, lon: 11.082075 },
      { lat: 49.449910, lon: 11.083458 },
      { lat: 49.6, lon: 11.3 },
    ];
    const encoded = encodePolyline6(original);
    const decoded = decodePolyline6(encoded);
    expect(decoded.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i].lat).toBeCloseTo(original[i].lat, 6);
      expect(decoded[i].lon).toBeCloseTo(original[i].lon, 6);
    }
  });

  it('round-trips negative coordinates', () => {
    const original = [
      { lat: -33.8688, lon: 151.2093 },
      { lat: -33.87, lon: -151.21 },
    ];
    const encoded = encodePolyline6(original);
    const decoded = decodePolyline6(encoded);
    for (let i = 0; i < original.length; i++) {
      expect(decoded[i].lat).toBeCloseTo(original[i].lat, 6);
      expect(decoded[i].lon).toBeCloseTo(original[i].lon, 6);
    }
  });
});
