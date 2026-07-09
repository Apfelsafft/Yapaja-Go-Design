/**
 * Lists installed PMTiles regions with metadata parsed from their headers.
 */

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { REGION_NAME_PATTERN } from './paths.js';
import { readPMTilesHeader, tileTypeName, compressionName } from './pmtiles-metadata.js';

export interface MapRegionInfo {
  region: string;
  file: string;
  size_bytes: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  minzoom: number;
  maxzoom: number;
  tile_type: string;
  compression: string;
}

export interface RegionLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
}

const TILES_EXTENSION = '.pmtiles';

/**
 * List all installed regions under tilesDir. Files that cannot be parsed as
 * valid PMTiles (corrupt/empty/wrong magic) or whose name doesn't fit our
 * region-name pattern are skipped with a warning, never crashing the
 * endpoint.
 */
export async function listRegions(tilesDir: string, log: RegionLogger): Promise<MapRegionInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(tilesDir);
  } catch {
    // tilesDir missing entirely (e.g. fresh install with no data yet).
    return [];
  }

  const results: MapRegionInfo[] = [];

  for (const file of entries) {
    if (!file.endsWith(TILES_EXTENSION)) {
      continue;
    }
    const region = file.slice(0, -TILES_EXTENSION.length);
    if (!REGION_NAME_PATTERN.test(region)) {
      log.warn({ file }, 'Skipping .pmtiles file with an invalid region name');
      continue;
    }

    const filePath = join(tilesDir, file);
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        continue;
      }
      const header = await readPMTilesHeader(filePath);
      results.push({
        region,
        file,
        size_bytes: fileStat.size,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        tile_type: tileTypeName(header.tileType),
        compression: compressionName(header.tileCompression),
      });
    } catch (err) {
      log.warn(
        { file, error: (err as Error).message },
        'Skipping unreadable or invalid .pmtiles file',
      );
    }
  }

  results.sort((a, b) => a.region.localeCompare(b.region));
  return results;
}
