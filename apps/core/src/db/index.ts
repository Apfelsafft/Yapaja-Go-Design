/**
 * Database initialization and singleton access
 * Uses SQLite with WAL mode for concurrent reads
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { VehicleProfile } from '@yapaja/shared';

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

/**
 * Close the database connection (for testing/shutdown)
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
