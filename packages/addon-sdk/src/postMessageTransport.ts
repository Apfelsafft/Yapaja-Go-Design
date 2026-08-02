/**
 * The postMessage transport (docs/05 §3, E09-T2/T4): the UI add-on side of
 * the handshake + call/result/event protocol `protocol.ts` defines, wrapped
 * into the shared {@link YapajaAddon} surface. Runs INSIDE the sandboxed,
 * opaque-origin add-on iframe and talks to `apps/web/src/addons/bridge.ts`.
 *
 * ⚠️ THIS CODE IS UNTRUSTED. It ships inside the add-on bundle and an add-on
 * author can replace or bypass it entirely. It exists ONLY for developer
 * ergonomics. Every security decision -- does this add-on have `pos.read`?
 * may it publish to that topic? may it remove that map layer? -- is made by
 * the HOST (`apps/web/src/addons/bridge.ts`), which re-checks each call
 * against the scope-set it pinned at handshake and never trusts a single byte
 * this file sends. A malicious add-on that hand-rolls its own postMessage
 * calls to skip these wrappers gains NOTHING: the host enforcement is
 * identical either way.
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
  type AddLayerParams,
  type AddMarkersParams,
  type AddonScope,
  type BridgeMethod,
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
import type { NavState } from '@yapaja/shared';
import { AddonTimeoutError, AddonTransportError, RemoteCallError, UnsupportedOnTransportError } from './errors.js';
import { guardScope } from './sdkMethods.js';
import type { YapajaAddon } from './types.js';

type PositionCallback = (pos: PositionUpdate) => void;

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface PostMessageTransportOptions {
  /** The window to talk to; defaults to `window.parent`. Injectable for tests. */
  target?: Window;
  /** The window whose `message` events we listen on; defaults to `self`/`window`. */
  self?: Window;
  /** Handshake timeout in ms (default 5000). */
  timeoutMs?: number;
}

const TRANSPORT = 'postMessage';

function unsupported<T>(method: string, reason?: string): Promise<T> {
  return Promise.reject(new UnsupportedOnTransportError(method, TRANSPORT, reason));
}

/**
 * Performs the handshake with the host and resolves to a {@link YapajaAddon}
 * bound to the postMessage transport. Rejects with {@link AddonTimeoutError}
 * if the host does not answer within `timeoutMs`.
 */
export function connectPostMessage(options: PostMessageTransportOptions = {}): Promise<YapajaAddon> {
  const targetWindow = options.target ?? (typeof window !== 'undefined' ? window.parent : undefined);
  const selfWindow = options.self ?? (typeof window !== 'undefined' ? window : undefined);
  if (!targetWindow || !selfWindow) {
    return Promise.reject(
      new AddonTransportError('connectPostMessage() requires a browser window/parent (or explicit { target, self } for tests)'),
    );
  }
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise<YapajaAddon>((resolve, reject) => {
    const pending = new Map<string, PendingCall>();
    const positionCallbacks = new Map<PositionCallback, ((err: Error) => void) | undefined>();
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
        else p.reject(new RemoteCallError(data.error?.code ?? 'ERROR', data.error?.message ?? 'Bridge call failed'));
        return;
      }
      if (data.type === 'event') {
        if (data.channel === 'pos/update') {
          for (const cb of positionCallbacks.keys()) {
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
      reject(new AddonTimeoutError(`Host did not answer the handshake within ${timeoutMs}ms`));
    }, timeoutMs);

    function buildClient(addonId: string, scopes: AddonScope[]): YapajaAddon {
      const scopeSet = new Set<string>(scopes);

      return {
        transport: TRANSPORT,
        addonId,
        scopes,
        hasScope: (scope) => scopeSet.has(scope),

        position: {
          get: () => unsupported('position.get', 'the host bridge has no one-shot getter; use position.subscribe'),
          subscribe(cb, onError) {
            positionCallbacks.set(cb, onError);
            // Idempotent host-side: repeated subscribes just (re)confirm. A
            // scope denial surfaces asynchronously through `onError`, never by
            // throwing out of `subscribe` itself (it returns synchronously).
            void guardScope('position.subscribe', () => call('position.subscribe', {})).catch((err: Error) => {
              positionCallbacks.delete(cb);
              onError?.(err);
            });
            return () => positionCallbacks.delete(cb);
          },
        },

        nav: {
          state: () => guardScope('nav.state', () => call('nav.state', {})).then((r) => r as NavState),
          subscribe: () => {
            throw new UnsupportedOnTransportError(
              'nav.subscribe',
              TRANSPORT,
              'the host bridge has no push channel for nav state; poll nav.state() instead',
            );
          },
          control: {
            start: () => unsupported('nav.control.start', 'navigation control has no postMessage bridge method'),
            stop: () => unsupported('nav.control.stop', 'navigation control has no postMessage bridge method'),
            pause: () => unsupported('nav.control.pause', 'navigation control has no postMessage bridge method'),
            resume: () => unsupported('nav.control.resume', 'navigation control has no postMessage bridge method'),
            destination: () =>
              unsupported('nav.control.destination', 'navigation control has no postMessage bridge method'),
          },
        },

        route: {
          read: () => unsupported('route.read', 'route computation has no postMessage bridge method; it is service-only'),
          get: () => unsupported('route.get', 'route lookup has no postMessage bridge method; it is service-only'),
          propose: (params: RouteProposeParams) =>
            guardScope('route.propose', () => call('route.propose', params)).then(() => undefined),
        },

        map: {
          addLayer: (params: AddLayerParams) =>
            guardScope('map.addLayer', () => call('map.addLayer', params)).then(() => undefined),
          addMarkers: (params: AddMarkersParams) =>
            guardScope('map.addMarkers', () => call('map.addMarkers', params)).then(() => undefined),
          removeLayer: (params: RemoveLayerParams) =>
            guardScope('map.removeLayer', () => call('map.removeLayer', params)).then(() => undefined),
        },

        widgets: {
          register: (params: WidgetRegisterParams) =>
            guardScope('widgets.register', () => call('widgets.register', params)).then(() => undefined),
          update: (widgetId: string, data: WidgetData) =>
            guardScope('widgets.update', () =>
              call('widgets.update', { widgetId, data } satisfies WidgetUpdateParams),
            ).then(() => undefined),
        },

        events: {
          publish: (topic: string, payload: unknown) =>
            guardScope('events.publish', () =>
              call('events.publish', { topic, payload } satisfies EventPublishParams),
            ).then(() => undefined),
        },

        storage: {
          get: <T = unknown>(key: string) =>
            guardScope('storage.get', () => call('storage.get', { key } satisfies StorageGetParams)).then(
              (r) => r as T | undefined,
            ),
          set: (key: string, value: unknown) =>
            guardScope('storage.set', () =>
              call('storage.set', { key, value } satisfies StorageSetParams),
            ).then(() => undefined),
          delete: () => unsupported('storage.delete', 'the host bridge exposes storage.get/set but no delete method'),
        },

        notify: {
          send: () => unsupported('notify.send', 'ha.notify has no postMessage bridge method; it is service-only'),
        },

        fetch: () => unsupported('fetch', 'the egress proxy has no postMessage bridge method; it is service-only'),

        dispose,
      };
    }

    // Announce readiness LAST, once our listener is attached, so the host's
    // init reply can never race ahead of us being ready to receive it.
    post({ type: 'ready' });
  });
}
