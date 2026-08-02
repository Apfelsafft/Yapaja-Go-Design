import { describe, it, expect, vi } from 'vitest';
import { connectPostMessage } from './postMessageTransport.js';
import { ADDON_MESSAGE_NS, ADDON_PROTOCOL_VERSION, METHOD_SCOPES, BRIDGE_METHODS } from './protocol.js';
import { AddonTimeoutError, ScopeDeniedError, UnsupportedOnTransportError } from './errors.js';
import type { YapajaAddon } from './types.js';

/**
 * The postMessage transport is add-on-side convenience only, but it still
 * has to speak the wire protocol correctly. These tests drive it with a mock
 * host window (no jsdom needed) and assert the handshake + call/result +
 * event-stream plumbing, PLUS the scope-denial -> ScopeDeniedError mapping
 * and the UI-only/service-only method boundary.
 */

interface MockWindow {
  addEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  removeEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  postMessage: ReturnType<typeof vi.fn>;
  _deliver: (data: unknown) => void;
  _listeners: Set<(e: MessageEvent) => void>;
}

function makeWindow(): MockWindow {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    _listeners: listeners,
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    postMessage: vi.fn(),
    _deliver: (data) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}

function lastPosted(win: MockWindow): Record<string, unknown> {
  const calls = win.postMessage.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

async function connectHandshaken(scopes: string[] = ['pos.read', 'map.layer.write']): Promise<{
  host: MockWindow;
  addon: MockWindow;
  client: YapajaAddon;
}> {
  const host = makeWindow();
  const addon = makeWindow();
  const promise = connectPostMessage({
    target: host as unknown as Window,
    self: addon as unknown as Window,
    timeoutMs: 1000,
  });
  expect(lastPosted(host)).toMatchObject({ ns: ADDON_MESSAGE_NS, type: 'ready' });
  addon._deliver({
    ns: ADDON_MESSAGE_NS,
    v: ADDON_PROTOCOL_VERSION,
    type: 'init',
    addonId: 'com.example.demo',
    scopes,
  });
  const client = await promise;
  return { host, addon, client };
}

describe('postMessage transport: handshake', () => {
  it('completes the handshake and exposes the pinned id + scopes + transport tag', async () => {
    const { client } = await connectHandshaken();
    expect(client.transport).toBe('postMessage');
    expect(client.addonId).toBe('com.example.demo');
    expect(client.hasScope('pos.read')).toBe(true);
    expect(client.hasScope('nav.control')).toBe(false);
  });

  it('rejects with AddonTimeoutError when the host never answers within the timeout', async () => {
    const host = makeWindow();
    const addon = makeWindow();
    await expect(
      connectPostMessage({ target: host as unknown as Window, self: addon as unknown as Window, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(AddonTimeoutError);
  });

  it('rejects with AddonTransportError when there is no window/parent and no explicit target/self', async () => {
    await expect(connectPostMessage({})).rejects.toMatchObject({ code: 'TRANSPORT_ERROR' });
  });
});

describe('postMessage transport: UI-supported methods', () => {
  it('map.addLayer sends a typed call and resolves on the matching result', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.map.addLayer({ id: 'poi', data: { type: 'FeatureCollection', features: [] } });
    const posted = lastPosted(host);
    expect(posted).toMatchObject({ type: 'call', method: 'map.addLayer' });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: posted.callId, ok: true });
    await expect(p).resolves.toBeUndefined();
  });

  it('map.addMarkers / map.removeLayer round-trip', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p1 = client.map.addMarkers({ id: 'poi', markers: [{ lat: 1, lng: 2 }] });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(p1).resolves.toBeUndefined();

    const p2 = client.map.removeLayer({ id: 'poi' });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(p2).resolves.toBeUndefined();
  });

  it('widgets.register / widgets.update round-trip', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p1 = client.widgets.register({ widgetId: 'w1', name: 'Widget', slots: ['top'] });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(p1).resolves.toBeUndefined();

    const p2 = client.widgets.update('w1', { text: 'hi' });
    const posted = lastPosted(host);
    expect(posted).toMatchObject({ type: 'call', method: 'widgets.update', params: { widgetId: 'w1', data: { text: 'hi' } } });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: posted.callId, ok: true });
    await expect(p2).resolves.toBeUndefined();
  });

  it('events.publish and storage.get/set round-trip', async () => {
    const { host, addon, client } = await connectHandshaken();
    const pub = client.events.publish('jam-detected', { at: 1 });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(pub).resolves.toBeUndefined();

    const setP = client.storage.set('k', 42);
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(setP).resolves.toBeUndefined();

    const getP = client.storage.get<number>('k');
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true, result: 42 });
    await expect(getP).resolves.toBe(42);
  });

  it('route.propose round-trip (never activates a route -- just the call/result plumbing)', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.route.propose({ waypoints: [{ lat: 1, lng: 2 }], reason: 'x' });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: lastPosted(host).callId, ok: true });
    await expect(p).resolves.toBeUndefined();
  });

  it('nav.state resolves the host-provided snapshot', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.nav.state();
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: 1,
      type: 'result',
      callId: lastPosted(host).callId,
      ok: true,
      result: { status: 'idle' },
    });
    await expect(p).resolves.toMatchObject({ status: 'idle' });
  });

  it('delivers pos/update events to position subscribers and stops after unsubscribe', async () => {
    const { addon, client } = await connectHandshaken();
    const cb = vi.fn();
    const unsub = client.position.subscribe(cb);
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'event', channel: 'pos/update', payload: { lat: 5, lng: 6 } });
    expect(cb).toHaveBeenCalledWith({ lat: 5, lng: 6 });
    unsub();
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'event', channel: 'pos/update', payload: { lat: 7, lng: 8 } });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('postMessage transport: scope denial -> ScopeDeniedError', () => {
  it('carries the missing scope + method for a rejected call (e.g. route.propose)', async () => {
    const { host, addon, client } = await connectHandshaken(['pos.read']); // no route.propose
    const p = client.route.propose({ waypoints: [{ lat: 1, lng: 2 }], reason: 'x' });
    const posted = lastPosted(host);
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: 1,
      type: 'result',
      callId: posted.callId,
      ok: false,
      error: { code: 'SCOPE_DENIED', message: 'Add-on "com.example.demo" lacks scope "route.propose" for "route.propose"' },
    });
    await expect(p).rejects.toBeInstanceOf(ScopeDeniedError);
    await p.catch((err: ScopeDeniedError) => {
      expect(err.scope).toBe('route.propose');
      expect(err.method).toBe('route.propose');
      expect(err.code).toBe('SCOPE_DENIED');
    });
  });

  it('propagates position.subscribe scope denial through onError, carrying the missing scope', async () => {
    const { host, addon, client } = await connectHandshaken([]); // no pos.read
    const onError = vi.fn();
    const cb = vi.fn();
    client.position.subscribe(cb, onError);
    const posted = lastPosted(host);
    expect(posted).toMatchObject({ type: 'call', method: 'position.subscribe' });
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: 1,
      type: 'result',
      callId: posted.callId,
      ok: false,
      error: { code: 'SCOPE_DENIED', message: 'nope' },
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const err = onError.mock.calls[0][0] as ScopeDeniedError;
    expect(err).toBeInstanceOf(ScopeDeniedError);
    expect(err.scope).toBe('pos.read');
    expect(err.method).toBe('position.subscribe');
  });

  it('a non-scope error result still rejects, but as a plain RemoteCallError (not ScopeDeniedError)', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.map.addLayer({ id: 'x', data: {} });
    const posted = lastPosted(host);
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: 1,
      type: 'result',
      callId: posted.callId,
      ok: false,
      error: { code: 'INVALID_PARAMS', message: 'bad' },
    });
    await expect(p).rejects.not.toBeInstanceOf(ScopeDeniedError);
    await expect(p).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('every host bridge method carries a scope (protocol.ts sanity check the SDK relies on)', () => {
    for (const method of BRIDGE_METHODS) {
      expect(METHOD_SCOPES[method]).toBeTruthy();
    }
    expect(BRIDGE_METHODS).toHaveLength(11);
  });
});

describe('postMessage transport: service-only methods are unsupported here', () => {
  it('position.get() rejects with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    await expect(client.position.get()).rejects.toBeInstanceOf(UnsupportedOnTransportError);
  });

  it('nav.subscribe() throws synchronously with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    expect(() => client.nav.subscribe(() => {})).toThrow(UnsupportedOnTransportError);
  });

  it('nav.control.* all reject with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    await expect(client.nav.control.start({})).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.nav.control.stop()).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.nav.control.pause()).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.nav.control.resume()).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.nav.control.destination({})).rejects.toBeInstanceOf(UnsupportedOnTransportError);
  });

  it('route.read/get reject with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    await expect(
      client.route.read({ origin: 'current', destination: { lat: 1, lon: 2 }, waypoints: [], profile_id: 'p', alternatives: 0 }),
    ).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.route.get('r1')).rejects.toBeInstanceOf(UnsupportedOnTransportError);
  });

  it('storage.delete rejects with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    await expect(client.storage.delete('k')).rejects.toBeInstanceOf(UnsupportedOnTransportError);
  });

  it('notify.send and fetch reject with UnsupportedOnTransportError', async () => {
    const { client } = await connectHandshaken();
    await expect(client.notify.send('hi')).rejects.toBeInstanceOf(UnsupportedOnTransportError);
    await expect(client.fetch('https://example.com')).rejects.toBeInstanceOf(UnsupportedOnTransportError);
  });
});

describe('postMessage transport: dispose', () => {
  it('removes the message listener so late events are no longer delivered', async () => {
    const { addon, client } = await connectHandshaken();
    const cb = vi.fn();
    client.position.subscribe(cb);
    client.dispose();
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'event', channel: 'pos/update', payload: { lat: 1, lng: 2 } });
    expect(cb).not.toHaveBeenCalled();
  });
});
