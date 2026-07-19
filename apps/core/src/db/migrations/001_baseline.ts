/**
 * 001_baseline -- the schema Yapaja Go shipped with BEFORE the migration
 * runner existed (E08-T6). These are the exact four `CREATE TABLE`
 * statements that used to live inline in `db/index.ts::createDb` --
 * column-for-column unchanged, so a brand-new database created through the
 * runner ends up byte-for-byte identical to what `createDb` produced before
 * this task. Do NOT edit the columns here; any real schema change belongs
 * in a NEW migration (002_*, 003_*, ...) that ALTERs this baseline.
 */

import type { Migration } from './types.js';

export const baseline: Migration = {
  version: 1,
  name: '001_baseline',
  up(db) {
    // Vehicle profiles.
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        height_m REAL NOT NULL,
        width_m REAL NOT NULL,
        length_m REAL NOT NULL,
        weight_t REAL NOT NULL,
        avg_speed_kmh REAL NOT NULL,
        hazmat INTEGER NOT NULL DEFAULT 0,
        avoid_motorway INTEGER NOT NULL DEFAULT 0,
        avoid_toll INTEGER NOT NULL DEFAULT 0,
        avoid_ferry INTEGER NOT NULL DEFAULT 0,
        avoid_unpaved INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Favorites table (E05-T3, docs/03 §2): category 'home' is kept unique at
    // the service layer (transactional replace-or-reject), not via a SQL
    // constraint, so the service can return a friendly 409 instead of a raw
    // SQLite constraint-violation error.
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        icon TEXT NOT NULL,
        category TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      )
    `);

    // History table (E05-T3, docs/03 §2): records search queries and/or
    // picked destinations. Capped at 100 rows, FIFO eviction (service
    // layer). `query`/`dest_*` are all nullable -- exactly one "half" may be
    // null, never both (enforced by the service, not this schema).
    db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        query TEXT,
        dest_lat REAL,
        dest_lon REAL,
        dest_name TEXT,
        ts TEXT NOT NULL
      )
    `);

    // Settings table (E07-T1): a general-purpose key/value store. `value` is
    // an arbitrary JSON-serialized blob -- this table deliberately knows
    // nothing about what any given key means (the `layouts` key holds the
    // widget-shell's per-mode layouts today; units/theme/online_fallback and
    // other future settings reuse the exact same table/service/routes
    // rather than each growing their own bespoke schema).
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  },
};
