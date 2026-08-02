/**
 * The REST+WS transport (docs/05 §3, E09-T3/T4): the service add-on side.
 * Runs as a plain Node process -- either Core-spawned (`runtime: node18|
 * node20`, `apps/core/src/addons/service-host.ts`) or a `runtime: external`
 * container the operator ran by hand -- and talks to the Core over EXACTLY
 * the same public REST/WS API any other client uses, authenticated with the
 * scoped bearer token the process contract hands it. There is no internal
 * import, no direct DB access, no privileged side channel (docs/05 §1B):
 * everything below is a plain `fetch`/`WebSocket` call an add-on author could
 * make by hand (and the reference fixtures,
 * `apps/core/src/addons/__fixtures__/services/*.js`, do exactly that without
 * this SDK at all) -- this module just wraps it typed, with reconnect and
 * scope-aware errors.
 *
 * ⚠️ THIS CODE IS UNTRUSTED, same posture as `postMessageTransport.ts`: the
 * Core re-checks every single request against `scopeMatrix.ts`, independent
 * of anything this file does or doesn't do.
 */

import type { NavState, Position, Route, RouteRequest } from '@yapaja/shared';
import type { PositionUpdate } from './protocol.js';
import { AddonTransportError, RemoteCallError, ScopeDeniedError, UnsupportedOnTransportError } from './errors.js';
import { assertCoreCompatible } from './version.js';
import { guardScope, toScopeAwareError } from './sdkMethods.js';
import type {
  NavControlDestinationParams,
  NavControlDestinationResult,
  NavControlStartParams,
  SdkFetchInit,
  YapajaAddon,
} from './types.js';

const TRANSPORT = 'service';

function unsupported<T>(method: string, reason?: string): Promise<T> {
  return Promise.reject(new UnsupportedOnTransportError(method, TRANSPORT, reason));
}

/** Structural subset of the DOM `fetch` function this module needs -- lets a
 *  test inject a fake without pulling in a real network stack. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Structural subset of the DOM `WebSocket` constructor this module needs. */
export type WebSocketCtor = new (url: string) => WebSocket;

export interface ServiceReconnectOptions {
  /** Initial backoff before the first reconnect attempt, ms. Default 1000. */
  initialDelayMs?: number;
  /** Backoff ceiling (doubles on each failed attempt up to this). Default 30000. */
  maxDelayMs?: number;
  /** Reconnect attempts before giving up entirely. Default: unlimited -- a
   *  long-running service add-on should keep trying for as long as it runs;
   *  the Core coming back after a restart is the common case this exists for. */
  maxAttempts?: number;
}

export interface ServiceTransportOptions {
  /** Base URL, e.g. `http://127.0.0.1:8080`. Defaults to `process.env.YAPAJA_API_URL`. */
  apiUrl?: string;
  /** Scoped bearer token. Defaults to `process.env.YAPAJA_TOKEN`. */
  token?: string;
  /** This add-on's own id. Defaults to `process.env.YAPAJA_ADDON_ID`. */
  addonId?: string;
  /** Injectable transport, defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /** Injectable WS constructor, defaults to the global `WebSocket`. */
  webSocketImpl?: WebSocketCtor;
  /** Skip the `GET /api/v1/health` Core-compatibility check performed at
   *  connect (see `version.ts`). Default false. */
  skipCoreCompatibilityCheck?: boolean;
  reconnect?: ServiceReconnectOptions;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null;
}

/** POSTs/PUTs/DELETEs/GETs the Core's JSON REST API with the add-on's bearer
 *  token, unwraps `{ data }` envelopes are the CALLER's job (endpoints differ,
 *  see each method below) -- this only turns a non-2xx response into a typed
 *  {@link RemoteCallError} and a 204 into `undefined`. */
async function restRequest(
  fetchImpl: FetchLike,
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    throw new AddonTransportError(
      `Request ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (response.status === 204) return undefined;
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const body2 = isApiErrorBody(parsed) ? parsed.error : undefined;
    throw new RemoteCallError(body2?.code ?? `HTTP_${response.status}`, body2?.message ?? `${method} ${path} failed with ${response.status}`);
  }
  return parsed;
}

function dataOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: unknown }).data;
  }
  return value;
}

// ---------------------------------------------------------------------------
// WS bus: reconnect with backoff, resubscribe every desired topic on reopen.
// Mirrors `apps/web/src/shell/wsStore.ts` / `apps/core/src/mqtt/bridge.ts`'s
// "own connect(), reconnect via scheduleReconnect() with doubling backoff
// reset on success" shape.
// ---------------------------------------------------------------------------

interface WsFrame {
  topic?: string;
  payload?: unknown;
  type?: string;
  code?: string;
  message?: string;
  required_scope?: string;
}

class ServiceBus {
  private ws: WebSocket | null = null;
  private connecting = false;
  private disposed = false;
  private readonly desiredTopics = new Set<string>();
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly errorHandlers = new Map<string, Set<(err: Error) => void>>();
  private reconnectAttempt = 0;
  private reconnectDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly WebSocketImpl: WebSocketCtor,
    private readonly reconnect: Required<ServiceReconnectOptions>,
  ) {
    this.reconnectDelay = reconnect.initialDelayMs;
  }

  ensureConnected(): void {
    if (this.disposed || this.ws || this.connecting) return;
    this.open();
  }

  subscribe(topic: string, onPayload: (payload: unknown) => void, onError?: (err: Error) => void): () => void {
    this.desiredTopics.add(topic);
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(onPayload);
    if (onError) {
      let errSet = this.errorHandlers.get(topic);
      if (!errSet) {
        errSet = new Set();
        this.errorHandlers.set(topic, errSet);
      }
      errSet.add(onError);
    }
    this.ensureConnected();
    this.sendSubscribe();
    return () => {
      set?.delete(onPayload);
      if (onError) this.errorHandlers.get(topic)?.delete(onError);
      if (set && set.size === 0) {
        this.handlers.delete(topic);
        this.desiredTopics.delete(topic);
        this.sendSubscribe();
      }
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private open(): void {
    this.connecting = true;
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.addEventListener('open', () => {
      this.connecting = false;
      this.reconnectAttempt = 0;
      this.reconnectDelay = this.reconnect.initialDelayMs;
      // THE resubscribe: every topic any live `subscribe()` call still wants,
      // resent as one batch -- the server REPLACES the subscription set on
      // every `subscribe` message (`apps/core/src/bus/ws.ts`), so a partial
      // resend would silently drop topics.
      this.sendSubscribe();
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(String(event.data)) as WsFrame;
      } catch {
        return;
      }
      if (typeof frame.topic === 'string' && frame.type !== 'error') {
        for (const cb of this.handlers.get(frame.topic) ?? []) {
          try {
            cb(frame.payload);
          } catch {
            /* an add-on callback throwing must never break the stream */
          }
        }
        return;
      }
      if (frame.type === 'error' && typeof frame.topic === 'string') {
        const err = new RemoteCallError(frame.code ?? 'ERROR', frame.message ?? 'WS subscription refused');
        (err as RemoteCallError & { requiredScope?: string }).requiredScope = frame.required_scope;
        for (const cb of this.errorHandlers.get(frame.topic) ?? []) cb(err);
      }
    });
    socket.addEventListener('close', () => {
      this.ws = null;
      this.connecting = false;
      if (!this.disposed) this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      /* the `close` event that follows drives reconnection */
    });
  }

  private sendSubscribe(): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'subscribe', topics: [...this.desiredTopics] }));
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    if (this.reconnectAttempt >= this.reconnect.maxAttempts) return;
    this.reconnectAttempt += 1;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnect.maxDelayMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// connect
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * Connects the service transport: resolves `apiUrl`/`token`/`addonId` (from
 * options, falling back to the process-contract env vars), checks the Core's
 * reported version for major-compatibility (unless skipped), and returns a
 * {@link YapajaAddon}. The WS connection itself is opened LAZILY, on the
 * first `position.subscribe`/`nav.subscribe` call -- a service add-on that
 * only ever does REST (storage, events, fetch, nav.control) never pays for a
 * socket it doesn't use.
 */
export async function connectServiceAddon(options: ServiceTransportOptions = {}): Promise<YapajaAddon> {
  const apiUrl = (options.apiUrl ?? env('YAPAJA_API_URL'))?.replace(/\/+$/, '');
  const token = options.token ?? env('YAPAJA_TOKEN');
  const addonId = options.addonId ?? env('YAPAJA_ADDON_ID');
  if (!apiUrl || !token || !addonId) {
    throw new AddonTransportError(
      'connectServiceAddon() requires apiUrl/token/addonId -- pass them explicitly or run under the Core\'s ' +
        'service-add-on process contract (YAPAJA_API_URL/YAPAJA_TOKEN/YAPAJA_ADDON_ID env vars).',
    );
  }
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const webSocketImpl = options.webSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor);

  // Core-compatibility check (docs/05 §3, version.ts): `GET /api/v1/health`
  // is on the auth guard's OPEN list -- deliberately called WITHOUT the
  // bearer token, because `apps/core/src/auth/plugin.ts` resolves an add-on
  // principal from ANY presented bearer token FIRST, before consulting the
  // open-path list, and `/api/v1/health` is not in `scopeMatrix.ts`'s route
  // table -- an authenticated add-on request to it would be REFUSED
  // (`ROUTE_NOT_ALLOWED`), not just "allowed because it's open".
  if (!options.skipCoreCompatibilityCheck) {
    let health: unknown;
    try {
      const res = await fetchImpl(`${apiUrl}/api/v1/health`);
      health = await res.json();
    } catch (err) {
      throw new AddonTransportError(
        `Could not reach the Core's GET /api/v1/health to verify compatibility: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const coreVersion = (health as { version?: unknown } | null)?.version;
    if (typeof coreVersion === 'string') {
      assertCoreCompatible(coreVersion);
    }
  }

  const reconnect: Required<ServiceReconnectOptions> = {
    initialDelayMs: options.reconnect?.initialDelayMs ?? 1000,
    maxDelayMs: options.reconnect?.maxDelayMs ?? 30_000,
    maxAttempts: options.reconnect?.maxAttempts ?? Number.POSITIVE_INFINITY,
  };
  const wsUrl = `${apiUrl.replace(/^http/, 'ws')}/ws/v1?token=${encodeURIComponent(token)}`;
  const bus = new ServiceBus(wsUrl, webSocketImpl, reconnect);

  const rest = (method: string, path: string, body?: unknown): Promise<unknown> =>
    restRequest(fetchImpl, apiUrl, token, method, path, body);

  const asState = (v: unknown): NavState => dataOf(v) as NavState;

  const client: YapajaAddon = {
    transport: TRANSPORT,
    addonId,
    // No endpoint reports a token's granted scopes back to the holder of
    // that token -- see `types.ts`'s doc on `scopes`. `hasScope` is therefore
    // always `false` here; the response to the call you actually make is the
    // only real signal.
    scopes: [],
    hasScope: () => false,

    position: {
      get: () =>
        guardScope('position.get', async () => {
          const raw = await rest('GET', '/api/v1/position');
          return (raw ?? null) as Position | null;
        }),
      subscribe(cb, onError) {
        return bus.subscribe(
          'pos/update',
          (payload) => cb(payload as PositionUpdate),
          onError && ((err) => onError(toScopeAwareError('position.subscribe', asRemoteError(err), scopeOf(err)))),
        );
      },
    },

    nav: {
      state: () => guardScope('nav.state', async () => asState(await rest('GET', '/api/v1/navigation/state'))),
      subscribe(cb, onError) {
        return bus.subscribe(
          'nav/state',
          (payload) => cb(payload as NavState),
          onError && ((err) => onError(toScopeAwareError('nav.subscribe', asRemoteError(err), scopeOf(err)))),
        );
      },
      control: {
        start: (params: NavControlStartParams) =>
          guardScope('nav.control.start', async () => asState(await rest('POST', '/api/v1/navigation/start', params))),
        stop: () => guardScope('nav.control.stop', async () => asState(await rest('POST', '/api/v1/navigation/stop'))),
        pause: () =>
          guardScope('nav.control.pause', async () => asState(await rest('POST', '/api/v1/navigation/pause'))),
        resume: () =>
          guardScope('nav.control.resume', async () => asState(await rest('POST', '/api/v1/navigation/resume'))),
        destination: (params: NavControlDestinationParams) =>
          guardScope(
            'nav.control.destination',
            async () => dataOf(await rest('POST', '/api/v1/navigation/destination', params)) as NavControlDestinationResult,
          ),
      },
    },

    route: {
      read: (request: RouteRequest) =>
        guardScope('route.read', async () => dataOf(await rest('POST', '/api/v1/routes', request)) as Route[]),
      get: (routeId: string) =>
        guardScope('route.get', async () => dataOf(await rest('GET', `/api/v1/routes/${encodeURIComponent(routeId)}`)) as Route),
      propose: () => unsupported('route.propose', 'route.propose renders a UI confirmation banner; it is UI-only'),
    },

    map: {
      addLayer: () => unsupported('map.addLayer', 'there is no map in a headless service add-on process'),
      addMarkers: () => unsupported('map.addMarkers', 'there is no map in a headless service add-on process'),
      removeLayer: () => unsupported('map.removeLayer', 'there is no map in a headless service add-on process'),
    },

    widgets: {
      register: () => unsupported('widgets.register', 'widgets render in the shell UI; it is UI-only'),
      update: () => unsupported('widgets.update', 'widgets render in the shell UI; it is UI-only'),
    },

    events: {
      publish: (topic: string, payload: unknown) =>
        guardScope('events.publish', async () => {
          await rest('POST', `/api/v1/addons/${encodeURIComponent(addonId)}/events`, { topic, payload });
        }),
    },

    storage: {
      get: <T = unknown>(key: string) =>
        guardScope('storage.get', async () => {
          try {
            const raw = await rest('GET', `/api/v1/addons/${encodeURIComponent(addonId)}/storage/${encodeURIComponent(key)}`);
            return dataOf(raw) as T;
          } catch (err) {
            if (err instanceof RemoteCallError && err.code === 'NOT_FOUND') return undefined;
            throw err;
          }
        }),
      set: (key: string, value: unknown) =>
        guardScope('storage.set', async () => {
          await rest('PUT', `/api/v1/addons/${encodeURIComponent(addonId)}/storage/${encodeURIComponent(key)}`, { value });
        }),
      delete: (key: string) =>
        guardScope('storage.delete', async () => {
          await rest('DELETE', `/api/v1/addons/${encodeURIComponent(addonId)}/storage/${encodeURIComponent(key)}`);
        }),
    },

    notify: {
      send: (message: string, title?: string) =>
        guardScope('notify.send', async () => {
          await rest('POST', `/api/v1/addons/${encodeURIComponent(addonId)}/notifications`, { message, title });
        }),
    },

    fetch: async (url: string, init?: SdkFetchInit) => {
      if (init?.method && init.method !== 'GET') {
        throw new AddonTransportError(
          `fetch(): the Core's egress proxy only ever issues GET upstream, got "${init.method}"`,
          'FETCH_METHOD_NOT_SUPPORTED',
        );
      }
      const proxyUrl = `${apiUrl}/api/v1/addons/proxy?url=${encodeURIComponent(url)}`;
      let response: Response;
      try {
        response = await fetchImpl(proxyUrl, {
          headers: { authorization: `Bearer ${token}` },
          ...(init?.signal ? { signal: init.signal } : {}),
        });
      } catch (err) {
        throw new AddonTransportError(`fetch(${url}) failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (response.status === 403) {
        let code: string | undefined;
        let message = 'Egress refused';
        try {
          const body = (await response.clone().json()) as ApiErrorBody;
          code = body.error?.code;
          message = body.error?.message ?? message;
        } catch {
          /* non-JSON error body -- fall through with the generic message */
        }
        if (code === 'HOST_NOT_ALLOWED') {
          // Not a fixed-scope method (`SDK_METHOD_SCOPES.fetch` is `null`,
          // see `sdkMethods.ts`) -- the specific `net.fetch:<host>` scope is
          // built from the URL actually requested, so `ScopeDeniedError` is
          // constructed directly here rather than through `guardScope`.
          throw new ScopeDeniedError('fetch', `net.fetch:${safeHostname(url)}`, message);
        }
        throw new RemoteCallError(code ?? 'FORBIDDEN', message);
      }
      return response;
    },

    dispose: () => bus.dispose(),
  };

  return client;
}

function asRemoteError(err: Error): RemoteCallError {
  return err instanceof RemoteCallError ? err : new RemoteCallError('ERROR', err.message);
}

function scopeOf(err: Error): string | undefined {
  return (err as RemoteCallError & { requiredScope?: string }).requiredScope;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
