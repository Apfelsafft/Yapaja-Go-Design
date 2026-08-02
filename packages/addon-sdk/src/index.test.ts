import { describe, expect, it, vi } from 'vitest';
import { connectAddon } from './index.js';
import { AddonTransportError } from './errors.js';
import { detectTransport } from './detect.js';
import { ADDON_MESSAGE_NS, ADDON_PROTOCOL_VERSION } from './protocol.js';

/**
 * `connectAddon()` dispatch: auto-detects the transport (`detectTransport()`)
 * unless overridden, then delegates. The transports themselves are covered
 * end-to-end in `postMessageTransport.test.ts` / `serviceTransport.test.ts`;
 * these tests only check the DISPATCH decision + the explicit-override escape
 * hatch.
 */

interface MockWindow {
  addEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  removeEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  postMessage: ReturnType<typeof vi.fn>;
  _deliver: (data: unknown) => void;
}

function makeWindow(): MockWindow {
  const listeners = new Set<(e: MessageEvent) => void>();
  return {
    addEventListener: (_type, cb) => listeners.add(cb),
    removeEventListener: (_type, cb) => listeners.delete(cb),
    postMessage: vi.fn(),
    _deliver: (data) => listeners.forEach((cb) => cb({ data } as MessageEvent)),
  };
}

describe('connectAddon() transport dispatch', () => {
  it('honours an explicit { transport: "postMessage" } override and drives the postMessage handshake', async () => {
    const host = makeWindow();
    const addon = makeWindow();
    const connectPromise = connectAddon({
      transport: 'postMessage',
      postMessage: { target: host as unknown as Window, self: addon as unknown as Window, timeoutMs: 1000 },
    });
    expect(host.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ns: ADDON_MESSAGE_NS, type: 'ready' }),
      '*',
    );
    addon._deliver({
      ns: ADDON_MESSAGE_NS,
      v: ADDON_PROTOCOL_VERSION,
      type: 'init',
      addonId: 'com.example.ui',
      scopes: ['pos.read'],
    });
    const client = await connectPromise;
    expect(client.transport).toBe('postMessage');
    expect(client.addonId).toBe('com.example.ui');
    client.dispose();
  });

  it('honours an explicit { transport: "service" } override and drives the REST+WS connect', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'ok', version: '0.1.0' }), { status: 200 }));
    const client = await connectAddon({
      transport: 'service',
      service: {
        apiUrl: 'http://127.0.0.1:8080',
        token: 'tok',
        addonId: 'com.example.svc',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    });
    expect(client.transport).toBe('service');
    expect(client.addonId).toBe('com.example.svc');
    client.dispose();
  });

  it('detectTransport() throws a clear AddonTransportError when neither signal is present', () => {
    expect(() => detectTransport()).toThrow(AddonTransportError);
  });

  it('connectAddon() with no override propagates detectTransport()\'s failure when neither signal is present', async () => {
    await expect(connectAddon()).rejects.toThrow(AddonTransportError);
  });
});
