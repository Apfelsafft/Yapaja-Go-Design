/* eslint-disable no-undef -- `fetch`/`AbortController`/`setTimeout`/
 * `clearTimeout` are standard Node 22 globals (typed via @types/node); same
 * justification as search/nominatimBackend.ts and routing/valhallaClient.ts. */

/**
 * Minimal Home-Assistant REST client for the output channel (E08-T3).
 *
 * The ONE hard rule (docs/04 §2 acceptance #3): a down / misconfigured / slow
 * HA must NEVER crash or block the Core or navigation. Therefore every call:
 *  - has a hard timeout via `AbortController` (default 5 s),
 *  - logs any failure (pino) at WARN and SWALLOWS it -- `callHaService` never
 *    throws and never rejects.
 *
 * `fetch` is injectable so tests can assert the exact outgoing service call
 * (and simulate timeouts / HTTP errors) without a live network.
 */

import type { HaConnection } from './config.js';

export interface HaHttpResponseLike {
  readonly ok: boolean;
  readonly status: number;
}

export interface HaHttpRequestInitLike {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type HaFetchLike = (url: string, init: HaHttpRequestInitLike) => Promise<HaHttpResponseLike>;

export const defaultHaFetch: HaFetchLike = (url, init) =>
  fetch(url, init) as unknown as Promise<HaHttpResponseLike>;

export interface HaClientLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CallHaServiceInput {
  connection: HaConnection;
  /** e.g. `"tts"`, `"notify"`. */
  domain: string;
  /** e.g. `"speak"`, `"mobile_app_phone"`. */
  service: string;
  /** JSON service-call payload. */
  data: Record<string, unknown>;
}

export interface CallHaServiceDeps {
  fetch?: HaFetchLike;
  logger: HaClientLogger;
  /** Hard request timeout in ms (default 5000). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * POSTs a HA service call (`POST {apiBase}/services/{domain}/{service}`).
 * Resolves to `true` on a 2xx response, `false` on ANY failure (network,
 * timeout, non-2xx) -- but NEVER rejects. The Core keeps working regardless.
 */
export async function callHaService(
  input: CallHaServiceInput,
  deps: CallHaServiceDeps,
): Promise<boolean> {
  const fetchImpl = deps.fetch ?? defaultHaFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { connection, domain, service, data } = input;
  const url = `${connection.apiBase}/services/${domain}/${service}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Never include the Authorization header / token in the log.
      deps.logger.warn('HA service call returned an error status', {
        domain,
        service,
        status: res.status,
      });
      return false;
    }
    return true;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    deps.logger.warn('HA service call failed', {
      domain,
      service,
      aborted,
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_TIMEOUT_MS as HA_DEFAULT_TIMEOUT_MS };
