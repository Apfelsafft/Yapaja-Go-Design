/**
 * Read-side access to an already-built `lite_search.db` (E05-T5, W-12).
 * Opened lazily, read-only (`fileMustExist: true` -- a missing file is a
 * clear "index not built yet" signal, not a silently-empty index), and kept
 * open across calls (closed explicitly via `close()`, mirroring
 * `apps/core/src/db/index.ts`'s singleton-with-explicit-close shape).
 */
import Database from 'better-sqlite3';
import type { LiteCandidate, LiteKind } from './ranking.js';

interface LiteSearchRow {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  ftsRank: number;
}

interface LiteAllRow {
  name: string;
  kind: string;
  lat: number;
  lon: number;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(['city', 'town', 'village', 'street']);

function isLiteKind(kind: string): kind is LiteKind {
  return KNOWN_KINDS.has(kind);
}

/** Wraps a raw user query as a double-quoted FTS5 phrase, escaping internal
 *  quotes by doubling them (standard FTS5 string-literal escaping). This is
 *  what keeps arbitrary user input (which may contain `"`, `AND`/`OR`/`NOT`,
 *  `*`, `:`, `-`, ...) from ever being parsed as FTS5 *query-language*
 *  syntax -- it's always treated as literal phrase text for the trigram
 *  tokenizer to match substrings within, never as an operator. */
export function escapeFtsQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

/** SQLite FTS5's trigram tokenizer needs at least 3 characters to form a
 *  single trigram; anything shorter can never match. Callers upstream
 *  already gate on `SEARCH_MIN_CHARS` (3, see `apps/web/src/search/store.ts`)
 *  before ever reaching a backend, but this is defense-in-depth so a direct
 *  unit test / API call with a 1-2 char query gets a clean `[]` instead of
 *  an SQLite error. */
const MIN_QUERY_LENGTH = 3;

export class LiteIndexReader {
  private db: Database.Database | null = null;

  constructor(private readonly dbPath: string) {}

  private open(): Database.Database {
    if (this.db) return this.db;
    this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    return this.db;
  }

  /** Returns candidates for `ranking.ts` to sort/trim -- deliberately
   *  over-fetches (`limit * OVERFETCH_FACTOR`) so the ranking tiers (prefix,
   *  kind) have enough raw material to reorder before the caller trims to
   *  the actually-requested page size. */
  searchByPrefix(query: string, limit: number): LiteCandidate[] {
    if (query.trim().length < MIN_QUERY_LENGTH) return [];

    const db = this.open();
    const overfetch = Math.max(limit * 4, 20);
    const rows = db
      .prepare(
        `SELECT p.name as name, p.kind as kind, p.lat as lat, p.lon as lon, bm25(lite_search) as ftsRank
         FROM lite_search
         JOIN places p ON p.id = lite_search.rowid
         WHERE lite_search MATCH ?
         ORDER BY ftsRank
         LIMIT ?`,
      )
      .all(escapeFtsQuery(query), overfetch) as LiteSearchRow[];

    return rows.filter((r): r is LiteSearchRow & { kind: LiteKind } => isLiteKind(r.kind));
  }

  /** Nearest-neighbor lookup for reverse geocoding. The index has no
   *  spatial index (small LI/DE-scale datasets, see build-lite-index.sh's
   *  <1min/<400MB budgets) -- a coarse bounding-box pre-filter in SQL keeps
   *  the row count sane, then exact Haversine distance (via `ranking.ts`'s
   *  same formula, duplicated here on purpose -- see that file's comment on
   *  why this codebase copies the ~6-line Haversine per module rather than
   *  sharing it) picks the closest rows in JS. */
  nearest(lat: number, lon: number, limit: number): LiteCandidate[] {
    const db = this.open();
    // ~0.5 degrees is generously larger than any plausible LI/DE reverse-geocode
    // radius; if nothing falls inside it there's nothing nearby to find anyway.
    const boxDeg = 0.5;
    const rows = db
      .prepare(
        `SELECT name, kind, lat, lon FROM places
         WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
      )
      .all(lat - boxDeg, lat + boxDeg, lon - boxDeg, lon + boxDeg) as LiteAllRow[];

    const withDistance = rows
      .filter((r): r is LiteAllRow & { kind: LiteKind } => isLiteKind(r.kind))
      .map((r) => ({ ...r, distanceKm: haversineKm(lat, lon, r.lat, r.lon) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    // ftsRank has no meaning for a reverse lookup (there was no text query);
    // 0 keeps every candidate on equal footing for that ranking tier so
    // `rankLiteCandidates` falls straight through to the distance-bias tier.
    return withDistance.map((r) => ({ name: r.name, kind: r.kind, lat: r.lat, lon: r.lon, ftsRank: 0 }));
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
