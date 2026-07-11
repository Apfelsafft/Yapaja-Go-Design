/**
 * Coverage check: verifies that routing origin, destination, and waypoints
 * lie within at least one installed region's bounds (E03-T6, wargame W-09).
 *
 * If a point is outside all installed regions, throws RoutingError(422, 'OUT_OF_COVERAGE')
 * with a hint about which catalog region (if any) would cover it.
 */

import type { LatLng } from '@yapaja/shared';
import { RoutingError } from './errors.js';

/** Represents a region with geographical bounds. */
export interface BoundedRegion {
  id: string;
  name: string;
  bounds: [minLon: number, minLat: number, maxLon: number, maxLat: number];
}

/** Provider of installed regions with bounds. Injected into RoutingService. */
export interface InstalledRegionsProvider {
  /** Returns all installed regions with their bounds, or empty array if none. */
  getInstalledRegions(): Promise<BoundedRegion[]>;
  /** Returns the full catalog (for missing_region_hint). */
  getCatalogRegions(): Promise<BoundedRegion[]>;
}

/**
 * Checks if a point (lon, lat) lies within a bounding box.
 * Bounds format: [minLon, minLat, maxLon, maxLat]
 */
function isPointInBounds(point: LatLng, bounds: [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  return point.lon >= minLon && point.lon <= maxLon && point.lat >= minLat && point.lat <= maxLat;
}

/**
 * Checks if a point is covered by at least one installed region.
 * Returns the region if found, or null if uncovered.
 */
function findCoveringRegion(point: LatLng, installedRegions: BoundedRegion[]): BoundedRegion | null {
  for (const region of installedRegions) {
    if (isPointInBounds(point, region.bounds)) {
      return region;
    }
  }
  return null;
}

/**
 * Finds a catalog region that would cover the point (for the missing_region_hint).
 * Returns the first matching catalog entry, or null if none.
 */
function findHintRegion(point: LatLng, catalogRegions: BoundedRegion[]): BoundedRegion | null {
  for (const region of catalogRegions) {
    if (isPointInBounds(point, region.bounds)) {
      return region;
    }
  }
  return null;
}

/**
 * Performs a coverage check: ensures origin, destination, and all waypoints
 * are within at least one installed region's bounds.
 *
 * Throws RoutingError(422, 'OUT_OF_COVERAGE') if any point is uncovered.
 */
export async function checkCoverage(
  origin: LatLng | null,
  destination: LatLng,
  waypoints: LatLng[],
  provider: InstalledRegionsProvider,
): Promise<void> {
  const installedRegions = await provider.getInstalledRegions();

  // If no regions are installed, we can't check coverage - let it through
  // (this shouldn't happen in normal operation).
  if (installedRegions.length === 0) {
    return;
  }

  const pointsToCheck: Array<{ point: LatLng; role: string }> = [];

  if (origin) {
    pointsToCheck.push({ point: origin, role: 'origin' });
  }
  pointsToCheck.push({ point: destination, role: 'destination' });
  for (let i = 0; i < waypoints.length; i++) {
    pointsToCheck.push({ point: waypoints[i], role: `waypoint[${i}]` });
  }

  // Check each point against installed regions
  for (const { point, role } of pointsToCheck) {
    const covering = findCoveringRegion(point, installedRegions);
    if (!covering) {
      // Point is uncovered - find a catalog region that would cover it for the hint
      const catalogRegions = await provider.getCatalogRegions();
      const hintRegion = findHintRegion(point, catalogRegions);

      const message = `${role} liegt außerhalb der installierten Kartenabdeckung.`;
      const details: Record<string, unknown> = {
        point: { lat: point.lat, lon: point.lon },
        role,
      };

      const error = new RoutingError(422, 'OUT_OF_COVERAGE', message);
      // Attach missing_region_hint as a property (will be included in error response)
      (error as RoutingError & { missing_region_hint?: string }).missing_region_hint = hintRegion
        ? `${hintRegion.name} (${hintRegion.id})`
        : 'keine passende Region im Katalog gefunden.';
      (error as RoutingError & { details?: Record<string, unknown> }).details = details;
      throw error;
    }
  }
}
