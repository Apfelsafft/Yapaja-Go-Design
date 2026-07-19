/**
 * 002_addons -- add-on install/lifecycle table (E09-T1, docs/05 §2/§5).
 * The FIRST migration added through the runner (E08-T6) after `001_baseline`
 * -- per `README.md`'s rule, `001_baseline` itself is never edited; new
 * schema always arrives as a new numbered migration.
 *
 * `enabled` is the single source of truth this task's plausibility check
 * relies on ("a disabled add-on has no running effects"): a later task
 * (E09-T2/T3, actually running add-on service processes) must consult this
 * column before doing anything, never infer "running" from any other state.
 *
 * `manifest` stores the FULL validated `yapaja-addon.json` as JSON text
 * (mirrors the `settings` table's `value` TEXT-blob convention) rather than
 * being column-per-field -- the manifest shape may grow (new optional
 * fields) without a further migration, and the install pipeline is the only
 * code that needs to parse it back out.
 */

import type { Migration } from './types.js';

export const addons: Migration = {
  version: 2,
  name: '002_addons',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS addons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        install_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  },
};
