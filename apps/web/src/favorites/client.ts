/**
 * Fetch helpers for favorites + search/destination history (E05-T3, backend
 * contract from the Core's `apps/core/src/favorites/routes.ts`).
 *
 * Mirrors `apps/web/src/profiles/client.ts` / `apps/web/src/search/client.ts`:
 * every URL is built from `import.meta.env.BASE_URL` (offline, ingress-
 * sub-path-safe), mutating calls throw a typed `FavoriteApiError` /
 * `HistoryApiError` carrying the Core's unified `{ error: { code, message } }`
 * shape so callers can branch on specific codes (e.g. `HOME_ALREADY_EXISTS`).
 */

import type { Favorite, HistoryEntry } from '@yapaja/shared';

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class FavoriteApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'FavoriteApiError';
    this.code = code;
    this.details = details;
  }
}

export class HistoryApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HistoryApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError<T extends FavoriteApiError | HistoryApiError>(
  response: Response,
  ctor: new (code: string, message: string, details?: Record<string, unknown>) => T,
): Promise<T> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new ctor(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new ctor('UNKNOWN', `Request failed with status ${response.status}`);
}

export type FavoriteCreateInput = Omit<Favorite, 'id' | 'sort_order'> & { sort_order?: number };
export type FavoriteUpdateInput = Partial<Omit<Favorite, 'id'>>;

/** List all favorites, ordered by `sort_order` ascending. Returns `[]`
 *  (never throws) on network/parse failure -- same "read calls never throw"
 *  convention as `profiles/client.ts`'s `fetchProfiles`. */
export async function fetchFavorites(): Promise<Favorite[]> {
  try {
    const response = await fetch(apiUrl('api/v1/favorites'));
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data: Favorite[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

/** Creates a favorite. `replace: true` replaces an existing `home` favorite
 *  instead of the Core rejecting with 409 `HOME_ALREADY_EXISTS`. */
export async function createFavorite(
  data: FavoriteCreateInput,
  opts: { replace?: boolean } = {},
): Promise<Favorite> {
  const response = await fetch(apiUrl('api/v1/favorites'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, ...(opts.replace ? { replace: true } : {}) }),
  });
  if (!response.ok) {
    throw await toApiError(response, FavoriteApiError);
  }
  const body = (await response.json()) as { data: Favorite };
  return body.data;
}

export async function updateFavorite(
  id: string,
  data: FavoriteUpdateInput,
  opts: { replace?: boolean } = {},
): Promise<Favorite> {
  const response = await fetch(apiUrl(`api/v1/favorites/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, ...(opts.replace ? { replace: true } : {}) }),
  });
  if (!response.ok) {
    throw await toApiError(response, FavoriteApiError);
  }
  const body = (await response.json()) as { data: Favorite };
  return body.data;
}

export async function deleteFavorite(id: string): Promise<void> {
  const response = await fetch(apiUrl(`api/v1/favorites/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await toApiError(response, FavoriteApiError);
  }
}

/** Persists a full drag-order id list. Returns the reordered favorites. */
export async function reorderFavorites(ids: string[]): Promise<Favorite[]> {
  const response = await fetch(apiUrl('api/v1/favorites/reorder'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    throw await toApiError(response, FavoriteApiError);
  }
  const body = (await response.json()) as { data: Favorite[] };
  return body.data;
}

/** List all history entries, newest first. Returns `[]` (never throws) on
 *  network/parse failure. */
export async function fetchHistory(): Promise<HistoryEntry[]> {
  try {
    const response = await fetch(apiUrl('api/v1/history'));
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data: HistoryEntry[] };
    return Array.isArray(body?.data) ? body.data : [];
  } catch {
    return [];
  }
}

export interface HistoryRecordInput {
  query?: string | null;
  destination?: HistoryEntry['destination'];
}

/** Records one history entry. At least one of `query`/`destination` is
 *  required (the Core rejects otherwise with 400 `VALIDATION_ERROR`). */
export async function recordHistory(input: HistoryRecordInput): Promise<HistoryEntry> {
  const response = await fetch(apiUrl('api/v1/history'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await toApiError(response, HistoryApiError);
  }
  const body = (await response.json()) as { data: HistoryEntry };
  return body.data;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const response = await fetch(apiUrl(`api/v1/history/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await toApiError(response, HistoryApiError);
  }
}

export async function clearHistory(): Promise<void> {
  const response = await fetch(apiUrl('api/v1/history'), { method: 'DELETE' });
  if (!response.ok) {
    throw await toApiError(response, HistoryApiError);
  }
}
