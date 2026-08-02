import { describe, it, expect, vi } from 'vitest';
import { AddonBridge, type HostBridgeDeps } from './bridge.js';
import { BRIDGE_METHODS, METHOD_SCOPES, type AddonScope, type BridgeMethod } from '@yapaja/addon-sdk';

/**
 * THE key security test (docs/05 §2, Wargame W-10): for EVERY bridge method,
 * with the required scope granted the call executes; with it missing the call
 * is REJECTED (`SCOPE_DENIED`), LOGGED (host-side), and the host dep is NEVER
 * invoked. Enforcement is exercised via `handleCall` directly -- i.e. bypassing
 * the (untrusted) SDK entirely -- so this proves the check lives in the HOST,
 * not in add-on-side code.
 */

const ADDON_ID = 'com.example.matrix';

function makeDeps(): { deps: HostBridgeDeps; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const deps: HostBridgeDeps = {
    position: { subscribe: vi.fn(() => () => {}) },
    nav: { getState: vi.fn(() => ({ navigating: 'idle' })) },
    map: {
      addLayer: vi.fn(),
      addMarkers: vi.fn(),
      removeLayer: vi.fn(),
      removeAllForAddon: vi.fn(),
    },
    widgets: {
      register: vi.fn(),
      update: vi.fn(),
      removeAllForAddon: vi.fn(),
    },
    events: { publish: vi.fn() },
    storage: {
      get: vi.fn(async () => 'stored-value'),
      set: vi.fn(async () => undefined),
    },
    routes: { propose: vi.fn(), clearForAddon: vi.fn() },
    logger: { warn, info: vi.fn() },
  };
  return { deps, warn };
}

/** A fake window/iframe -- `handleCall` never touches either, so no jsdom. */
function makeBridge(scopes: AddonScope[], deps: HostBridgeDeps): AddonBridge {
  const fakeWindow = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as Window;
  const fakeIframe = { contentWindow: {} } as unknown as HTMLIFrameElement;
  return new AddonBridge({ addonId: ADDON_ID, scopes, iframe: fakeIframe, deps, hostWindow: fakeWindow });
}

/** Valid params for each method (shape the method's own validation accepts). */
const VALID_PARAMS: Record<BridgeMethod, unknown> = {
  'position.subscribe': {},
  'nav.state': {},
  'map.addLayer': { id: 'layer-1', data: { type: 'FeatureCollection', features: [] } },
  'map.addMarkers': { id: 'm-1', markers: [{ lat: 1, lng: 2 }] },
  'map.removeLayer': { id: 'layer-1' },
  'widgets.register': { widgetId: 'w1', name: 'W1', slots: ['top-bar'] },
  'widgets.update': { widgetId: 'w1', data: { text: 'hi' } },
  'events.publish': { topic: 'jam', payload: { level: 3 } },
  'storage.get': { key: 'k' },
  'storage.set': { key: 'k', value: 42 },
  'route.propose': { waypoints: [{ lat: 1, lng: 2 }], reason: 'Stau' },
};

/** The host dep spy each method is expected to reach when granted. */
function depSpyFor(deps: HostBridgeDeps, method: BridgeMethod): ReturnType<typeof vi.fn> {
  const map: Record<BridgeMethod, () => ReturnType<typeof vi.fn>> = {
    'position.subscribe': () => deps.position.subscribe as ReturnType<typeof vi.fn>,
    'nav.state': () => deps.nav.getState as ReturnType<typeof vi.fn>,
    'map.addLayer': () => deps.map.addLayer as ReturnType<typeof vi.fn>,
    'map.addMarkers': () => deps.map.addMarkers as ReturnType<typeof vi.fn>,
    'map.removeLayer': () => deps.map.removeLayer as ReturnType<typeof vi.fn>,
    'widgets.register': () => deps.widgets.register as ReturnType<typeof vi.fn>,
    'widgets.update': () => deps.widgets.update as ReturnType<typeof vi.fn>,
    'events.publish': () => deps.events.publish as ReturnType<typeof vi.fn>,
    'storage.get': () => deps.storage.get as ReturnType<typeof vi.fn>,
    'storage.set': () => deps.storage.set as ReturnType<typeof vi.fn>,
    'route.propose': () => deps.routes.propose as ReturnType<typeof vi.fn>,
  };
  return map[method]();
}

describe('scope matrix: every bridge method × {granted, missing}', () => {
  it('covers all 11 methods (guards against silent method drift)', () => {
    expect(BRIDGE_METHODS).toHaveLength(11);
  });

  for (const method of BRIDGE_METHODS) {
    const required = METHOD_SCOPES[method];

    it(`${method}: GRANTED (${required}) -> executes, reaches the host dep`, async () => {
      const { deps, warn } = makeDeps();
      const bridge = makeBridge([required], deps);
      const res = await bridge.handleCall(method, VALID_PARAMS[method]);
      expect(res.ok).toBe(true);
      expect(depSpyFor(deps, method)).toHaveBeenCalledTimes(1);
      // A granted, valid call must not emit a scope-denial warning.
      expect(warn).not.toHaveBeenCalled();
    });

    it(`${method}: MISSING (${required}) -> rejected + logged, host dep untouched`, async () => {
      const { deps, warn } = makeDeps();
      // Grant NOTHING (no scope at all covers this method).
      const bridge = makeBridge([], deps);
      const res = await bridge.handleCall(method, VALID_PARAMS[method]);
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe('SCOPE_DENIED');
      // Rejected AND logged host-side.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toMatchObject({ addonId: ADDON_ID, method, requiredScope: required });
      // And the effect NEVER happened.
      expect(depSpyFor(deps, method)).not.toHaveBeenCalled();
    });
  }

  it('rejects an unknown method (not in the scope map) without executing anything', async () => {
    const { deps, warn } = makeDeps();
    const bridge = makeBridge(['pos.read', 'map.layer.write'], deps);
    const res = await bridge.handleCall('map.nukeEverything', {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('UNKNOWN_METHOD');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('events.publish is confined to the add-on OWN namespace even WITH the scope', async () => {
    const { deps, warn } = makeDeps();
    const bridge = makeBridge(['events.publish'], deps);

    // Relative topic -> prefixed to addon/{id}/…
    await bridge.handleCall('events.publish', { topic: 'jam', payload: 1 });
    expect(deps.events.publish).toHaveBeenCalledWith(`addon/${ADDON_ID}/jam`, 1);

    // Attempt to publish into ANOTHER namespace -> rejected + logged.
    const res = await bridge.handleCall('events.publish', { topic: 'addon/com.other/evil', payload: 1 });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('TOPIC_FORBIDDEN');
    expect(deps.events.publish).toHaveBeenCalledTimes(1); // still only the first, legit one
    expect(warn).toHaveBeenCalled();
  });
});
