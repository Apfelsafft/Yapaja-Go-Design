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
  /** Nur die LESENDEN Aufrufe (`fetchHaStates`) brauchen den Rumpf. Optional,
   *  damit bestehende Test-Stubs fuer `callHaService` unveraendert gelten. */
  json?: () => Promise<unknown>;
}

export interface HaHttpRequestInitLike {
  method: string;
  headers: Record<string, string>;
  /** Bei GET-Aufrufen gibt es keinen Rumpf. */
  body?: string;
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

/** Ein Zustand aus Home Assistant, auf das reduziert, was hier gebraucht
 *  wird. HA liefert deutlich mehr Attribute; alles Weitere wird ignoriert. */
export interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  /** Wann Home Assistant diesen Zustand zuletzt gesehen hat (ISO-8601).
   *  Optional, weil ein Zustand ihn theoretisch nicht tragen kann -- wer ihn
   *  auswertet, muss den Fall behandeln. */
  last_updated?: string;
}

export interface FetchHaStatesDeps {
  fetch?: HaFetchLike;
  logger: HaClientLogger;
  timeoutMs?: number;
}

/**
 * Liest `GET {apiBase}/states` -- ALLE Zustaende auf einmal.
 *
 * Warum alle statt gezielt einer: der Betreiber muss die Entitaet erst
 * FINDEN. Eine Liste der vorhandenen `device_tracker.*` ist die einzige
 * Angabe, mit der er den richtigen Namen eintragen kann, ohne in den
 * Entwicklerwerkzeugen zu suchen -- und dieselbe Antwort liefert danach den
 * Positions-Fix. Zwei Zwecke, ein Aufruf.
 *
 * Dieselbe harte Regel wie bei `callHaService`: hartes Zeitlimit, jeder
 * Fehler wird geloggt und GESCHLUCKT. Ein ausgefallenes oder langsames Home
 * Assistant darf die Navigation nie blockieren -- deshalb `[]` statt eines
 * Fehlers.
 */
export async function fetchHaStates(
  connection: HaConnection,
  deps: FetchHaStatesDeps,
): Promise<HaEntityState[]> {
  const fetchImpl = deps.fetch ?? defaultHaFetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${connection.apiBase}/states`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      // Niemals den Authorization-Header / das Token mitloggen.
      deps.logger.warn('HA states request returned an error status', { status: res.status });
      return [];
    }
    const body = res.json ? await res.json() : null;
    if (!Array.isArray(body)) {
      deps.logger.warn('HA states response was not an array');
      return [];
    }
    return body.filter(
      (entry): entry is HaEntityState =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as HaEntityState).entity_id === 'string' &&
        typeof (entry as HaEntityState).attributes === 'object' &&
        (entry as HaEntityState).attributes !== null,
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    deps.logger.warn('HA states request failed', {
      aborted,
      reason: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_TIMEOUT_MS as HA_DEFAULT_TIMEOUT_MS };
