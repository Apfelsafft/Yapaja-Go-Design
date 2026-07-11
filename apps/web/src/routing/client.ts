/**
 * Fetch client for the routing API (E03-T3, backend contract from E03-T2):
 *  - `POST /api/v1/routes` body `RouteRequest` -> `{ data: Route[] }`
 *
 * Mirrors the fetch-client style of `apps/web/src/profiles/client.ts`: every
 * URL is built from `import.meta.env.BASE_URL` so this keeps working under
 * an ingress sub-path (W-15), and errors are thrown as a typed error class
 * carrying the Core's unified `{ error: { code, message } }` shape so
 * callers can branch on specific codes (e.g. 409 `NO_POSITION`).
 */

import type { Route, RouteRequest } from '@yapaja/shared';

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class RoutingApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RoutingApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<RoutingApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new RoutingApiError(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new RoutingApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

/** Requests route(s) for a `RouteRequest`. Throws `RoutingApiError` on any non-2xx response. */
export async function requestRoutes(body: RouteRequest): Promise<Route[]> {
  const response = await fetch(apiUrl('api/v1/routes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const responseBody = (await response.json()) as { data: Route[] };
  return Array.isArray(responseBody?.data) ? responseBody.data : [];
}
