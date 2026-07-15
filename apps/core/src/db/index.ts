/**
 * Database initialization and singleton access
 * Uses SQLite with WAL mode for concurrent reads
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { VehicleProfile, Favorite, HistoryEntry } from '@yapaja/shared';

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

  // Create profiles table if it doesn't exist
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

  // History table (E05-T3, docs/03 §2): records search queries and/or picked
  // destinations. Capped at 100 rows, FIFO eviction (service layer). `query`/
  // `dest_*` are all nullable -- exactly one "half" may be null, never both
  // (enforced by the service, not this schema).
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
