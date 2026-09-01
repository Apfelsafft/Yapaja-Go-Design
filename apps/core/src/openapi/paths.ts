/**
 * E10-T5: hand-curated enrichment for the OpenAPI document, keyed by
 * `"METHOD /fastify/style/:path"` exactly as Fastify reports it via the
 * `onRouteHook` (see `generate.ts`). This table supplies what Fastify route
 * registration in this codebase does NOT declare today -- no route attaches
 * a `schema` option (verified: `grep -rn "schema:" apps/core/src` finds none
 * outside tests) -- so the PATHS themselves come from live introspection of
 * the running server (never hand-typed, never drifts silently), while
 * REQUEST/RESPONSE shape comes from this table referencing the real
 * `@yapaja/shared` JSON Schemas (`schemas.ts`).
 *
 * A route with no entry here still appears in the published spec (from
 * introspection) with a generic description -- an undocumented ROUTE can
 * never happen, only an under-documented one, and that's visible in the
 * spec itself (no `requestBody`/typed `200` response).
 *
 * Deliberately NOT attempted: adding `schema` to the actual Fastify route
 * registrations so `@fastify/swagger` could introspect real per-route
 * validation. That would be the more "textbook" approach, but Fastify
 * treats an attached response `schema` as active output filtering
 * (fast-json-stringify) and a request `schema` as active AJV validation --
 * i.e. NOT a documentation-only change, but new enforced behavior on every
 * one of ~60 routes. Retrofitting that safely (matching today's actual
 * accepted/returned shapes exactly, including the handful of routes that
 * intentionally return `Reply: unknown`) is a real engineering project of
 * its own, not something to bolt on inside a documentation task without
 * risking the very "don't weaken/break existing behavior" rule this repo
 * enforces via its 2400+-test baseline. Documented here, not hidden.
 */

export interface RouteDoc {
  summary: string;
  tags: string[];
  /** Component name (see `schemas.ts`) used as the JSON request body. */
  requestSchema?: string;
  /** Component name used for the success payload. */
  responseSchema?: string;
  /** Success payload is `{ data: T[] }` instead of `{ data: T }`. */
  responseIsArray?: boolean;
  /** Success payload is the schema itself, not wrapped in `{ data }`. */
  responseNotWrapped?: boolean;
  /** Non-JSON response (binary tiles, static assets) -- no content schema. */
  rawResponse?: boolean;
}

export const DEFAULT_TAG = 'Sonstige';

export const ROUTE_DOCS: Record<string, RouteDoc> = {
  // --- Auth (docs/04 §2) ---
  'GET /api/v1/auth/status': { summary: 'Auth-Status (Token konfiguriert? Ingress-Modus?)', tags: ['Auth'] },
  'POST /api/v1/auth/token': { summary: 'API-Token setzen/ändern', tags: ['Auth'] },
  'DELETE /api/v1/auth/token': { summary: 'API-Token entfernen (App wird wieder offen)', tags: ['Auth'] },

  // --- Fahrzeugprofile ---
  'GET /api/v1/profiles': { summary: 'Alle Fahrzeugprofile', tags: ['Profile'], responseSchema: 'VehicleProfile', responseIsArray: true },
  'POST /api/v1/profiles': { summary: 'Profil anlegen', tags: ['Profile'], requestSchema: 'VehicleProfile', responseSchema: 'VehicleProfile' },
  'GET /api/v1/profiles/:id': { summary: 'Profil-Details', tags: ['Profile'], responseSchema: 'VehicleProfile' },
  'PUT /api/v1/profiles/:id': { summary: 'Profil ändern', tags: ['Profile'], requestSchema: 'VehicleProfile', responseSchema: 'VehicleProfile' },
  'DELETE /api/v1/profiles/:id': { summary: 'Profil löschen (aktives Profil nicht löschbar)', tags: ['Profile'] },
  'PUT /api/v1/profiles/:id/activate': {
    summary: 'Profil aktivieren (laufende Navigation ⇒ Reroute + Warnhinweis)',
    tags: ['Profile'],
    responseSchema: 'VehicleProfile',
  },

  // --- Position ---
  'GET /api/v1/position': { summary: 'Letzte bekannte Position', tags: ['Position'], responseSchema: 'Position' },
  'GET /api/v1/position/sources': { summary: 'Verfügbare Positionsquellen + aktive Quelle', tags: ['Position'] },
  'PUT /api/v1/position/source': { summary: 'Positionsquelle erzwingen (gpsd|browser|auto|simulator)', tags: ['Position'] },
  'POST /api/v1/position/browser': { summary: 'Browser-Geolocation-Fix melden', tags: ['Position'], responseSchema: 'Position' },

  // --- Simulator (E02-T4, zentrales Testwerkzeug) ---
  'POST /api/v1/simulator/play': { summary: 'GPS-Simulator: Track abspielen (GPX/Route/Mutation)', tags: ['Simulator'] },
  'POST /api/v1/simulator/pause': { summary: 'GPS-Simulator pausieren', tags: ['Simulator'] },
  'POST /api/v1/simulator/stop': { summary: 'GPS-Simulator stoppen', tags: ['Simulator'] },
  'GET /api/v1/simulator/status': { summary: 'GPS-Simulator-Status', tags: ['Simulator'] },

  // --- Karten & Regionen (E01) ---
  'GET /api/v1/map/regions/catalog': { summary: 'Herunterladbare Kartenregionen (Katalog)', tags: ['Karten'] },
  'POST /api/v1/map/regions': { summary: 'Region-Download starten (202 + job_id)', tags: ['Karten'] },
  'DELETE /api/v1/map/regions/:id': { summary: 'Installierte Region entfernen', tags: ['Karten'] },
  'GET /api/v1/jobs/:id': { summary: 'Download-/Import-Job-Status (progress, eta, error)', tags: ['Karten'] },
  'DELETE /api/v1/jobs/:id': { summary: 'Job abbrechen', tags: ['Karten'] },
  'GET /tiles/:regionParam': { summary: 'PMTiles-Kachel (HTTP-Range-Support)', tags: ['Karten'], rawResponse: true },
  'GET /api/v1/map/regions': { summary: 'Installierte Kartenregionen', tags: ['Karten'] },
  'GET /api/v1/map/styles': { summary: 'Verfügbare MapLibre-Styles', tags: ['Karten'] },
  'GET /api/v1/map/styles/:id': { summary: 'MapLibre-Style-JSON (lokale Tile-URLs)', tags: ['Karten'] },

  // --- Routing ---
  'POST /api/v1/routes': {
    summary: 'Route(n) berechnen (erste = empfohlen)',
    tags: ['Routing'],
    requestSchema: 'RouteRequest',
    responseSchema: 'Route',
    responseIsArray: true,
  },
  'GET /api/v1/routes/:id': { summary: 'Route abrufen (Cache, TTL 1 h)', tags: ['Routing'], responseSchema: 'Route' },

  // --- Navigation ---
  'POST /api/v1/navigation/start': { summary: 'Navigation starten (`{route_id}`)', tags: ['Navigation'], responseSchema: 'NavState' },
  'POST /api/v1/navigation/pause': { summary: 'Navigation pausieren', tags: ['Navigation'] },
  'POST /api/v1/navigation/resume': { summary: 'Navigation fortsetzen', tags: ['Navigation'] },
  'POST /api/v1/navigation/stop': { summary: 'Navigation beenden', tags: ['Navigation'] },
  'POST /api/v1/navigation/profile_change/confirm': {
    summary: 'Profilwechsel während Navigation bestätigen (W-Reroute)',
    tags: ['Navigation'],
  },
  'GET /api/v1/navigation/state': { summary: 'Aktueller Navigationszustand', tags: ['Navigation'], responseSchema: 'NavState' },
  'POST /api/v1/navigation/destination': {
    summary: 'Convenience für HA/Add-ons: geocodet, routet, startet optional (`autostart`)',
    tags: ['Navigation'],
    responseSchema: 'NavState',
  },

  // --- Suche ---
  'GET /api/v1/search': { summary: 'Geocoding (Photon → Fallback), bias auf Position', tags: ['Suche'], responseSchema: 'SearchResult', responseIsArray: true },
  'GET /api/v1/search/reverse': { summary: 'Reverse-Geocoding', tags: ['Suche'], responseSchema: 'SearchResult', responseIsArray: true },

  // --- Favoriten & Verlauf ---
  'GET /api/v1/favorites': { summary: 'Favoritenliste', tags: ['Favoriten'], responseSchema: 'Favorite', responseIsArray: true },
  'POST /api/v1/favorites': { summary: 'Favorit anlegen', tags: ['Favoriten'], responseSchema: 'Favorite' },
  'PUT /api/v1/favorites/reorder': { summary: 'Favoriten-Reihenfolge ändern', tags: ['Favoriten'], responseSchema: 'Favorite', responseIsArray: true },
  'PUT /api/v1/favorites/:id': { summary: 'Favorit ändern', tags: ['Favoriten'], responseSchema: 'Favorite' },
  'DELETE /api/v1/favorites/:id': { summary: 'Favorit löschen', tags: ['Favoriten'] },
  'GET /api/v1/history': { summary: 'Such-/Zielverlauf', tags: ['Verlauf'], responseSchema: 'HistoryEntry', responseIsArray: true },
  'POST /api/v1/history': { summary: 'Verlaufseintrag anlegen', tags: ['Verlauf'], responseSchema: 'HistoryEntry' },
  'DELETE /api/v1/history/:id': { summary: 'Einzelnen Verlaufseintrag löschen', tags: ['Verlauf'] },
  'DELETE /api/v1/history': { summary: 'Gesamten Verlauf löschen', tags: ['Verlauf'] },

  // --- Einstellungen ---
  'GET /api/v1/settings': { summary: 'Alle App-Einstellungen', tags: ['Einstellungen'] },
  'GET /api/v1/settings/:key': { summary: 'Einzelne Einstellung', tags: ['Einstellungen'] },
  'PATCH /api/v1/settings': { summary: 'Einstellungen ändern (Einheiten, Sprache, GPS-Priorität, MQTT …)', tags: ['Einstellungen'] },

  // --- Add-ons (docs/05) ---
  'GET /api/v1/addons': { summary: 'Installierte Add-ons + Status', tags: ['Add-ons'], responseSchema: 'AddonManifest', responseIsArray: true },
  'POST /api/v1/addons/install': { summary: 'Installation starten (`{registry_id | url}`, Job)', tags: ['Add-ons'] },
  'POST /api/v1/addons/install/:pendingId/confirm': { summary: 'Berechtigungs-Bestätigung nach Prüfung abschließen', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/enable': { summary: 'Add-on aktivieren', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/disable': { summary: 'Add-on deaktivieren (Kill-Switch, W-10/W-11)', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/mqtt/enable': { summary: 'MQTT-Discovery für Add-on aktivieren', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/mqtt/disable': { summary: 'MQTT-Discovery für Add-on deaktivieren', tags: ['Add-ons'] },
  'DELETE /api/v1/addons/:id': { summary: 'Add-on deinstallieren (rückstandsfrei)', tags: ['Add-ons'] },
  'GET /api/v1/addons/registry': { summary: 'Store-Katalog (lokaler Registry-Cache)', tags: ['Add-ons'] },
  'POST /api/v1/addons/registry/sync': { summary: 'Katalog aktualisieren (braucht Internet, W-13)', tags: ['Add-ons'] },
  'GET /api/v1/addons/:id/storage/:key': { summary: 'Add-on-eigener Storage-Wert lesen (scoped)', tags: ['Add-ons'] },
  'PUT /api/v1/addons/:id/storage/:key': { summary: 'Add-on-eigener Storage-Wert schreiben (scoped)', tags: ['Add-ons'] },
  'DELETE /api/v1/addons/:id/storage/:key': { summary: 'Add-on-eigener Storage-Wert löschen (scoped)', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/token': { summary: 'Scoped Bearer-Token für Service-Add-on ausstellen', tags: ['Add-ons'] },
  'GET /api/v1/addons/:id/service': { summary: 'Service-Add-on-Prozessstatus', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/events': { summary: 'Service-Add-on publiziert Event auf den Bus (scoped)', tags: ['Add-ons'] },
  'POST /api/v1/addons/:id/notifications': { summary: 'Service-Add-on löst Nutzer-Benachrichtigung aus (scoped)', tags: ['Add-ons'] },
  'GET /api/v1/addons/proxy': { summary: 'Egress-Proxy: `net.fetch` nur zu deklarierten Hosts (W-10)', tags: ['Add-ons'] },

  // --- Sicherheit (E09-T6/E10-T4) ---
  'GET /api/v1/security/events': { summary: 'Security-Event-Log (Sandbox-Verstöße, Scope-Denials)', tags: ['Sicherheit'] },
  'POST /api/v1/security/events': { summary: 'Frontend meldet einen Sicherheits-Event (z. B. Bridge-Verstoß)', tags: ['Sicherheit'] },

  // --- System ---
  'GET /api/v1/system/resources': { summary: 'RAM/Disk frei-vs-gesamt (W-12/W-18)', tags: ['System'] },
  'GET /api/v1/system/preflight': {
    summary:
      'Installationsprüfung: Kacheln, Routing, Suche (Photon ODER Lite), Position, RAM, Platz, MQTT — je mit Handlungsanweisung',
    tags: ['System'],
  },
  'GET /api/v1/health': { summary: 'Liveness: Version + Status je Subsystem (valhalla, photon, gpsd, mqtt)', tags: ['System'] },
};
