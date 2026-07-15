/**
 * HistoryService: records search-history entries (queries and/or picked
 * destinations), capped at `HISTORY_MAX_ENTRIES` with FIFO eviction
 * (E05-T3, docs/03 §2).
 */

import { randomUUID } from 'crypto';
import type { HistoryEntry } from '@yapaja/shared';
import { getDb, rowToHistoryEntry, historyEntryToRow, type HistoryRow } from '../db/index.js';

export class HistoryError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'HistoryError';
  }
}

export const HISTORY_MAX_ENTRIES = 100;

export interface HistoryAddInput {
  query?: string | null;
  destination?: HistoryEntry['destination'];
  /** Test/internal seam only -- HTTP routes never accept a client-supplied
   *  `ts`, exactly like `VehicleProfile.is_active` is ignored on write. */
  ts?: string;
}

export class HistoryService {
  /** Records one entry. At least one of `query`/`destination` is required.
   *  Evicts the oldest entr(y/ies) beyond `HISTORY_MAX_ENTRIES` in the same
   *  transaction (FIFO). */
  add(input: HistoryAddInput): HistoryEntry {
    const query = input.query ?? null;
    const destination = input.destination ?? null;
    if (query === null && destination === null) {
      throw new HistoryError(
        'VALIDATION_ERROR',
        'Either "query" or "destination" is required',
      );
    }

    const db = getDb();
    const entry: HistoryEntry = {
      id: randomUUID(),
      query,
      destination,
      ts: input.ts ?? new Date().toISOString(),
    };

    const transaction = db.transaction(() => {
      const row = historyEntryToRow(entry);
      db.prepare(
        'INSERT INTO history (id, query, dest_lat, dest_lon, dest_name, ts) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(row.id, row.query, row.dest_lat, row.dest_lon, row.dest_name, row.ts);
      this.evictOverflow();
    });
    transaction();

    return entry;
  }

  /** All entries, most recent first. */
  getAll(): HistoryEntry[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM history ORDER BY ts DESC, rowid DESC')
      .all() as HistoryRow[];
    return rows.map(rowToHistoryEntry);
  }

  deleteOne(id: string): void {
    const db = getDb();
    const result = db.prepare('DELETE FROM history WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new HistoryError('NOT_FOUND', `History entry ${id} not found`);
    }
  }

  clear(): void {
    const db = getDb();
    db.prepare('DELETE FROM history').run();
  }

  /** Deletes the oldest rows beyond the cap (ties broken by insertion order
   *  via `rowid`, so entries added within the same millisecond still evict
   *  in FIFO order). */
  private evictOverflow(): void {
    const db = getDb();
    const { count } = db.prepare('SELECT COUNT(*) as count FROM history').get() as {
      count: number;
    };
    if (count > HISTORY_MAX_ENTRIES) {
      const excess = count - HISTORY_MAX_ENTRIES;
      db.prepare(
        'DELETE FROM history WHERE id IN (SELECT id FROM history ORDER BY ts ASC, rowid ASC LIMIT ?)',
      ).run(excess);
    }
  }
}
