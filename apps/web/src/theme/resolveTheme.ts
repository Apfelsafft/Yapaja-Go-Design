/**
 * Combines theme MODE (light/dark/auto), a manual override, and the sun/
 * clock resolution into one pure "what to apply right now" result -- the
 * exact pairing of `theme` (UI) and `styleId` (map) the E07-T3 "atomic,
 * same tick" acceptance criterion needs: a caller applies BOTH fields from
 * the SAME `ThemeResolution` object in one synchronous step
 * (`themeStore.ts#applyResolution`), so there is never a frame where one
 * reflects an old resolution and the other a new one.
 *
 * Pure: no `Date.now()`, no store/DOM reads -- `now`/`position`/`override`
 * are all explicit inputs, so every acceptance criterion (auto-switch from
 * simulated time+position, override-until-next-boundary) is a plain unit
 * test with no fake-timer/mocking machinery needed.
 */

import { resolveClockTheme, resolveSunTheme, type ResolvedTheme } from './sunResolution.js';

export type { ResolvedTheme } from './sunResolution.js';

export type ThemeMode = 'light' | 'dark' | 'auto';

/** A pending manual choice made while `mode === 'auto'` (docs/06 §3:
 *  "Manueller Override hält bis nächstem Auf-/Untergang"). Only ever
 *  consulted while the mode is `auto` -- picking an explicit `light`/`dark`
 *  MODE has no override to hold, it just stays put (task note). */
export interface ThemeOverride {
  theme: ResolvedTheme;
  /** Epoch ms of the boundary that ends this override -- the
   *  `nextBoundaryAt` that was in effect at the moment the override was
   *  created (see `createOverride`). */
  expiresAt: number;
}

export type MapStyleId = 'yapaja-light' | 'yapaja-dark';

export interface ThemeResolution {
  theme: ResolvedTheme;
  /** The theme-coupled map style for `theme` -- see `themeStore.ts`'s doc
   *  comment for why a manually-picked `yapaja-contrast` is deliberately
   *  NOT reflected here (this is only ever `yapaja-light`/`yapaja-dark`;
   *  the caller decides whether to actually apply it). */
  styleId: MapStyleId;
  /** True if this resolution came from an still-active manual override
   *  rather than a fresh sun/clock computation. */
  overrideActive: boolean;
  /** Epoch ms of the next auto boundary crossing (also the override's
   *  expiry, were one to be created right now), or `null` if none could be
   *  found (should not happen on Earth, `sunResolution.ts`'s scan window). */
  nextBoundaryAt: number | null;
}

export interface GeoPosition {
  lat: number;
  lon: number;
}

export function mapStyleIdFor(theme: ResolvedTheme): MapStyleId {
  return theme === 'dark' ? 'yapaja-dark' : 'yapaja-light';
}

/** The sun (if a position fix is available) or fixed-clock (docs/06 §3
 *  fallback, 19:00-07:00 local) resolution -- ignores mode/override. */
function resolveAuto(now: Date, position: GeoPosition | null): { theme: ResolvedTheme; nextBoundaryAt: number | null } {
  return position ? resolveSunTheme(position.lat, position.lon, now) : resolveClockTheme(now);
}

export interface ResolveThemeInput {
  mode: ThemeMode;
  now: Date;
  position: GeoPosition | null;
  /** Only consulted when `mode === 'auto'`. */
  override: ThemeOverride | null;
}

/**
 * The single entry point tying mode + override + sun/clock together.
 *  - `mode === 'light' | 'dark'`: resolves directly, no override, no sun/
 *    clock computation needed -- "an explicit light/dark mode just stays
 *    put" (task note).
 *  - `mode === 'auto'`, override active (`now < override.expiresAt`):
 *    returns the override's theme, `overrideActive: true`.
 *  - `mode === 'auto'`, no active override: fresh sun/clock resolution.
 */
export function resolveTheme(input: ResolveThemeInput): ThemeResolution {
  if (input.mode === 'light' || input.mode === 'dark') {
    return {
      theme: input.mode,
      styleId: mapStyleIdFor(input.mode),
      overrideActive: false,
      nextBoundaryAt: null,
    };
  }

  if (input.override && input.now.getTime() < input.override.expiresAt) {
    return {
      theme: input.override.theme,
      styleId: mapStyleIdFor(input.override.theme),
      overrideActive: true,
      nextBoundaryAt: input.override.expiresAt,
    };
  }

  const auto = resolveAuto(input.now, input.position);
  return {
    theme: auto.theme,
    styleId: mapStyleIdFor(auto.theme),
    overrideActive: false,
    nextBoundaryAt: auto.nextBoundaryAt,
  };
}

/**
 * Creates a fresh override for a manual light/dark pick made while
 * `mode === 'auto'`: holds `theme` until the boundary that would otherwise
 * have applied at the moment of picking (docs/06 §3: "hält bis nächstem
 * Auf-/Untergang"). If no boundary could be found (should not happen),
 * falls back to a 24h hold so the override can never get stuck forever.
 */
export function createOverride(theme: ResolvedTheme, now: Date, position: GeoPosition | null): ThemeOverride {
  const auto = resolveAuto(now, position);
  const FALLBACK_HOLD_MS = 24 * 60 * 60 * 1000;
  return { theme, expiresAt: auto.nextBoundaryAt ?? now.getTime() + FALLBACK_HOLD_MS };
}

/** Whether `override` is still holding at `now` -- the same test
 *  `resolveTheme` applies internally, exposed separately so callers (the
 *  store's periodic tick) can decide whether to clear a stale override
 *  without re-deriving a whole resolution. */
export function isOverrideActive(override: ThemeOverride | null, now: Date): boolean {
  return override !== null && now.getTime() < override.expiresAt;
}
