/**
 * 003_addon_tokens -- per-add-on SCOPED API tokens (E09-T3, docs/05 §1B/§2,
 * Wargame W-14). Additive; `001_baseline`/`002_addons` are never edited (see
 * `README.md`).
 *
 * SECURITY: the raw token is NEVER stored. Only its sha256 hex digest lands
 * in `token_hash`, so a stolen database file does not hand an attacker a
 * usable token (see `addons/tokens.ts`). The token itself is surfaced exactly
 * once -- at issuance -- and otherwise only lives in the add-on child
 * process's environment.
 *
 * `addon_id` is the PRIMARY KEY: an add-on has at most ONE live token at a
 * time, so re-issuing (every enable/spawn, or an operator pressing "show
 * token" for a `runtime: external` add-on) ROTATES it and instantly
 * invalidates the previous one. `ON DELETE CASCADE` on the `addons` row is
 * deliberately NOT used (better-sqlite3 does not enable foreign keys by
 * default in this codebase); instead every disable/uninstall path revokes
 * explicitly AND `authenticate()` re-reads the add-on's live `enabled` flag,
 * so a stale row can never authenticate anything.
 */

import type { Migration } from './types.js';

export const addonTokens: Migration = {
  version: 3,
  name: '003_addon_tokens',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS addon_tokens (
        addon_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        scopes TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_addon_tokens_hash ON addon_tokens (token_hash)`);
  },
};
