/**
 * The SERVER-SIDE route -> required-scope table for add-on principals
 * (E09-T3, docs/05 §2, Wargame W-14). This is the exact server-side mirror of
 * `@yapaja/addon-sdk`'s `METHOD_SCOPES` (which governs the FRONTEND
 * postMessage bridge, E09-T2): one table, consulted from ONE hook, never
 * ad-hoc checks sprinkled through route handlers.
 *
 * THE CENTRAL RULE IS DEFAULT-DENY. A request authenticated with an add-on
 * token may reach ONLY the (method, path) pairs listed in {@link ADDON_ROUTE_RULES}
 * below, and only when the add-on's manifest granted the mapped scope. Any
 * other API path -- including every route added by a future task, the install
 * pipeline, the settings API, the auth-token rotation endpoints -- is refused
 * with 403 without anyone having to remember to guard it. Adding a new
 * add-on-reachable route is therefore a deliberate, reviewable edit to THIS
 * file.
 *
 * Scopes with no server-side surface are documented, not silently dropped:
 *  - `map.layer.write`, `widget.register`, `camera.view`, `route.propose`
 *    are FRONTEND scopes; they are enforced host-side by the iframe bridge
 *    (`apps/web/src/addons/bridge.ts`) because the map/widget registry and
 *    the "user must confirm a proposed route" banner (W-10) live in the web
 *    app, not in the Core. A service add-on reaches the UI through
 *    `events.publish` (`addon/{id}/*`), which the UI renders.
 *  - `nav.control` is mapped here (the Core owns navigation state), and it is
 *    the one scope the install-time confirmation flags as dangerous when
 *    combined with `net.fetch` (see `installService.ts#computeScopeWarnings`).
 */

import type { ADDON_PERMISSION_SCOPES } from '@yapaja/shared';
import { decodePathSegments, normalizeRequestPath } from '../auth/authGuard.js';

/** The v1 permission scopes (docs/05 §2 table), derived from the ONE list in
 *  `@yapaja/shared` so this table can never drift from the manifest schema.
 *  Structurally identical to `@yapaja/addon-sdk`'s `AddonScope` (the frontend
 *  bridge's copy) -- the Core deliberately does not depend on the add-on SDK
 *  package, which is published for untrusted add-on authors. */
export type AddonScope = (typeof ADDON_PERMISSION_SCOPES)[number];

/** Everything an authorization decision needs about the calling add-on. */
export interface AddonPrincipal {
  addonId: string;
  /** Plain scopes (`pos.read`, ...) the manifest was granted. */
  scopes: ReadonlySet<string>;
  /** Hosts declared via `net.fetch:<host>` (see `proxy.ts`). */
  netFetchDeclarations: readonly string[];
}

export interface AddonRouteRule {
  method: string;
  /** Path template with `:param` placeholders, matched against the full
   *  request path INCLUDING the `/api/v1` prefix. */
  path: string;
  /** Scope required to call it, or `null` when merely being an authenticated
   *  add-on is enough (the handler applies its own, narrower rule -- the
   *  egress proxy checks `net.fetch:<host>` per target host). */
  scope: AddonScope | null;
  /** When true the `:id` path parameter MUST equal the calling add-on's own
   *  id -- the namespace isolation behind `storage.own` and the
   *  `addon/{id}/*` publish restriction. */
  ownAddonOnly?: boolean;
  /** Why this route carries this scope (kept next to the rule so the table
   *  stays self-documenting as it grows). */
  note: string;
}

/**
 * THE TABLE. Ordered: literal paths before parameterised ones, so
 * `/api/v1/addons/proxy` can never be swallowed by a `:id`-style rule.
 */
export const ADDON_ROUTE_RULES: readonly AddonRouteRule[] = [
  // --- pos.read -------------------------------------------------------
  { method: 'GET', path: '/api/v1/position', scope: 'pos.read', note: 'Current fix (docs/05 §2: pos.read => GET /position)' },
  { method: 'GET', path: '/api/v1/position/sources', scope: 'pos.read', note: 'Which position source is active' },

  // --- nav.read / nav.control ----------------------------------------
  { method: 'GET', path: '/api/v1/navigation/state', scope: 'nav.read', note: 'NavState lesen' },
  { method: 'POST', path: '/api/v1/navigation/start', scope: 'nav.control', note: 'Start-Pause-Stopp + Ziel setzen' },
  { method: 'POST', path: '/api/v1/navigation/stop', scope: 'nav.control', note: 'Start-Pause-Stopp' },
  { method: 'POST', path: '/api/v1/navigation/pause', scope: 'nav.control', note: 'Start-Pause-Stopp' },
  { method: 'POST', path: '/api/v1/navigation/resume', scope: 'nav.control', note: 'Start-Pause-Stopp' },
  { method: 'POST', path: '/api/v1/navigation/destination', scope: 'nav.control', note: 'Ziel setzen' },

  // --- route.read -----------------------------------------------------
  // Computing a route (`POST /routes`) ACTIVATES nothing -- it returns
  // candidates. Activation is `POST /navigation/start` (nav.control) or, for
  // an add-on suggestion, the UI-confirmed `route.propose` bridge call
  // (W-10). So both live under `route.read`.
  { method: 'POST', path: '/api/v1/routes', scope: 'route.read', note: 'Route berechnen (aktiviert nichts)' },
  { method: 'GET', path: '/api/v1/routes/:id', scope: 'route.read', note: 'Routen lesen' },

  // --- add-on-own surfaces (always ownAddonOnly) -----------------------
  { method: 'GET', path: '/api/v1/addons/proxy', scope: null, note: 'Egress proxy; per-host net.fetch check in the handler' },
  { method: 'GET', path: '/api/v1/addons/:id/service', scope: null, ownAddonOnly: true, note: 'Own service/watchdog status' },
  { method: 'GET', path: '/api/v1/addons/:id/storage/:key', scope: 'storage.own', ownAddonOnly: true, note: 'storage.own, own namespace only' },
  { method: 'PUT', path: '/api/v1/addons/:id/storage/:key', scope: 'storage.own', ownAddonOnly: true, note: 'storage.own, own namespace only' },
  { method: 'DELETE', path: '/api/v1/addons/:id/storage/:key', scope: 'storage.own', ownAddonOnly: true, note: 'storage.own, own namespace only' },
  { method: 'POST', path: '/api/v1/addons/:id/events', scope: 'events.publish', ownAddonOnly: true, note: 'Publish under addon/{id}/* only' },
  { method: 'POST', path: '/api/v1/addons/:id/notifications', scope: 'ha.notify', ownAddonOnly: true, note: 'ha.notify via the HA output channel' },
];

// ---------------------------------------------------------------------------
// Path matching
// ---------------------------------------------------------------------------

interface CompiledRule {
  rule: AddonRouteRule;
  segments: string[];
}

const COMPILED: readonly CompiledRule[] = ADDON_ROUTE_RULES.map((rule) => ({
  rule,
  segments: rule.path.split('/'),
}));

/** Strips the query string and percent-DECODES each segment (the form the
 *  router matches on -- see `auth/authGuard.ts#decodePathSegments`), then
 *  drops an insignificant trailing slash. Matching is segment-by-segment,
 *  never a regex over the raw URL. */
export function pathOfUrl(url: string): string {
  const path = normalizeRequestPath(url);
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export interface RouteMatch {
  rule: AddonRouteRule;
  params: Record<string, string>;
}

/**
 * Finds the first rule matching `method` + `path`, or `null` (=> DENY).
 * `path` is split into PERCENT-DECODED segments -- the same view the router
 * has -- so neither `/%61pi/...` nor a `%2F` inside a parameter can make the
 * matcher and the router disagree about which route is being called.
 */
export function matchAddonRoute(method: string, path: string): RouteMatch | null {
  const upper = method.toUpperCase();
  const parts = decodePathSegments(path.split('?')[0]);
  // A trailing slash is insignificant (`/position/` == `/position`).
  if (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
  for (const { rule, segments } of COMPILED) {
    if (rule.method !== upper) continue;
    if (segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith(':')) {
        if (parts[i] === '') {
          ok = false;
          break;
        }
        params[seg.slice(1)] = parts[i]; // already decoded
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { rule, params };
  }
  return null;
}

export type AddonAuthzDecision =
  | { allowed: true; rule: AddonRouteRule }
  | { allowed: false; code: 'ROUTE_NOT_ALLOWED' | 'SCOPE_MISSING' | 'FOREIGN_ADDON'; message: string; requiredScope?: string };

/**
 * The ONE authorization function. Applied by the auth hook to every `/api/*`
 * request that authenticated as an add-on. Default-deny.
 */
export function authorizeAddonRequest(
  principal: AddonPrincipal,
  method: string,
  path: string,
): AddonAuthzDecision {
  const match = matchAddonRoute(method, path);
  if (!match) {
    return {
      allowed: false,
      code: 'ROUTE_NOT_ALLOWED',
      message: `Add-on "${principal.addonId}" may not call ${method.toUpperCase()} ${path}`,
    };
  }
  const { rule, params } = match;
  if (rule.ownAddonOnly && params.id !== principal.addonId) {
    return {
      allowed: false,
      code: 'FOREIGN_ADDON',
      message: `Add-on "${principal.addonId}" may only access its own namespace, not "${params.id ?? ''}"`,
    };
  }
  if (rule.scope !== null && !principal.scopes.has(rule.scope)) {
    return {
      allowed: false,
      code: 'SCOPE_MISSING',
      message: `Add-on "${principal.addonId}" is missing the required scope "${rule.scope}"`,
      requiredScope: rule.scope,
    };
  }
  return { allowed: true, rule };
}

// ---------------------------------------------------------------------------
// WebSocket topic scopes (`/ws/v1`)
// ---------------------------------------------------------------------------

/**
 * Bus topic FAMILY -> required scope. A client subscribes with a PATTERN
 * (`pos/*`, `nav/state`, `*`), so the check runs on the pattern, not on a
 * concrete topic -- otherwise a broad `*` subscription would sneak past a
 * per-topic check and fan out everything.
 */
const TOPIC_FAMILY_SCOPES: ReadonlyArray<{ prefix: string; scope: AddonScope }> = [
  { prefix: 'pos/', scope: 'pos.read' },
  { prefix: 'nav/', scope: 'nav.read' },
  { prefix: 'route/', scope: 'route.read' },
  // `event/*` carries navigation-lifecycle events (arrived, gps_lost_paused,
  // reroute_*, profile_*) -- all of them are "what is the navigation doing",
  // so they ride on nav.read.
  { prefix: 'event/', scope: 'nav.read' },
];

export type WsTopicDecision =
  | { allowed: true; scope: AddonScope | null }
  | { allowed: false; code: 'TOPIC_NOT_ALLOWED' | 'SCOPE_MISSING'; message: string; requiredScope?: string };

/**
 * Decides whether `pattern` may be subscribed to by `principal`.
 *
 *  - `addon/{ownId}` / `addon/{ownId}/...` -> always allowed (its own
 *    namespace; this is how a service add-on hears its own UI half).
 *  - `addon/{otherId}/...` -> DENIED (no cross-add-on eavesdropping).
 *  - A family pattern (`pos/*`, `pos/update`, `pos*`) -> the family's scope.
 *  - A bare `*` (or any pattern whose prefix is not fully inside one family)
 *    -> DENIED. An add-on can never subscribe to "everything".
 */
export function authorizeAddonTopic(principal: AddonPrincipal, pattern: string): WsTopicDecision {
  const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
  if (prefix === '') {
    return {
      allowed: false,
      code: 'TOPIC_NOT_ALLOWED',
      message: 'A wildcard "*" subscription is never granted to an add-on',
    };
  }

  const ownNs = `addon/${principal.addonId}`;
  if (prefix === ownNs || prefix.startsWith(`${ownNs}/`)) {
    return { allowed: true, scope: null };
  }
  if (prefix === 'addon/' || prefix.startsWith('addon/')) {
    return {
      allowed: false,
      code: 'TOPIC_NOT_ALLOWED',
      message: `Add-on "${principal.addonId}" may only subscribe to its own addon/${principal.addonId}/* namespace`,
    };
  }

  for (const { prefix: family, scope } of TOPIC_FAMILY_SCOPES) {
    const familyName = family.slice(0, -1);
    if (prefix === familyName || prefix.startsWith(family)) {
      if (!principal.scopes.has(scope)) {
        return {
          allowed: false,
          code: 'SCOPE_MISSING',
          message: `Add-on "${principal.addonId}" is missing the required scope "${scope}" for topic "${pattern}"`,
          requiredScope: scope,
        };
      }
      return { allowed: true, scope };
    }
  }

  return {
    allowed: false,
    code: 'TOPIC_NOT_ALLOWED',
    message: `Topic "${pattern}" is not exposed to add-ons`,
  };
}

/**
 * The `addon/{id}/*` publish restriction behind `events.publish`. Accepts a
 * topic RELATIVE to the namespace (`jam-detected`) or a fully-qualified one
 * (`addon/{id}/jam-detected`), and returns the fully-qualified topic -- or
 * `null` when the topic would escape the add-on's namespace.
 */
export function normalizeAddonEventTopic(addonId: string, topic: string): string | null {
  if (typeof topic !== 'string') return null;
  const trimmed = topic.trim();
  if (trimmed === '') return null;
  // No wildcards, no traversal-ish segments, no leading/trailing slashes.
  if (trimmed.includes('*') || trimmed.includes('..') || trimmed.startsWith('/') || trimmed.endsWith('/')) {
    return null;
  }
  const ns = `addon/${addonId}/`;
  if (trimmed.startsWith(ns)) {
    return trimmed.length > ns.length ? trimmed : null;
  }
  if (trimmed.startsWith('addon/')) return null; // another add-on's namespace
  return `${ns}${trimmed}`;
}
