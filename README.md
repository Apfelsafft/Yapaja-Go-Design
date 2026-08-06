# Yapaja Go – Planungs- und Design-Repository

![CI](https://github.com/Apfelsafft/Yapaja-Go-Design/actions/workflows/ci.yml/badge.svg)

**Yapaja Go** ist eine browserbasierte Navigations-App im Stil von Google Maps / Sygic Truck,
optimiert für **Wohnmobile und Camper**, lauffähig **offline** auf einem Low-/Mid-End-Mini-PC
(parallel zu einer Home-Assistant-Instanz unter Proxmox), mit tiefer
**Home-Assistant-Integration** (MQTT + REST) und einem **erweiterbaren Add-on-System**
inkl. Marketplace.

> Dieses Repository enthält **ausschließlich Planung, Design und Task-Prompts** –
> keine Implementierung. Die Tasks sind so formuliert, dass sie von günstigeren
> AI-Modellen (z. B. Haiku-Klasse) eigenständig umgesetzt werden können.

---

## Dokumenten-Index

| Dokument | Inhalt |
|---|---|
| [docs/00-vision-scope.md](docs/00-vision-scope.md) | Produktvision, Zielgruppe, Scope, Nicht-Ziele |
| [docs/01-architecture.md](docs/01-architecture.md) | Systemarchitektur, Technologie-Entscheidungen (ADRs), Hardware-Budget |
| [docs/02-roadmap-milestones.md](docs/02-roadmap-milestones.md) | Phasen, Meilensteine, Abhängigkeitsgraph der Epics |
| [docs/03-api-spec.md](docs/03-api-spec.md) | REST-API, WebSocket-Events, MQTT-Topics |
| [docs/04-home-assistant.md](docs/04-home-assistant.md) | MQTT-Integration, HA-REST, Add-on-Packaging, Ingress |
| [docs/05-addon-system.md](docs/05-addon-system.md) | Plugin-Architektur, Sandbox, Manifest, Marketplace, Add-on-API |
| [docs/06-ui-ux-guidelines.md](docs/06-ui-ux-guidelines.md) | Styleguide, Layout-System, Customizing, Fahrmodus-UX |
| [docs/07-testing-qa.md](docs/07-testing-qa.md) | Teststrategie, Plausibilitätsprüfungen, Release-Gates, CI |
| [docs/08-wargame.md](docs/08-wargame.md) | Wargame-Analyse: Risikoszenarien mit vorbereiteten Lösungen |

## Nutzer- & Betriebs-Dokumentation (E10-T5)

| Dokument | Inhalt |
|---|---|
| [docs/installation.md](docs/installation.md) | Installations-Guide: HA-Add-on **und** Compose/Proxmox-LXC, inkl. USB-GPS-Durchreichung |
| [docs/erste-schritte.md](docs/erste-schritte.md) | Profil anlegen → Ziel suchen → Route berechnen → Navigation starten |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Symptom → Ursache → Lösung für alle 🔴/🟠-Wargame-Fälle (`docs/08-wargame.md`) |
| [docs/faq.md](docs/faq.md) | Häufige Fragen |
| [docs/addon-dev-guide.md](docs/addon-dev-guide.md) | Add-on-Entwicklungsleitfaden (`@yapaja/addon-sdk`) |
| [docs/openapi.json](docs/openapi.json) | Core-REST-API als OpenAPI 3.1, generiert aus den Fastify-Routen + `@yapaja/shared`-Schemas (`apps/core/src/openapi/`, CI-Check „Spec aktuell") |

## Task-Prompts (für Umsetzungs-Modelle)

| Epic | Datei | Thema |
|---|---|---|
| E00 | [tasks/E00-projekt-setup.md](tasks/E00-projekt-setup.md) | Monorepo, CI, Docker, Grundgerüst |
| E01 | [tasks/E01-kartenanzeige.md](tasks/E01-kartenanzeige.md) | MapLibre, Offline-Tiles, 2D/3D, Nord/Heading |
| E02 | [tasks/E02-positionierung.md](tasks/E02-positionierung.md) | Browser-GPS, USB-GPS via gpsd, Positions-Fusion |
| E03 | [tasks/E03-routing.md](tasks/E03-routing.md) | Valhalla-Integration, Fahrzeugprofil-Routing |
| E04 | [tasks/E04-navigation.md](tasks/E04-navigation.md) | Turn-by-Turn, Rerouting, ETA, Tempolimits |
| E05 | [tasks/E05-suche-favoriten.md](tasks/E05-suche-favoriten.md) | Offline-Geocoding, Favoriten, Verlauf |
| E06 | [tasks/E06-fahrzeugprofile.md](tasks/E06-fahrzeugprofile.md) | Profile (Höhe/Breite/Länge/Gewicht/Tempo) |
| E07 | [tasks/E07-ui-shell.md](tasks/E07-ui-shell.md) | App-Shell, Widget-Customizing, Tag/Nacht |
| E08 | [tasks/E08-home-assistant.md](tasks/E08-home-assistant.md) | MQTT, HA-Add-on, Ingress, Discovery |
| E09 | [tasks/E09-addon-system.md](tasks/E09-addon-system.md) | Plugin-Runtime, SDK, Store-UI, Registry |
| E10 | [tasks/E10-qualitaet-release.md](tasks/E10-qualitaet-release.md) | E2E-Tests, Performance, Release-Prozess |

**Bevor ein Task an ein Umsetzungs-Modell geht:** [tasks/README.md](tasks/README.md) lesen –
dort stehen das Prompt-Template, verbindliche Regeln und die Abnahme-Checkliste.

**Umsetzung komplett starten:** [tasks/KICKOFF-PROMPT.md](tasks/KICKOFF-PROMPT.md) –
ein Copy-Paste-Master-Prompt für einen Orchestrator-Agenten, inkl. verbindlicher
Modell-Zuordnung pro Task (haiku/sonnet/opus) und Abnahmetest-Anleitung für den
Menschen nach Abschluss.

---

## Kurzüberblick Technologie-Stack (Details in `docs/01-architecture.md`)

- **Frontend:** TypeScript, React 18, Vite, MapLibre GL JS, Zustand, Tailwind CSS
- **Karten offline:** OpenStreetMap-Vektortiles als **PMTiles** (Protomaps), Styles anpassbar
- **Routing:** **Valhalla** (self-hosted, Docker) – unterstützt LKW-/Fahrzeugprofile mit
  Höhe, Breite, Länge, Gewicht → ideal für Wohnmobile, komplett offline
- **Geocoding offline:** **Photon** (Komoot) mit Länder-Extrakt, Online-Fallback Nominatim
- **Backend:** Node.js 20+, Fastify, WebSocket; SQLite für Persistenz
- **GPS:** Browser-Geolocation **oder** USB-GPS-Maus via **gpsd**
- **Home Assistant:** MQTT (Auto-Discovery) + REST-API + offizielles **HA-Add-on** mit Ingress
- **Add-ons:** Manifest-basierte Plugins (Frontend-Sandbox + Service-Plugins), Git-basierte Registry

## Namenskonvention

Produktname: **Yapaja Go** (Schreibweise „Yapaia Go" ist ein Alias derselben App).
Technischer Name / Package-Prefix: `yapaja-go`, npm-Scope `@yapaja`.
