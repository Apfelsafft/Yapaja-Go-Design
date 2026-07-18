/**
 * Unit tests for `resolveTheme.ts` -- the mode/override/sun-clock combiner.
 * Covers E07-T3 acceptance criteria 2 ("UI+Karte wechseln zusammen") via the
 * atomic {theme, styleId} pairing, and 3 ("Override-Logik") via
 * `createOverride`/`isOverrideActive`/the override branch of `resolveTheme`.
 */

import { describe, expect, it } from 'vitest';
import { createOverride, isOverrideActive, resolveTheme } from './resolveTheme.js';

const STUTTGART = { lat: 48.7758, lon: 9.1829 };

describe('resolveTheme: explicit light/dark mode', () => {
  it('mode "light" always resolves to light + yapaja-light, regardless of time/position', () => {
    const result = resolveTheme({
      mode: 'light',
      now: new Date('2026-01-01T00:00:00Z'), // deep night
      position: STUTTGART,
      override: null,
    });
    expect(result).toEqual({ theme: 'light', styleId: 'yapaja-light', overrideActive: false, nextBoundaryAt: null });
  });

  it('mode "dark" always resolves to dark + yapaja-dark, regardless of time/position', () => {
    const result = resolveTheme({
      mode: 'dark',
      now: new Date('2026-06-21T12:00:00Z'), // bright midday
      position: STUTTGART,
      override: null,
    });
    expect(result).toEqual({ theme: 'dark', styleId: 'yapaja-dark', overrideActive: false, nextBoundaryAt: null });
  });
});

describe('resolveTheme: auto mode, atomic {theme, styleId} pairing (acceptance criterion 2)', () => {
  it('a single resolution carries BOTH the resolved theme AND its coupled map style -- never independently', () => {
    const dayResult = resolveTheme({
      mode: 'auto',
      now: new Date('2026-06-21T12:00:00Z'),
      position: STUTTGART,
      override: null,
    });
    expect(dayResult.theme).toBe('light');
    expect(dayResult.styleId).toBe('yapaja-light');

    const nightResult = resolveTheme({
      mode: 'auto',
      now: new Date('2026-06-21T23:00:00Z'),
      position: STUTTGART,
      override: null,
    });
    expect(nightResult.theme).toBe('dark');
    expect(nightResult.styleId).toBe('yapaja-dark');
  });

  it('falls back to the clock heuristic with no position fix', () => {
    const result = resolveTheme({
      mode: 'auto',
      now: new Date(2026, 5, 21, 21, 0, 0), // 21:00 local, no position
      position: null,
      override: null,
    });
    expect(result.theme).toBe('dark');
    expect(result.styleId).toBe('yapaja-dark');
  });
});

describe('resolveTheme / createOverride / isOverrideActive: override-until-next-boundary (acceptance criterion 3)', () => {
  it('an active override wins over the sun/clock resolution', () => {
    const now = new Date('2026-06-21T12:00:00Z'); // would otherwise resolve light
    const override = createOverride('dark', now, STUTTGART);
    const result = resolveTheme({ mode: 'auto', now, position: STUTTGART, override });
    expect(result).toMatchObject({ theme: 'dark', styleId: 'yapaja-dark', overrideActive: true });
  });

  it("createOverride's expiry is the next boundary that was in effect at the moment of picking", () => {
    const now = new Date('2026-06-21T12:00:00Z');
    const freshAuto = resolveTheme({ mode: 'auto', now, position: STUTTGART, override: null });
    const override = createOverride('dark', now, STUTTGART);
    expect(override.expiresAt).toBe(freshAuto.nextBoundaryAt);
  });

  it('the override lapses exactly at its boundary: resolveTheme falls back to auto once now reaches expiresAt', () => {
    const pickedAt = new Date('2026-06-21T12:00:00Z');
    const override = createOverride('dark', pickedAt, STUTTGART); // expires at sunset-15min today

    const justBeforeExpiry = resolveTheme({
      mode: 'auto',
      now: new Date(override.expiresAt - 1000),
      position: STUTTGART,
      override,
    });
    expect(justBeforeExpiry.overrideActive).toBe(true);
    expect(justBeforeExpiry.theme).toBe('dark');

    const atExpiry = resolveTheme({
      mode: 'auto',
      now: new Date(override.expiresAt),
      position: STUTTGART,
      override,
    });
    expect(atExpiry.overrideActive).toBe(false);
    // At the sunset-15min boundary itself, the auto resolution is dark
    // anyway -- pick a moment well past it too, so this test actually
    // proves auto RESUMED (not just that dark persisted by coincidence).
    const wellPastExpiry = resolveTheme({
      mode: 'auto',
      now: new Date(override.expiresAt + 5 * 60 * 1000),
      position: STUTTGART,
      override,
    });
    expect(wellPastExpiry.overrideActive).toBe(false);
    expect(wellPastExpiry.theme).toBe('dark'); // still dark (it's evening) but via fresh auto, not the override
  });

  it('a light override set at night correctly resumes to auto-dark once the next-morning boundary passes', () => {
    const pickedAt = new Date('2026-06-21T23:00:00Z'); // night, would auto-resolve dark
    const override = createOverride('light', pickedAt, STUTTGART); // expires at tomorrow's sunrise+15min

    const stillOverridden = resolveTheme({
      mode: 'auto',
      now: new Date(override.expiresAt - 1000),
      position: STUTTGART,
      override,
    });
    expect(stillOverridden).toMatchObject({ theme: 'light', overrideActive: true });

    const afterBoundary = resolveTheme({
      mode: 'auto',
      now: new Date(override.expiresAt + 1000),
      position: STUTTGART,
      override,
    });
    expect(afterBoundary).toMatchObject({ theme: 'light', overrideActive: false }); // it's now genuinely daytime
  });

  it('isOverrideActive reflects the same expiry boundary resolveTheme uses', () => {
    const now = new Date('2026-06-21T12:00:00Z');
    const override = createOverride('dark', now, STUTTGART);
    expect(isOverrideActive(override, new Date(override.expiresAt - 1))).toBe(true);
    expect(isOverrideActive(override, new Date(override.expiresAt))).toBe(false);
    expect(isOverrideActive(null, now)).toBe(false);
  });

  it('an expired override in auto mode is ignored even if still present in state', () => {
    const now = new Date('2026-06-21T12:00:00Z');
    const staleOverride = { theme: 'dark' as const, expiresAt: now.getTime() - 1 };
    const result = resolveTheme({ mode: 'auto', now, position: STUTTGART, override: staleOverride });
    expect(result.overrideActive).toBe(false);
    expect(result.theme).toBe('light'); // fresh auto resolution, not the stale override
  });

  it('an override is irrelevant to (never consulted by) an explicit light/dark mode', () => {
    const now = new Date('2026-06-21T12:00:00Z');
    const override = createOverride('dark', now, STUTTGART);
    const result = resolveTheme({ mode: 'light', now, position: STUTTGART, override });
    expect(result).toMatchObject({ theme: 'light', overrideActive: false });
  });
});
