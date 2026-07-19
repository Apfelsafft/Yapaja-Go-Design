/**
 * Migration runner tests (E08-T6, Wargame W-16). File-based cases use a real
 * temp-dir DB (`mkdtempSync`) so backup/rotation/adoption are exercised
 * against actual files on disk; pure-schema cases use `:memory:`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { runMigrations } from './runner.js';
import { MigrationError } from './types.js';
import type { Migration } from './types.js';
import { baseline } from './001_baseline.js';
import { MIGRATIONS } from './index.js';

const BASELINE_TABLES = ['profiles', 'favorites', 'history', 'settings'];

function tableNames(db: Database.Database): string[] {
  return (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function currentVersion(db: Database.Database): number {
  const row = db.prepare(`SELECT COALESCE(MAX(version), 0) as v FROM schema_version`).get() as { v: number };
  return row.v;
}

const dirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yapaja-migrations-'));
  dirs.push(dir);
  return join(dir, 'test.db');
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('runMigrations -- fresh schema', () => {
  it('creates all 4 baseline tables on a fresh :memory: DB and records the baseline version', () => {
    const db = new Database(':memory:');
    runMigrations(db, ':memory:', MIGRATIONS);

    const names = tableNames(db);
    for (const t of BASELINE_TABLES) {
      expect(names).toContain(t);
    }
    expect(currentVersion(db)).toBe(1);
    db.close();
  });

  it('is a byte-for-byte-schema match for the old inline createDb (same columns)', () => {
    const db = new Database(':memory:');
    runMigrations(db, ':memory:', MIGRATIONS);

    const profileCols = (db.prepare(`PRAGMA table_info(profiles)`).all() as { name: string }[]).map((c) => c.name);
    expect(profileCols).toEqual([
      'id',
      'name',
      'height_m',
      'width_m',
      'length_m',
      'weight_t',
      'avg_speed_kmh',
      'hazmat',
      'avoid_motorway',
      'avoid_toll',
      'avoid_ferry',
      'avoid_unpaved',
      'is_active',
    ]);
    db.close();
  });
});

describe('runMigrations -- idempotency', () => {
  it('running twice on an already-migrated :memory: DB is a no-op the second time', () => {
    const db = new Database(':memory:');
    runMigrations(db, ':memory:', MIGRATIONS);
    expect(currentVersion(db)).toBe(1);

    expect(() => runMigrations(db, ':memory:', MIGRATIONS)).not.toThrow();
    expect(currentVersion(db)).toBe(1);
    db.close();
  });

  it('running twice on an already-migrated file DB creates no new backup', () => {
    const dbPath = tempDbPath();
    const db = new Database(dbPath);
    runMigrations(db, dbPath, MIGRATIONS);

    const dir = dirname(dbPath);
    const backupsAfterFirst = readdirSync(dir).filter((f) => f.endsWith('.bak'));

    runMigrations(db, dbPath, MIGRATIONS);
    const backupsAfterSecond = readdirSync(dir).filter((f) => f.endsWith('.bak'));

    expect(backupsAfterSecond).toEqual(backupsAfterFirst);
    expect(currentVersion(db)).toBe(1);
    db.close();
  });
});

describe('runMigrations -- failing migration', () => {
  const failingMigration: Migration = {
    version: 2,
    name: '002_deliberately_fails',
    up: () => {
      throw new Error('boom: simulated migration failure');
    },
  };

  it('throws a MigrationError and leaves an :memory: DB at the last good version, tables intact', () => {
    const db = new Database(':memory:');
    expect(() => runMigrations(db, ':memory:', [baseline, failingMigration])).toThrow(MigrationError);

    // Version stayed at the baseline (1), NOT advanced to the failed migration's 2.
    expect(currentVersion(db)).toBe(1);
    // The good baseline tables are intact.
    const names = tableNames(db);
    for (const t of BASELINE_TABLES) {
      expect(names).toContain(t);
    }
    db.close();
  });

  it('for a file DB: leaves the pre-migration backup intact and the schema at the last good version', () => {
    const dbPath = tempDbPath();
    const db = new Database(dbPath);

    expect(() => runMigrations(db, dbPath, [baseline, failingMigration])).toThrow(MigrationError);

    expect(currentVersion(db)).toBe(1);
    const names = tableNames(db);
    for (const t of BASELINE_TABLES) {
      expect(names).toContain(t);
    }

    const dir = dirname(dbPath);
    const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
    for (const b of backups) {
      expect(existsSync(join(dir, b))).toBe(true);
    }
    db.close();
  });

  it('error message names the failing migration and does not swallow the cause', () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db, ':memory:', [baseline, failingMigration]);
      expect.unreachable('expected runMigrations to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationError);
      const migrationErr = err as MigrationError;
      expect(migrationErr.message).toContain('002_deliberately_fails');
      expect(migrationErr.cause).toBeInstanceOf(Error);
    }
    db.close();
  });
});

describe('runMigrations -- backup rotation', () => {
  it('keeps at most 3 backups across more than 3 migration events on a file DB', () => {
    const dbPath = tempDbPath();
    const dir = dirname(dbPath);

    // Simulate 5 separate "release" events, each adding exactly one new
    // no-op migration on top of the baseline -- each run has exactly one
    // pending migration, so each run takes exactly one backup.
    let migrations: Migration[] = [baseline];
    let db = new Database(dbPath);
    runMigrations(db, dbPath, migrations); // event 1: applies baseline itself
    db.close();

    for (let v = 2; v <= 5; v++) {
      migrations = [...migrations, { version: v, name: `00${v}_noop`, up: () => {} }];
      db = new Database(dbPath);
      runMigrations(db, dbPath, migrations);
      db.close();
    }

    const backups = readdirSync(dir).filter((f) => f.endsWith('.bak'));
    expect(backups.length).toBe(3);

    // Final DB has all 5 migrations recorded as the current version.
    db = new Database(dbPath);
    expect(currentVersion(db)).toBe(5);
    db.close();
  });
});

describe('runMigrations -- baseline adoption (no data loss)', () => {
  it('stamps a pre-existing (pre-runner) DB at baseline version 1 and keeps existing rows', () => {
    const dbPath = tempDbPath();

    // Simulate an install from BEFORE this task: build the 4 baseline
    // tables directly (no schema_version table at all) and seed a profile
    // row, exactly like the old inline createDb + a real user would leave
    // behind.
    const seedDb = new Database(dbPath);
    baseline.up(seedDb);
    seedDb
      .prepare(
        `INSERT INTO profiles (id, name, height_m, width_m, length_m, weight_t, avg_speed_kmh, hazmat, avoid_motorway, avoid_toll, avoid_ferry, avoid_unpaved, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('profile-1', 'Camper', 3.0, 2.2, 6.5, 3.5, 85, 0, 0, 0, 0, 0, 1);
    seedDb.close();

    // No schema_version table exists yet on disk.
    const preCheck = new Database(dbPath);
    const hasVersionTable = preCheck
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`)
      .get();
    expect(hasVersionTable).toBeUndefined();
    preCheck.close();

    // Now run the real runner against this pre-existing DB.
    const db = new Database(dbPath);
    runMigrations(db, dbPath, MIGRATIONS);

    expect(currentVersion(db)).toBe(1);
    const row = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get('profile-1') as { name: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.name).toBe('Camper');
    db.close();
  });
});
