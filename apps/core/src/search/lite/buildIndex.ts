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

export function buildLiteIndexFile(records: readonly NormalizedRecord[], dbPath: string): void {
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
        population INTEGER
      );

      CREATE VIRTUAL TABLE lite_search USING fts5(
        name,
        tokenize = 'trigram',
        content = 'places',
        content_rowid = 'id'
      );
    `);

    const insertPlace = db.prepare(
      'INSERT INTO places (name, kind, lat, lon, population) VALUES (@name, @kind, @lat, @lon, @population)',
    );

    const insertAll = db.transaction((rows: readonly NormalizedRecord[]) => {
      for (const row of rows) {
        insertPlace.run({
          name: row.name,
          kind: row.kind,
          lat: row.lat,
          lon: row.lon,
          population: row.population ?? null,
        });
      }
    });
    insertAll(records);

    // Bulk-populate the FTS index from the now-fully-written content table
    // in one pass -- cheaper than a trigger-per-row for a build-once,
    // read-many index (there are never any updates to an already-built
    // lite_search.db; a rebuild always starts from a fresh file).
    db.exec('INSERT INTO lite_search(rowid, name) SELECT id, name FROM places;');
    db.exec("INSERT INTO lite_search(lite_search) VALUES('optimize');");
  } finally {
    db.close();
  }
}
