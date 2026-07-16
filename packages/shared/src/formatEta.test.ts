/**
 * Unit tests for the client-side ETA formatter (E04-T2, Wargame W-22):
 * zone-correct formatting, DST spring-forward and fall-back boundaries, and
 * the invalid-input failure mode.
 */

import { describe, it, expect } from 'vitest';
import { formatEta } from './formatEta';

describe('formatEta', () => {
  it('formats a fixed instant in an explicit IANA zone as 24h "HH:MM"', () => {
    // 2026-06-15T12:34:00Z is 14:34 CEST (Europe/Berlin, UTC+2 in summer).
    expect(formatEta('2026-06-15T12:34:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('14:34');
  });

  it('formats the SAME instant differently across zones (zone-crossing, W-22)', () => {
    const iso = '2026-06-15T12:34:00.000Z';
    expect(formatEta(iso, { timeZone: 'Europe/Berlin' })).toBe('14:34'); // UTC+2
    expect(formatEta(iso, { timeZone: 'America/New_York' })).toBe('08:34'); // UTC-4 (EDT)
  });

  it('shifts by +1h across the spring-forward DST boundary (Europe/Berlin, 2026-03-29 01:00 UTC)', () => {
    // Same 21:00 UTC clock reading, one day apart, straddling the transition.
    expect(formatEta('2026-03-28T21:00:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('22:00'); // still CET (UTC+1)
    expect(formatEta('2026-03-29T21:00:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('23:00'); // now CEST (UTC+2)
  });

  it('shifts by -1h across the fall-back DST boundary (Europe/Berlin, 2026-10-25 01:00 UTC)', () => {
    expect(formatEta('2026-10-24T21:00:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('23:00'); // still CEST (UTC+2)
    expect(formatEta('2026-10-25T21:00:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('22:00'); // now CET (UTC+1)
  });

  it('always renders 24h clock (hour12 forced off) regardless of locale', () => {
    const iso = '2026-06-15T12:34:00.000Z';
    expect(formatEta(iso, { timeZone: 'Europe/Berlin', locale: 'en-US' })).toBe('14:34');
    expect(formatEta(iso, { timeZone: 'Europe/Berlin', locale: 'de-DE' })).toBe('14:34');
  });

  it('defaults to the "de-DE" locale when none is given', () => {
    expect(formatEta('2026-06-15T12:34:00.000Z', { timeZone: 'Europe/Berlin' })).toBe('14:34');
  });

  it('throws RangeError for an unparseable ISO timestamp', () => {
    expect(() => formatEta('not-a-date')).toThrow(RangeError);
  });
});
