/**
 * Region-name validation and safe path resolution for the tiles directory.
 * Keeps all path-traversal defenses in one place.
 */

import { join, resolve, sep } from 'path';

// Region names must be a plain slug: no dots, slashes, or other characters
// that could be abused for path traversal or encoding tricks.
export const REGION_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function resolveTilesDir(): string {
  return process.env.TILES_DIR || 'data/tiles';
}

export function tileFileName(region: string): string {
  return `${region}.pmtiles`;
}

/**
 * Resolve a validated region name to an absolute file path inside tilesDir.
 * Returns null if the region name is invalid, or if (defense in depth) the
 * resolved path would escape tilesDir.
 */
export function resolveRegionFilePath(tilesDir: string, region: string): string | null {
  if (!REGION_NAME_PATTERN.test(region)) {
    return null;
  }

  const resolvedTilesDir = resolve(tilesDir);
  const resolvedFilePath = resolve(join(resolvedTilesDir, tileFileName(region)));

  if (
    resolvedFilePath !== resolvedTilesDir &&
    !resolvedFilePath.startsWith(resolvedTilesDir + sep)
  ) {
    return null;
  }

  return resolvedFilePath;
}

/**
 * Parse a `:regionParam` route param of the form `<region>.pmtiles` into a
 * validated region name, or null if it doesn't match the expected shape.
 */
export function parseRegionParam(regionParam: string): string | null {
  if (!regionParam.endsWith('.pmtiles')) {
    return null;
  }
  const region = regionParam.slice(0, -'.pmtiles'.length);
  if (!REGION_NAME_PATTERN.test(region)) {
    return null;
  }
  return region;
}

/**
 * Verzeichnis mit dem Valhalla-Routinggraphen.
 *
 * Dieselbe Umgebungsvariable, die das Add-on-Init-Skript setzt
 * (`VALHALLA_TILES_DIR`, siehe `yapaja_go/rootfs/etc/yapaja/`), und derselbe
 * Default wie in `yapaja-build-graph` -- laufen die beiden auseinander,
 * meldet die Übersicht „nicht gebaut" fuer einen Graphen, der da ist.
 */
export function resolveGraphDir(): string {
  return process.env.VALHALLA_TILES_DIR || 'data/valhalla/tiles';
}
