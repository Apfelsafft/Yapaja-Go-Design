/**
 * The postMessage WIRE PROTOCOL shared by the sandboxed add-on iframe (this
 * SDK) and the trusted host (`apps/web/src/addons`). This is the ONE source
 * of truth for the message shapes, the bridge method names, and the
 * method -> required-scope mapping (docs/05 §2/§3, Wargame W-10).
 *
 * SECURITY NOTE -- read before touching anything here: the scope mapping in
 * this file is ALSO consumed by the host, but the host must NEVER treat a
 * scope claim coming over the wire from the iframe as authoritative. The
 * granted scope-set is decided host-side from the installed add-on's manifest
 * and pinned at handshake time; this table only says WHICH scope a given
 * method requires, not whether the calling add-on HAS it. The check
 * (`scopes.has(required)`) happens in the host bridge, never in this
 * (untrusted, add-on-controlled) SDK. See `apps/web/src/addons/bridge.ts`.
 */

/** Bumped only on a breaking change to the message envelope below. */
export const ADDON_PROTOCOL_VERSION = 1;

/** Envelope discriminator so the host/iframe ignore unrelated postMessage
 *  traffic (analytics pings, other embeds, browser-extension chatter). */
export const ADDON_MESSAGE_NS = 'yapaja-addon';

/** The permission scopes an add-on manifest may declare (docs/05 §2 table).
 *  Mirrors `@yapaja/shared` `ADDON_PERMISSION_SCOPES` -- kept as a local type
 *  so the public SDK has no dependency on the Core's shared package. */
export type AddonScope =
  | 'pos.read'
  | 'nav.read'
  | 'nav.control'
  | 'route.read'
  | 'route.propose'
  | 'map.layer.write'
  | 'widget.register'
  | 'events.publish'
  | 'storage.own'
  | 'ha.notify'
  | 'camera.view';

/** Every RPC the bridge exposes to add-on UI code. */
export type BridgeMethod =
  | 'position.subscribe'
  | 'nav.state'
  | 'map.addLayer'
  | 'map.addMarkers'
  | 'map.removeLayer'
  | 'widgets.register'
  | 'widgets.update'
  | 'events.publish'
  | 'storage.get'
  | 'storage.set'
  | 'route.propose';

/**
 * Method -> the SINGLE scope the host requires before it will execute it.
 * The host rejects (and logs) any call whose method maps to a scope the
 * add-on was not granted -- BEFORE the method runs. This object is the
 * exhaustive contract the scope-matrix test iterates over.
 */
export const METHOD_SCOPES: Record<BridgeMethod, AddonScope> = {
  'position.subscribe': 'pos.read',
  'nav.state': 'nav.read',
  'map.addLayer': 'map.layer.write',
  'map.addMarkers': 'map.layer.write',
  'map.removeLayer': 'map.layer.write',
  'widgets.register': 'widget.register',
  'widgets.update': 'widget.register',
  'events.publish': 'events.publish',
  'storage.get': 'storage.own',
  'storage.set': 'storage.own',
  'route.propose': 'route.propose',
};

/** All bridge methods, derived from the scope map (single source of truth). */
export const BRIDGE_METHODS = Object.keys(METHOD_SCOPES) as BridgeMethod[];

// ---------------------------------------------------------------------------
// Message envelope
// ---------------------------------------------------------------------------

interface BaseMessage {
  ns: typeof ADDON_MESSAGE_NS;
  v: number;
}

/** iframe -> host: "my SDK has loaded, send me the handshake". */
export interface ReadyMessage extends BaseMessage {
  type: 'ready';
}

/** host -> iframe: the handshake result -- the add-on's own id + the exact
 *  scope-set it was granted (informational for the SDK; the host enforces). */
export interface InitMessage extends BaseMessage {
  type: 'init';
  addonId: string;
  scopes: AddonScope[];
}

/** iframe -> host: invoke a bridge method. `callId` correlates the result. */
export interface CallMessage extends BaseMessage {
  type: 'call';
  callId: string;
  method: BridgeMethod;
  params: unknown;
}

/** host -> iframe: the result of a `call`. */
export interface ResultMessage extends BaseMessage {
  type: 'result';
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** host -> iframe: a pushed stream event (e.g. a live `pos/update`). */
export interface EventMessage extends BaseMessage {
  type: 'event';
  channel: string;
  payload: unknown;
}

export type AddonToHostMessage = ReadyMessage | CallMessage;
export type HostToAddonMessage = InitMessage | ResultMessage | EventMessage;
export type AddonMessage = AddonToHostMessage | HostToAddonMessage;

/** Narrow an arbitrary postMessage payload to a well-formed add-on message.
 *  Both sides call this FIRST -- anything that isn't our envelope is dropped
 *  without a second look. */
export function isAddonMessage(data: unknown): data is AddonMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return m.ns === ADDON_MESSAGE_NS && typeof m.type === 'string';
}

// ---------------------------------------------------------------------------
// Method parameter/result payload shapes (typed for add-on authors)
// ---------------------------------------------------------------------------

export interface PositionUpdate {
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  [k: string]: unknown;
}

/** A GeoJSON overlay layer. `id` is the add-on-local id; the host namespaces
 *  it by add-on id before it ever touches MapLibre (so `removeLayer` can only
 *  ever remove THIS add-on's layers, never a core/other-add-on one). */
export interface AddLayerParams {
  id: string;
  /** A GeoJSON FeatureCollection / Feature / Geometry. */
  data: unknown;
  /** One of MapLibre's vector render types; defaults to a line/fill guess. */
  render?: 'line' | 'fill' | 'circle';
  /** MapLibre paint overrides (kept opaque -- validated host-side). */
  paint?: Record<string, unknown>;
}

export interface MarkerSpec {
  id?: string;
  lat: number;
  lng: number;
  label?: string;
}

export interface AddMarkersParams {
  id: string;
  markers: MarkerSpec[];
}

export interface RemoveLayerParams {
  id: string;
}

export interface WidgetRegisterParams {
  widgetId: string;
  name: string;
  slots: string[];
  /** Initial render data (the same shape `widgets.update` sends). */
  data?: WidgetData;
}

export interface WidgetData {
  text?: string;
  severity?: 'info' | 'warn' | 'critical';
  [k: string]: unknown;
}

export interface WidgetUpdateParams {
  widgetId: string;
  data: WidgetData;
}

export interface EventPublishParams {
  /** Topic RELATIVE to the add-on namespace (host prefixes `addon/{id}/`),
   *  OR a fully-qualified `addon/{id}/...` topic -- either way the host
   *  rejects anything that would escape the add-on's own namespace. */
  topic: string;
  payload: unknown;
}

export interface StorageGetParams {
  key: string;
}

export interface StorageSetParams {
  key: string;
  value: unknown;
}

export interface RouteProposeWaypoint {
  lat: number;
  lng: number;
}

/** A ROUTE SUGGESTION. Wargame W-10: this NEVER activates a route. The host
 *  renders a confirmation banner; only a user click can ever apply it. */
export interface RouteProposeParams {
  waypoints: RouteProposeWaypoint[];
  reason: string;
}
