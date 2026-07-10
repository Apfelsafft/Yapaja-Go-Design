/**
 * Downloadable-regions catalog (E01-T5).
 *
 * Reads `regions-catalog.json` (committed alongside this module) at
 * runtime rather than importing it as a JSON module: that keeps the path
 * overridable via `MAP_REGIONS_CATALOG_FILE`, which is how tests point the
 * catalog at fixture entries whose `url` targets a local mock HTTP server
 * instead of a real host (no test may hit a real foreign host).
 *
 * `tsup.config.ts` copies this JSON file next to the bundled `dist/index.js`
 * (same reason `position/simulator`'s GPX fixtures are copied there) so the
 * default (non-overridden) path still resolves in a built/production core.
 */

import { readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { REGION_NAME_PATTERN } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = join(__dirname, 'regions-catalog.json');

export interface CatalogEntry {
  id: string;
  name: string;
  url: string;
  sizeBytes: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  sha256?: string;
}

function isValidBounds(bounds: unknown): bounds is [number, number, number, number] {
  if (!Array.isArray(bounds) || bounds.length !== 4) {
    return false;
  }
  const [minLon, minLat, maxLon, maxLat] = bounds as unknown[];
  return (
    typeof minLon === 'number' &&
    typeof minLat === 'number' &&
    typeof maxLon === 'number' &&
    typeof maxLat === 'number' &&
    minLon >= -180 &&
    minLon <= 180 &&
    maxLon >= -180 &&
    maxLon <= 180 &&
    minLat >= -90 &&
    minLat <= 90 &&
    maxLat >= -90 &&
    maxLat <= 90 &&
    minLon <= maxLon &&
    minLat <= maxLat
  );
}

function isValidEntry(raw: unknown): raw is CatalogEntry {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const entry = raw as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    REGION_NAME_PATTERN.test(entry.id) &&
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    typeof entry.url === 'string' &&
    entry.url.length > 0 &&
    typeof entry.sizeBytes === 'number' &&
    entry.sizeBytes > 0 &&
    isValidBounds(entry.bounds) &&
    (entry.sha256 === undefined || typeof entry.sha256 === 'string')
  );
}

/** Resolves the catalog file path, honoring the test/ops override env var. */
export function resolveCatalogPath(): string {
  return process.env.MAP_REGIONS_CATALOG_FILE
    ? resolve(process.env.MAP_REGIONS_CATALOG_FILE)
    : DEFAULT_CATALOG_PATH;
}

/**
 * Loads and validates the regions catalog. Entries that don't fit the
 * expected shape (or whose `id` isn't a safe filename slug, matching the
 * same pattern the tiles/regions routes already enforce) are dropped
 * rather than crashing the endpoint -- a malformed catalog must never take
 * down region listing.
 */
export async function loadCatalog(): Promise<CatalogEntry[]> {
  const path = resolveCatalogPath();
  let raw: unknown;
  try {
    const text = await readFile(path, 'utf-8');
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to read regions catalog at ${path}: ${(err as Error).message}`);
  }
  if (!Array.isArray(raw)) {
    throw new Error(`Regions catalog at ${path} must be a JSON array`);
  }
  return raw.filter(isValidEntry);
}
