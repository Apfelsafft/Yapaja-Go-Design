import { describe, it, expect, vi } from 'vitest';
import { AddonBridge, type HostBridgeDeps } from './bridge.js';
import { ADDON_MESSAGE_NS } from '@yapaja/addon-sdk';

/**
 * Host-side bridge unit tests: the handshake, SOURCE-SPOOF rejection (a
 * message from any window other than the pinned iframe's contentWindow is
 * ignored), in-scope dispatch, and residue-free teardown. Origin is never
 * consulted -- trust is pinned to `event.source === iframe.contentWindow`.
 *
 * Uses lightweight fake window/iframe objects (this repo runs Vitest under the
 * `node` environment, no jsdom) so `event.source` identity can be controlled
 * precisely, which is the whole point of the source-pinning assertions.
 */

const ADDON_ID = 'com.example.demo';

function makeDeps(): {
  deps: HostBridgeDeps;
  warn: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
} {
  const warn = vi.fn();
  const report = vi.fn();
  const deps: HostBridgeDeps = {
    position: { subscribe: vi.fn(() => () => {}) },
    nav: { getState: vi.fn(() => ({ navigating: 'idle' })) },
    map: { addLayer: vi.fn(), addMarkers: vi.fn(), removeLayer: vi.fn(), removeAllForAddon: vi.fn() },
    widgets: { register: vi.fn(), update: vi.fn(), removeAllForAddon: vi.fn() },
    events: { publish: vi.fn() },
    storage: { get: vi.fn(async () => 'v'), set: vi.fn(async () => undefined) },
    routes: { propose: vi.fn(), clearForAddon: vi.fn() },
    logger: { warn, info: vi.fn() },
    security: { report },
  };
  return { deps, warn, report };
}

interface FakeWindow {
  addEventListener: (t: string, cb: (e: MessageEvent) => void) => void;
  removeEventListener: (t: string, cb: (e: MessageEvent) => void) => void;
  _deliver: (data: unknown, source: unknown) => void;
  _listeners: Set<(e: MessageEvent) => void>;
}

function makeHostWindow(): FakeWindow {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    _listeners: listeners,
    addEventListener: (_t, cb) => listeners.add(cb),
    removeEventListener: (_t, cb) => listeners.delete(cb),
    _deliver: (data, source) => listeners.forEach((cb) => cb({ data, source, origin: 'null' } as MessageEvent)),
  };
}

/** A fake iframe whose `contentWindow` is a stable object with a postMessage spy. */
function makeIframe(): { iframe: HTMLIFrameElement; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn();
  const contentWindow = { postMessage: post };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  return { iframe, post };
}

function msg(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ns: ADDON_MESSAGE_NS, v: 1, type, ...extra };
}

describe('AddonBridge handshake + source pinning', () => {
  it('answers a ready from the correct source with an init carrying id + scopes', () => {
    const { deps } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['pos.read'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();

    host._deliver(msg('ready'), iframe.contentWindow);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'init', addonId: ADDON_ID, scopes: ['pos.read'] });
    bridge.destroy();
  });

  it('IGNORES a message whose source is a DIFFERENT window (spoof rejected)', async () => {
    const { deps } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    const attacker = { postMessage: vi.fn() }; // some other window
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['map.layer.write'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();

    host._deliver(msg('ready'), attacker);
    host._deliver(msg('ready'), {}); // yet another window object
    host._deliver(msg('call', { callId: 'c1', method: 'map.addLayer', params: { id: 'x', data: {} } }), attacker);
    await Promise.resolve();

    expect(post).not.toHaveBeenCalled();
    expect(deps.map.addLayer).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it('ignores non-addon-namespaced messages from the correct source', () => {
    const { deps } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['pos.read'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();
    host._deliver({ type: 'ready' }, iframe.contentWindow); // missing ns
    host._deliver('a string', iframe.contentWindow);
    expect(post).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it('dispatches an in-scope call from the correct source and posts a result', async () => {
    const { deps } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['map.layer.write'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();

    host._deliver(
      msg('call', { callId: 'c9', method: 'map.addLayer', params: { id: 'poi', data: { type: 'FeatureCollection', features: [] } } }),
      iframe.contentWindow,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.map.addLayer).toHaveBeenCalledWith(ADDON_ID, expect.objectContaining({ id: 'poi' }));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', callId: 'c9', ok: true }), '*');
    bridge.destroy();
  });

  it('rejects an out-of-scope call from the correct source (result ok:false, dep untouched)', async () => {
    const { deps, warn } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['pos.read'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();

    host._deliver(msg('call', { callId: 'c1', method: 'map.addLayer', params: { id: 'x', data: {} } }), iframe.contentWindow);
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.map.addLayer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'result', callId: 'c1', ok: false, error: expect.objectContaining({ code: 'SCOPE_DENIED' }) }),
      '*',
    );
    bridge.destroy();
  });

  it('destroy removes the listener and tears down all add-on artefacts', async () => {
    const { deps } = makeDeps();
    const host = makeHostWindow();
    const { iframe, post } = makeIframe();
    let posCb: ((p: unknown) => void) | null = null;
    (deps.position.subscribe as ReturnType<typeof vi.fn>).mockImplementation((cb: (p: unknown) => void) => {
      posCb = cb;
      return () => {
        posCb = null;
      };
    });
    const bridge = new AddonBridge({ addonId: ADDON_ID, scopes: ['pos.read'], iframe, deps, hostWindow: host as unknown as Window });
    bridge.start();

    host._deliver(msg('call', { callId: 'c1', method: 'position.subscribe', params: {} }), iframe.contentWindow);
    await Promise.resolve();
    expect(deps.position.subscribe).toHaveBeenCalled();
    expect(posCb).not.toBeNull();

    bridge.destroy();
    expect(posCb).toBeNull(); // position stream unsubscribed
    expect(deps.map.removeAllForAddon).toHaveBeenCalledWith(ADDON_ID);
    expect(deps.widgets.removeAllForAddon).toHaveBeenCalledWith(ADDON_ID);
    expect(deps.routes.clearForAddon).toHaveBeenCalledWith(ADDON_ID);

    // After destroy, further messages are ignored (listener removed).
    post.mockClear();
    host._deliver(msg('call', { callId: 'c2', method: 'position.subscribe', params: {} }), iframe.contentWindow);
    await Promise.resolve();
    expect(post).not.toHaveBeenCalled();
  });
});
