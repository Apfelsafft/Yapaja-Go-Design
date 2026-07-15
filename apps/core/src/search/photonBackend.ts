/* eslint-disable no-undef -- `AbortController`/`setTimeout`/`clearTimeout` are
 * standard Node 22 globals; same justification as routing/valhallaClient.ts. */

/**
 * `GeocoderBackend` for Photon (E05-T1, chain step 2). Photon serves
 * GeoJSON; every network/parse failure is caught and rethrown as a typed
 * {@link GeocoderBackendError} so `SearchService` can log it and move on
 * ("Photon down -> next backend + degraded, never a crash"). Hard 3s
 * timeout per request.
 */
import type { SearchResult } from '@yapaja/shared';
import { GeocoderBackendError } from './errors.js';
import { defaultFetch, type FetchLike, type HttpResponseLike } from './httpTypes.js';
import type { GeocoderBackend, ReverseQuery, SearchLogger, SearchQuery } from './types.js';

export const DEFAULT_PHOTON_URL = 'http://localhost:2322';
export const DEFAULT_BACKEND_TIMEOUT_MS = 3_000;

const noopLogger: SearchLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

export interface PhotonBackendOptions {
  baseUrl?: string;
  lang?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: SearchLogger;
}

export class PhotonBackend implements GeocoderBackend {
  readonly source = 'photon' as const;
  private readonly baseUrl: string;
  private readonly lang: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: SearchLogger;

  constructor(opts: PhotonBackendOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_PHOTON_URL).replace(/\/+$/, '');
    this.lang = opts.lang ?? 'de';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_BACKEND_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.logger = opts.logger ?? noopLogger;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query.q,
      limit: String(query.limit),
      lang: query.lang ?? this.lang,
    });
    if (query.lat !== undefined && query.lon !== undefined) {
      params.set('lat', String(query.lat));
      params.set('lon', String(query.lon));
    }
    const json = await this.request(`${this.baseUrl}/api?${params.toString()}`);
    return mapPhotonResponse(json);
  }

  async reverse(query: ReverseQuery): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      lat: String(query.lat),
      lon: String(query.lon),
      limit: String(query.limit),
      lang: query.lang ?? this.lang,
    });
    const json = await this.request(`${this.baseUrl}/reverse?${params.toString()}`);
    return mapPhotonResponse(json);
  }

  private async request(url: string): Promise<PhotonResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: HttpResponseLike;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers: {}, signal: controller.signal });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.logger.error('Photon request failed', {
        url,
        aborted,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new GeocoderBackendError(
        'photon',
        aborted ? 'TIMEOUT' : 'UNAVAILABLE',
        aborted
          ? `Photon did not respond within ${this.timeoutMs} ms`
          : 'Photon is unreachable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      this.logger.warn('Photon returned an error status', { url, status: res.status });
      throw new GeocoderBackendError('photon', 'UNAVAILABLE', `Photon returned HTTP ${res.status}`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      this.logger.error('Photon returned a non-JSON response', {
        url,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new GeocoderBackendError('photon', 'BAD_RESPONSE', 'Photon returned an unreadable response');
    }

    if (!isPhotonResponse(json)) {
      this.logger.error('Photon response missing a features array', { url });
      throw new GeocoderBackendError('photon', 'BAD_RESPONSE', 'Photon response was malformed');
    }

    return json;
  }
}

function isPhotonResponse(json: unknown): json is PhotonResponse {
  if (typeof json !== 'object' || json === null) return false;
  // Photon always responds with a GeoJSON FeatureCollection, i.e. a
  // `features` array (empty when there are no hits) -- a response missing it
  // entirely is malformed, not "zero results".
  return Array.isArray((json as { features?: unknown }).features);
}

function mapPhotonResponse(json: PhotonResponse): SearchResult[] {
  const features = json.features ?? [];
  const results: SearchResult[] = [];

  for (const feature of features) {
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lon, lat] = coords;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    const props = feature.properties ?? {};
    const name = typeof props.name === 'string' && props.name.length > 0 ? props.name : 'Unbenannt';
    const city = typeof props.city === 'string' && props.city !== name ? props.city : undefined;
    const country = typeof props.country === 'string' ? props.country : undefined;
    const labelParts = [name, city, country].filter((p): p is string => Boolean(p));
    const label = labelParts.length > 0 ? labelParts.join(', ') : name;
    const type =
      typeof props.osm_value === 'string'
        ? props.osm_value
        : typeof props.osm_key === 'string'
          ? props.osm_key
          : 'unknown';

    results.push({ name, label, latlng: { lat, lon }, type, source: 'photon' });
  }

  return results;
}
