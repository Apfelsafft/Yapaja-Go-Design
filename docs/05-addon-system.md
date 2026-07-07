# 05 – Add-on-System (Plugins, SDK, Marketplace)

**Designziel:** Add-ons wie Stauwarner, POI-Overlays, Track-Recording, Track-Planung,
Kamera-Einbindung, Schilder-/Ampelerkennung sollen integriert werden können, **ohne
Core-Backend oder -Frontend anzupassen** (Open/Closed-Prinzip). Installation über
einen Store; klare API; begrenzte Rechte (Sandbox + Scopes).

## 1. Zwei Plugin-Typen

### Typ A: Frontend-Add-on (UI-Plugin)
- Läuft als **sandboxed `<iframe>`** (eigene Origin `/addons/{id}/ui/`,
  `sandbox="allow-scripts"`, CSP) und/oder registriert **Map-Layer** und **Widgets**.
- Kommuniziert ausschließlich über das **postMessage-SDK** `@yapaja/addon-sdk`.
- Beispiele: POI-Overlay (Stellplätze), Track-Planung-UI, Kamera-Ansicht.

### Typ B: Service-Add-on (Backend-Plugin)
- Eigenständiger Prozess: entweder **Node-Prozess, vom Core gestartet**
  (Manifest `runtime: node18`, läuft mit `--experimental-permission`-Flags,
  eingeschränkter FS-Zugriff auf eigenes Datenverzeichnis) oder **externer
  Container/Dienst**, der sich mit Add-on-Token verbindet (`runtime: external`).
- Spricht Core-**REST + WebSocket** mit einem **scoped Token** – exakt dieselbe
  öffentliche API wie alle anderen Clients. Keine internen Importe, keine
  Direktzugriffe auf Valhalla/Photon/SQLite.
- Beispiele: Stauwarner (holt online Verkehrsdaten, published Events + Layer-Daten),
  Track-Recorder (subscribed `pos/update`, schreibt GPX), Schildererkennung
  (liest Kamerastream, published erkannte Limits).

Ein Add-on-Paket darf beide Teile enthalten (z. B. Stauwarner: Service + Overlay).

## 2. Manifest `yapaja-addon.json`

```json
{
  "id": "com.example.traffic-warner",
  "name": "Stauwarner",
  "version": "1.2.0",
  "core_api": "^1.0",
  "author": "…", "license": "MIT",
  "description": "Live-Verkehrslage als Overlay + Umfahrungsvorschläge",
  "requires_online": true,
  "ui": {
    "entry": "ui/index.html",
    "widgets": [{ "id": "traffic-status", "name": "Verkehrslage", "slots": ["top-bar","side-panel"] }],
    "map_layers": [{ "id": "traffic-flow", "name": "Verkehrsfluss", "source": "service" }],
    "settings_page": true
  },
  "service": { "runtime": "node18", "entry": "service/main.js" },
  "permissions": [
    "pos.read", "nav.read", "route.read", "route.propose",
    "map.layer.write", "events.publish", "storage.own", "net.fetch:api.tomtom.com"
  ]
}
```

### Permission-Scopes (v1, erweiterbar)
| Scope | Erlaubt |
|---|---|
| `pos.read` | `pos/*`-Events + `GET /position` |
| `nav.read` / `nav.control` | NavState lesen / Start-Pause-Stopp + Ziel setzen |
| `route.read` / `route.propose` | Routen lesen / alternative Route vorschlagen (Nutzer bestätigt in UI!) |
| `map.layer.write` | GeoJSON-/Vektor-Layer + Marker in die Karte pushen |
| `widget.register` | UI-Widgets in Slots anbieten |
| `events.publish` | Events unter `addon/{id}/*` publizieren (auch → MQTT `yapaja/addon/{id}/*`) |
| `storage.own` | Key-Value + Dateien im eigenen Datenverzeichnis |
| `net.fetch:<host>` | Outbound-HTTP nur zu deklarierten Hosts (Service-Typ; Core erzwingt via Proxy) |
| `ha.notify` | Notification über HA senden |
| `camera.view` | Kamera-Streams einbetten (nur UI-seitig, URLs aus Nutzer-Config) |

**Sicherheitsregeln:** Scopes werden bei Installation angezeigt und bestätigt.
Gefährliche Kombinationen (z. B. `nav.control` + `net.fetch`) bekommen einen roten
Hinweis. `route.propose` kann eine Route nie ohne Nutzerbestätigung aktivieren —
ein Add-on darf das Fahrzeug niemals „still" umleiten (Wargame W-10).

## 3. Add-on-SDK (`@yapaja/addon-sdk`)

TypeScript-Paket, kapselt postMessage (UI) bzw. REST/WS (Service) hinter einer API:

```ts
const yapaja = await YapajaAddon.connect();          // handshake, prüft Scopes
yapaja.position.subscribe(pos => …);                 // pos.read
yapaja.nav.state();                                  // nav.read
yapaja.map.addLayer({ id, type:'geojson', data });   // map.layer.write
yapaja.map.addMarkers('campsites', markers);         // inkl. Klick-Callbacks
yapaja.widgets.update('traffic-status', { text, severity });
yapaja.events.publish('jam-detected', payload);      // → WS + MQTT
yapaja.storage.set('lastSync', ts);
yapaja.route.propose({ waypoints, reason: 'Stau A8' }); // UI fragt Nutzer
```

Der SDK-Vertrag ist Teil der versionierten Core-API (`core_api` im Manifest,
semver-Check bei Installation und bei Core-Updates; inkompatible Add-ons werden
deaktiviert statt zu crashen — Wargame W-11).

## 4. Widget-Slots & Map-Layer (Frontend-Integrationspunkte)

Das Core-Frontend definiert feste **Slots** (`top-bar`, `side-panel`,
`bottom-drawer`, `map-overlay-tl|tr|bl|br`, `settings`) und eine **Layer-Registry**
(Reihenfolge/Sichtbarkeit vom Nutzer steuerbar, persistiert). Add-ons füllen Slots
und Layer deklarativ – das UI-Customizing (E07) behandelt Add-on-Widgets identisch
zu Core-Widgets. Dadurch: keine Core-Änderung pro Add-on.

## 5. Marketplace / Store

- **Registry:** öffentliches Git-Repo `yapaja-addons-registry` mit `index.json`
  (Liste: id, name, version, beschreibung, icon, download_url → Release-Tarball,
  sha256, scopes, core_api, screenshots). Statisch hostbar (GitHub Pages/raw) —
  funktioniert mit sporadischem Internet; Core cached den Katalog lokal.
- **Installation:** Core lädt Tarball, prüft sha256 + Manifest + Scope-Bestätigung,
  entpackt nach `data/addons/{id}/`, startet ggf. Service-Prozess. Auch
  **Offline-Installation per Datei-Upload** (Tarball über UI) — Camper haben oft
  kein Netz (W-13).
- **Updates:** Store zeigt Updates beim Registry-Sync; ein-Klick-Update mit
  Rollback (alte Version bleibt bis erfolgreichem Start erhalten).
- **Kuratierung v1:** PR ins Registry-Repo + Review-Checkliste (Scopes minimal,
  Lizenz, kein obfuskierter Code). Signierung (minisign) ist ab v1.1 vorgesehen,
  Feld `signature` im Index von Anfang an reserviert.

## 6. Referenz-Add-ons (Teil von E09, dienen als lebende Doku)

1. **POI-Overlay „Stellplätze"** (Typ A): lädt gebündelte GeoJSON-POIs, Layer +
   Marker-Klick → Detail-Widget → „Route hierhin".
2. **Track-Recorder** (Typ B + Mini-UI): subscribed Position, schreibt GPX in
   eigenen Storage, UI-Widget Start/Stop + Export-Download.

Diese zwei decken zusammen alle SDK-Oberflächen ab und sind die Vorlage, an der
sich Dritt-Add-ons (Stauwarner, Kamera, Schilder-/Ampelerkennung) orientieren.

## 7. Grenzen für rechenintensive Add-ons (Schilder-/Ampelerkennung)

Bilderkennung auf N100 ist grenzwertig. Architektur-Vorgabe: solche Add-ons laufen
als `runtime: external` (eigener Container, ggf. anderes Gerät/Coral-TPU) und
publizieren nur Ergebnisse (`addon/{id}/sign-detected`). Der Core rendert sie wie
jede andere Event-Quelle. So bleibt der Core-Performance-Envelope geschützt (W-14).
