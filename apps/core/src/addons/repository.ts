/**
 * DB row <-> object mapping + CRUD for the `addons` table (E09-T1, migration
 * `002_addons`). Mirrors `favorites/service.ts`'s "thin, stateless service
 * re-reading the shared DB singleton" shape -- no in-memory state here, the
 * DB row IS the state (this is what the plausibility check "a disabled
 * add-on has no running effects" hinges on: `enabled` is read live, never
 * cached).
 */

import type Database from 'better-sqlite3';
import type { AddonManifest } from '@yapaja/shared';
import { getDb } from '../db/index.js';

export interface AddonRow {
  id: string;
  name: string;
  version: string;
  manifest: string;
  enabled: number;
  install_path: string;
  created_at: string;
  updated_at: string;
}

/** API/service-facing shape -- `manifest` parsed, `enabled` a real boolean. */
export interface AddonRecord {
  id: string;
  name: string;
  version: string;
  manifest: AddonManifest;
  enabled: boolean;
  install_path: string;
  created_at: string;
  updated_at: string;
}

export function rowToAddonRecord(row: AddonRow): AddonRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    manifest: JSON.parse(row.manifest) as AddonManifest,
    enabled: row.enabled === 1,
    install_path: row.install_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class AddonRepository {
  constructor(private readonly db: Database.Database = getDb()) {}

  getById(id: string): AddonRecord | null {
    const row = this.db.prepare(`SELECT * FROM addons WHERE id = ?`).get(id) as AddonRow | undefined;
    return row ? rowToAddonRecord(row) : null;
  }

  listAll(): AddonRecord[] {
    const rows = this.db.prepare(`SELECT * FROM addons ORDER BY id ASC`).all() as AddonRow[];
    return rows.map(rowToAddonRecord);
  }

  /** Inserts a brand-new add-on row (fresh install). */
  insert(params: {
    id: string;
    name: string;
    version: string;
    manifest: AddonManifest;
    enabled: boolean;
    installPath: string;
  }): AddonRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO addons (id, name, version, manifest, enabled, install_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.name,
        params.version,
        JSON.stringify(params.manifest),
        params.enabled ? 1 : 0,
        params.installPath,
        now,
        now,
      );
    const created = this.getById(params.id);
    if (!created) throw new Error(`AddonRepository.insert: row for "${params.id}" vanished after INSERT`);
    return created;
  }

  /** Updates an EXISTING add-on row's version/manifest (an update-in-place)
   *  -- `enabled` is deliberately NOT touched here so an update preserves
   *  whatever the operator had it set to (see `installService.ts`'s
   *  `confirmInstall`). */
  updateVersion(params: { id: string; name: string; version: string; manifest: AddonManifest }): AddonRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE addons SET name = ?, version = ?, manifest = ?, updated_at = ? WHERE id = ?`,
      )
      .run(params.name, params.version, JSON.stringify(params.manifest), now, params.id);
    const updated = this.getById(params.id);
    if (!updated) throw new Error(`AddonRepository.updateVersion: row for "${params.id}" vanished after UPDATE`);
    return updated;
  }

  setEnabled(id: string, enabled: boolean): AddonRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`UPDATE addons SET enabled = ?, updated_at = ? WHERE id = ?`)
      .run(enabled ? 1 : 0, now, id);
    if (result.changes === 0) return null;
    return this.getById(id);
  }

  /** Deletes the DB row. Filesystem cleanup (code dir + storage dir) is the
   *  CALLER's responsibility (`installService.ts#uninstall`) -- this class
   *  only ever touches the database. */
  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM addons WHERE id = ?`).run(id);
    return result.changes > 0;
  }
}
