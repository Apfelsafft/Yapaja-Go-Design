/**
 * The HOST side of the add-on sandbox (E09-T2, docs/05 §1A/§3, Wargame W-10).
 *
 * One `AddonBridge` owns exactly one sandboxed add-on iframe and is the ONLY
 * thing that iframe can talk to. It is the TRUSTED enforcement point -- the
 * SDK inside the iframe (`@yapaja/addon-sdk`) is untrusted convenience code
 * that a malicious add-on can bypass, so every security decision is made HERE
 * and re-made on every message, never delegated to the add-on side.
 *
 * Two trust anchors, both essential:
 *
 *  1. SOURCE PINNING (not origin). The iframe is `sandbox="allow-scripts"`
 *     WITHOUT `allow-same-origin`, so it runs in an OPAQUE origin: its
 *     `event.origin` on postMessage is the literal string `"null"`, which is
 *     unforgeable-as-a-secret but also useless as a trust signal (any opaque
 *     context reports `"null"`). So we do NOT trust `event.origin`. Instead we
 *     require `event.source === iframe.contentWindow` on EVERY message: a
 *     message from any other window (another add-on's iframe, a popup, the top
 *     window, an attacker frame) is silently ignored. The `contentWindow`
 *     identity is a live object reference the page holds directly and nothing
 *     outside the browser can fabricate.
 *
 *  2. SCOPE CHECKING. Each bridge method maps to a required permission scope
 *     (`METHOD_SCOPES`). The bridge holds the exact scope-set granted to THIS
 *     add-on (pinned from its manifest at construction). A call whose method
 *     needs a scope the add-on was not granted is rejected AND logged, and the
 *     method never runs. The check bypasses the SDK entirely -- a hand-rolled
 *     postMessage that skips the SDK is rejected identically.
 *
 * Teardown (`destroy`) removes the message listener, cancels the position
 * stream, and asks the host adapters to drop every map layer / widget / route
 * proposal this add-on created -- the "disable removes everything immediately,
 * no residue" guarantee.
 */

import {
  ADDON_MESSAGE_NS,
  ADDON_PROTOCOL_VERSION,
  METHOD_SCOPES,
  isAddonMessage,
  type AddonScope,
  type BridgeMethod,
  type AddLayerParams,
  type AddMarkersParams,
  type EventPublishParams,
  type PositionUpdate,
  type RemoveLayerParams,
  type RouteProposeParams,
  type StorageGetParams,
  type StorageSetParams,
  type WidgetRegisterParams,
  type WidgetUpdateParams,
} from '@yapaja/addon-sdk';

/** Result of a dispatched bridge call. */
export interface BridgeCallResult {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** The host capabilities the bridge drives. Injected so the bridge is unit-
 *  testable in isolation (jsdom) with mocks, and so the real adapters
 *  (MapLibre, the shell widget registry, the Core storage API, the route-
 *  proposal banner store) stay decoupled from the enforcement logic. Every
 *  method takes the add-on id explicitly so the adapters can namespace by it. */
export interface HostBridgeDeps {
  position: { subscribe(cb: (pos: PositionUpdate) => void): () => void };
  nav: { getState(): unknown };
  map: {
    addLayer(addonId: string, params: AddLayerParams): void;
    addMarkers(addonId: string, params: AddMarkersParams): void;
    removeLayer(addonId: string, layerId: string): void;
    removeAllForAddon(addonId: string): void;
  };
  widgets: {
    register(addonId: string, params: WidgetRegisterParams): void;
    update(addonId: string, params: WidgetUpdateParams): void;
    removeAllForAddon(addonId: string): void;
  };
  events: { publish(topic: string, payload: unknown): void };
  storage: {
    get(addonId: string, key: string): Promise<unknown>;
    set(addonId: string, key: string, value: unknown): Promise<void>;
  };
  routes: {
    /** Renders a confirmation banner. NEVER activates a route (W-10). */
    propose(addonId: string, params: RouteProposeParams): void;
    clearForAddon(addonId: string): void;
  };
  logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
    info?(message: string, meta?: Record<string, unknown>): void;
  };
}

export interface AddonBridgeOptions {
  addonId: string;
  scopes: readonly AddonScope[];
  iframe: HTMLIFrameElement;
  deps: HostBridgeDeps;
  /** The window whose `message` events we listen on; defaults to `window`. */
  hostWindow?: Window;
}

export class AddonBridge {
  readonly addonId: string;
  private readonly scopes: Set<AddonScope>;
  private readonly iframe: HTMLIFrameElement;
  private readonly deps: HostBridgeDeps;
  private readonly hostWindow: Window;
  private positionUnsub: (() => void) | null = null;
  private readonly onMessage: (event: MessageEvent) => void;
  private destroyed = false;

  constructor(options: AddonBridgeOptions) {
    this.addonId = options.addonId;
    this.scopes = new Set(options.scopes);
    this.iframe = options.iframe;
    this.deps = options.deps;
    this.hostWindow = options.hostWindow ?? window;
    this.onMessage = (event: MessageEvent) => {
      void this.receiveMessage(event);
    };
  }

  /** Begins listening. The handshake completes when the iframe posts `ready`. */
  start(): void {
    this.hostWindow.addEventListener('message', this.onMessage);
  }

  /** Tears the bridge (and everything the add-on created) down. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hostWindow.removeEventListener('message', this.onMessage);
    if (this.positionUnsub) {
      this.positionUnsub();
      this.positionUnsub = null;
    }
    this.deps.map.removeAllForAddon(this.addonId);
    this.deps.widgets.removeAllForAddon(this.addonId);
    this.deps.routes.clearForAddon(this.addonId);
  }

  /**
   * The message gate. Every inbound message runs this. It is the ONE place
   * the source is verified -- a message from any window other than THIS
   * iframe's `contentWindow` is dropped without any side effect.
   */
  async receiveMessage(event: MessageEvent): Promise<void> {
    if (this.destroyed) return;
    // SOURCE PINNING: the only trust anchor. Origin (`"null"` for the opaque
    // sandbox) is deliberately NOT consulted.
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data;
    if (!isAddonMessage(data)) return;

    if (data.type === 'ready') {
      this.sendInit();
      return;
    }
    if (data.type === 'call') {
      const result = await this.handleCall(data.method, data.params);
      this.postToIframe({
        type: 'result',
        callId: data.callId,
        ok: result.ok,
        ...(result.result !== undefined ? { result: result.result } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
    }
    // `init`/`result`/`event` are host->iframe only; ignore if echoed back.
  }

  /**
   * Scope-checked dispatch. PUBLIC so tests can exercise enforcement directly,
   * bypassing the SDK -- exactly the "a call for a missing scope must still be
   * rejected host-side even when the SDK is bypassed" requirement.
   */
  async handleCall(method: string, params: unknown): Promise<BridgeCallResult> {
    const required = (METHOD_SCOPES as Record<string, AddonScope>)[method];
    if (!required) {
      this.deps.logger.warn('[addon-bridge] unknown method rejected', { addonId: this.addonId, method });
      return { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Unknown bridge method "${method}"` } };
    }
    if (!this.scopes.has(required)) {
      // Rejected AND logged (host-side), never executed -- W-10.
      this.deps.logger.warn('[addon-bridge] scope denied', {
        addonId: this.addonId,
        method,
        requiredScope: required,
        grantedScopes: [...this.scopes],
      });
      return {
        ok: false,
        error: { code: 'SCOPE_DENIED', message: `Add-on "${this.addonId}" lacks scope "${required}" for "${method}"` },
      };
    }
    try {
      return await this.execute(method as BridgeMethod, params);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.deps.logger.warn('[addon-bridge] method threw', { addonId: this.addonId, method, message });
      return { ok: false, error: { code: 'BRIDGE_ERROR', message } };
    }
  }

  private async execute(method: BridgeMethod, params: unknown): Promise<BridgeCallResult> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'position.subscribe': {
        if (!this.positionUnsub) {
          this.positionUnsub = this.deps.position.subscribe((pos) => {
            this.postToIframe({ type: 'event', channel: 'pos/update', payload: pos });
          });
        }
        return { ok: true };
      }
      case 'nav.state':
        return { ok: true, result: this.deps.nav.getState() };
      case 'map.addLayer': {
        const layer = p as unknown as AddLayerParams;
        if (typeof layer.id !== 'string' || layer.data === undefined) {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'map.addLayer requires { id, data }' } };
        }
        this.deps.map.addLayer(this.addonId, layer);
        return { ok: true };
      }
      case 'map.addMarkers': {
        const markers = p as unknown as AddMarkersParams;
        if (typeof markers.id !== 'string' || !Array.isArray(markers.markers)) {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'map.addMarkers requires { id, markers[] }' } };
        }
        this.deps.map.addMarkers(this.addonId, markers);
        return { ok: true };
      }
      case 'map.removeLayer': {
        const rm = p as unknown as RemoveLayerParams;
        if (typeof rm.id !== 'string') {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'map.removeLayer requires { id }' } };
        }
        // The adapter only ever touches THIS add-on's namespaced layers, so an
        // add-on can never remove a core / other-add-on layer by id-guessing.
        this.deps.map.removeLayer(this.addonId, rm.id);
        return { ok: true };
      }
      case 'widgets.register': {
        const w = p as unknown as WidgetRegisterParams;
        if (typeof w.widgetId !== 'string' || typeof w.name !== 'string' || !Array.isArray(w.slots)) {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'widgets.register requires { widgetId, name, slots[] }' } };
        }
        this.deps.widgets.register(this.addonId, w);
        return { ok: true };
      }
      case 'widgets.update': {
        const u = p as unknown as WidgetUpdateParams;
        if (typeof u.widgetId !== 'string' || typeof u.data !== 'object' || u.data === null) {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'widgets.update requires { widgetId, data }' } };
        }
        this.deps.widgets.update(this.addonId, u);
        return { ok: true };
      }
      case 'events.publish': {
        const ev = p as unknown as EventPublishParams;
        if (typeof ev.topic !== 'string') {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'events.publish requires { topic }' } };
        }
        const full = this.namespaceTopic(ev.topic);
        if (full === null) {
          // Tried to publish OUTSIDE its own `addon/{id}/*` namespace.
          this.deps.logger.warn('[addon-bridge] events.publish topic rejected (out of namespace)', {
            addonId: this.addonId,
            topic: ev.topic,
          });
          return {
            ok: false,
            error: { code: 'TOPIC_FORBIDDEN', message: `events.publish may only target addon/${this.addonId}/*` },
          };
        }
        this.deps.events.publish(full, ev.payload);
        return { ok: true };
      }
      case 'storage.get': {
        const g = p as unknown as StorageGetParams;
        if (typeof g.key !== 'string') {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'storage.get requires { key }' } };
        }
        const value = await this.deps.storage.get(this.addonId, g.key);
        return { ok: true, result: value };
      }
      case 'storage.set': {
        const s = p as unknown as StorageSetParams;
        if (typeof s.key !== 'string') {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'storage.set requires { key, value }' } };
        }
        await this.deps.storage.set(this.addonId, s.key, s.value);
        return { ok: true };
      }
      case 'route.propose': {
        const r = p as unknown as RouteProposeParams;
        if (!Array.isArray(r.waypoints) || typeof r.reason !== 'string') {
          return { ok: false, error: { code: 'INVALID_PARAMS', message: 'route.propose requires { waypoints[], reason }' } };
        }
        // W-10: this ONLY renders a confirmation banner. It NEVER activates a
        // route. Nav state is unchanged until the user clicks "apply".
        this.deps.routes.propose(this.addonId, r);
        return { ok: true };
      }
      default: {
        // Exhaustiveness guard: METHOD_SCOPES gated us in, so this is unreachable.
        const _never: never = method;
        return { ok: false, error: { code: 'UNKNOWN_METHOD', message: `Unhandled method ${String(_never)}` } };
      }
    }
  }

  /** Maps a caller-supplied topic to a fully-qualified `addon/{id}/…` topic,
   *  or `null` if the caller tried to target a DIFFERENT namespace. */
  private namespaceTopic(topic: string): string | null {
    const prefix = `addon/${this.addonId}/`;
    if (topic.startsWith(prefix)) return topic;
    // Any other `addon/…` topic is an attempt to publish into someone else's
    // (or the root add-on) namespace -> forbidden.
    if (topic.startsWith('addon/')) return null;
    return prefix + topic;
  }

  private sendInit(): void {
    this.postToIframe({ type: 'init', addonId: this.addonId, scopes: [...this.scopes] });
  }

  private postToIframe(message: Record<string, unknown>): void {
    if (this.destroyed) return;
    const target = this.iframe.contentWindow;
    if (!target) return;
    try {
      target.postMessage({ ns: ADDON_MESSAGE_NS, v: ADDON_PROTOCOL_VERSION, ...message }, '*');
    } catch {
      /* a torn-down / navigating iframe can throw; nothing actionable */
    }
  }
}
