/**
 * SQLite migration runner (E08-T6, Wargame W-16 -- data-integrity-critical:
 * user data (profiles, favorites, layouts, onboarding state) must survive
 * updates). See `README.md` in this directory for how to add a migration
 * and how to roll back manually from a `.bak`.
 */

import type Database from 'better-sqlite3';
import { backupDatabase } from './backup.js';
import type { Migration } from './types.js';
import { MigrationError } from './types.js';

const SCHEMA_VERSION_TABLE = 'schema_version';

/** The four tables `createDb` used to build inline, pre-runner (baseline). */
const BASELINE_TABLES = ['profiles', 'favorites', 'history', 'settings'];

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return row !== undefined;
}

function baselineTablesExist(db: Database.Database): boolean {
  return BASELINE_TABLES.every((t) => tableExists(db, t));
}

function ensureVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function getCurrentVersion(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(version), 0) as v FROM ${SCHEMA_VERSION_TABLE}`)
    .get() as { v: number };
  return row.v;
}

function recordVersion(db: Database.Database, version: number, name: string): void {
  db.prepare(
    `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`,
  ).run(version, name, new Date().toISOString());
}

/**
 * Applies every migration whose `version` is greater than the DB's current
 * recorded version, in ascending order, each inside its own transaction.
 *
 * - **Fresh DB** (no `schema_version` table, none of the 4 baseline tables
 *   either): current version starts at 0, so EVERY migration -- including
 *   001_baseline, which creates the 4 tables -- runs normally.
 * - **Adoption** (no `schema_version` table, but the 4 baseline tables
 *   already exist -- an install from before this task): the DB is stamped
 *   at the baseline version WITHOUT re-running 001_baseline's `up()`. This
 *   is the critical no-data-loss path: baseline's `up()` only uses
 *   `CREATE TABLE IF NOT EXISTS` so re-running it would technically be
 *   harmless too, but adoption makes the invariant explicit and future
 *   migrations don't get to assume `up()` re-runs are always safe.
 * - **Already migrated**: current version is read from `schema_version`;
 *   if nothing is pending this is a pure no-op (no backup, no writes) --
 *   the required idempotency/determinism guarantee.
 *
 * A backup is taken ONCE, before the first pending migration in this call
 * runs (not once per migration) -- see `backup.ts`. On any migration
 * failure the failing migration's transaction is rolled back by
 * better-sqlite3, the backup already taken is left on disk untouched, and
 * this throws a `MigrationError` that must propagate out of `createDb` --
 * the Core must refuse to start on a half-applied schema.
 */
export function runMigrations(
  db: Database.Database,
  dbPath: string,
  migrations: readonly Migration[],
): void {
  const hadVersionTable = tableExists(db, SCHEMA_VERSION_TABLE);
  ensureVersionTable(db);

  let currentVersion: number;
  if (!hadVersionTable && baselineTablesExist(db)) {
    const baseline = migrations.find((m) => m.version === 1);
    if (!baseline) {
      throw new MigrationError(
        'Cannot adopt existing database: no version-1 (baseline) migration is registered.',
      );
    }
    recordVersion(db, baseline.version, baseline.name);
    currentVersion = baseline.version;
  } else {
    currentVersion = getCurrentVersion(db);
  }

  const pending = migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return;
  }

  backupDatabase(db, dbPath);

  for (const migration of pending) {
    try {
      const applyInTransaction = db.transaction(() => {
        migration.up(db);
        recordVersion(db, migration.version, migration.name);
      });
      applyInTransaction();
    } catch (err) {
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) failed -- database left at version ` +
          `${currentVersion}, the pre-migration backup was preserved. Refusing to start on a ` +
          `half-applied schema. Original error: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    currentVersion = migration.version;
  }
}
