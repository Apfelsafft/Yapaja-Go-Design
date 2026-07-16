/**
 * Fetch client for the navigation control plane (E04-T5, backend contract
 * from `apps/core/src/navigation/routes.ts`):
 *  - `POST /api/v1/navigation/start`  body `{ route | route_id, destination?, reroute? }`
 *  - `POST /api/v1/navigation/pause` | `resume` | `stop`
 *  - `GET  /api/v1/navigation/state` -> `{ data: NavState, recovered_route?: NavRecoveryRecord }`
 *
 * Mirrors `apps/web/src/routing/client.ts`'s style exactly: every URL is
 * built from `import.meta.env.BASE_URL` (offline, ingress-sub-path-safe),
 * and a non-2xx response throws a typed error carrying the Core's unified
 * `{ error: { code, message } }` shape so callers can branch on specific
 * codes (e.g. 409 `INVALID_TRANSITION`).
 */

import type { LatLng, NavState, Route, RouteAvoidOverrides } from '@yapaja/shared';

interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class NavigationApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NavigationApiError';
    this.code = code;
    this.details = details;
  }
}

function apiUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function toApiError(response: Response): Promise<NavigationApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.code && body.error.message) {
      return new NavigationApiError(body.error.code, body.error.message, body.error.details);
    }
  } catch {
    // Body wasn't the expected error shape; fall through to a generic error.
  }
  return new NavigationApiError('UNKNOWN', `Request failed with status ${response.status}`);
}

/** The E04-T4 reroute context, exactly as `NavigationService.StartInput.reroute`
 *  expects it -- see `apps/core/src/navigation/service.ts#RerouteContext`. */
export interface StartNavigationReroute {
  waypoints?: LatLng[];
  exclude_locations?: LatLng[];
  exclude_polygons?: LatLng[][];
  avoid_overrides?: RouteAvoidOverrides;
  profile_id?: string;
}

export interface StartNavigationBody {
  /** Full route object (the routing store already has one after "Route hierhin"). */
  route?: Route;
  /** ...or a reference to an already-cached route (W-19 resume-from-recovery path). */
  route_id?: string;
  destination?: { latlng: LatLng; name: string | null } | null;
  /** E04-T4 reproduction context -- see the file-level doc comment. */
  reroute?: StartNavigationReroute;
}

async function postControl(path: string, body?: unknown): Promise<NavState> {
  // `pause`/`resume`/`stop` send no body -- Fastify's default JSON body
  // parser rejects an EMPTY body when `Content-Type: application/json` is
  // still set (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400), so the header is only
  // attached when there's actually a JSON body to describe.
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  const responseBody = (await response.json()) as { data: NavState };
  return responseBody.data;
}

/** `POST /api/v1/navigation/start`. Throws `NavigationApiError` on any non-2xx response. */
export async function startNavigation(body: StartNavigationBody): Promise<NavState> {
  return postControl('api/v1/navigation/start', body);
}

export async function pauseNavigation(): Promise<NavState> {
  return postControl('api/v1/navigation/pause');
}

export async function resumeNavigation(): Promise<NavState> {
  return postControl('api/v1/navigation/resume');
}

export async function stopNavigation(): Promise<NavState> {
  return postControl('api/v1/navigation/stop');
}

/** The W-19 reload-recovery envelope: the current `NavState` plus, when idle
 *  with a still-cached route from a prior (crashed/restarted) navigation, a
 *  `recovered_route` reference the UI can offer to resume. */
export interface NavStateEnvelope {
  navState: NavState;
  recoveredRoute: { route_id: string; destination: { latlng: LatLng; name: string | null } | null } | null;
}

/** `GET /api/v1/navigation/state`. Throws `NavigationApiError` on any non-2xx response. */
export async function getNavigationState(): Promise<NavStateEnvelope> {
  const response = await fetch(apiUrl('api/v1/navigation/state'));
  if (!response.ok) {
    throw await toApiError(response);
  }
  const body = (await response.json()) as {
    data: NavState;
    recovered_route?: { route_id: string; destination: { latlng: LatLng; name: string | null } | null };
  };
  return { navState: body.data, recoveredRoute: body.recovered_route ?? null };
}
