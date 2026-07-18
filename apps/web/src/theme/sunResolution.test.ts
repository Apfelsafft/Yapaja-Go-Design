/**
 * Unit tests for the pure sun/clock resolution (E07-T3 acceptance criterion
 * 1: "Auto-Wechsel bei simulierter Zeit/Position nachweisbar"). All inputs
 * are explicit `Date`s/positions -- no fake timers needed anywhere here.
 */

import { describe, expect, it } from 'vitest';
import { resolveClockTheme, resolveSunTheme } from './sunResolution.js';

const STUTTGART = { lat: 48.7758, lon: 9.1829 };
const TROMSO = { lat: 69.65, lon: 18.96 };

describe('resolveSunTheme (with position)', () => {
  it('resolves light at midday, summer solstice', () => {
    const result = resolveSunTheme(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T12:00:00Z'));
    expect(result.theme).toBe('light');
  });

  it('resolves dark at midnight, summer solstice', () => {
    const result = resolveSunTheme(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T23:00:00Z'));
    expect(result.theme).toBe('dark');
  });

  it('switches at sunset MINUS 15 minutes, not exactly at sunset (docs/06 §3 offset)', () => {
    // Computed sunset ~19:31 UTC on this date (see packages/shared/src/sun.test.ts).
    const justBeforeOffsetBoundary = resolveSunTheme(
      STUTTGART.lat,
      STUTTGART.lon,
      new Date('2026-06-21T19:15:00Z'), // ~16 min before sunset -> still light
    );
    const justAfterOffsetBoundary = resolveSunTheme(
      STUTTGART.lat,
      STUTTGART.lon,
      new Date('2026-06-21T19:20:00Z'), // ~11 min before sunset -> already past sunset-15min
    );
    expect(justBeforeOffsetBoundary.theme).toBe('light');
    expect(justAfterOffsetBoundary.theme).toBe('dark');
  });

  it('switches at sunrise PLUS 15 minutes on the way back to light', () => {
    // Computed sunrise ~03:21 UTC on this date.
    const beforeSunriseOffset = resolveSunTheme(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T03:30:00Z'));
    const afterSunriseOffset = resolveSunTheme(STUTTGART.lat, STUTTGART.lon, new Date('2026-06-21T03:40:00Z'));
    expect(beforeSunriseOffset.theme).toBe('dark');
    expect(afterSunriseOffset.theme).toBe('light');
  });

  it('polar night (Tromsø, December): always dark, never crashes, still returns a next boundary', () => {
    const result = resolveSunTheme(TROMSO.lat, TROMSO.lon, new Date('2026-12-21T12:00:00Z'));
    expect(result.theme).toBe('dark');
    expect(result.nextBoundaryAt).not.toBeNull();
    expect(result.nextBoundaryAt as number).toBeGreaterThan(new Date('2026-12-21T12:00:00Z').getTime());
  });

  it('midnight sun (Tromsø, June): always light, never crashes, still returns a next boundary', () => {
    const result = resolveSunTheme(TROMSO.lat, TROMSO.lon, new Date('2026-06-21T12:00:00Z'));
    expect(result.theme).toBe('light');
    expect(result.nextBoundaryAt).not.toBeNull();
  });

  it('returns a nextBoundaryAt strictly in the future for a normal day', () => {
    const now = new Date('2026-06-21T12:00:00Z');
    const result = resolveSunTheme(STUTTGART.lat, STUTTGART.lon, now);
    expect(result.nextBoundaryAt).not.toBeNull();
    expect(result.nextBoundaryAt as number).toBeGreaterThan(now.getTime());
  });
});

describe('resolveClockTheme (no position -- fixed 19:00-07:00 local fallback)', () => {
  it('is dark at 20:00 local', () => {
    const result = resolveClockTheme(new Date(2026, 5, 21, 20, 0, 0));
    expect(result.theme).toBe('dark');
  });

  it('is dark at 03:00 local', () => {
    const result = resolveClockTheme(new Date(2026, 5, 21, 3, 0, 0));
    expect(result.theme).toBe('dark');
  });

  it('is light at 12:00 local', () => {
    const result = resolveClockTheme(new Date(2026, 5, 21, 12, 0, 0));
    expect(result.theme).toBe('light');
  });

  it('flips to dark exactly at 19:00 and stays light at 18:59', () => {
    expect(resolveClockTheme(new Date(2026, 5, 21, 18, 59, 0)).theme).toBe('light');
    expect(resolveClockTheme(new Date(2026, 5, 21, 19, 0, 0)).theme).toBe('dark');
  });

  it('flips to light exactly at 07:00 and stays dark at 06:59', () => {
    expect(resolveClockTheme(new Date(2026, 5, 21, 6, 59, 0)).theme).toBe('dark');
    expect(resolveClockTheme(new Date(2026, 5, 21, 7, 0, 0)).theme).toBe('light');
  });

  it('next boundary from daytime is today at 19:00', () => {
    const now = new Date(2026, 5, 21, 12, 0, 0);
    const result = resolveClockTheme(now);
    expect(result.nextBoundaryAt).toBe(new Date(2026, 5, 21, 19, 0, 0).getTime());
  });

  it('next boundary from nighttime (after midnight) is today at 07:00', () => {
    const now = new Date(2026, 5, 21, 3, 0, 0);
    const result = resolveClockTheme(now);
    expect(result.nextBoundaryAt).toBe(new Date(2026, 5, 21, 7, 0, 0).getTime());
  });

  it('next boundary from evening (after 19:00) is tomorrow at 07:00', () => {
    const now = new Date(2026, 5, 21, 21, 0, 0);
    const result = resolveClockTheme(now);
    expect(result.nextBoundaryAt).toBe(new Date(2026, 5, 22, 7, 0, 0).getTime());
  });
});
