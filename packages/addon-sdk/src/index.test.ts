import { describe, it, expect, vi } from 'vitest';
import { connect, ADDON_MESSAGE_NS, ADDON_PROTOCOL_VERSION, METHOD_SCOPES, BRIDGE_METHODS } from './index.js';

/**
 * The SDK is add-on-side convenience only, but it still has to speak the wire
 * protocol correctly. These tests drive it with a mock host window (no jsdom
 * needed) and assert the handshake + call/result + event-stream plumbing.
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

async function connectHandshaken(): Promise<{
  host: MockWindow;
  addon: MockWindow;
  client: Awaited<ReturnType<typeof connect>>;
}> {
  const host = makeWindow();
  const addon = makeWindow();
  const promise = connect({
    target: host as unknown as Window,
    self: addon as unknown as Window,
    timeoutMs: 1000,
  });
  // The SDK announces readiness immediately.
  expect(lastPosted(host)).toMatchObject({ ns: ADDON_MESSAGE_NS, type: 'ready' });
  // Host answers the handshake.
  addon._deliver({
    ns: ADDON_MESSAGE_NS,
    v: ADDON_PROTOCOL_VERSION,
    type: 'init',
    addonId: 'com.example.demo',
    scopes: ['pos.read', 'map.layer.write'],
  });
  const client = await promise;
  return { host, addon, client };
}

describe('addon-sdk connect()', () => {
  it('completes the handshake and exposes the pinned id + scopes', async () => {
    const { client } = await connectHandshaken();
    expect(client.addonId).toBe('com.example.demo');
    expect(client.hasScope('pos.read')).toBe(true);
    expect(client.hasScope('nav.control')).toBe(false);
  });

  it('rejects when the host never answers within the timeout', async () => {
    const host = makeWindow();
    const addon = makeWindow();
    await expect(
      connect({ target: host as unknown as Window, self: addon as unknown as Window, timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'HANDSHAKE_TIMEOUT' });
  });

  it('sends a typed call and resolves on the matching result', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.map.addLayer({ id: 'poi', data: { type: 'FeatureCollection', features: [] } });
    const posted = lastPosted(host);
    expect(posted).toMatchObject({ type: 'call', method: 'map.addLayer' });
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'result', callId: posted.callId, ok: true });
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects a call when the host returns an error result', async () => {
    const { host, addon, client } = await connectHandshaken();
    const p = client.route.propose({ waypoints: [{ lat: 1, lng: 2 }], reason: 'x' });
    const posted = lastPosted(host);
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: 1,
      type: 'result',
      callId: posted.callId,
      ok: false,
      error: { code: 'SCOPE_DENIED', message: 'nope' },
    });
    await expect(p).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('delivers pos/update events to position subscribers', async () => {
    const { addon, client } = await connectHandshaken();
    const cb = vi.fn();
    const unsub = client.position.subscribe(cb);
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'event', channel: 'pos/update', payload: { lat: 5, lng: 6 } });
    expect(cb).toHaveBeenCalledWith({ lat: 5, lng: 6 });
    unsub();
    addon._deliver({ ns: ADDON_MESSAGE_NS, v: 1, type: 'event', channel: 'pos/update', payload: { lat: 7, lng: 8 } });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('exposes a complete method->scope map for every bridge method', () => {
    for (const method of BRIDGE_METHODS) {
      expect(METHOD_SCOPES[method]).toBeTruthy();
    }
    expect(BRIDGE_METHODS).toHaveLength(11);
  });
});
