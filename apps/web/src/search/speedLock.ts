/**
 * Speed-lock predicate for the search field (E05-T2 "Speed-Lock-Vorgriff"):
 * originally a fixed-10-km/h stand-in, generalized in E07-T4 into the
 * shared, CONFIGURABLE predicate `drive/driveLock.ts#isSpeedLocked`. This
 * module now just re-exports the fixed-default-threshold shape this file's
 * own pre-existing unit tests (`speedLock.test.ts`) already assert against,
 * so that suite keeps passing unchanged.
 *
 * `SearchBar.tsx` itself no longer uses this fixed-10 wrapper -- it calls
 * `isSpeedLocked` directly with the user-CONFIGURED threshold from
 * `drive/driveLockStore.ts` (E07-T4), so a non-default threshold actually
 * affects search too. This file is kept for backward compatibility (the
 * fixed-10 behavior it was written against) and as a thin, focused export.
 */

import { DEFAULT_DRIVE_LOCK_KMH, isSpeedLocked } from '../drive/driveLock.js';

export const SEARCH_SPEED_LOCK_KMH = DEFAULT_DRIVE_LOCK_KMH;

/** `speedMps` is `Position.speed` (m/s), or `null`/`undefined` when unknown
 *  (no fix yet, or the source doesn't report speed) -- treated as "not
 *  moving" (unlocked), the safe default absent better information. */
export function isSearchSpeedLocked(speedMps: number | null | undefined): boolean {
  return isSpeedLocked(speedMps, SEARCH_SPEED_LOCK_KMH);
}
