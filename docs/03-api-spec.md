# 03 – API-Spezifikation (REST · WebSocket · MQTT)

**Single Source of Truth:** Alle Payload-Schemata werden als JSON-Schema in
`packages/shared/schemas/` gepflegt und generieren daraus TypeScript-Typen,
Fastify-Validierung, OpenAPI-Doku und die MQTT-Payload-Doku. Dieses Dokument
definiert die Verträge; bei Konflikt gewinnt `packages/shared`.

Versionierung: URL-Prefix `/api/v1`. Breaking Changes ⇒ `/api/v2`, v1 bleibt
mindestens eine Major-Version lang erhalten (wichtig für Add-ons!).

Auth: `Authorization: Bearer <token>` (standalone) bzw. HA-Ingress-Session.
Add-ons nutzen scoped Tokens (siehe `docs/05-addon-system.md`).

---

## 1. Kern-Datentypen (Auszug)

```ts
type LatLng = { lat: number; lon: number };            // WGS84, EPSG:4326

interface Position {
  lat: number; lon: number;
  alt: number | null;          // Meter über MSL (aktuelle Höhe!)
  speed: number | null;        // m/s über Grund
  heading: number | null;      // Grad, 0 = Nord
  accuracy: number | null;     // Meter (HDOP-basiert bei gpsd)
  source: 'gpsd' | 'browser' | 'simulator';
  fix: 'none' | '2d' | '3d';
  ts: string;                  // ISO 8601 UTC
}

interface VehicleProfile {
  id: string;                  // uuid
  name: string;                // "Kastenwagen", "Alkoven 7.5t" ...
  height_m: number;            // 1.0–4.5
  width_m: number;             // 1.5–3.0
  length_m: number;            // 3.0–20.0
  weight_t: number;            // 1.0–40.0
  avg_speed_kmh: number;       // 40–130, für ETA-Berechnung
  hazmat: boolean;             // default false
  avoid: { motorway: boolean; toll: boolean; ferry: boolean; unpaved: boolean };
  is_active: boolean;
}

interface RouteRequest {
  origin: LatLng | 'current';
  destination: LatLng;
  waypoints: LatLng[];         // max 25
  profile_id: string;
  alternatives: number;        // 0–3
}

interface Route {
  id: string;
  distance_m: number;
  duration_s: number;          // Valhalla-Zeit, kalibriert mit avg_speed_kmh
  geometry: string;            // polyline6
  legs: RouteLeg[];            // je Wegpunkt-Abschnitt
  maneuvers: Maneuver[];
  speed_limits: SpeedSegment[];// [{begin_shape_index, end_shape_index, kmh|null}]
  warnings: RouteWarning[];    // z.B. "restriction data missing on 2 edges"
}

interface Maneuver {
  index: number;
  type: ManeuverType;          // enum nach Valhalla (turn_left, roundabout_enter, ...)
  instruction: string;         // lokalisiert, z.B. "Links abbiegen auf B27"
  street_names: string[];
  distance_m: number;          // Länge dieses Manöver-Abschnitts
  begin_shape_index: number;
  lanes?: LaneInfo[];
}

interface NavState {
  status: 'idle' | 'routing' | 'navigating' | 'paused' | 'arrived' | 'off_route';
  route_id: string | null;
  next_maneuver: Maneuver | null;
  distance_to_maneuver_m: number | null;
  distance_remaining_m: number | null;
  duration_remaining_s: number | null;
  eta: string | null;                    // ISO 8601, lokale TZ des Geräts
  speed_kmh: number | null;              // aktuelle Geschwindigkeit
  speed_limit_kmh: number | null;        // erlaubt lt. Kartendaten, null = unbekannt
  altitude_m: number | null;
  destination: { latlng: LatLng; name: string | null } | null;
}
```

---

## 2. REST-API (Core)

### System
| Methode & Pfad | Zweck |
|---|---|
| `GET /api/v1/health` | Liveness: `{status, version, services:{valhalla, photon, gpsd, mqtt}}` je `ok|degraded|down` |
| `GET /api/v1/system/info` | Versionen, Kartenregion(en), Datenstand (OSM-Timestamp), Disk-Frei |
| `GET/PATCH /api/v1/settings` | App-Einstellungen (Einheiten, Sprache, Tag/Nacht-Auto, GPS-Priorität, MQTT-Config …) |

### Karten & Tiles
| Methode & Pfad | Zweck |
|---|---|
| `GET /tiles/{region}.pmtiles` | PMTiles mit HTTP-Range-Support |
| `GET /api/v1/map/styles` | verfügbare Styles (id, name, preview) |
| `GET /api/v1/map/styles/{id}` | MapLibre-Style-JSON (URLs auf lokale Tiles umgeschrieben) |
| `GET/POST/DELETE /api/v1/map/regions` | installierte Regionen; POST startet Download-Job (`202` + job_id) |
| `GET /api/v1/jobs/{id}` | Download-/Import-Job-Status (progress, eta, error) |

### Position
| Methode & Pfad | Zweck |
|---|---|
| `GET /api/v1/position` | letzte bekannte Position (`Position`) |
| `POST /api/v1/position/browser` | Browser meldet Geolocation-Fix (wird nur genutzt, wenn Quelle 'browser' aktiv) |
| `GET /api/v1/position/sources` | verfügbare Quellen + Status + aktive Quelle |
| `PUT /api/v1/position/source` | Quelle erzwingen (`gpsd|browser|auto|simulator`) |

### Fahrzeugprofile
| Methode & Pfad | Zweck |
|---|---|
| `GET/POST /api/v1/profiles` | Liste / Anlegen (Validierung: Wertebereiche s. o.) |
| `GET/PUT/DELETE /api/v1/profiles/{id}` | Details / Ändern / Löschen (aktives Profil nicht löschbar) |
| `PUT /api/v1/profiles/{id}/activate` | Profil aktivieren; laufende Navigation ⇒ Reroute mit neuem Profil + Warnhinweis |

### Routing & Navigation
| Methode & Pfad | Zweck |
|---|---|
| `POST /api/v1/routes` | Route(n) berechnen (`RouteRequest` → `Route[]`, erste = empfohlen) |
| `GET /api/v1/routes/{id}` | Route abrufen (Cache, TTL 1 h) |
| `POST /api/v1/navigation/start` | `{route_id}` → Navigation starten |
| `POST /api/v1/navigation/pause` \| `resume` \| `stop` | Steuerung |
| `GET /api/v1/navigation/state` | aktueller `NavState` |
| `POST /api/v1/navigation/destination` | Convenience für HA/Add-ons: `{query | latlng, profile_id?, autostart?: bool}` – geocodet, routet, startet optional |

### Suche & Favoriten
| Methode & Pfad | Zweck |
|---|---|
| `GET /api/v1/search?q=&limit=&lat=&lon=` | Geocoding (Photon → Fallback Nominatim); bias auf Position |
| `GET /api/v1/search/reverse?lat=&lon=` | Reverse-Geocoding |
| `GET/POST /api/v1/favorites` | Favoriten (name, latlng, icon, category: home|campsite|poi|custom, sort_order) |
| `PUT/DELETE /api/v1/favorites/{id}` | Ändern/Löschen |
| `GET/DELETE /api/v1/history` | Suchverlauf/Zielverlauf (löschen: alles oder einzeln) |

### Add-ons (Details in docs/05)
| Methode & Pfad | Zweck |
|---|---|
| `GET /api/v1/addons` | installierte Add-ons + Status |
| `POST /api/v1/addons/install` | `{registry_id | url}` → Installation (Job) |
| `POST /api/v1/addons/{id}/enable|disable` · `DELETE .../{id}` | Lifecycle |
| `GET /api/v1/addons/registry` | Store-Katalog (lokaler Cache der Registry) |
| `POST /api/v1/addons/registry/sync` | Katalog aktualisieren (braucht Internet) |

Fehlerformat einheitlich: `{error: {code: string, message: string, details?: object}}`,
HTTP-Statuscodes semantisch korrekt (400 Validierung, 404, 409 Konflikt, 503 Service down).

---

## 3. WebSocket (`/ws/v1`, JSON-Nachrichten)

Client → Server: `{type: 'subscribe', topics: ['pos/*','nav/*']}`, `{type:'ping'}`.
Server → Client: `{topic, payload, ts}`. Topics == interne Event-Bus-Topics:

| Topic | Payload | Frequenz |
|---|---|---|
| `pos/update` | `Position` | 1 Hz (konfigurierbar bis 5 Hz) |
| `nav/state` | `NavState` (komplett) | 1 Hz während Navigation |
| `nav/instruction` | `{maneuver, distance_m, say: string}` | bei Wechsel/Ansage-Schwelle |
| `route/updated` | `{route: Route, reason: 'initial'|'reroute'|'profile_change'}` | bei Änderung |
| `route/deviation` | `{distance_from_route_m}` | bei Erkennung |
| `system/health` | wie REST-health | bei Änderung + alle 30 s |
| `addon/{addon_id}/*` | Add-on-eigene Events | Add-on-definiert |

---

## 4. MQTT-Topics (Bridge zu Home Assistant)

Basis-Prefix konfigurierbar, Default `yapaja`. QoS 1, `retain` für Zustands-Topics.
Alle Payloads JSON. HA-Auto-Discovery unter `homeassistant/...` (siehe docs/04).

### Publiziert von Yapaja Go (Status)
| Topic | Inhalt | Retain |
|---|---|---|
| `yapaja/status` | `online|offline` (LWT!) | ✔ |
| `yapaja/position` | `Position` (1 Hz während Fahrt, 0,1 Hz im Stand) | ✔ |
| `yapaja/nav/state` | `NavState.status` | ✔ |
| `yapaja/nav/instruction` | `{type, instruction, street_names, distance_m, icon}` – `icon` = mdi-Name für Richtungspfeil (z. B. `mdi:arrow-left-top`) | ✔ |
| `yapaja/nav/eta` | `{eta, duration_remaining_s, distance_remaining_m}` | ✔ |
| `yapaja/nav/speed` | `{speed_kmh, speed_limit_kmh, speeding: bool}` | ✔ |
| `yapaja/nav/altitude` | `{altitude_m}` | ✔ |
| `yapaja/nav/destination` | `{lat, lon, name}` oder `null` | ✔ |
| `yapaja/route/summary` | `{distance_m, duration_s, via: string[]}` bei neuer Route | ✔ |
| `yapaja/event/#` | flüchtige Events (deviation, arrived, gps_lost, reroute) | ✘ |

### Kommandos an Yapaja Go (HA → App)
| Topic | Payload | Wirkung |
|---|---|---|
| `yapaja/cmd/destination` | `{query?: string, lat?: number, lon?: number, autostart?: bool}` | Ziel setzen (wie REST `/navigation/destination`) |
| `yapaja/cmd/navigation` | `"start" \| "pause" \| "resume" \| "stop"` | Steuerung |
| `yapaja/cmd/profile` | `{id}` oder `{name}` | Fahrzeugprofil aktivieren |
| `yapaja/cmd/favorite` | `{name}` | Route zu benanntem Favoriten starten |

Jedes Kommando wird mit `yapaja/cmd/result` beantwortet:
`{cmd, ok: bool, error?: string, request_id?}` (`request_id` wird durchgereicht,
wenn im Kommando enthalten).

---

## 5. Plausibilitäts-Invarianten (von Tests erzwungen, siehe docs/07)

- `0 ≤ speed_kmh < 250`; `-450 < altitude_m < 4900` (Europa-Grenzen + Marge).
- `distance_to_maneuver_m` monoton fallend zwischen Manövern (Toleranz GPS-Rauschen 15 m).
- `eta` nie in der Vergangenheit; `duration_remaining_s` fällt bei konstanter Fahrt.
- Route-Distanz ≥ Luftlinie und ≤ 4 × Luftlinie (sonst `RouteWarning` + Log).
- `speed_limit_kmh ∈ {5..130} ∪ null` (DE); Wert `null` heißt „unbekannt", niemals 0.
- Bei `fix: 'none'` werden keine `pos/update` publiziert, stattdessen `event/gps_lost`.
