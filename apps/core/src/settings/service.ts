/**
 * SettingsService: a general-purpose key/value settings store (E07-T1).
 *
 * Deliberately generic -- the service has no idea what any key means. The
 * widget-shell's per-mode layouts (`layouts` key, see
 * `apps/web/src/shell/persistence.ts`) are the first consumer, but future
 * settings (units, theme, `online_fallback`, HA-overridable day/night
 * override -- see docs/06 Section 3, E07-T3) reuse this same table/service/
 * routes rather than each growing a bespoke schema, per the task's explicit
 * "keep it general" instruction.
 *
 * Each value is stored as a JSON-serialized string (so any JSON-safe value --
 * object, array, primitive -- round-trips exactly) alongside an
 * `updated_at` ISO-8601 UTC timestamp of the server-side write. That
 * `updated_at` is the ROW's own bookkeeping (SQL write time), independent of
 * any timestamp embedded IN a value's payload (e.g. a `ModeLayout.updatedAt`
 * the client computes for its own local-vs-server merge, docs E07-T1
 * "neuester Zeitstempel gewinnt") -- the two are unrelated and must not be
 * conflated.
 */

import { getDb } from '../db/index.js';

export class SettingsError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SettingsError';
  }
}

interface SettingsRow {
  key: string;
  value: string;
  updated_at: string;
}

export class SettingsService {
  /** All settings, key -> parsed JSON value. */
  getAll(): Record<string, unknown> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM settings').all() as SettingsRow[];
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = this.parseValue(row);
    }
    return result;
  }

  /** A single setting's value, or `undefined` if the key has never been set. */
  get(key: string): unknown {
    const db = getDb();
    const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as SettingsRow | undefined;
    return row ? this.parseValue(row) : undefined;
  }

  /**
   * Merge-patches settings: every key in `patch` is upserted (created or
   * overwritten wholesale -- NOT deep-merged with any previous value for
   * that same key, matching `PATCH /api/v1/settings`'s documented contract
   * of "merge KEYS", not "merge nested objects"). Returns the FULL settings
   * map after the patch, so a caller never needs a follow-up GET.
   */
  patch(values: Record<string, unknown>): Record<string, unknown> {
    const db = getDb();
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const transaction = db.transaction((entries: [string, unknown][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, JSON.stringify(value), now);
      }
    });
    transaction(Object.entries(values));
    return this.getAll();
  }

  private parseValue(row: SettingsRow): unknown {
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      // A value written outside this service (or corrupted) must never crash
      // a GET -- surface it as the raw string instead of throwing, same
      // "never silently fail the whole request over one bad row" spirit as
      // the rest of the codebase.
      return row.value;
    }
  }
}
