/**
 * PWA update-reload gating (E07-T5): "Update-Strategie `autoUpdate` mit
 * Reload-Prompt im Stand (nie während Fahrt!)" -- the Service Worker itself
 * updates/activates automatically (`skipWaiting`/`clientsClaim`, see
 * `vite.config.ts`'s workbox options), but the visible page reload that
 * actually swaps the running app for the new build must NEVER happen while
 * the vehicle is moving above the Speed-Lock threshold -- a mid-drive reload
 * would drop the map/nav UI out from under the driver.
 *
 * Pure/DOM-free by design (mirrors `drive/driveLock.ts`'s "zero DOM/React/
 * store dependencies" boundary for the same reason: trivially unit-testable,
 * real wiring lives in `pwaStore.ts`). Deliberately REUSES
 * `drive/driveLock.ts#isSpeedLocked` (same speed source, same default
 * threshold, same "unknown speed = not moving" contract) rather than
 * reimplementing a second speed-vs-threshold check -- one definition of
 * "driving" for the whole app.
 */
import { DEFAULT_DRIVE_LOCK_KMH, isSpeedLocked } from '../drive/driveLock.js';

/**
 * Whether the "Update verfügbar, neu laden?" prompt should be shown/allowed
 * to reload right now.
 *
 * `speedMps` is `Position.speed` (m/s), or `null`/`undefined` when unknown --
 * treated as "not moving" (prompt allowed), same safe default as
 * `isSpeedLocked`'s own contract.
 */
export function shouldPromptReload(
  speedMps: number | null | undefined,
  updateAvailable: boolean,
  thresholdKmh: number = DEFAULT_DRIVE_LOCK_KMH,
): boolean {
  if (!updateAvailable) {
    return false;
  }
  return !isSpeedLocked(speedMps, thresholdKmh);
}
