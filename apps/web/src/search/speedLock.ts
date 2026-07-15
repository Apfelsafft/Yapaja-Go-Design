/**
 * Speed-lock predicate for the search field (E05-T2 "Speed-Lock-Vorgriff"):
 * the search field is disabled above a fixed 10 km/h threshold while
 * driving. This is a hard-coded stand-in -- the real, user-configurable
 * threshold ships with E07's settings; this task only needs the fixed
 * 10 km/h behavior called out explicitly in the task text.
 *
 * `usePositionStore`'s `position.speed` is in m/s over ground (see
 * `@yapaja/shared`'s `Position` type); this converts to km/h before
 * comparing, matching how `packages/shared/src/plausibility.ts` does the
 * same m/s -> km/h conversion for its own speed checks.
 */

export const SEARCH_SPEED_LOCK_KMH = 10;

/** `speedMps` is `Position.speed` (m/s), or `null`/`undefined` when unknown
 *  (no fix yet, or the source doesn't report speed) -- treated as "not
 *  moving" (unlocked), the safe default absent better information. */
export function isSearchSpeedLocked(speedMps: number | null | undefined): boolean {
  if (speedMps === null || speedMps === undefined) {
    return false;
  }
  const speedKmh = speedMps * 3.6;
  return speedKmh > SEARCH_SPEED_LOCK_KMH;
}
