/**
 * Database initialization and singleton access
 * Uses SQLite with WAL mode for concurrent reads
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { VehicleProfile, Favorite, HistoryEntry } from '@yapaja/shared';
import { runMigrations } from './migrations/index.js';

let dbInstance: Database.Database | null = null;

/**
 * Initializes database and creates schema if needed
 * Creates the data directory if it doesn't exist
 */
export function createDb(path: string): Database.Database {
  // Create directory if it doesn't exist (synchronously for bootstrap)
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(path);

  // Enable WAL mode for better concurrent reads
  db.pragma('journal_mode = WAL');

  // E08-T6 (Wargame W-16): schema creation/evolution now goes through the
  // numbered migration runner instead of inline `CREATE TABLE`s. For a
  // brand-new DB this produces the exact same 4 tables (`001_baseline`,
  // see `db/migrations/001_baseline.ts`, moved verbatim from what used to
  // be here). For an EXISTING DB from before this task, it adopts the
  // schema at the baseline version without re-running -- and without ever
  // dropping/recreating -- anything, so existing profiles/favorites/
  // history/settings survive. A file DB is backed up before any pending
  // migration runs (rotated to the 3 most recent backups). If a migration
  // fails, this throws a `MigrationError` that propagates out of
  // `createDb`/`getDb` -- the Core must refuse to start rather than run on
  // a half-applied schema (see `db/migrations/README.md`).
  runMigrations(db, path);

  return db;
}

/**
 * Get or create the database singleton
 */
export function getDb(): Database.Database {
  if (!dbInstance) {
    const dbPath = process.env.DB_PATH || 'data/db/yapaja.db';
    dbInstance = createDb(dbPath);
  }
  return dbInstance;
}

export interface DatabaseRow {
  id: string;
  name: string;
  height_m: number;
  width_m: number;
  length_m: number;
  weight_t: number;
  avg_speed_kmh: number;
  hazmat: number;
  avoid_motorway: number;
  avoid_toll: number;
  avoid_ferry: number;
  avoid_unpaved: number;
  is_active: number;
  /** Migration 005. `null`/fehlend = nie von einem Menschen bestaetigt. */
  dimensions_confirmed_at?: string | null;
}

/**
 * Converts a database row to a VehicleProfile object
 */
export function rowToProfile(row: DatabaseRow): VehicleProfile {
  return {
    id: row.id,
    name: row.name,
    height_m: row.height_m,
    width_m: row.width_m,
    length_m: row.length_m,
    weight_t: row.weight_t,
    avg_speed_kmh: row.avg_speed_kmh,
    hazmat: row.hazmat === 1,
    avoid: {
      motorway: row.avoid_motorway === 1,
      toll: row.avoid_toll === 1,
      ferry: row.avoid_ferry === 1,
      unpaved: row.avoid_unpaved === 1,
    },
    is_active: row.is_active === 1,
    // `NULL` (nie bestaetigt) bleibt `null` -- siehe Migration 005. Ein
    // fehlendes Feld darf hier NIE zu einem Zeitstempel werden: das hiesse
    // „ein Mensch hat die Masse geprueft", und genau das ist unbekannt.
    dimensions_confirmed_at: row.dimensions_confirmed_at ?? null,
  };
}

/**
 * Converts a VehicleProfile to database values
 */
export function profileToRow(profile: VehicleProfile): Record<string, number | string> {
  return {
    id: profile.id,
    name: profile.name,
    height_m: profile.height_m,
    width_m: profile.width_m,
    length_m: profile.length_m,
    weight_t: profile.weight_t,
    avg_speed_kmh: profile.avg_speed_kmh,
    hazmat: profile.hazmat ? 1 : 0,
    avoid_motorway: profile.avoid.motorway ? 1 : 0,
    avoid_toll: profile.avoid.toll ? 1 : 0,
    avoid_ferry: profile.avoid.ferry ? 1 : 0,
    avoid_unpaved: profile.avoid.unpaved ? 1 : 0,
    is_active: profile.is_active ? 1 : 0,
  };
}

export interface FavoriteRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  icon: string;
  category: string;
  sort_order: number;
}

/**
 * Converts a database row to a Favorite object
 */
export function rowToFavorite(row: FavoriteRow): Favorite {
  return {
    id: row.id,
    name: row.name,
    latlng: { lat: row.lat, lon: row.lon },
    icon: row.icon,
    category: row.category as Favorite['category'],
    sort_order: row.sort_order,
  };
}

/**
 * Converts a Favorite to database values
 */
export function favoriteToRow(favorite: Favorite): Record<string, number | string> {
  return {
    id: favorite.id,
    name: favorite.name,
    lat: favorite.latlng.lat,
    lon: favorite.latlng.lon,
    icon: favorite.icon,
    category: favorite.category,
    sort_order: favorite.sort_order,
  };
}

export interface HistoryRow {
  id: string;
  query: string | null;
  dest_lat: number | null;
  dest_lon: number | null;
  dest_name: string | null;
  ts: string;
}

/**
 * Converts a database row to a HistoryEntry object
 */
export function rowToHistoryEntry(row: HistoryRow): HistoryEntry {
  return {
    id: row.id,
    query: row.query,
    destination:
      row.dest_lat !== null && row.dest_lon !== null
        ? { latlng: { lat: row.dest_lat, lon: row.dest_lon }, name: row.dest_name }
        : null,
    ts: row.ts,
  };
}

/**
 * Converts a HistoryEntry to database values
 */
export function historyEntryToRow(entry: HistoryEntry): Record<string, number | string | null> {
  return {
    id: entry.id,
    query: entry.query,
    dest_lat: entry.destination?.latlng.lat ?? null,
    dest_lon: entry.destination?.latlng.lon ?? null,
    dest_name: entry.destination?.name ?? null,
    ts: entry.ts,
  };
}

/**
 * Close the database connection (for testing/shutdown)
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
