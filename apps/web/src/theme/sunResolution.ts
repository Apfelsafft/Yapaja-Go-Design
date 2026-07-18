/**
 * Pure "what should the theme be right now" resolution from either sun
 * position or a fixed clock fallback (E07-T3, docs/06 §3).
 *
 * Both `resolveSunTheme` and `resolveClockTheme` are pure functions of their
 * arguments (no `Date.now()`, no DOM, no store reads) so the acceptance
 * criterion "Auto-switch demonstrable with simulated time+position" is a
 * plain unit test: pass in whatever `Date`/position you like.
 */

import { computeSunTimes } from '@yapaja/shared';

export type ResolvedTheme = 'light' | 'dark';

/** docs/06 §3: "Wechsel bei Sonnenstand ∓15 min" -- dark from sunset-15min
 *  through sunrise+15min (next dawn), light in between. */
const BOUNDARY_OFFSET_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far forward `resolveSunTheme`/`resolveClockTheme` will scan for the
 *  next boundary. 370 days safely covers even the longest real polar-night/
 *  midnight-sun stretch on Earth (well under 6 months) with margin. */
const MAX_SCAN_FORWARD_DAYS = 370;

interface BoundaryEvent {
  at: number;
  themeAfter: ResolvedTheme;
}

/** The (at most two) boundary-crossing instants for one calendar day at
 *  `dayDate`, empty for a polar-night/midnight-sun day (no crossing). */
function dayBoundaryEvents(lat: number, lon: number, dayDate: Date): BoundaryEvent[] {
  const sun = computeSunTimes(lat, lon, dayDate);
  if (sun.kind !== 'normal') {
    return [];
  }
  const events: BoundaryEvent[] = [
    { at: sun.sunrise.getTime() + BOUNDARY_OFFSET_MS, themeAfter: 'light' },
    { at: sun.sunset.getTime() - BOUNDARY_OFFSET_MS, themeAfter: 'dark' },
  ];
  return events.sort((a, b) => a.at - b.at);
}

/** Earliest boundary-crossing instant strictly after `now`, scanning
 *  forward day by day (skipping polar-night/midnight-sun days, which
 *  contribute no crossing) until one is found or the scan window is
 *  exhausted (`null` -- should not happen anywhere on Earth). */
function findNextBoundary(lat: number, lon: number, now: Date): number | null {
  const nowMs = now.getTime();
  for (let offset = 0; offset <= MAX_SCAN_FORWARD_DAYS; offset += 1) {
    const day = new Date(nowMs + offset * DAY_MS);
    const futureEvents = dayBoundaryEvents(lat, lon, day).filter((event) => event.at > nowMs);
    if (futureEvents.length > 0) {
      return Math.min(...futureEvents.map((event) => event.at));
    }
  }
  return null;
}

export interface SunThemeResolution {
  theme: ResolvedTheme;
  /** Epoch ms of the next auto boundary crossing (used as an override's
   *  expiry, see `override.ts`), or `null` if none was found in the scan
   *  window. */
  nextBoundaryAt: number | null;
}

/**
 * Resolves light/dark from sunrise/sunset ∓15min at (`lat`, `lon`), `now`.
 * Polar night -> always dark that day; midnight sun -> always light --
 * never throws, mirrors `computeSunTimes`'s own fallback contract.
 */
export function resolveSunTheme(lat: number, lon: number, now: Date): SunThemeResolution {
  const today = computeSunTimes(lat, lon, now);

  let theme: ResolvedTheme;
  if (today.kind === 'midnight-sun') {
    theme = 'light';
  } else if (today.kind === 'polar-night') {
    theme = 'dark';
  } else {
    const nowMs = now.getTime();
    const sunriseBoundary = today.sunrise.getTime() + BOUNDARY_OFFSET_MS;
    const sunsetBoundary = today.sunset.getTime() - BOUNDARY_OFFSET_MS;
    theme = nowMs >= sunriseBoundary && nowMs < sunsetBoundary ? 'light' : 'dark';
  }

  return { theme, nextBoundaryAt: findNextBoundary(lat, lon, now) };
}

/** docs/06 §3: "ohne Position: 07/19 Uhr lokal" -- dark 19:00-07:00 in the
 *  DEVICE's local time zone (deliberately `Date#getHours`, not UTC). */
const CLOCK_DARK_START_HOUR = 19;
const CLOCK_DARK_END_HOUR = 7;

function localBoundary(base: Date, dayOffset: number, hour: number): number {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + dayOffset,
    hour,
    0,
    0,
    0,
  ).getTime();
}

/** Fixed local-clock fallback used whenever no position fix is available yet. */
export function resolveClockTheme(now: Date): SunThemeResolution {
  const hour = now.getHours();
  const theme: ResolvedTheme = hour >= CLOCK_DARK_START_HOUR || hour < CLOCK_DARK_END_HOUR ? 'dark' : 'light';

  const nowMs = now.getTime();
  const candidates = [-1, 0, 1, 2].flatMap((dayOffset) => [
    localBoundary(now, dayOffset, CLOCK_DARK_END_HOUR),
    localBoundary(now, dayOffset, CLOCK_DARK_START_HOUR),
  ]);
  const future = candidates.filter((candidate) => candidate > nowMs).sort((a, b) => a - b);

  return { theme, nextBoundaryAt: future[0] ?? null };
}
