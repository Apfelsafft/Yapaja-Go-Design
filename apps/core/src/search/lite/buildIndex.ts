/**
 * Builds `lite_search.db` from an already-normalized record array (E05-T5,
 * W-12). Two tables, exactly as the task spec asks for:
 *
 *  - `places`: the companion metadata table (name, kind, lat, lon, raw rank
 *    inputs -- currently just `population`, best-effort/unused today, see
 *    `extract.ts`'s doc comment).
 *  - `lite_search`: a `content=`-linked FTS5 virtual table over
 *    `places.name`, `tokenize='trigram'` for typo/substring tolerance
 *    (verified to work natively with this repo's pinned better-sqlite3 --
 *    no custom SQLite build, see the task's feasibility note).
 *
 * `journal_mode` is deliberately left at SQLite's default ('delete', a
 * single rollback-journal file that's removed on commit) rather than WAL:
 * WAL would leave `-wal`/`-shm` sidecar files next to `lite_search.db`,
 * which would break the caller's plain single-file atomic rename (the same
 * "temp file + rename" discipline `build-tiles.sh` uses for its tiles
 * directory, W-17) -- a single `.db` file is what gets swapped in
 * `LiteIndexCli`/`build-lite-index.sh`.
 *
 * This function is pure I/O against ONE fresh file (never opens an existing
 * db to update it in place) -- callers are responsible for writing to a
 * temp path and renaming it into place afterwards (see `cli.ts`).
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { NormalizedRecord } from './extract.js';

/** Was neben den Datensaetzen ueber diesen Index festgehalten wird. */
export interface LiteIndexMeta {
  /** Die Region, aus der er gebaut wurde. */
  region?: string;
}

export function buildLiteIndexFile(
  records: readonly NormalizedRecord[],
  dbPath: string,
  meta: LiteIndexMeta = {},
): void {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE places (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        population INTEGER,
        -- Nur bei POIs gesetzt: der OSM-Tag-Wert (supermarket, camp_site, ...).
        category TEXT,
        -- Name PLUS deutsche Kategoriebegriffe. Diese Spalte -- nicht name --
        -- speist die Volltextsuche, damit „Supermarkt" den Laden findet, der
        -- in den Daten „REWE" heisst. Bei Orten und Strassen steht hier
        -- schlicht der Name, das Verhalten bleibt dort unveraendert.
        search_text TEXT NOT NULL,
        -- Strasse und Hausnummer, sofern getaggt. Nur zum Anzeigen: sie
        -- speisen die Volltextsuche NICHT, sonst faende "Beethoven" jeden
        -- Laden in der Beethovenstrasse statt der Strasse selbst.
        address TEXT,
        -- Der Ort, in dem der Eintrag liegt (aus addr:city oder abgeleitet).
        locality TEXT
      );

      -- Was in diesem Index steckt und wann er gebaut wurde. Es gibt EINEN
      -- Index fuer alle Regionen -- "Suche bauen" ersetzt ihn. Ohne diese
      -- Auskunft sieht niemand, welche Region gerade drin ist; genau das war
      -- gemeldet ("ich sehe nicht, dass bereits etwas erstellt wurde").
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE lite_search USING fts5(
        search_text,
        tokenize = 'trigram',
        content = 'places',
        content_rowid = 'id'
      );
    `);

    const insertPlace = db.prepare(
      'INSERT INTO places (name, kind, lat, lon, population, category, search_text, address, locality) ' +
        'VALUES (@name, @kind, @lat, @lon, @population, @category, @search_text, @address, @locality)',
    );

    const insertAll = db.transaction((rows: readonly NormalizedRecord[]) => {
      for (const row of rows) {
        insertPlace.run({
          name: row.name,
          kind: row.kind,
          lat: row.lat,
          lon: row.lon,
          population: row.population ?? null,
          category: row.category ?? null,
          // Der Name gehoert IMMER hinein -- sonst faende „REWE" den Laden
          // nicht mehr, sobald er Kategoriebegriffe hat.
          search_text: row.searchTerms ? `${row.name} ${row.searchTerms}` : row.name,
          address: row.address ?? null,
          locality: row.locality ?? null,
        });
      }
    });
    insertAll(records);

    // Bulk-populate the FTS index from the now-fully-written content table
    // in one pass -- cheaper than a trigger-per-row for a build-once,
    // read-many index (there are never any updates to an already-built
    // lite_search.db; a rebuild always starts from a fresh file).
    db.exec('INSERT INTO lite_search(rowid, search_text) SELECT id, search_text FROM places;');
    db.exec("INSERT INTO lite_search(lite_search) VALUES('optimize');");

    // Beim Bauen festgehalten, nicht beim Lesen erraten: die Datei wandert
    // per rename an ihren Platz, ihr Zeitstempel sagt also nichts Sicheres
    // ueber den Bau aus.
    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insertMeta.run('built_at', new Date().toISOString());
    insertMeta.run('record_count', String(records.length));
    if (meta.region) insertMeta.run('region', meta.region);
  } finally {
    db.close();
  }
}
