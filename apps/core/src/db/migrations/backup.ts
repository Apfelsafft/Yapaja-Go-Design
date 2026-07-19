/**
 * File-DB backup + rotation for the migration runner (E08-T6, Wargame
 * W-16). Pure `fs` sync calls -- consistent with the rest of bootstrap
 * (`db/index.ts` already uses `mkdirSync`/`existsSync` synchronously) and
 * with better-sqlite3 itself being synchronous.
 */

import { copyFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { basename, dirname, join } from 'path';
import type Database from 'better-sqlite3';

/** Keep at most this many `.bak` files per DB (W-16 plausibility: "kein Disk-Fressen"). */
export const MAX_BACKUPS = 3;

const BACKUP_SUFFIX = '.bak';

// Monotonically increasing per-process counter, zero-padded into the backup
// filename. Guarantees strictly increasing, lexicographically-sortable,
// COLLISION-FREE names even when several backups are taken within the same
// millisecond (e.g. in a fast test loop) -- a plain `Date.now()`/ISO
// timestamp alone cannot promise that.
let backupSeq = 0;

function nextBackupSuffix(): string {
  backupSeq += 1;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${ts}-${String(backupSeq).padStart(6, '0')}`;
}

/**
 * Backs up the DB file at `dbPath` before pending migrations run, then
 * rotates old backups down to `MAX_BACKUPS`. No-op (returns `null`) for
 * `:memory:` DBs -- there is no file to copy, and in-memory tests must keep
 * working without a backup step.
 *
 * WAL mode buffers recent writes in a separate `-wal` file; a plain file
 * copy of just the main DB file could miss them. `wal_checkpoint(TRUNCATE)`
 * flushes the WAL back into the main file (and truncates it) BEFORE the
 * copy, so the `.bak` is a complete, self-contained snapshot.
 */
export function backupDatabase(db: Database.Database, dbPath: string): string | null {
  if (dbPath === ':memory:') {
    return null;
  }
  if (!existsSync(dbPath)) {
    // Nothing on disk yet to protect (shouldn't normally happen -- opening
    // a file-backed better-sqlite3 handle creates the file -- but guard
    // against it rather than throwing from a safety step).
    return null;
  }

  db.pragma('wal_checkpoint(TRUNCATE)');

  const backupPath = `${dbPath}.${nextBackupSuffix()}${BACKUP_SUFFIX}`;
  copyFileSync(dbPath, backupPath);
  rotateBackups(dbPath);
  return backupPath;
}

/** Deletes the oldest `.bak` files for `dbPath` beyond `maxBackups`. */
export function rotateBackups(dbPath: string, maxBackups: number = MAX_BACKUPS): void {
  const dir = dirname(dbPath);
  const base = basename(dbPath);
  const prefix = `${base}.`;

  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(BACKUP_SUFFIX))
    .sort(); // zero-padded counter in the name => lexicographic == chronological

  const excess = backups.length - maxBackups;
  if (excess <= 0) {
    return;
  }
  for (const f of backups.slice(0, excess)) {
    unlinkSync(join(dir, f));
  }
}
