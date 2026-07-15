/* eslint-disable no-undef -- `AbortController`/`setTimeout`/`clearTimeout` are
 * standard Node 22 globals; same justification as routing/valhallaClient.ts. */

/**
 * `GeocoderBackend` for Nominatim online search (E05-T1, chain step 3).
 * Only ever invoked by `SearchService` when Setting `online_fallback:true`
 * AND Photon returned 0 hits (see service.ts). Enforces Nominatim's usage
 * policy: a descriptive `User-Agent` header and a hard max-1-req/s rate
 * limit via the injectable {@link RateLimiter}. Hard 3s timeout per request.
 */
import type { SearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from './errors.js';
import { defaultFetch, type FetchLike, type HttpResponseLike } from './httpTypes.js';
import { RateLimiter } from './rateLimiter.js';
import type { GeocoderBackend, ReverseQuery, SearchLogger, SearchQuery } from './types.js';

export const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_NOMINATIM_USER_AGENT = 'YapajaGo/0.1 (+https://github.com/yapaja/yapaja-go)';
export const DEFAULT_NOMINATIM_RATE_LIMIT_MS = 1_000;
export const DEFAULT_BACKEND_TIMEOUT_MS = 3_000;

const noopLogger: SearchLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface NominatimItem {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  class?: string;
}

export interface NominatimBackendOptions {
  baseUrl?: string;
  userAgent?: string;
  lang?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: SearchLogger;
  /** Injectable for tests (Vitest fake timers) -- defaults to a real
   *  1-req/s limiter shared across this backend instance's lifetime. */
  rateLimiter?: RateLimiter;
}

export class NominatimBackend implements GeocoderBackend {
  readonly source = 'nominatim' as const;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: SearchLogger;
  private readonly rateLimiter: RateLimiter;

  constructor(opts: NominatimBackendOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_NOMINATIM_URL).replace(/\/+$/, '');
    this.userAgent = opts.userAgent ?? DEFAULT_NOMINATIM_USER_AGENT;
    this.lang = opts.lang ?? 'de';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.logger = opts.logger ?? noopLogger;
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter(DEFAULT_NOMINATIM_RATE_LIMIT_MS);
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query.q,
      format: 'jsonv2',
      limit: String(query.limit),
      'accept-language': query.lang ?? this.lang,
    });
    const json = await this.request(`${this.baseUrl}/search?${params.toString()}`);
    return mapNominatimResponse(Array.isArray(json) ? json : []);
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      lat: String(query.lat),
      lon: String(query.lon),
      format: 'jsonv2',
      'accept-language': query.lang ?? this.lang,
    });
    const json = await this.request(`${this.baseUrl}/reverse?${params.toString()}`);
    const items = Array.isArray(json) ? json : json !== null && json !== undefined ? [json] : [];
    return mapNominatimResponse(items).slice(0, query.limit);
  }

  private async request(url: string): Promise<unknown> {
    // Enforce max 1 req/s BEFORE the network call, not around it -- so the
    // wait is attributed to the caller, not hidden inside a race.
    await this.rateLimiter.acquire();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: HttpResponseLike;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent },
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.logger.error('Nominatim request failed', {
        url,
        aborted,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new GeocoderBackendError(
        'nominatim',
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted
          ? `Nominatim did not respond within ${this.timeoutMs} ms`
          : 'Nominatim is unreachable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      this.logger.warn('Nominatim returned an error status', { url, status: res.status });
      throw new GeocoderBackendError(
        'nominatim',
        'UNAVAILABLE',
        `Nominatim returned HTTP ${res.status}`,
      );
    }

    try {
      return await res.json();
    } catch (err) {
      this.logger.error('Nominatim returned a non-JSON response', {
        url,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new GeocoderBackendError(
        'nominatim',
        'BAD_RESPONSE',
        'Nominatim returned an unreadable response',
      );
    }
  }
}

function mapNominatimResponse(items: unknown[]): SearchResult[] {
  const results: SearchResult[] = [];

  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as NominatimItem;

    const lat = item.lat !== undefined ? Number(item.lat) : NaN;
    const lon = item.lon !== undefined ? Number(item.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const label = typeof item.display_name === 'string' ? item.display_name : '';
    const firstPart = label.split(',')[0]?.trim();
    const name =
      typeof item.name === 'string' && item.name.length > 0
        ? item.name
        : firstPart && firstPart.length > 0
          ? firstPart
          : 'Unbenannt';
    const type =
      typeof item.type === 'string' ? item.type : typeof item.class === 'string' ? item.class : 'unknown';

    results.push({ name, label: label.length > 0 ? label : name, latlng: { lat, lon }, type, source: 'nominatim' });
  }

  return results;
}
