/**
 * Thin HTTP client the Golden-Route runner uses to drive the Core
 * (`apps/core`) over its public REST API. The suite talks to the CORE, not to
 * Valhalla directly, so the profile→truck-costing mapping (the actual W-08
 * safety surface) is part of what gets tested.
 *
 * Uses the global `fetch` (Node >= 18). No dependency on `@yapaja/*` packages:
 * `e2e/` is outside those package boundaries on purpose.
 */

/* global fetch, Response, setTimeout */
import type { LatLng, ProfileSpec } from './types.js';

/** The subset of the Core `Route` object the suite reads. */
export interface RouteSummary {
  id: string;
  distance_m: number;
  duration_s: number;
  /** polyline6-encoded geometry. */
  geometry: string;
}

export type RouteResult =
  | { ok: true; routes: RouteSummary[] }
  | { ok: false; status: number; code: string; message: string };

interface ProfilesResponse {
  data: { id: string };
}
interface RoutesResponse {
  data: RouteSummary[];
}
interface ErrorResponse {
  error: { code: string; message: string };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}) from Core: ${text.slice(0, 200)}`);
  }
}

/**
 * Creates a fresh vehicle profile and returns its server-generated id.
 * A unique suffix is appended to the name so repeated runs never collide.
 */
export async function createProfile(coreUrl: string, spec: ProfileSpec): Promise<string> {
  const body: ProfileSpec = {
    ...spec,
    name: `${spec.name} [golden ${Date.now()}-${Math.floor(Math.random() * 1e6)}]`,
  };
  const res = await fetch(`${coreUrl}/api/v1/profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (res.status !== 201) {
    const err = json as ErrorResponse;
    throw new Error(
      `Failed to create profile "${spec.name}" (HTTP ${res.status}): ${
        err.error?.code ?? '??'
      } ${err.error?.message ?? ''}`,
    );
  }
  const id = (json as ProfilesResponse).data?.id;
  if (!id) {
    throw new Error(`Profile creation returned no id: ${JSON.stringify(json)}`);
  }
  return id;
}

/** Requests a route through the Core for an already-created profile id. */
export async function requestRoute(
  coreUrl: string,
  args: { origin: LatLng; destination: LatLng; profileId: string },
): Promise<RouteResult> {
  const res = await fetch(`${coreUrl}/api/v1/routes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      origin: args.origin,
      destination: args.destination,
      waypoints: [],
      profile_id: args.profileId,
      alternatives: 0,
    }),
  });
  const json = await readJson(res);
  if (res.status === 200) {
    return { ok: true, routes: (json as RoutesResponse).data };
  }
  const err = json as ErrorResponse;
  return {
    ok: false,
    status: res.status,
    code: err.error?.code ?? 'UNKNOWN',
    message: err.error?.message ?? '',
  };
}

/** Waits until the Core health endpoint reports ok, or throws after `timeoutMs`. */
export async function waitForCore(coreUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${coreUrl}/api/v1/health`);
      if (res.status === 200) {
        return;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Core at ${coreUrl} did not become healthy within ${timeoutMs}ms (${lastErr})`);
}
