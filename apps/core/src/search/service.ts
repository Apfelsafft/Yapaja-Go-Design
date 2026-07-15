/**
 * `SearchService`: orchestrates the `GeocoderBackend` chain (E05-T1).
 *
 * Forward search (`search`):
 *   1. Coordinate parser -- no network; a hit short-circuits the whole chain.
 *   2. Photon -- always tried next.
 *   3. Nominatim -- only if Setting `online_fallback:true` AND Photon
 *      produced 0 results (an unreachable/erroring Photon is treated the
 *      same as "0 results" for this gate, see `call()` below).
 *
 * Reverse geocode (`reverse`): Photon, then optionally Nominatim under the
 * same online_fallback+0-hits gate. The coordinate parser doesn't apply
 * (input is already lat/lon).
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
  /** Setting `online_fallback`; default false (docs/03, E05-T1). */
  onlineFallback?: boolean;
  regionsProvider: SearchRegionsProvider;
  logger?: SearchLogger;
}

export class SearchService {
  private readonly coordsBackend: GeocoderBackend;
  private readonly photonBackend: GeocoderBackend;
  private readonly nominatimBackend?: GeocoderBackend;
  private readonly onlineFallback: boolean;
  private readonly regionsProvider: SearchRegionsProvider;
  private readonly logger: SearchLogger;
  private readonly health = new Map<string, BackendHealthStatus>();

  constructor(opts: SearchServiceOptions) {
    this.coordsBackend = opts.coordsBackend;
    this.photonBackend = opts.photonBackend;
    this.nominatimBackend = opts.nominatimBackend;
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

    const photonResults = await this.call(this.photonBackend, (b) => b.search(query));
    if (photonResults.length > 0) {
      return markOutOfCoverage(photonResults, this.regionsProvider);
    }

    if (this.onlineFallback && this.nominatimBackend) {
      const nominatimResults = await this.call(this.nominatimBackend, (b) => b.search(query));
      return markOutOfCoverage(nominatimResults, this.regionsProvider);
    }

    return [];
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    const photonResults = await this.call(this.photonBackend, (b) => b.reverse(query));
    if (photonResults.length > 0) {
      return markOutOfCoverage(photonResults, this.regionsProvider);
    }

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
