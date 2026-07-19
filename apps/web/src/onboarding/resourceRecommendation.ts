/**
 * Photon-off recommendation logic (E08-T5, W-12/W-18): a PURE function over
 * REAL measured free disk bytes (from `GET /api/v1/system/resources`, see
 * `resourcesClient.ts`) -- deliberately separate from that fetch so the
 * threshold decision itself is trivially unit-testable without a server, and
 * so the plausibility requirement ("Empfehlungen basieren auf echten
 * Messwerten, nicht Hardcodes") is visibly satisfied: this module never
 * invents a number, it only classifies one handed to it.
 */

/** Below this many free bytes, recommend turning Photon (the online-geocoder
 *  helper process) off to save RAM (docs/08-wargame.md W-12). */
export const LOW_DISK_THRESHOLD_BYTES = 3_000_000_000; // 3 GB

export interface SystemResources {
  disk_free_bytes: number;
  disk_total_bytes: number;
  mem_free_bytes: number;
  mem_total_bytes: number;
}

/** `freeBytes < 3 GB` -> recommend Photon off. Exactly at the threshold does
 *  NOT trigger the recommendation (strict `<`, mirrors `checkDiskSpace`'s
 *  own boundary convention in `apps/core/src/map/regions/disk.ts`). */
export function shouldRecommendPhotonOff(freeBytes: number): boolean {
  return freeBytes < LOW_DISK_THRESHOLD_BYTES;
}

/** Convenience wrapper taking the full `SystemResources` snapshot. */
export function recommendPhotonOff(resources: Pick<SystemResources, 'disk_free_bytes'>): boolean {
  return shouldRecommendPhotonOff(resources.disk_free_bytes);
}
