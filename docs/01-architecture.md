# 01 – Systemarchitektur & Technologie-Entscheidungen

## 1. Gesamtbild

```
┌────────────────────────── Mini-PC (Proxmox) ──────────────────────────┐
│                                                                       │
│  ┌───────────── VM/LXC oder HAOS-Add-on: Yapaja Go ────────────────┐  │
│  │                                                                 │  │
│  │  ┌───────────────┐   ┌─────────────────────────────────────┐    │  │
│  │  │ yapaja-core   │   │ Daten-Services (Docker/Prozesse)    │    │  │
│  │  │ (Node/Fastify)│──▶│  • Valhalla (Routing, :8002)        │    │  │
│  │  │  REST + WS    │   │  • Photon  (Geocoding, :2322)       │    │  │
│  │  │  MQTT-Bridge  │   │  • gpsd    (USB-GPS, :2947)         │    │  │
│  │  │  Plugin-Host  │   │  • Tileserver (PMTiles, im Core)    │    │  │
│  │  │  SQLite       │   └─────────────────────────────────────┘    │  │
│  │  └──────┬────────┘                                              │  │
│  │         │ statisch ausgeliefert                                 │  │
│  │  ┌──────▼────────┐   ┌───────────────┐                          │  │
│  │  │ yapaja-web    │   │ Add-ons       │                          │  │
│  │  │ (React SPA)   │   │ (Sandbox/Svc) │                          │  │
│  │  └───────────────┘   └───────────────┘                          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────── HAOS-VM: Home Assistant ────────────────┐          │
│  │  Mosquitto (MQTT-Broker)  ◀──── MQTT ────  yapaja-core  │          │
│  │  HA REST/WS API           ◀──── REST ────  yapaja-core  │          │
│  └──────────────────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────────────────────┘
          ▲ HTTP(S)                          ▲ USB
   Browser (Tablet/Monitor)            GPS-Maus (NMEA)
```

**Grundprinzip:** Ein schlanker Node.js-Core orchestriert spezialisierte, bewährte
Open-Source-Services (Valhalla, Photon, gpsd). Das Frontend ist eine SPA/PWA, die
alle Daten über REST + WebSocket vom Core bezieht. Add-ons docken über definierte
Schnittstellen an, nie direkt an die internen Services.

## 2. Architektur-Entscheidungen (ADRs)

### ADR-001: Frontend = React 18 + TypeScript + Vite
- **Entscheidung:** React 18, TypeScript strict, Vite als Build-Tool, Zustand für
  State-Management, Tailwind CSS für Styling, PWA (Service Worker via `vite-plugin-pwa`).
- **Begründung:** Größtes Ökosystem → günstige AI-Modelle produzieren hier die
  zuverlässigsten Ergebnisse; MapLibre-React-Bindings ausgereift; PWA ermöglicht
  Offline-Shell + Vollbild-Kioskbetrieb.
- **Verworfen:** Svelte (weniger Trainingsdaten für Umsetzungs-Modelle),
  Angular (zu schwergewichtig), reines JS (keine Typsicherheit für Plugin-API).

### ADR-002: Karten-Rendering = MapLibre GL JS
- **Entscheidung:** MapLibre GL JS (WebGL-Vektorrendering).
- **Begründung:** Open Source (BSD), unterstützt 2D/3D (pitch/bearing → Fahrtrichtungs-
  Modus, 3D-Gebäude via fill-extrusion, Hillshading), Styles sind JSON → Karten
  „bei Bedarf anpassbar", performant genug für N100-iGPU.
- **Verworfen:** Leaflet (kein Vektor/3D/Rotation-Rendering in nötiger Qualität),
  Google Maps SDK (online-only, Lizenz), OpenLayers (schwächeres GL-Rendering).

### ADR-003: Offline-Karten = PMTiles (Protomaps-Builds von OSM)
- **Entscheidung:** Vektortiles im **PMTiles**-Format; der Core liefert Tiles über
  einen Range-Request-Endpunkt aus. Basemap-Styles: abgeleitet von Protomaps
  „light/dark" + eigener Navigations-Style.
- **Begründung:** Eine einzige Datei pro Region (einfaches Update per Download),
  kein Tile-Server-Prozess nötig, sparsam auf schwacher Hardware.
  Deutschland ≈ 5–8 GB, Europa ≈ 40–70 GB (je Detailgrad).
- **Verworfen:** MBTiles + tileserver-gl (zusätzlicher Prozess, mehr RAM),
  Raster-Tiles (kein Restyling, kein sauberes Rotieren/3D, riesiger Speicherbedarf).

### ADR-004: Routing = Valhalla (self-hosted)
- **Entscheidung:** Valhalla im Docker-Container; Costing-Modell `truck` mit den
  Parametern des Fahrzeugprofils (height, width, length, weight, top_speed).
- **Begründung:** Einzige reife OSS-Engine mit dynamischem Fahrzeugmaß-Costing
  **zur Laufzeit** (kein Neubau des Graphen pro Profil nötig – entscheidend für
  mehrere Fahrzeugprofile); Tiles-basiert → moderater RAM-Bedarf (DE ≈ 1–1,5 GB);
  liefert Turn-by-Turn-Manöver, Spurinfos, Tempolimits entlang der Route,
  Alternativrouten, Isochronen (nützlich für Add-ons).
- **Verworfen:** OSRM (Profile werden zur Preprocessing-Zeit fixiert → pro
  Fahrzeugprofil eigener Graph, RAM-explosiv), GraphHopper (Kern-Features für
  Truck-Routing hinter kommerzieller Lizenz), BRouter (Fahrrad-fokussiert).

### ADR-005: Geocoding = Photon (offline) + Nominatim (online-Fallback)
- **Entscheidung:** Photon (Komoot) mit Länder-Extrakt für Offline-Suche;
  wenn Internet verfügbar und vom Nutzer erlaubt, zusätzlich Nominatim-API als
  Fallback für Regionen außerhalb des Extrakts. Suche läuft immer über den Core
  (`/api/v1/search`), der die Quellen kapselt.
- **Begründung:** Photon ist fehlertolerant (typo-tolerant, „search as you type"),
  Extrakte pro Land verfügbar (DE ≈ 1,5 GB Index, ~600 MB–1 GB RAM mit JVM-Tuning).
- **Risiko & Plan B:** Photon (Java) ist der RAM-hungrigste Baustein. Wargame-Szenario
  W-12 definiert den Fallback: SQLite-FTS5-Eigenindex aus OSM-Namen (nur Orte/Straßen,
  abgespeckte Qualität) für 512-MB-Umgebungen. Die Core-API bleibt identisch.

### ADR-006: Backend = Node.js 20 + Fastify + TypeScript, SQLite
- **Entscheidung:** Ein Core-Service (Fastify) für REST, WebSocket, statisches
  Frontend, PMTiles-Auslieferung, MQTT-Bridge (mqtt.js), gpsd-Client, Plugin-Host.
  Persistenz: SQLite (better-sqlite3) – Profile, Favoriten, Einstellungen, Add-on-Registry.
- **Begründung:** Eine Sprache (TypeScript) über Frontend, Backend und Add-on-SDK →
  günstige Modelle müssen nicht kontextwechseln; Fastify ist schnell und schema-first
  (JSON-Schema → automatische Validierung + OpenAPI-Generierung); SQLite = null
  Betriebsaufwand, ideal embedded.
- **Verworfen:** Go (zweite Sprache, „Go" im Produktnamen ist kein Technik-Hinweis),
  Python/FastAPI (GIL/Performance bei WS-Fanout), Postgres (Overkill).

### ADR-007: GPS = Browser-Geolocation ODER gpsd, Fusion im Core
- **Entscheidung:** Zwei Quellen: (a) Browser `navigator.geolocation.watchPosition`
  → per WS an den Core gemeldet; (b) USB-GPS am Host via **gpsd**, Core verbindet
  sich als gpsd-Client (JSON-Protokoll, Port 2947). Der Core wählt die Quelle nach
  Priorität (konfigurierbar; Default: gpsd > Browser) und publiziert eine
  einheitliche `position`-Nachricht (lat, lon, alt, speed, heading, accuracy, source, ts).
- **Begründung:** gpsd abstrahiert NMEA/u-blox-Hardware zuverlässig; die Fusion im
  Core (statt im Browser) macht die Position auch für MQTT/HA und Add-ons verfügbar,
  selbst wenn kein Browser offen ist.

### ADR-008: Auslieferung = Docker Compose (standalone) + HA-Add-on (gleiches Image)
- **Entscheidung:** Ein Multi-Arch-Container-Image `yapaja/core` (amd64/aarch64).
  Standalone: `docker-compose.yml` (core + valhalla + photon + gpsd).
  HA-Add-on: eigenes Add-on-Repository, `config.yaml` mit `ingress: true`,
  s6-overlay startet alle Prozesse in einem Add-on-Container (HA-Add-ons erlauben
  kein Compose). Details in `docs/04-home-assistant.md`.
- **Begründung:** Ein Codepfad, zwei Verpackungen; Ingress löst Auth + Remote-Zugriff
  über HA; standalone bleibt für Proxmox-LXC-Nutzer erste Wahl (mehr RAM-Kontrolle).

### ADR-009: Add-on-System = Manifest + zwei Plugin-Typen + Git-Registry
- **Entscheidung:** Frontend-Plugins (sandboxed iframe + postMessage-SDK) und
  Service-Plugins (eigener Prozess/Container, sprechen Core-REST/WS mit scoped Token).
  Manifest `yapaja-addon.json` mit deklarierten Permissions; Registry = statisches
  Git-Repo mit `index.json`; Store-UI im Frontend. Details in `docs/05-addon-system.md`.
- **Begründung:** Core bleibt unangetastet (Open/Closed-Prinzip); Sandbox begrenzt
  Schadpotenzial; statische Registry funktioniert mit sporadischem Internet.

### ADR-010: Echtzeit-Verteilung = ein interner Event-Bus
- **Entscheidung:** Der Core führt einen internen, typisierten Event-Bus
  (`nav/*`, `pos/*`, `route/*`, `system/*`). WebSocket-Server, MQTT-Bridge und
  Plugin-Host sind **Subscriber desselben Busses** – identische Payload-Schemata
  überall (definiert als JSON-Schema in `packages/shared`).
- **Begründung:** Verhindert Drift zwischen UI-, MQTT- und Add-on-Sicht; ein
  Schema, drei Transportwege; trivial testbar (Bus-Replay).

## 3. Monorepo-Struktur (Zielbild für die Implementierung)

```
yapaja-go/
├── apps/
│   ├── core/            # Fastify-Backend (REST, WS, MQTT, Plugin-Host, Tiles)
│   └── web/             # React-SPA/PWA
├── packages/
│   ├── shared/          # JSON-Schemata, TS-Typen, Event-Definitionen (Single Source)
│   ├── addon-sdk/       # @yapaja/addon-sdk – postMessage-Bridge + Typen
│   └── ui/              # wiederverwendbare UI-Komponenten (Widgets)
├── services/
│   ├── valhalla/        # Dockerfile, valhalla.json-Template, Daten-Download-Skripte
│   ├── photon/          # Dockerfile, Index-Download-Skripte
│   └── gpsd/            # Setup-/udev-Doku, Container-Variante
├── yapaja_go/           # Home-Assistant-Add-on (config.yaml, Dockerfile, s6) --
│                        # liegt bewusst auf oberster Ebene, damit der HA-Supervisor
│                        # es zusammen mit repository.yaml (Wurzel) findet
├── repository.yaml      # HA-Add-on-Repository-Deskriptor (Store-Weg via ⋮ -> Repositories)
├── addons-examples/     # Referenz-Add-ons (POI-Overlay, Track-Recorder)
├── e2e/                 # Playwright-Tests + GPS-Simulator (NMEA/Fixture-Replay)
└── docs/                # dieses Verzeichnis
```

Tooling: pnpm workspaces, ESLint (typescript-eslint, strict), Prettier, Vitest,
Playwright, GitHub Actions, Conventional Commits, Changesets für Versionierung.

## 4. Ressourcen-Budget (Deutschland-Extrakt, Referenz N100/8 GB, Anteil Yapaja ≤ 4 GB)

| Komponente | RAM (Ziel) | Disk | CPU (Idle/Last) |
|---|---|---|---|
| yapaja-core (Node) | ≤ 300 MB | 200 MB | <2 % / 1 Kern |
| Valhalla | ≤ 1,5 GB | ~3 GB Graph | 0 % / 1–2 Kerne beim Routing |
| Photon (JVM, -Xmx) | ≤ 1 GB | ~2 GB Index | 0 % / 1 Kern bei Suche |
| gpsd | ≤ 10 MB | – | vernachlässigbar |
| PMTiles DE | – | ~6 GB | – (I/O-bound) |
| Browser-Tab (extern od. lokal) | 300–600 MB | – | Render-Last GPU |
| **Summe Server-Seite** | **≤ 2,9 GB** | **~12 GB** | passt in 4-GB-LXC |

**Budget-Gate:** Jedes Epic, das einen Service hinzufügt, muss dieses Budget
aktualisieren; CI-Check misst RSS der Container gegen die Tabelle (E10).

## 5. Datenfluss Navigation (Kernpfad)

1. Position (gpsd oder Browser) → Core `PositionService` → Event `pos/update` (≥1 Hz).
2. `NavigationService` matcht Position auf aktive Route (Map-Matching: Distanz zur
   Polyline + Heading-Plausibilität), berechnet: nächstes Manöver, Distanz dazu,
   Restdistanz, ETA (aus Ø-Profilgeschwindigkeit + Valhalla-Kantenzeiten),
   aktuelles Tempolimit (aus Routen-Metadaten).
3. Bei Abweichung > 30 m für > 5 s → Event `route/deviation` → automatisches
   Rerouting (Valhalla, aktuelle Position → verbleibende Ziele).
4. Alle Events gehen an: WS-Clients (UI), MQTT-Bridge (HA), Plugin-Host (Add-ons).

## 6. Sicherheit

- Core-API standalone: Token-Auth (Bearer, in Settings generierbar); im HA-Add-on
  übernimmt Ingress die Auth, API-Port dann nur intern.
- Add-ons: Capability-basierte Tokens (nur deklarierte Scopes), iframe-Sandbox
  (`sandbox="allow-scripts"`, eigene Origin), CSP im Frontend.
- MQTT: Credentials aus HA-Add-on-Services-API (`services: [mqtt:need]`) oder manuell.
- Kein externer Netzzugriff des Core außer: Karten-/Index-Downloads, Registry-Sync,
  Nominatim-Fallback – alles einzeln abschaltbar (Offline-First-Garantie).
