import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectServiceAddon, type FetchLike, type WebSocketCtor } from './serviceTransport.js';
import {
  AddonTransportError,
  IncompatibleCoreError,
  RemoteCallError,
  ScopeDeniedError,
  UnsupportedOnTransportError,
} from './errors.js';
import type { YapajaAddon } from './types.js';

/**
 * The REST+WS (service add-on) transport: mocked `fetch` + a fake
 * `WebSocket`, covering every REST method, the WS subscribe/unsubscribe +
 * reconnect-and-resubscribe path, scope-denial -> ScopeDeniedError on BOTH
 * REST and WS, and the Core-compatibility (major-version) check performed at
 * connect.
 */

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type Listener = (event: unknown) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  readonly url: string;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners.get(type)?.delete(cb);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.emit('close', {});
  }

  emit(type: string, payload: unknown): void {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(payload);
  }

  simulateOpen(): void {
    this.readyState = this.OPEN;
    this.emit('open', {});
  }

  simulateMessage(data: unknown): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  simulateServerClose(): void {
    this.readyState = this.CLOSED;
    this.emit('close', {});
  }

  lastSentTopics(): string[] {
    const raw = this.sent[this.sent.length - 1];
    const parsed = JSON.parse(raw ?? '{}') as { topics?: string[] };
    return parsed.topics ?? [];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

const HEALTH_OK = { status: 'ok', version: '0.1.0', services: {} };

/** Cycles through canned responses, one per `fetch()` call, and records every
 *  call's `(url, init)` on `.mock.calls` like any `vi.fn`. */
function fetchQueue(...responses: Array<Response | (() => Response)>): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[i++];
    if (!r) throw new Error(`fetch called more times (${i}) than the test queued responses for`);
    return typeof r === 'function' ? r() : r;
  });
}

const BASE_OPTS = { apiUrl: 'http://127.0.0.1:8080', token: 'tok-123', addonId: 'com.example.svc' };

async function connectWith(
  fetchImpl: ReturnType<typeof vi.fn>,
  extra: Partial<Parameters<typeof connectServiceAddon>[0]> = {},
): Promise<YapajaAddon> {
  return connectServiceAddon({
    ...BASE_OPTS,
    fetchImpl: fetchImpl as unknown as FetchLike,
    webSocketImpl: FakeWebSocket as unknown as WebSocketCtor,
    ...extra,
  });
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// connect() / compatibility check
// ---------------------------------------------------------------------------

describe('connectServiceAddon(): setup', () => {
  it('requires apiUrl/token/addonId (from options or env)', async () => {
    await expect(connectServiceAddon({})).rejects.toBeInstanceOf(AddonTransportError);
  });

  it('resolves with the addonId + "service" transport tag on success', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    expect(client.transport).toBe('service');
    expect(client.addonId).toBe('com.example.svc');
    client.dispose();
  });

  it('calls GET /api/v1/health WITHOUT an Authorization header (it is on the auth guard open list; ' +
    'an authed add-on request to it would be refused by the scope matrix instead)', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK));
    const client = await connectWith(fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/health');
    expect(init).toBeUndefined(); // no headers object at all -- never mind an Authorization one
    client.dispose();
  });

  it('throws IncompatibleCoreError when the Core major differs from the SDK major', async () => {
    await expect(connectWith(fetchQueue(jsonResponse({ ...HEALTH_OK, version: '99.0.0' })))).rejects.toBeInstanceOf(
      IncompatibleCoreError,
    );
  });

  it('skipCoreCompatibilityCheck bypasses the health-based check entirely (no fetch call for it)', async () => {
    const fetchImpl = fetchQueue(jsonResponse({ data: { lat: 1, lon: 2 } }));
    const client = await connectWith(fetchImpl, { skipCoreCompatibilityCheck: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    client.dispose();
  });

  it('wraps a network failure reaching /health in AddonTransportError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(connectWith(fetchImpl)).rejects.toBeInstanceOf(AddonTransportError);
  });
});

// ---------------------------------------------------------------------------
// REST methods
// ---------------------------------------------------------------------------

describe('service transport: REST methods', () => {
  it('position.get() returns the Position on 200, null on 204', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK), jsonResponse({ lat: 47.1, lon: 9.6 }), noContentResponse());
    const client = await connectWith(fetchImpl);
    await expect(client.position.get()).resolves.toMatchObject({ lat: 47.1, lon: 9.6 });
    await expect(client.position.get()).resolves.toBeNull();
    client.dispose();
  });

  it('nav.state() unwraps { data }', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK), jsonResponse({ data: { status: 'idle' } }));
    const client = await connectWith(fetchImpl);
    await expect(client.nav.state()).resolves.toMatchObject({ status: 'idle' });
    client.dispose();
  });

  it('nav.control.start/stop/pause/resume/destination round-trip', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ data: { status: 'navigating' } }),
      jsonResponse({ data: { status: 'idle' } }),
      jsonResponse({ data: { status: 'paused' } }),
      jsonResponse({ data: { status: 'navigating' } }),
      jsonResponse({ data: { route: { id: 'r1' }, nav_state: { status: 'navigating' } } }),
    );
    const client = await connectWith(fetchImpl);
    await expect(client.nav.control.start({ route_id: 'r1' })).resolves.toMatchObject({ status: 'navigating' });
    await expect(client.nav.control.stop()).resolves.toMatchObject({ status: 'idle' });
    await expect(client.nav.control.pause()).resolves.toMatchObject({ status: 'paused' });
    await expect(client.nav.control.resume()).resolves.toMatchObject({ status: 'navigating' });
    await expect(client.nav.control.destination({ latlng: { lat: 1, lon: 2 } })).resolves.toMatchObject({
      route: { id: 'r1' },
      nav_state: { status: 'navigating' },
    });
    client.dispose();
  });

  it('route.read/get round-trip', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ data: [{ id: 'r1' }] }),
      jsonResponse({ data: { id: 'r1' } }),
    );
    const client = await connectWith(fetchImpl);
    await expect(
      client.route.read({ origin: 'current', destination: { lat: 1, lon: 2 }, waypoints: [], profile_id: 'p', alternatives: 0 }),
    ).resolves.toMatchObject([{ id: 'r1' }]);
    await expect(client.route.get('r1')).resolves.toMatchObject({ id: 'r1' });
    client.dispose();
  });

  it('events.publish POSTs to the own-namespace endpoint', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK), jsonResponse({ data: { topic: 'addon/com.example.svc/x' } }, 202));
    const client = await connectWith(fetchImpl);
    await client.events.publish('x', { at: 1 });
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/addons/com.example.svc/events');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ topic: 'x', payload: { at: 1 } });
    client.dispose();
  });

  it('storage.get resolves undefined for a NOT_FOUND (unset key), the value otherwise; set/delete round-trip', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Storage key "k" not set' } }, 404),
      jsonResponse({ data: 42 }),
      jsonResponse({ data: 42 }),
      noContentResponse(),
    );
    const client = await connectWith(fetchImpl);
    await expect(client.storage.get('k')).resolves.toBeUndefined();
    await expect(client.storage.get<number>('k')).resolves.toBe(42);
    await expect(client.storage.set('k', 42)).resolves.toBeUndefined();
    await expect(client.storage.delete('k')).resolves.toBeUndefined();
    client.dispose();
  });

  it('notify.send POSTs message + title', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK), jsonResponse({ data: { delivered: true } }, 202));
    const client = await connectWith(fetchImpl);
    await client.notify.send('hello', 'Title');
    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ message: 'hello', title: 'Title' });
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// fetch() via the egress proxy
// ---------------------------------------------------------------------------

describe('service transport: fetch() via the egress proxy', () => {
  it('passes through a successful proxied response', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK), new Response('hello', { status: 200 }));
    const client = await connectWith(fetchImpl);
    const res = await client.fetch('https://api.example.com/x');
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('hello');
    const [url] = fetchImpl.mock.calls[1] as [string];
    expect(url).toBe('http://127.0.0.1:8080/api/v1/addons/proxy?url=' + encodeURIComponent('https://api.example.com/x'));
    client.dispose();
  });

  it('HOST_NOT_ALLOWED (missing net.fetch:<host>) rejects with ScopeDeniedError carrying the host-specific scope', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ error: { code: 'HOST_NOT_ALLOWED', message: 'Host "api.example.com" is not declared' } }, 403),
    );
    const client = await connectWith(fetchImpl);
    const p = client.fetch('https://api.example.com/x');
    await expect(p).rejects.toBeInstanceOf(ScopeDeniedError);
    await p.catch((err: ScopeDeniedError) => {
      expect(err.method).toBe('fetch');
      expect(err.scope).toBe('net.fetch:api.example.com');
    });
    client.dispose();
  });

  it('a non-host-related 403 (e.g. PRIVATE_HOST_NOT_ALLOWED) rejects as a plain RemoteCallError', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ error: { code: 'PRIVATE_HOST_NOT_ALLOWED', message: 'no' } }, 403),
    );
    const client = await connectWith(fetchImpl);
    await expect(client.fetch('https://127.0.0.1/x')).rejects.toMatchObject({ code: 'PRIVATE_HOST_NOT_ALLOWED' });
    client.dispose();
  });

  it('rejects a non-GET method up front (the proxy only ever issues GET upstream), before any network call', async () => {
    const fetchImpl = fetchQueue(jsonResponse(HEALTH_OK));
    const client = await connectWith(fetchImpl);
    const nonGetInit = { method: 'POST' } as unknown as Parameters<YapajaAddon['fetch']>[1];
    await expect(client.fetch('https://api.example.com', nonGetInit)).rejects.toMatchObject({
      code: 'FETCH_METHOD_NOT_SUPPORTED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the health check -- the proxy was never actually called
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// REST-level scope denial
// ---------------------------------------------------------------------------

describe('service transport: REST scope denial -> ScopeDeniedError', () => {
  it('nav.control.start carries "nav.control" when the Core returns SCOPE_MISSING', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ error: { code: 'SCOPE_MISSING', message: 'Add-on "x" is missing the required scope "nav.control"' } }, 403),
    );
    const client = await connectWith(fetchImpl);
    const p = client.nav.control.start({});
    await expect(p).rejects.toBeInstanceOf(ScopeDeniedError);
    await p.catch((err: ScopeDeniedError) => {
      expect(err.method).toBe('nav.control.start');
      expect(err.scope).toBe('nav.control');
    });
    client.dispose();
  });

  it('a non-scope REST error (e.g. VALIDATION_ERROR) stays a plain RemoteCallError', async () => {
    const fetchImpl = fetchQueue(
      jsonResponse(HEALTH_OK),
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'bad body' } }, 400),
    );
    const client = await connectWith(fetchImpl);
    const p = client.nav.control.start({});
    await expect(p).rejects.toBeInstanceOf(RemoteCallError);
    await expect(p).rejects.not.toBeInstanceOf(ScopeDeniedError);
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// Unsupported (UI-only) methods
// ---------------------------------------------------------------------------

describe('service transport: UI-only methods are unsupported here', () => {
  it('map.*, widgets.*, route.propose all reject with UnsupportedOnTransportError', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    await expect(client.map.addLayer({ id: 'x', data: {} })).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.map.addMarkers({ id: 'x', markers: [] })).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.map.removeLayer({ id: 'x' })).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.widgets.register({ widgetId: 'w', name: 'W', slots: [] })).rejects.toBeInstanceOf(
      UnsupportedOnTransportError,
    );
    await expect(client.widgets.update('w', {})).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.route.propose({ waypoints: [], reason: 'x' })).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    client.dispose();
  });
});

// ---------------------------------------------------------------------------
// WS: subscribe / unsubscribe / scope denial / reconnect + resubscribe
// ---------------------------------------------------------------------------

describe('service transport: WS position/nav subscribe', () => {
  it('opens the socket lazily on first subscribe and sends the token in the URL', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    expect(FakeWebSocket.instances).toHaveLength(0);
    client.position.subscribe(() => {});
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:8080/ws/v1?token=tok-123');
    client.dispose();
  });

  it('delivers pos/update payloads after the socket opens, and stops after unsubscribe', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    const cb = vi.fn();
    const unsub = client.position.subscribe(cb);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    expect(ws.lastSentTopics()).toEqual(['pos/update']);

    ws.simulateMessage({ topic: 'pos/update', payload: { lat: 1, lon: 2 } });
    expect(cb).toHaveBeenCalledWith({ lat: 1, lon: 2 });

    unsub();
    expect(ws.lastSentTopics()).toEqual([]); // full-replace resubscribe with the topic removed
    ws.simulateMessage({ topic: 'pos/update', payload: { lat: 9, lon: 9 } });
    expect(cb).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('nav.subscribe shares the connection and both topics batch into one subscribe frame', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    client.position.subscribe(() => {});
    client.nav.subscribe(() => {});
    expect(FakeWebSocket.instances).toHaveLength(1); // ONE socket for both subscriptions
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    expect(new Set(ws.lastSentTopics())).toEqual(new Set(['pos/update', 'nav/state']));
    client.dispose();
  });

  it('a WS scope-denial error frame reaches onError as a ScopeDeniedError carrying the required_scope', async () => {
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)));
    const onError = vi.fn();
    client.position.subscribe(() => {}, onError);
    const ws = FakeWebSocket.instances[0];
    ws.simulateOpen();
    ws.simulateMessage({
      type: 'error',
      topic: 'pos/update',
      code: 'SCOPE_MISSING',
      required_scope: 'pos.read',
      message: 'missing pos.read',
    });
    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as ScopeDeniedError;
    expect(err).toBeInstanceOf(ScopeDeniedError);
    expect(err.scope).toBe('pos.read');
    expect(err.method).toBe('position.subscribe');
    client.dispose();
  });
});

describe('service transport: WS reconnect + resubscribe', () => {
  it('reconnects with backoff after the server closes the socket, and resubscribes every desired topic', async () => {
    vi.useFakeTimers();
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)), {
      reconnect: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    client.position.subscribe(() => {});
    client.nav.subscribe(() => {});
    const first = FakeWebSocket.instances[0];
    first.simulateOpen();
    expect(new Set(first.lastSentTopics())).toEqual(new Set(['pos/update', 'nav/state']));

    // Server-side disconnect.
    first.simulateServerClose();
    expect(FakeWebSocket.instances).toHaveLength(1); // no reconnect attempt yet

    await vi.advanceTimersByTimeAsync(100);
    expect(FakeWebSocket.instances).toHaveLength(2); // reconnect attempt fired

    const second = FakeWebSocket.instances[1];
    second.simulateOpen();
    // THE resubscribe: the reopened socket gets the SAME desired topic set,
    // without the add-on calling subscribe() again.
    expect(new Set(second.lastSentTopics())).toEqual(new Set(['pos/update', 'nav/state']));

    client.dispose();
  });

  it('backs off exponentially between attempts, capped at maxDelayMs', async () => {
    vi.useFakeTimers();
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)), {
      reconnect: { initialDelayMs: 100, maxDelayMs: 300 },
    });
    client.position.subscribe(() => {});
    FakeWebSocket.instances[0].simulateOpen();

    FakeWebSocket.instances[0].simulateServerClose();
    await vi.advanceTimersByTimeAsync(100); // 1st reconnect at 100ms
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].simulateServerClose();
    await vi.advanceTimersByTimeAsync(199); // < 200ms (100*2) -- not yet
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // now at 200ms
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2].simulateServerClose();
    await vi.advanceTimersByTimeAsync(299); // would be 400ms uncapped; capped at 300ms
    expect(FakeWebSocket.instances).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(4);

    client.dispose();
  });

  it('dispose() stops the reconnect loop', async () => {
    vi.useFakeTimers();
    const client = await connectWith(fetchQueue(jsonResponse(HEALTH_OK)), {
      reconnect: { initialDelayMs: 50, maxDelayMs: 200 },
    });
    client.position.subscribe(() => {});
    FakeWebSocket.instances[0].simulateOpen();
    FakeWebSocket.instances[0].simulateServerClose();
    client.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(1); // never reconnected
  });
});
