/**
 * Public entry point for the migration runner (E08-T6). `db/index.ts`'s
 * `createDb` calls `runMigrations(db, path)` with the default, real
 * migration list below -- tests inject their own lists (fixtures with a
 * deliberately-failing migration, etc.) via the lower-level
 * `runMigrations(db, path, migrations)` in `runner.ts`.
 */

import type Database from 'better-sqlite3';
import { baseline } from './001_baseline.js';
import { addons } from './002_addons.js';
import { addonTokens } from './003_addon_tokens.js';
import { addonMqttEnabled } from './004_addon_mqtt_enabled.js';
import { runMigrations as runMigrationsWith } from './runner.js';
import type { Migration } from './types.js';

export type { Migration } from './types.js';
export { MigrationError } from './types.js';
export { backupDatabase, rotateBackups, MAX_BACKUPS } from './backup.js';

/** Every migration Yapaja Go ships, in the order they were added. */
export const MIGRATIONS: readonly Migration[] = [baseline, addons, addonTokens, addonMqttEnabled];

/** Runs the full, real migration list against `db` (the `createDb` path). */
export function runMigrations(db: Database.Database, dbPath: string): void {
  runMigrationsWith(db, dbPath, MIGRATIONS);
}
