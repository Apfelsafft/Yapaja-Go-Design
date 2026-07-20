/**
 * `@yapaja/addon-sdk` -- the convenience client add-on UI authors code
 * against (docs/05 §3). It runs INSIDE the sandboxed, opaque-origin add-on
 * iframe and wraps the raw postMessage protocol (`protocol.ts`) into a typed
 * promise/callback API.
 *
 * ⚠️ THIS CODE IS UNTRUSTED. It ships inside the add-on bundle and an add-on
 * author can replace or bypass it entirely. It exists ONLY for developer
 * ergonomics. Every security decision -- does this add-on have `pos.read`?
 * may it publish to that topic? may it remove that map layer? -- is made by
 * the HOST (`apps/web/src/addons/bridge.ts`), which re-checks each call
 * against the scope-set it pinned at handshake and never trusts a single byte
 * this file sends. A malicious add-on that hand-rolls its own postMessage
 * calls to skip these wrappers gains NOTHING: the host enforcement is identical
 * either way. See `bridge.ts` for the real enforcement.
 *
 * Transport note: the iframe posts to `window.parent` with targetOrigin `'*'`
 * because a `sandbox="allow-scripts"` (no `allow-same-origin`) iframe has an
 * opaque origin and cannot know the parent's origin string. Trust is NOT
 * established by origin on either side -- the host pins the iframe's
 * `contentWindow` identity instead (documented in `bridge.ts`).
 */

import {
  ADDON_MESSAGE_NS,
  ADDON_PROTOCOL_VERSION,
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
  type WidgetData,
  type WidgetRegisterParams,
  type WidgetUpdateParams,
} from './protocol.js';

export * from './protocol.js';

type PositionCallback = (pos: PositionUpdate) => void;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class AddonBridgeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AddonBridgeError';
    this.code = code;
  }
}

/** The connected SDK surface. Returned by {@link connect}. */
export interface YapajaAddon {
  /** This add-on's id, as pinned by the host at handshake. */
  readonly addonId: string;
  /** The scope-set the host granted (informational -- the host enforces). */
  readonly scopes: readonly AddonScope[];
  /** True if the add-on was granted `scope` (a courtesy pre-check; the host
   *  enforces regardless). */
  hasScope(scope: AddonScope): boolean;

  position: {
    /** Stream live positions (requires `pos.read`). Returns an unsubscribe fn. */
    subscribe(cb: PositionCallback): () => void;
  };
  nav: {
    /** Current navigation state snapshot (requires `nav.read`). */
    state(): Promise<unknown>;
  };
  map: {
    addLayer(params: AddLayerParams): Promise<void>;
    addMarkers(params: AddMarkersParams): Promise<void>;
    removeLayer(params: RemoveLayerParams): Promise<void>;
  };
  widgets: {
    register(params: WidgetRegisterParams): Promise<void>;
    update(widgetId: string, data: WidgetData): Promise<void>;
  };
  events: {
    /** Publish under the add-on's OWN namespace only (requires `events.publish`). */
    publish(topic: string, payload: unknown): Promise<void>;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
  };
  route: {
    /** Suggest a route. NEVER activates it -- the host asks the user first. */
    propose(params: RouteProposeParams): Promise<void>;
  };
  /** Tear down the SDK's message listener (e.g. on unload). */
  dispose(): void;
}

interface ConnectOptions {
  /** The window to talk to; defaults to `window.parent`. Injectable for tests. */
  target?: Window;
  /** The window whose `message` events we listen on; defaults to `self`. */
  self?: Window;
  /** Handshake timeout in ms (default 5000). */
  timeoutMs?: number;
}

/**
 * Performs the handshake with the host and resolves to a typed client.
 * Rejects if the host does not answer within `timeoutMs`.
 */
export function connect(options: ConnectOptions = {}): Promise<YapajaAddon> {
  const targetWindow = options.target ?? (typeof window !== 'undefined' ? window.parent : undefined);
  const selfWindow = options.self ?? (typeof window !== 'undefined' ? window : undefined);
  if (!targetWindow || !selfWindow) {
    return Promise.reject(new AddonBridgeError('NO_WINDOW', 'connect() requires a browser window/parent'));
  }
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise<YapajaAddon>((resolve, reject) => {
    const pending = new Map<string, PendingCall>();
    const positionCallbacks = new Set<PositionCallback>();
    let callSeq = 0;
    let settled = false;

    const post = (message: Record<string, unknown>): void => {
      targetWindow.postMessage({ ns: ADDON_MESSAGE_NS, v: ADDON_PROTOCOL_VERSION, ...message }, '*');
    };

    const call = (method: BridgeMethod, params: unknown): Promise<unknown> => {
      const callId = `c${++callSeq}`;
      return new Promise<unknown>((res, rej) => {
        pending.set(callId, { resolve: res, reject: rej });
        post({ type: 'call', callId, method, params });
      });
    };

    const onMessage = (event: MessageEvent): void => {
      const data = event.data;
      if (!isAddonMessage(data)) return;

      if (data.type === 'init') {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(buildClient(data.addonId, data.scopes));
        return;
      }
      if (data.type === 'result') {
        const p = pending.get(data.callId);
        if (!p) return;
        pending.delete(data.callId);
        if (data.ok) p.resolve(data.result);
        else p.reject(new AddonBridgeError(data.error?.code ?? 'ERROR', data.error?.message ?? 'Bridge call failed'));
        return;
      }
      if (data.type === 'event') {
        if (data.channel === 'pos/update') {
          for (const cb of positionCallbacks) {
            try {
              cb(data.payload as PositionUpdate);
            } catch {
              /* an add-on callback throwing must never break the stream */
            }
          }
        }
      }
    };

    selfWindow.addEventListener('message', onMessage);

    const dispose = (): void => {
      selfWindow.removeEventListener('message', onMessage);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new AddonBridgeError('HANDSHAKE_TIMEOUT', `Host did not answer the handshake within ${timeoutMs}ms`));
    }, timeoutMs);

    function buildClient(addonId: string, scopes: AddonScope[]): YapajaAddon {
      const scopeSet = new Set(scopes);
      return {
        addonId,
        scopes,
        hasScope: (scope) => scopeSet.has(scope),
        position: {
          subscribe(cb: PositionCallback): () => void {
            positionCallbacks.add(cb);
            // Idempotent server-side: repeated subscribes just (re)confirm.
            void call('position.subscribe', {});
            return () => positionCallbacks.delete(cb);
          },
        },
        nav: {
          state: () => call('nav.state', {}),
        },
        map: {
          addLayer: (params: AddLayerParams) => call('map.addLayer', params).then(() => undefined),
          addMarkers: (params: AddMarkersParams) => call('map.addMarkers', params).then(() => undefined),
          removeLayer: (params: RemoveLayerParams) => call('map.removeLayer', params).then(() => undefined),
        },
        widgets: {
          register: (params: WidgetRegisterParams) => call('widgets.register', params).then(() => undefined),
          update: (widgetId: string, data: WidgetData) =>
            call('widgets.update', { widgetId, data } satisfies WidgetUpdateParams).then(() => undefined),
        },
        events: {
          publish: (topic: string, payload: unknown) =>
            call('events.publish', { topic, payload } satisfies EventPublishParams).then(() => undefined),
        },
        storage: {
          get: (key: string) => call('storage.get', { key } satisfies StorageGetParams),
          set: (key: string, value: unknown) =>
            call('storage.set', { key, value } satisfies StorageSetParams).then(() => undefined),
        },
        route: {
          propose: (params: RouteProposeParams) => call('route.propose', params).then(() => undefined),
        },
        dispose,
      };
    }

    // Announce readiness LAST, once our listener is attached, so the host's
    // init reply can never race ahead of us being ready to receive it.
    post({ type: 'ready' });
  });
}
