/* eslint-disable no-undef -- `fetch`, `AbortController` and `setTimeout`/
 * `clearTimeout` are standard Node 22 globals (typed via @types/node); the
 * shared eslint `globals` list predates this backend module and only covers
 * console/process/DOM. Same justification as position/service.ts. */

/**
 * Thin HTTP client for Valhalla `/route`, with a hard request timeout and a
 * deliberate mapping of every failure onto a typed {@link RoutingError}
 * (status + code + message). No failure is ever swallowed silently.
 *
 * The actual HTTP transport is injectable via `fetchImpl` so tests can
 * intercept the OUTGOING request body (the profile-mapping intercept test) and
 * drive every error path without a live Valhalla.
 */

import { RoutingError } from './errors.js';
import type {
  ValhallaErrorBody,
  ValhallaRouteRequestBody,
  ValhallaRouteResponse,
} from './types.js';

/** Minimal response shape we depend on -- a strict subset of WHATWG `Response`. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Minimal `fetch` init we send. */
export interface FetchInitLike {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

/** Injectable transport. Global `fetch` conforms to this. */
export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface RoutingLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const consoleLogger: RoutingLogger = {
  info: (msg, meta) => console.warn(`[routing] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[routing] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[routing] ${msg}`, meta ?? ''),
};

export const DEFAULT_VALHALLA_URL = 'http://localhost:8002';
export const DEFAULT_TIMEOUT_MS = 30_000;

const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<FetchResponseLike>;

export interface ValhallaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  logger?: RoutingLogger;
}

/** Structural contract the RoutingService depends on -- eases mocking. */
export interface ValhallaClientLike {
  route(body: ValhallaRouteRequestBody): Promise<ValhallaRouteResponse>;
}

/**
 * Turn a Valhalla 4xx error payload into a client-facing RoutingError.
 * Valhalla error codes we care about (see valhalla `odin`/`loki` sources):
 *  - 442 "No path could be found for input"        -> NO_ROUTE (400)
 *  - 170/171/172 no/too-far/unreachable edges near a location -> POINT_UNREACHABLE (400)
 * Any other 4xx is treated as "no usable route" (fail towards NO_ROUTE, never
 * towards silently returning something).
 */
function mapValhallaError(body: ValhallaErrorBody): RoutingError {
  const code = body.error_code;
  const message = body.error ?? 'Valhalla could not compute a route';

  if (code === 170 || code === 171 || code === 172) {
    return new RoutingError(400, 'POINT_UNREACHABLE', message);
  }
  const lower = message.toLowerCase();
  if (lower.includes('unreachable') || lower.includes('no suitable edges')) {
    return new RoutingError(400, 'POINT_UNREACHABLE', message);
  }
  return new RoutingError(400, 'NO_ROUTE', message);
}

export class ValhallaClient implements ValhallaClientLike {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly logger: RoutingLogger;

  constructor(opts: ValhallaClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_VALHALLA_URL).replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.logger = opts.logger ?? consoleLogger;
  }

  async route(body: ValhallaRouteRequestBody): Promise<ValhallaRouteResponse> {
    const url = `${this.baseUrl}/route`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: FetchResponseLike;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.logger.error('Valhalla request failed', {
        url,
        aborted,
        reason: err instanceof Error ? err.message : String(err),
      });
      // Timeout and transport failure are both "the router is not answering".
      throw new RoutingError(
        503,
        'ROUTING_UNAVAILABLE',
        aborted
          ? `Valhalla did not respond within ${this.timeoutMs} ms`
          : 'Valhalla routing backend is unreachable',
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 500) {
      this.logger.error('Valhalla returned a server error', { url, status: res.status });
      throw new RoutingError(503, 'ROUTING_UNAVAILABLE', `Valhalla returned HTTP ${res.status}`);
    }

    if (!res.ok) {
      let body: ValhallaErrorBody = {};
      try {
        body = (await res.json()) as ValhallaErrorBody;
      } catch {
        // Non-JSON 4xx body -> keep the empty object, mapValhallaError defaults.
      }
      const mapped = mapValhallaError(body);
      this.logger.warn('Valhalla could not compute a route', {
        url,
        status: res.status,
        error_code: body.error_code,
        code: mapped.code,
      });
      throw mapped;
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      this.logger.error('Valhalla returned a non-JSON success body', {
        url,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Valhalla returned an unreadable response');
    }

    if (!isValhallaRouteResponse(json)) {
      this.logger.error('Valhalla response missing a trip', { url });
      throw new RoutingError(503, 'ROUTING_UNAVAILABLE', 'Valhalla response was malformed');
    }

    return json;
  }
}

function isValhallaRouteResponse(json: unknown): json is ValhallaRouteResponse {
  if (typeof json !== 'object' || json === null) return false;
  const trip = (json as { trip?: unknown }).trip;
  if (typeof trip !== 'object' || trip === null) return false;
  const legs = (trip as { legs?: unknown }).legs;
  const summary = (trip as { summary?: unknown }).summary;
  return Array.isArray(legs) && typeof summary === 'object' && summary !== null;
}
