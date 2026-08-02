/**
 * The unified, typed client surface `connectAddon()` resolves to (docs/05
 * §3) -- the ONE import surface an add-on author codes against regardless of
 * which transport they end up running over. Every method/property below
 * documents which transport(s) actually implement it; calling a method your
 * transport doesn't support rejects/throws {@link UnsupportedOnTransportError}
 * rather than silently doing nothing (see `postMessageTransport.ts` /
 * `serviceTransport.ts`).
 *
 * NONE of this is enforcement. It is a convenience layer over the SAME two
 * wire protocols the host bridge and the Core already define and enforce
 * (`protocol.ts`'s postMessage envelope; the Core's REST/WS API, docs/03).
 */

import type {
  LatLng,
  NavState,
  Position,
  Route,
  RouteRequest,
} from '@yapaja/shared';
import type {
  AddLayerParams,
  AddMarkersParams,
  AddonScope,
  PositionUpdate,
  RemoveLayerParams,
  RouteProposeParams,
  WidgetData,
  WidgetRegisterParams,
} from './protocol.js';
import type { TransportKind } from './detect.js';

/** Body of `nav.control.start` -- mirrors `POST /api/v1/navigation/start`'s
 *  `{ route_id }` OR `{ route, destination? }` (`apps/core/src/navigation/routes.ts`). */
export interface NavControlStartParams {
  route_id?: string;
  route?: Route;
  destination?: { latlng: LatLng; name?: string | null } | null;
}

/** Body of `nav.control.destination` -- mirrors `POST /api/v1/navigation/destination`. */
export interface NavControlDestinationParams {
  latlng?: LatLng;
  query?: string;
  profile_id?: string;
  autostart?: boolean;
}

/** Result of `nav.control.destination` -- mirrors that endpoint's `{ data: { route, nav_state } }`. */
export interface NavControlDestinationResult {
  route: Route;
  nav_state: NavState;
}

export interface SdkFetchInit {
  /**
   * Only `'GET'` is meaningful: the Core's egress proxy
   * (`GET /api/v1/addons/proxy?url=`, `apps/core/src/addons/proxy.ts`) always
   * issues a GET to the upstream host regardless of what is asked -- there is
   * no way to proxy a POST/PUT/DELETE today. Passing anything else throws
   * `AddonSdkError('FETCH_METHOD_NOT_SUPPORTED', ...)` up front rather than
   * silently downgrading the request to a GET.
   */
  method?: 'GET';
  signal?: AbortSignal;
}

export interface YapajaAddon {
  /** Which wire protocol this client is actually speaking. */
  readonly transport: TransportKind;
  /** This add-on's own id. */
  readonly addonId: string;
  /**
   * Best-effort, INFORMATIONAL ONLY set of scopes this client believes it
   * holds -- see each transport's `connect` doc for how (and how reliably) it
   * is populated. On the postMessage transport it's the exact set the host
   * pinned at handshake; on the service transport there is no endpoint that
   * reports a token's granted scopes back to the process holding it, so this
   * is always empty and `hasScope()` always returns `false` there -- the
   * actual authority is always the response to the call you actually make.
   */
  readonly scopes: readonly string[];
  /** Courtesy pre-check against {@link scopes}. NEVER authoritative. */
  hasScope(scope: AddonScope | string): boolean;

  position: {
    /** One-shot last-known fix, or `null` if none yet. Service transport only
     *  (`GET /api/v1/position`); the postMessage bridge has no one-shot getter. */
    get(): Promise<Position | null>;
    /** Live position stream (`pos.read`). Both transports. `onError` (optional)
     *  receives a {@link ScopeDeniedError} if the subscription is refused --
     *  `subscribe` itself never rejects, since it returns an unsubscribe
     *  function synchronously, not a Promise. */
    subscribe(cb: (pos: PositionUpdate) => void, onError?: (err: Error) => void): () => void;
  };

  nav: {
    /** Current `NavState` snapshot (`nav.read`). Both transports. */
    state(): Promise<NavState>;
    /** Live `NavState` push stream (`nav.read`). SERVICE TRANSPORT ONLY (WS
     *  `nav/state` topic) -- the postMessage host bridge has no push channel
     *  for nav state today; a UI add-on must poll `nav.state()`. Throws
     *  {@link UnsupportedOnTransportError} synchronously on the postMessage
     *  transport. */
    subscribe(cb: (state: NavState) => void, onError?: (err: Error) => void): () => void;
    /** `nav.control` operations. SERVICE TRANSPORT ONLY -- navigation control
     *  is a Core-owned REST surface with no postMessage bridge equivalent
     *  (`apps/core/src/addons/scopeMatrix.ts`'s comment on `nav.control`). */
    control: {
      start(params: NavControlStartParams): Promise<NavState>;
      stop(): Promise<NavState>;
      pause(): Promise<NavState>;
      resume(): Promise<NavState>;
      destination(params: NavControlDestinationParams): Promise<NavControlDestinationResult>;
    };
  };

  route: {
    /** Compute route candidates (`route.read`), activates nothing. SERVICE
     *  TRANSPORT ONLY (`POST /api/v1/routes`). */
    read(request: RouteRequest): Promise<Route[]>;
    /** Read a previously-computed route by id (`route.read`). SERVICE
     *  TRANSPORT ONLY (`GET /api/v1/routes/:id`). */
    get(routeId: string): Promise<Route>;
    /** Suggest a route for the user to confirm (`route.propose`, W-10 -- this
     *  NEVER activates a route). UI TRANSPORT ONLY: the confirmation banner
     *  it renders lives in the web app. */
    propose(params: RouteProposeParams): Promise<void>;
  };

  /** UI TRANSPORT ONLY (`map.layer.write`) -- there is no map in a headless
   *  service add-on process. */
  map: {
    addLayer(params: AddLayerParams): Promise<void>;
    addMarkers(params: AddMarkersParams): Promise<void>;
    removeLayer(params: RemoveLayerParams): Promise<void>;
  };

  /** UI TRANSPORT ONLY (`widget.register`) -- widgets render in the shell UI. */
  widgets: {
    register(params: WidgetRegisterParams): Promise<void>;
    update(widgetId: string, data: WidgetData): Promise<void>;
  };

  events: {
    /** Publish under the add-on's OWN `addon/{id}/*` namespace (`events.publish`).
     *  Both transports. */
    publish(topic: string, payload: unknown): Promise<void>;
  };

  storage: {
    /** `storage.own`. Both transports. Resolves `undefined` for an unset key. */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** `storage.own`. Both transports. */
    set(key: string, value: unknown): Promise<void>;
    /** `storage.own`. SERVICE TRANSPORT ONLY -- the E09-T2 postMessage host
     *  bridge exposes `storage.get`/`storage.set` but no delete method. */
    delete(key: string): Promise<void>;
  };

  /** `ha.notify`. SERVICE TRANSPORT ONLY (`POST /api/v1/addons/:id/notifications`)
   *  -- no postMessage bridge equivalent exists. */
  notify: {
    send(message: string, title?: string): Promise<void>;
  };

  /** Egress via the Core's per-host allow-listed proxy (`net.fetch:<host>`,
   *  `GET /api/v1/addons/proxy?url=`). SERVICE TRANSPORT ONLY. GET-only --
   *  see {@link SdkFetchInit}. */
  fetch(url: string, init?: SdkFetchInit): Promise<Response>;

  /** Tears the client down: removes the postMessage listener, or closes the
   *  WS connection and stops its reconnect loop. Both transports. */
  dispose(): void;
}
