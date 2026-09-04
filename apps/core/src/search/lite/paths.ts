/**
 * Wo die Suchindizes liegen — seit 0.5.0 EINER JE REGION.
 *
 * ─── WARUM DAS GEAENDERT WURDE ──────────────────────────────────────────────
 * Bis 0.4.0 gab es genau eine Datei `lite_search.db` fuer alles. „Suche bauen"
 * bei einer Region ersetzte damit den Index der anderen — wer Liechtenstein
 * und Rheinland-Pfalz installiert hatte, konnte immer nur in einer von beiden
 * suchen. Fuer den Plan, Karten fuer Deutschland, Frankreich, die Schweiz und
 * Oesterreich anzubieten, war das der Blocker: vier Laender herunterladen und
 * in dreien nicht suchen koennen.
 *
 * Jetzt: `lite_search-<region>.db` je Region, und gesucht wird in ALLEN
 * gleichzeitig (siehe `liteBackend.ts`).
 *
 * ─── DIE ALTE DATEI BLEIBT GUELTIG ──────────────────────────────────────────
 * Ein bestehender `lite_search.db` wird weiter gelesen. Sonst waere die Suche
 * nach einem Update erst einmal weg, bis jemand neu baut — und ein Neubau
 * dauert bei einem grossen Extrakt Stunden. Er verschwindet erst, wenn
 * dieselbe Region neu gebaut wurde und ihn damit ersetzt (`cli.ts`).
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Namensmuster eines regionsbezogenen Index. */
const REGION_DB_PREFIX = 'lite_search-';
const DB_SUFFIX = '.db';

/** Der Index aus der Zeit vor 0.5.0: eine Datei fuer alle Regionen. */
export const LEGACY_LITE_SEARCH_DB = 'lite_search.db';

/**
 * Das Verzeichnis mit den Suchindizes.
 *
 * `LITE_SEARCH_DB_PATH` zeigt historisch auf eine DATEI (das Add-on-Init
 * setzt sie so). Genommen wird deshalb ihr Verzeichnis — so bleibt eine
 * bestehende Konfiguration gueltig, ohne dass jemand etwas umstellen muss.
 */
export function resolveLiteSearchDir(): string {
  const explicit = process.env.LITE_SEARCH_DB_PATH;
  if (explicit && explicit.trim().length > 0) {
    return dirname(explicit);
  }
  return 'data/lite-search';
}

/** Der Pfad des Index dieser Region. */
export function liteSearchDbPathForRegion(dir: string, region: string): string {
  return join(dir, `${REGION_DB_PREFIX}${region}${DB_SUFFIX}`);
}

/** Die Region zu einem Dateinamen, oder `null` fuer den alten Sammelindex. */
export function regionFromLiteSearchFile(fileName: string): string | null {
  if (!fileName.startsWith(REGION_DB_PREFIX) || !fileName.endsWith(DB_SUFFIX)) {
    return null;
  }
  return fileName.slice(REGION_DB_PREFIX.length, -DB_SUFFIX.length) || null;
}

/**
 * Alle Indexdateien im Verzeichnis, alphabetisch — regionsbezogene UND der
 * alte Sammelindex.
 *
 * Wirft nie: ein fehlendes Verzeichnis heisst „noch nichts gebaut", und das
 * ist ein normaler Zustand (frische Installation), kein Fehler.
 *
 * Bewusst NICHT jede `*.db`: waehrend eines Baus liegt hier eine
 * `….db.tmp-<pid>`, und ein halb geschriebener Index darf nie in eine
 * Suchantwort geraten.
 */
export function listLiteSearchDbFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(
      (name) =>
        name === LEGACY_LITE_SEARCH_DB ||
        (name.startsWith(REGION_DB_PREFIX) && name.endsWith(DB_SUFFIX)),
    )
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Rueckwaertskompatibler Einzelpfad.
 *
 * Nur noch fuer Aufrufer, die genau eine Datei erwarten (Altbestand). Neuer
 * Code nimmt `resolveLiteSearchDir` + `listLiteSearchDbFiles`.
 */
export function resolveLiteSearchDbPath(): string {
  return process.env.LITE_SEARCH_DB_PATH || join('data', 'lite-search', LEGACY_LITE_SEARCH_DB);
}
