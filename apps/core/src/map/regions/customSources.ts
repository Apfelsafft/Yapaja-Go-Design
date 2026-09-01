/**
 * Operator-eigene Kartenquellen (`feat/gui-install-path`).
 *
 * WOZU: Die mitgelieferten Katalogeinträge haben keine `.pmtiles`-URL —
 * es ist keine belegbare öffentliche Quelle bekannt (siehe `catalog.ts`).
 * Der reguläre Weg zu Kacheln ist deshalb der Bau aus einem OSM-Extrakt
 * (`services/tiles/build-pmtiles.sh`). Wer trotzdem eine erreichbare
 * `.pmtiles`-URL hat — eine selbst gehostete Datei im LAN, eine Datei auf
 * einem NAS, eine Quelle, die es zu einem späteren Zeitpunkt gibt —, muss
 * sie eintragen können, OHNE die ausgelieferte `regions-catalog.json` per
 * SSH zu editieren. Der Betreiber dieses Systems hat HAOS und arbeitet
 * ausschließlich über die GUI.
 *
 * WO: `<TILES_DIR>/custom-sources.json`. Bewusst neben den Kacheln und
 * nicht in der SQLite-Settings-Tabelle:
 *   - `TILES_DIR` ist im Add-on `/share/yapaja/tiles` und überlebt damit
 *     Add-on-Updates und Neuinstallationen (W-16), genau wie die Kacheln
 *     selbst;
 *   - `listRegions()` betrachtet ausschließlich `.pmtiles`-Dateien, eine
 *     `.json` daneben stört dort nichts;
 *   - kein DB-Handle nötig, dadurch bleiben die Regions-Routen in Tests
 *     ohne Datenbank lauffähig;
 *   - und die Datei ist über das „Samba share"-/„File editor"-Add-on auch
 *     von Hand les- und schreibbar, falls jemand das lieber tut.
 *
 * Eine kaputte/unlesbare Datei darf die Regionenliste nie umbringen: sie
 * wird als „keine eigenen Quellen" behandelt (und beim nächsten Schreiben
 * ersetzt), analog zu `loadCatalog()`s Filterverhalten.
 */

import { readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { isValidCatalogEntry, type CatalogEntry } from './catalog.js';

export const CUSTOM_SOURCES_FILE_NAME = 'custom-sources.json';

/** Obergrenze, damit eine versehentlich riesige Datei nicht jede Anfrage
 *  ausbremst. 200 eigene Quellen sind für ein Fahrzeug-Navi reichlich. */
export const MAX_CUSTOM_SOURCES = 200;

export function customSourcesPath(tilesDir: string): string {
  return join(tilesDir, CUSTOM_SOURCES_FILE_NAME);
}

/**
 * Liest die eigenen Quellen. Fehlt die Datei oder ist sie unbrauchbar,
 * kommt `[]` zurück -- nie ein Fehler.
 */
export async function loadCustomSources(tilesDir: string): Promise<CatalogEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(customSourcesPath(tilesDir), 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  // Eine eigene Quelle OHNE `url` wäre sinnlos (sie existiert genau, um eine
  // herunterladbare Datei zu benennen) -- deshalb hier strenger als der
  // mitgelieferte Katalog.
  return raw.filter((entry): entry is CatalogEntry => isValidCatalogEntry(entry) && typeof entry.url === 'string');
}

/** Schreibt atomar (temp + rename), damit ein paralleler Leser nie eine
 *  halbe Datei sieht -- dieselbe Disziplin wie beim Kachel-Swap (W-17). */
async function persist(tilesDir: string, entries: CatalogEntry[]): Promise<void> {
  const target = customSourcesPath(tilesDir);
  const temp = `${target}.tmp`;
  await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  await rename(temp, target);
}

export class CustomSourceError extends Error {
  code: 'DUPLICATE_ID' | 'TOO_MANY_SOURCES' | 'NOT_FOUND';

  constructor(code: 'DUPLICATE_ID' | 'TOO_MANY_SOURCES' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'CustomSourceError';
    this.code = code;
  }
}

/**
 * Fügt eine eigene Quelle hinzu. `builtinIds` sind die IDs des
 * mitgelieferten Katalogs -- eine eigene Quelle darf keine davon
 * überschatten, sonst wäre nicht mehr klar, welcher Eintrag gemeint ist.
 */
export async function addCustomSource(
  tilesDir: string,
  entry: CatalogEntry,
  builtinIds: readonly string[],
): Promise<CatalogEntry[]> {
  const existing = await loadCustomSources(tilesDir);
  if (existing.length >= MAX_CUSTOM_SOURCES) {
    throw new CustomSourceError(
      'TOO_MANY_SOURCES',
      `Es sind bereits ${MAX_CUSTOM_SOURCES} eigene Quellen eingetragen.`,
    );
  }
  if (builtinIds.includes(entry.id) || existing.some((candidate) => candidate.id === entry.id)) {
    throw new CustomSourceError('DUPLICATE_ID', `Es gibt bereits eine Quelle mit der ID '${entry.id}'.`);
  }
  const next = [...existing, entry];
  await persist(tilesDir, next);
  return next;
}

/** Entfernt eine eigene Quelle. Wirft `NOT_FOUND`, wenn es sie nicht gibt
 *  (damit die GUI nicht stillschweigend „erfolgreich" meldet). */
export async function removeCustomSource(tilesDir: string, id: string): Promise<CatalogEntry[]> {
  const existing = await loadCustomSources(tilesDir);
  const next = existing.filter((entry) => entry.id !== id);
  if (next.length === existing.length) {
    throw new CustomSourceError('NOT_FOUND', `Keine eigene Quelle mit der ID '${id}'.`);
  }
  await persist(tilesDir, next);
  return next;
}
