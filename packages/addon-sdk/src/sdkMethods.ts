/**
 * The SDK-level method surface + its method -> required-scope table (docs/05
 * §3). `SdkMethod` names every operation `YapajaAddon` exposes across BOTH
 * transports (some exist on only one -- see `types.ts`'s per-method docs and
 * `postMessageTransport.ts` / `serviceTransport.ts` for which throw
 * {@link UnsupportedOnTransportError}).
 *
 * `SDK_METHOD_SCOPES` is a LOCAL MIRROR of two independent, authoritative,
 * server-side tables this SDK talks to:
 *  - `protocol.ts#METHOD_SCOPES` / `apps/web/src/addons/bridge.ts` (the
 *    postMessage host bridge, UI add-ons);
 *  - `apps/core/src/addons/scopeMatrix.ts#ADDON_ROUTE_RULES` /
 *    `#TOPIC_FAMILY_SCOPES` (the REST/WS server, service add-ons).
 * It exists ONLY so a wire-level scope rejection can be turned into a
 * {@link ScopeDeniedError} that names the RIGHT scope deterministically --
 * never by parsing a host/Core-authored error string, which is fragile and
 * not a contract either side promises to keep stable. It is NOT enforcement:
 * the host/Core re-check independently and are the only authority, exactly
 * like every other scope table in this codebase.
 */

import type { AddonScope } from './protocol.js';
import { RemoteCallError, ScopeDeniedError } from './errors.js';

export type SdkMethod =
  | 'position.get'
  | 'position.subscribe'
  | 'nav.state'
  | 'nav.subscribe'
  | 'nav.control.start'
  | 'nav.control.stop'
  | 'nav.control.pause'
  | 'nav.control.resume'
  | 'nav.control.destination'
  | 'route.read'
  | 'route.get'
  | 'route.propose'
  | 'map.addLayer'
  | 'map.addMarkers'
  | 'map.removeLayer'
  | 'widgets.register'
  | 'widgets.update'
  | 'events.publish'
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'
  | 'notify.send'
  | 'fetch';

/**
 * SDK method -> the single scope it needs, or `null` when the scope is not a
 * fixed one. The only `null` today is `fetch`, whose scope is PER-HOST
 * (`net.fetch:<host>`, checked by the Core's egress proxy) -- there is no one
 * scope name to report, so the service transport builds a
 * `ScopeDeniedError` with the specific `net.fetch:<host>` string itself
 * rather than consulting this table for that method.
 */
export const SDK_METHOD_SCOPES: Record<SdkMethod, AddonScope | null> = {
  'position.get': 'pos.read',
  'position.subscribe': 'pos.read',
  'nav.state': 'nav.read',
  'nav.subscribe': 'nav.read',
  'nav.control.start': 'nav.control',
  'nav.control.stop': 'nav.control',
  'nav.control.pause': 'nav.control',
  'nav.control.resume': 'nav.control',
  'nav.control.destination': 'nav.control',
  'route.read': 'route.read',
  'route.get': 'route.read',
  'route.propose': 'route.propose',
  'map.addLayer': 'map.layer.write',
  'map.addMarkers': 'map.layer.write',
  'map.removeLayer': 'map.layer.write',
  'widgets.register': 'widget.register',
  'widgets.update': 'widget.register',
  'events.publish': 'events.publish',
  'storage.get': 'storage.own',
  'storage.set': 'storage.own',
  'storage.delete': 'storage.own',
  'notify.send': 'ha.notify',
  fetch: null,
};

/** Wire-level codes that mean "you don't have the scope for this", across
 *  both transports: `SCOPE_DENIED` (postMessage host bridge, `bridge.ts`) and
 *  `SCOPE_MISSING` (Core REST/WS, `scopeMatrix.ts`). */
const SCOPE_DENIAL_CODES: ReadonlySet<string> = new Set(['SCOPE_DENIED', 'SCOPE_MISSING']);

/**
 * Runs `exec()`; if it rejects with a {@link RemoteCallError} whose `.code` is
 * a scope-denial code, rethrows a {@link ScopeDeniedError} carrying the scope
 * `method` requires (from {@link SDK_METHOD_SCOPES}, or `explicitScope` when
 * the caller already learned a more precise one from the wire, e.g. a WS
 * frame's `required_scope`). Every other error (including a non-scope
 * `RemoteCallError`, e.g. `INVALID_PARAMS`) propagates unchanged.
 */
export async function guardScope<T>(
  method: SdkMethod,
  exec: () => Promise<T>,
  explicitScope?: string,
): Promise<T> {
  try {
    return await exec();
  } catch (err) {
    if (err instanceof RemoteCallError && SCOPE_DENIAL_CODES.has(err.code)) {
      const scope = explicitScope ?? SDK_METHOD_SCOPES[method] ?? 'unknown';
      throw new ScopeDeniedError(method, scope, err.message);
    }
    throw err;
  }
}

/** Same as {@link guardScope} but for a `RemoteCallError` already caught
 *  synchronously (e.g. a WS `type:'error'` frame delivered to a subscription
 *  callback rather than a call's own rejection) -- reused so both call sites
 *  share one interpretation of "is this a scope denial". */
export function toScopeAwareError(method: SdkMethod, err: RemoteCallError, explicitScope?: string): Error {
  if (SCOPE_DENIAL_CODES.has(err.code)) {
    const scope = explicitScope ?? SDK_METHOD_SCOPES[method] ?? 'unknown';
    return new ScopeDeniedError(method, scope, err.message);
  }
  return err;
}
