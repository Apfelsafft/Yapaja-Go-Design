/**
 * Fetch client for the search API (E05-T2, backend contract from E05-T1):
 *  - `GET /api/v1/search?q=&limit=&lat=&lon=` -> `{ data: SearchResult[] }`
 *
 * Mirrors the fetch-client style of `apps/web/src/profiles/client.ts` /
 * `apps/web/src/routing/client.ts`: every URL is built from
 * `import.meta.env.BASE_URL` so this keeps working under an ingress
 * sub-path (W-15) and never targets a foreign host (offline requirement),
 * and errors are thrown as a typed error class carrying the Core's unified
 * `{ error: { code, message } }` shape.
 *
 * Accepts an `AbortSignal` so the caller (the search store's debounce/race
 * logic) can cancel an in-flight request when a newer one supersedes it.
 * `AbortError`s are NOT wrapped into `SearchApiError` -- they propagate
 * as-is so the caller can tell "cancelled" apart from "really failed".
 */

import type { SearchResult } from '@yapaja/shared';

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class SearchApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SearchApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<SearchApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new SearchApiError(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new SearchApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

export interface SearchParams {
  q: string;
  limit?: number;
  /** Bias latitude (usually the current position), omitted when unknown. */
  lat?: number;
  /** Bias longitude (usually the current position), omitted when unknown. */
  lon?: number;
  signal?: AbortSignal;
}

/**
 * Requests search results for `q`. Throws `SearchApiError` on any non-2xx
 * response. If `params.signal` is aborted (a newer search superseded this
 * one), `fetch` rejects with a `DOMException` named `AbortError`, which is
 * rethrown untouched -- callers branch on `err.name === 'AbortError'` to
 * distinguish "cancelled" from a real failure.
 */
export async function searchDestinations(params: SearchParams): Promise<SearchResult[]> {
  const query = new URLSearchParams({ q: params.q });
  if (params.limit !== undefined) {
    query.set('limit', String(params.limit));
  }
  if (params.lat !== undefined) {
    query.set('lat', String(params.lat));
  }
  if (params.lon !== undefined) {
    query.set('lon', String(params.lon));
  }

  const response = await fetch(apiUrl(`api/v1/search?${query.toString()}`), {
    signal: params.signal,
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as { data: SearchResult[] };
  return Array.isArray(body?.data) ? body.data : [];
}
