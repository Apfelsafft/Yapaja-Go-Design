/**
 * Downloadable-/buildable-regions catalog (E01-T5, überarbeitet in
 * `feat/gui-install-path`).
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
 *
 * ─── WARUM `url` OPTIONAL IST ───────────────────────────────────────────────
 * Der Katalog enthielt bis `feat/gui-install-path` zwei Einträge mit
 * `url: https://download.geofabrik.de/europe/<region>-latest.pmtiles`.
 * Diese URLs existieren nicht (404) — offenbar entstanden, indem an der
 * funktionierenden `.osm.pbf`-URL die Endung getauscht wurde. Geofabrik
 * verteilt OSM-ROHDATEN; PMTiles sind laut ADR-003 („Offline-Karten =
 * PMTiles, Protomaps-Builds von OSM") ein ERZEUGNIS daraus. Es gab damit
 * keinen funktionierenden Download-Weg, und die GUI bot trotzdem einen
 * „Herunterladen"-Knopf an, der sicher scheiterte.
 *
 * Konsequenz: ein Katalogeintrag beschreibt jetzt primär, WIE man an die
 * Kacheln kommt, nicht zwingend eine fertige Datei zum Herunterladen.
 *
 *   - `pbfUrl` (neu): der OSM-Extrakt, aus dem `services/tiles/
 *     build-pmtiles.sh` die Kacheln baut. Das ist der Weg, der tatsächlich
 *     funktioniert.
 *   - `url` (jetzt OPTIONAL): eine fertige `.pmtiles`-Datei zum direkten
 *     Herunterladen. Die mitgelieferten Einträge haben bewusst KEINE — es
 *     ist keine belegbare öffentliche Quelle bekannt. Die komplette,
 *     getestete Download-Maschinerie (Resume, sha256, Disk-Check, Jobs)
 *     bleibt erhalten und wird von operator-eigenen Quellen genutzt
 *     (`custom-sources.ts`), die vorher aus der GUI geprüft werden können.
 *
 * Ein Eintrag OHNE `url` ist kein Fehler: die Routen antworten dann mit
 * einem eigenen Fehlercode statt einen Download zu starten, der scheitern
 * muss (siehe `routes.ts`, `SOURCE_NOT_DOWNLOADABLE`).
 */

import { readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { REGION_NAME_PATTERN } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG_PATH = join(__dirname, 'regions-catalog.json');

/** Wie aufwändig der Kachelbau für diese Region ist. Steuert nur die
 *  Formulierung in der GUI (docs/installation.md §C: klein = auf der
 *  HAOS-VM baubar, groß = anderswo bauen). */
export type BuildEffort = 'small' | 'large';

export interface CatalogEntry {
  id: string;
  name: string;
  /** Fertige `.pmtiles`-Datei zum direkten Herunterladen. Optional — die
   *  mitgelieferten Einträge haben keine (siehe Modul-Kommentar). */
  url?: string;
  /** OSM-Extrakt, aus dem `services/tiles/build-pmtiles.sh` baut. */
  pbfUrl?: string;
  /** Ungefähre Größe der fertigen Kacheldatei, für Disk-Check und Anzeige. */
  sizeBytes: number;
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  sha256?: string;
  buildEffort?: BuildEffort;
  /** Freitext für die GUI (deutsch), z. B. Bau-Hinweise. */
  note?: string;
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

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

export function isValidCatalogEntry(raw: unknown): raw is CatalogEntry {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const entry = raw as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    REGION_NAME_PATTERN.test(entry.id) &&
    typeof entry.name === 'string' &&
    entry.name.length > 0 &&
    isOptionalNonEmptyString(entry.url) &&
    isOptionalNonEmptyString(entry.pbfUrl) &&
    typeof entry.sizeBytes === 'number' &&
    entry.sizeBytes > 0 &&
    isValidBounds(entry.bounds) &&
    (entry.sha256 === undefined || typeof entry.sha256 === 'string') &&
    (entry.buildEffort === undefined || entry.buildEffort === 'small' || entry.buildEffort === 'large') &&
    isOptionalNonEmptyString(entry.note)
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
  return raw.filter(isValidCatalogEntry);
}
