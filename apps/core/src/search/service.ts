/**
 * `SearchService`: orchestrates the `GeocoderBackend` chain (E05-T1, extended
 * E05-T5/W-12 with the `lite` offline fallback).
 *
 * Forward search (`search`):
 *   1. Coordinate parser -- no network; a hit short-circuits the whole chain.
 *   2. Photon -- tried next, UNLESS Setting `photon_enabled:false` (W-12)
 *      skips it entirely.
 *   3. `lite` (E05-T5) -- tried ONLY when Photon was skipped (disabled) or
 *      actually failed (threw -- see `call()`). A Photon that responded but
 *      genuinely found 0 results is "healthy", not "down": that case is NOT
 *      lite's job, it goes straight to step 4 exactly as before E05-T5 --
 *      "lite must not override a healthy Photon".
 *   4. Nominatim -- only if Setting `online_fallback:true` AND neither
 *      Photon nor lite (whichever applies) produced a result.
 *
 * Reverse geocode (`reverse`) follows the identical Photon -> lite ->
 * Nominatim shape. The coordinate parser doesn't apply there (input is
 * already lat/lon).
 *
 * Every backend call is wrapped so a failure (timeout, unreachable, bad
 * response) is logged and marks that backend "degraded" instead of ever
 * throwing out of this service -- a broken backend must never crash the
 * request (rule: keine stillen Fehler, but also no hard failure for a
 * merely degraded chain).
 */
import type { SearchResult } from '@yapaja/shared';
import { markOutOfCoverage, type SearchRegionsProvider } from './coverage.js';
import { isGeocoderBackendError } from './errors.js';
import type {
  BackendHealthStatus,
  GeocoderBackend,
  ReverseQuery,
  SearchLogger,
  SearchQuery,
} from './types.js';

const noopLogger: SearchLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface SearchServiceOptions {
  coordsBackend: GeocoderBackend;
  photonBackend: GeocoderBackend;
  /** Optional: required only if `onlineFallback` is (or becomes) true. */
  nominatimBackend?: GeocoderBackend;
  /** Optional (E05-T5, W-12): the offline SQLite/FTS5 fallback, tried when
   *  Photon is down or disabled. Omitting it simply means "no lite fallback
   *  configured" -- the chain degrades to Nominatim/`[]` exactly as it did
   *  before E05-T5, never a crash. */
  liteBackend?: GeocoderBackend;
  /** Setting `photon_enabled` (W-12); default true. Set to `false` to skip
   *  Photon entirely (e.g. operator turned it off to save RAM) and go
   *  straight to `liteBackend`. */
  photonEnabled?: boolean;
  /** Setting `online_fallback`; default false (docs/03, E05-T1). */
  onlineFallback?: boolean;
  regionsProvider: SearchRegionsProvider;
  logger?: SearchLogger;
}

export class SearchService {
  private readonly coordsBackend: GeocoderBackend;
  private readonly photonBackend: GeocoderBackend;
  private readonly nominatimBackend?: GeocoderBackend;
  private readonly liteBackend?: GeocoderBackend;
  private readonly photonEnabled: boolean;
  private readonly onlineFallback: boolean;
  private readonly regionsProvider: SearchRegionsProvider;
  private readonly logger: SearchLogger;
  private readonly health = new Map<string, BackendHealthStatus>();

  constructor(opts: SearchServiceOptions) {
    this.coordsBackend = opts.coordsBackend;
    this.photonBackend = opts.photonBackend;
    this.nominatimBackend = opts.nominatimBackend;
    this.liteBackend = opts.liteBackend;
    this.photonEnabled = opts.photonEnabled ?? true;
    this.onlineFallback = opts.onlineFallback ?? false;
    this.regionsProvider = opts.regionsProvider;
    this.logger = opts.logger ?? noopLogger;
  }

  /** Snapshot of the last-known health per backend ("Photon down -> ...
   *  Health degraded"). Not currently wired into `/api/v1/health` -- that's
   *  an additive follow-up left for whichever task owns that endpoint. */
  getBackendHealth(): Record<string, BackendHealthStatus> {
    return Object.fromEntries(this.health);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const coordsResults = await this.call(this.coordsBackend, (b) => b.search(query));
    if (coordsResults.length > 0) {
      return markOutOfCoverage(coordsResults, this.regionsProvider);
    }

    if (this.photonEnabled) {
      const photonResults = await this.call(this.photonBackend, (b) => b.search(query));
      if (photonResults.length > 0) {
        return markOutOfCoverage(photonResults, this.regionsProvider);
      }
      // Photon responded (possibly empty) without throwing -> "healthy",
      // even with 0 hits. Lite must not override a healthy Photon (E05-T5
      // acceptance): go straight to the Nominatim gate, same as pre-E05-T5.
      if (this.health.get(this.photonBackend.source) === 'ok') {
        return this.onlineFallbackSearch(query);
      }
      // Photon threw (down) -- `call()` already logged + marked it
      // "degraded" above. Fall through to lite below.
    } else {
      this.health.set(this.photonBackend.source, 'disabled');
    }

    if (this.liteBackend) {
      const liteResults = await this.call(this.liteBackend, (b) => b.search(query));
      if (liteResults.length > 0) {
        return markOutOfCoverage(liteResults, this.regionsProvider);
      }
    }

    return this.onlineFallbackSearch(query);
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    if (this.photonEnabled) {
      const photonResults = await this.call(this.photonBackend, (b) => b.reverse(query));
      if (photonResults.length > 0) {
        return markOutOfCoverage(photonResults, this.regionsProvider);
      }
      if (this.health.get(this.photonBackend.source) === 'ok') {
        return this.onlineFallbackReverse(query);
      }
    } else {
      this.health.set(this.photonBackend.source, 'disabled');
    }

    if (this.liteBackend) {
      const liteResults = await this.call(this.liteBackend, (b) => b.reverse(query));
      if (liteResults.length > 0) {
        return markOutOfCoverage(liteResults, this.regionsProvider);
      }
    }

    return this.onlineFallbackReverse(query);
  }

  /** Shared tail of both chains: Nominatim, gated by `online_fallback` +
   *  an actually-configured backend, else `[]`. Extracted so `search()` can
   *  reach it from two different points (healthy-Photon-0-hits, and after
   *  lite) without duplicating the gate logic. */
  private async onlineFallbackSearch(query: SearchQuery): Promise<SearchResult[]> {
    if (this.onlineFallback && this.nominatimBackend) {
      const nominatimResults = await this.call(this.nominatimBackend, (b) => b.search(query));
      return markOutOfCoverage(nominatimResults, this.regionsProvider);
    }
    return [];
  }

  private async onlineFallbackReverse(query: ReverseQuery): Promise<SearchResult[]> {
    if (this.onlineFallback && this.nominatimBackend) {
      const nominatimResults = await this.call(this.nominatimBackend, (b) => b.reverse(query));
      return markOutOfCoverage(nominatimResults, this.regionsProvider);
    }
    return [];
  }

  /** Runs one backend call, turning any throw into a logged "degraded"
   *  health entry + empty results, so the chain can always continue. */
  private async call(
    backend: GeocoderBackend,
    fn: (backend: GeocoderBackend) => Promise<SearchResult[]>,
  ): Promise<SearchResult[]> {
    try {
      const results = await fn(backend);
      this.health.set(backend.source, 'ok');
      return results;
    } catch (err) {
      this.health.set(backend.source, 'degraded');
      const reason = isGeocoderBackendError(err)
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
      this.logger.error(`Geocoder backend "${backend.source}" failed, continuing chain`, {
        backend: backend.source,
        reason,
      });
      return [];
    }
  }
}
