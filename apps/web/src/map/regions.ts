/**
 * Fetches installed map regions from the core (`GET /api/v1/map/regions`).
 *
 * Uses a path relative to `import.meta.env.BASE_URL` rather than a hardcoded
 * `/api/...` path, so this keeps working when the app is served under an
 * ingress sub-path (W-15) — see docs/01-architecture.md ADR-008.
 */

export interface MapRegionSummary {
  region: string;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

interface RegionsApiResponse {
  data: MapRegionSummary[];
}

function regionsUrl(): string {
  return `${import.meta.env.BASE_URL}api/v1/map/regions`;
}

/**
 * Fetch installed regions. Returns an empty array (never throws) on network
 * or parse failure, so callers can uniformly render the "no map installed"
 * state instead of crashing.
 */
export async function fetchRegions(): Promise<MapRegionSummary[]> {
  try {
    const response = await fetch(regionsUrl());
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as RegionsApiResponse;
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** Builds the relative pmtiles:// source URL for a given region name. */
export function pmtilesUrlForRegion(region: string): string {
  return `pmtiles://${import.meta.env.BASE_URL}tiles/${region}.pmtiles`;
}
