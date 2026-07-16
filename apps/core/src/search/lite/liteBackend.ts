/**
 * `GeocoderBackend` for the offline `lite` fallback (E05-T5, Wargame W-12).
 * Queries an already-built `lite_search.db` (see `buildIndex.ts`/
 * `build-lite-index.sh`) via SQLite FTS5 (trigram tokenizer), applies
 * `ranking.ts`'s ranking contract, and maps to `SearchResult` with
 * `source: 'lite'`.
 *
 * Failure contract (mirrors `photonBackend.ts`/`nominatimBackend.ts`): every
 * failure -- most commonly "index not built yet" (no `lite_search.db` on
 * disk, e.g. a fresh install that never ran `build-lite-index.sh`) --
 * throws a typed `GeocoderBackendError('lite', ...)` so `SearchService` can
 * log it, mark this backend "degraded", and continue the chain (to
 * Nominatim, if online_fallback is on) rather than crash the request.
 *
 * No network involved at all -- this is local SQLite I/O only, consistent
 * with the app's fully-offline design.
 */
import { existsSync } from 'fs';
import type { SearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from '../errors.js';
import type { GeocoderBackend, ReverseQuery, SearchLogger, SearchQuery } from '../types.js';
import { LiteIndexReader } from './reader.js';
import { rankLiteCandidates, type LiteCandidate } from './ranking.js';

const noopLogger: SearchLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface LiteBackendOptions {
  dbPath: string;
  logger?: SearchLogger;
  /** Test seam: a pre-built reader wins over constructing one from `dbPath`. */
  reader?: LiteIndexReader;
}

/**
 * `label`/`type` on the resulting `SearchResult`: the lite index carries no
 * administrative hierarchy (no "city, country" containment info -- see
 * `extract.ts`/`buildIndex.ts`'s schema), so `label` is simply the name and
 * `type` is the raw `kind` ('city'|'town'|'village'|'street'), which lines
 * up 1:1 with `apps/web/src/search/icons.ts`'s existing icon lookup keys.
 * This is a documented, intentional simplification (E05-T5: "Ranking
 * simpel", "keine Hausnummern") -- not a bug to fix later without a
 * corresponding index-schema change.
 */
function candidateToResult(candidate: LiteCandidate): SearchResult {
  return {
    name: candidate.name,
    label: candidate.name,
    latlng: { lat: candidate.lat, lon: candidate.lon },
    type: candidate.kind,
    source: 'lite',
  };
}

export class LiteBackend implements GeocoderBackend {
  readonly source = 'lite' as const;
  private readonly dbPath: string;
  private readonly logger: SearchLogger;
  private reader?: LiteIndexReader;

  constructor(opts: LiteBackendOptions) {
    this.dbPath = opts.dbPath;
    this.logger = opts.logger ?? noopLogger;
    this.reader = opts.reader;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const reader = this.getReader();
    const candidates = this.withErrorMapping('search', () => reader.searchByPrefix(query.q, query.limit));
    const origin = query.lat !== undefined && query.lon !== undefined ? { lat: query.lat, lon: query.lon } : undefined;
    return rankLiteCandidates(candidates, query.q, origin)
      .slice(0, query.limit)
      .map(candidateToResult);
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    const reader = this.getReader();
    const candidates = this.withErrorMapping('reverse', () =>
      reader.nearest(query.lat, query.lon, query.limit),
    );
    // No text query for a reverse lookup -- rank purely by distance
    // (reader.nearest already sorted by distance; rankLiteCandidates with an
    // empty query string keeps every candidate's prefix-tier equal, so the
    // existing sort order from `nearest()` is preserved through the
    // distance-bias tier).
    return rankLiteCandidates(candidates, '', { lat: query.lat, lon: query.lon })
      .slice(0, query.limit)
      .map(candidateToResult);
  }

  private getReader(): LiteIndexReader {
    if (this.reader) return this.reader;
    if (!existsSync(this.dbPath)) {
      this.logger.warn('Lite-Suchindex nicht gefunden -- build-lite-index.sh wurde noch nicht ausgefuehrt', {
        dbPath: this.dbPath,
      });
      throw new GeocoderBackendError(
        'lite',
        'UNAVAILABLE',
        `Lite-Suchindex fehlt unter ${this.dbPath} (build-lite-index.sh noch nicht ausgefuehrt)`,
      );
    }
    this.reader = new LiteIndexReader(this.dbPath);
    return this.reader;
  }

  private withErrorMapping<T>(op: 'search' | 'reverse', fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof GeocoderBackendError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Lite-Suchindex-Abfrage fehlgeschlagen (${op})`, { reason });
      throw new GeocoderBackendError('lite', 'BAD_RESPONSE', `Lite-Suchindex-Abfrage fehlgeschlagen: ${reason}`);
    }
  }
}
