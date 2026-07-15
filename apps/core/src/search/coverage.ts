/**
 * Coverage marking for search results (E05-T1, Vorgriff W-09).
 *
 * Reuses the exact same installed-regions/bounds concept as routing's
 * `coverageCheck.ts` (E03-T6): a point is "covered" if it falls inside at
 * least one installed region's bounding box. Unlike routing (which throws
 * 422 OUT_OF_COVERAGE and blocks the request), search results outside
 * coverage are still returned, just flagged `out_of_coverage: true` -- the
 * user can still see/select them.
 *
 * `BoundedRegion` is imported (read-only) from `../routing/coverageCheck.js`
 * so both modules agree on the bounds shape. The point-in-bbox check itself
 * is a small, independent copy: `isPointInBounds` in coverageCheck.ts is not
 * exported, and that file is explicitly out of scope to modify for this
 * task (E05-T1 allowed paths: read-only reuse of coverageCheck.ts).
 */
import type { LatLng } from '@yapaja/shared';
import type { BoundedRegion } from '../routing/coverageCheck.js';

/**
 * Minimal regions-provider contract this module needs. Structurally
 * compatible with routing's `InstalledRegionsProvider` (which has an
 * additional `getCatalogRegions` method) -- any object satisfying that also
 * satisfies this, so the same provider instance can be reused as-is.
 */
export interface SearchRegionsProvider {
  getInstalledRegions(): Promise<BoundedRegion[]>;
}

function isPointInBounds(point: LatLng, bounds: BoundedRegion['bounds']): boolean {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return point.lon >= minLon && point.lon <= maxLon && point.lat >= minLat && point.lat <= maxLat;
}

/**
 * Marks every result whose `latlng` falls outside all installed regions with
 * `out_of_coverage: true`. If no regions are installed at all, nothing is
 * marked -- mirrors coverageCheck.ts's "can't check, let it through" stance
 * (a fresh install with no maps yet shouldn't flag every single result).
 */
export async function markOutOfCoverage<T extends { latlng: LatLng }>(
  results: T[],
  provider: SearchRegionsProvider,
): Promise<(T & { out_of_coverage?: boolean })[]> {
  if (results.length === 0) return results;

  const installedRegions = await provider.getInstalledRegions();
  if (installedRegions.length === 0) {
    return results;
  }

  return results.map((result) => {
    const covered = installedRegions.some((region) => isPointInBounds(result.latlng, region.bounds));
    return covered ? result : { ...result, out_of_coverage: true };
  });
}
