/**
 * `@yapaja/addon-sdk` -- the add-on author's SDK (docs/05 §3, E09-T2/T3/T4):
 * ONE typed client surface for BOTH add-on kinds, auto-detecting which
 * transport to speak:
 *
 *  - a UI add-on (sandboxed iframe) talks postMessage to the host bridge
 *    (`apps/web/src/addons/bridge.ts`) -- see `postMessageTransport.ts`;
 *  - a service add-on (Core-spawned child process, or a `runtime: external`
 *    container) talks REST+WS to the Core -- see `serviceTransport.ts`.
 *
 * `connectAddon()` is the entry point most add-ons should use:
 *
 * ```ts
 * import { connectAddon } from '@yapaja/addon-sdk';
 * const addon = await connectAddon();
 * const unsub = addon.position.subscribe((pos) => console.log(pos));
 * ```
 *
 * ⚠️ EVERYTHING in this package is UNTRUSTED, add-on-side convenience code.
 * The host bridge and the Core (`apps/core/src/addons/scopeMatrix.ts`) are
 * the ONLY authorities on what an add-on may do; they re-check every call
 * independently of anything this SDK does. See each transport module's doc
 * comment for the detailed security posture.
 */

// --- the wire protocol (postMessage envelope, method/scope table, payload
// shapes) -- UNCHANGED export surface: `apps/web/src/addons/bridge.ts` (the
// E09-T2 host) imports directly from here and must keep working. -----------
export * from './protocol.js';

// --- transport auto-detection ----------------------------------------------
export { detectTransport, type TransportKind } from './detect.js';

// --- errors ------------------------------------------------------------------
export {
  AddonSdkError,
  AddonTimeoutError,
  AddonTransportError,
  IncompatibleCoreError,
  RemoteCallError,
  ScopeDeniedError,
  UnsupportedOnTransportError,
} from './errors.js';

// --- SDK <-> Core compatibility (semver major-match) ------------------------
export { ADDON_SDK_VERSION, assertCoreCompatible, isCoreCompatible } from './version.js';

// --- the SDK method table (informational scope map + the scope-denial
// reinterpretation helper transports use) -----------------------------------
export { SDK_METHOD_SCOPES, type SdkMethod } from './sdkMethods.js';

// --- the public client surface ---------------------------------------------
export type {
  NavControlDestinationParams,
  NavControlDestinationResult,
  NavControlStartParams,
  SdkFetchInit,
  YapajaAddon,
} from './types.js';

// --- transports --------------------------------------------------------------
export { connectPostMessage, type PostMessageTransportOptions } from './postMessageTransport.js';
export {
  connectServiceAddon,
  type FetchLike,
  type ServiceReconnectOptions,
  type ServiceTransportOptions,
  type WebSocketCtor,
} from './serviceTransport.js';

// --- re-exported shared domain types (docs/05 §3: "one import surface") ----
export type {
  AddonManifest,
  AddonManifestMapLayer,
  AddonManifestService,
  AddonManifestUi,
  AddonManifestWidget,
  LatLng,
  NavState,
  Position,
  Route,
  RouteRequest,
  VehicleProfile,
} from '@yapaja/shared';

import { detectTransport, type TransportKind } from './detect.js';
import { connectPostMessage, type PostMessageTransportOptions } from './postMessageTransport.js';
import { connectServiceAddon, type ServiceTransportOptions } from './serviceTransport.js';
import type { YapajaAddon } from './types.js';

export interface ConnectAddonOptions {
  /** Force a transport instead of auto-detecting (`detectTransport()`). */
  transport?: TransportKind;
  /** Options forwarded to `connectPostMessage()` when that transport is used. */
  postMessage?: PostMessageTransportOptions;
  /** Options forwarded to `connectServiceAddon()` when that transport is used. */
  service?: ServiceTransportOptions;
}

/**
 * THE entry point (docs/05 §3): auto-detects whether this process is a UI
 * add-on or a service add-on (`detectTransport()`) and connects over the
 * matching transport, returning ONE typed {@link YapajaAddon} surface either
 * way. Pass `{ transport: 'postMessage' | 'service' }` to skip detection
 * (mainly for tests, or the rare add-on that legitimately runs both ways and
 * wants to force one).
 */
export async function connectAddon(options: ConnectAddonOptions = {}): Promise<YapajaAddon> {
  // `async` is load-bearing here, not stylistic: `detectTransport()` throws
  // SYNCHRONOUSLY when neither signal is present, and callers reasonably
  // expect `connectAddon()` to always return a Promise (never throw directly)
  // -- wrapping the whole body in an async function turns that synchronous
  // throw into an ordinary rejected Promise instead of an uncatchable
  // exception from the call expression itself.
  const kind = options.transport ?? detectTransport();
  if (kind === 'postMessage') return connectPostMessage(options.postMessage);
  return connectServiceAddon(options.service);
}
