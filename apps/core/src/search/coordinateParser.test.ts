/**
 * Coordinate-parser table test (E05-T1 Pflicht-Test: >= 12 cases).
 * Covers decimal (comma/space separators), DMS with/without seconds,
 * N/S/E/W, swap-detection, and invalid inputs.
 */
import { describe, it, expect } from 'vitest';
import { parseCoordinates } from './coordinateParser.js';

const CLOSE = 1e-4;

describe('parseCoordinates', () => {
  const table: Array<{
    name: string;
    input: string;
    expectLat?: number;
    expectLon?: number;
    expectSwapped?: boolean;
    expectNull?: boolean;
  }> = [
    { name: 'decimal, comma+space', input: '47.14, 9.52', expectLat: 47.14, expectLon: 9.52 },
    { name: 'decimal, space only', input: '47.14 9.52', expectLat: 47.14, expectLon: 9.52 },
    { name: 'decimal, comma no space', input: '47.14,9.52', expectLat: 47.14, expectLon: 9.52 },
    {
      name: 'decimal, extra whitespace padding',
      input: '  47.14 ,  9.52  ',
      expectLat: 47.14,
      expectLon: 9.52,
    },
    { name: 'decimal, negative lat (southern hemisphere)', input: '-47.14, 9.52', expectLat: -47.14, expectLon: 9.52 },
    {
      name: 'DMS with seconds, N/E',
      input: `47°08'24"N 9°31'12"E`,
      expectLat: 47.14,
      expectLon: 9.52,
    },
    {
      name: 'DMS without seconds, N/E',
      input: `47°08'N 9°31'E`,
      expectLat: 47 + 8 / 60,
      expectLon: 9 + 31 / 60,
    },
    {
      name: 'DMS with seconds, lon-first order (hemisphere disambiguates)',
      input: `9°31'12"E 47°08'24"N`,
      expectLat: 47.14,
      expectLon: 9.52,
    },
    {
      name: 'DMS with S/W (both negative)',
      input: `47°08'24"S 9°31'12"W`,
      expectLat: -47.14,
      expectLon: -9.52,
    },
    {
      name: 'DMS with curly quotes (typographic apostrophe/quote)',
      input: `47°08’24”N 9°31’12”E`,
      expectLat: 47.14,
      expectLon: 9.52,
    },
    {
      name: 'swap: first number invalid as lat (>90), valid as lon; second valid as lat',
      input: '115.2, 47.14',
      expectLat: 47.14,
      expectLon: 115.2,
      expectSwapped: true,
    },
    { name: 'invalid: letters', input: 'abc, def', expectNull: true },
    { name: 'invalid: out-of-range lon (and not swappable)', input: '47.14, 200', expectNull: true },
    { name: 'invalid: empty string', input: '', expectNull: true },
    { name: 'invalid: whitespace only', input: '   ', expectNull: true },
    { name: 'invalid: both out of range even after swap', input: '200, 300', expectNull: true },
    {
      name: 'invalid: DMS with same-axis hemisphere twice (N/N)',
      input: `47°08'24"N 9°31'12"N`,
      expectNull: true,
    },
    { name: 'invalid: plain prose text', input: 'Vaduz Hauptstrasse', expectNull: true },
  ];

  it.each(table)('$name', ({ input, expectLat, expectLon, expectSwapped, expectNull }) => {
    const result = parseCoordinates(input);

    if (expectNull) {
      expect(result).toBeNull();
      return;
    }

    expect(result).not.toBeNull();
    expect(result!.source).toBe('coords');
    expect(result!.latlng.lat).toBeCloseTo(expectLat!, 4);
    expect(result!.latlng.lon).toBeCloseTo(expectLon!, 4);
    expect(Math.abs(result!.latlng.lat - expectLat!)).toBeLessThan(CLOSE);

    if (expectSwapped) {
      expect(result!.label).toContain('Koordinaten evtl. vertauscht?');
    } else {
      expect(result!.label).not.toContain('vertauscht');
    }
  });

  it('has at least 12 test cases in the table', () => {
    expect(table.length).toBeGreaterThanOrEqual(12);
  });

  it('coordinate results are schema-shaped (name/label/latlng/type/source)', () => {
    const result = parseCoordinates('47.14, 9.52');
    expect(result).toMatchObject({
      name: 'Koordinaten',
      type: 'coordinates',
      source: 'coords',
      latlng: { lat: 47.14, lon: 9.52 },
    });
  });
});
