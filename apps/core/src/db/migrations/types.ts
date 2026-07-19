/**
 * Migration runner types (E08-T6, Wargame W-16).
 */

import type Database from 'better-sqlite3';

/**
 * A single numbered schema migration. `up` is pure DDL/SQL run against the
 * live `better-sqlite3` handle -- synchronous, like every other DB call in
 * this codebase (better-sqlite3 has no async API).
 *
 * Migrations are applied in ascending `version` order, each wrapped in its
 * own transaction by the runner (see `runner.ts`) -- an individual
 * migration function should NOT open its own transaction.
 */
export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/**
 * Thrown by `runMigrations` when a migration's `up()` throws. The runner has
 * already rolled back that migration's transaction (better-sqlite3's
 * `db.transaction()` does this automatically) before this is thrown, so the
 * schema is left at the last successfully-applied version -- never
 * half-applied. Callers (ultimately `createDb`) must let this propagate;
 * swallowing it would mean booting on a schema the code doesn't understand.
 */
export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}
