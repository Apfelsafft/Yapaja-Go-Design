/**
 * Sonnenstand-Unit (E07-T3 Pflicht-Test): 6 reference-value assertions
 * against `computeSunTimes` --
 *  - Stuttgart (48.7758N, 9.1829E) summer + winter solstice: sunrise AND
 *    sunset each, checked against public almanac values (timeanddate.com),
 *    within a several-minute tolerance (NOAA-derived approximations are
 *    documented accurate to ~1 minute for this event; the tolerance here is
 *    kept generous to absorb the almanac source's own minute-level rounding
 *    -- still far inside what would be a user-visible theme-switch drift).
 *  - Tromsø (69.65N, 18.96E) polar-night (December) and midnight-sun (June)
 *    edge cases: these dates fall well inside Tromsø's well-documented
 *    polar-night (~Nov 27 - Jan 15) and midnight-sun (~May 20 - Jul 22)
 *    windows, so the algorithm MUST hit the fallback `kind` branches here,
 *    not crash or return NaN times.
 */

import { describe, expect, it } from 'vitest';
import { computeSunTimes, type SunTimesNormal } from './sun.js';

const STUTTGART = { lat: 48.7758, lon: 9.1829 };
const TROMSO = { lat: 69.65, lon: 18.96 };

/** Generous but still meaningful: keeps this test robust to the almanac
 *  source's own minute-level rounding while still catching a badly broken
 *  algorithm (a wrong day, a swapped sign, a several-hour offset, etc.). */
const TOLERANCE_MS = 5 * 60 * 1000;

function assertCloseTo(actual: Date, expectedIso: string, label: string): void {
  const diffMs = Math.abs(actual.getTime() - new Date(expectedIso).getTime());
  expect(diffMs, `${label}: expected close to ${expectedIso}, got ${actual.toISOString()}`).toBeLessThanOrEqual(
    TOLERANCE_MS,
  );
}

describe('computeSunTimes', () => {
  it('Stuttgart summer solstice (2026-06-21): sunrise ~05:20 CEST (03:20 UTC)', () => {
    const result = computeSunTimes(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T12:00:00Z'));
    expect(result.kind).toBe('normal');
    assertCloseTo((result as SunTimesNormal).sunrise, '2026-06-21T03:20:00Z', 'sunrise');
  });

  it('Stuttgart summer solstice (2026-06-21): sunset ~21:29 CEST (19:29 UTC)', () => {
    const result = computeSunTimes(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T12:00:00Z'));
    expect(result.kind).toBe('normal');
    assertCloseTo((result as SunTimesNormal).sunset, '2026-06-21T19:29:00Z', 'sunset');
  });

  it('Stuttgart winter solstice (2026-12-21): sunrise ~08:15 CET (07:15 UTC)', () => {
    const result = computeSunTimes(STUTTGART.lat, STUTTGART.lon, new Date('2026-12-21T12:00:00Z'));
    expect(result.kind).toBe('normal');
    assertCloseTo((result as SunTimesNormal).sunrise, '2026-12-21T07:15:00Z', 'sunrise');
  });

  it('Stuttgart winter solstice (2026-12-21): sunset ~16:30 CET (15:30 UTC)', () => {
    const result = computeSunTimes(STUTTGART.lat, STUTTGART.lon, new Date('2026-12-21T12:00:00Z'));
    expect(result.kind).toBe('normal');
    assertCloseTo((result as SunTimesNormal).sunset, '2026-12-21T15:30:00Z', 'sunset');
  });

  it('Tromsø polar-night edge (2026-12-21): sun never rises -> fallback, never throws/NaN', () => {
    const result = computeSunTimes(TROMSO.lat, TROMSO.lon, new Date('2026-12-21T12:00:00Z'));
    expect(result).toEqual({ kind: 'polar-night' });
  });

  it('Tromsø midnight-sun edge (2026-06-21): sun never sets -> fallback, never throws/NaN', () => {
    const result = computeSunTimes(TROMSO.lat, TROMSO.lon, new Date('2026-06-21T12:00:00Z'));
    expect(result).toEqual({ kind: 'midnight-sun' });
  });

  it('is pure: identical inputs always produce identical outputs (no hidden clock/global state)', () => {
    const date = new Date('2026-03-15T00:00:00Z');
    const a = computeSunTimes(STUTTGART.lat, STUTTGART.lon, date);
    const b = computeSunTimes(STUTTGART.lat, STUTTGART.lon, date);
    expect(a).toEqual(b);
  });
});
