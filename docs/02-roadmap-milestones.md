# 02 – Roadmap, Meilensteine & Abhängigkeiten

## Phasenmodell

Jede Phase endet mit einem **Release-Gate** (Kriterien in `docs/07-testing-qa.md`).
Kein Epic der Folgephase startet, bevor das Gate bestanden ist – Ausnahme:
dokumentierte, unabhängige Vorarbeiten (z. B. Doku, Schemata).

### Phase 0 – Fundament (Woche 1–2)
- **E00 Projekt-Setup**: Monorepo, CI, Docker-Basis, Shared-Schemata.
- **Gate G0:** CI grün (lint, typecheck, unit), `docker compose up` startet Core-Skeleton,
  Healthcheck-Endpoint antwortet.

### Phase 1 – Karte & Position (Woche 3–6)
- **E01 Kartenanzeige**: MapLibre, PMTiles offline, 2D/3D, Nord/Heading, Styles.
- **E02 Positionierung**: Browser-GPS, gpsd, Fusion, Positions-Marker.
- **Gate G1:** Karte rendert offline mit ≥ 30 fps auf Referenzhardware; Position
  (simuliert + echt) wird live angezeigt; „Follow-Me"-Modus funktioniert.

### Phase 2 – Routing & Navigation (Woche 7–12) — das Herzstück
- **E03 Routing**: Valhalla-Anbindung, Fahrzeugprofil-Costing, Routen-Anzeige.
- **E06 Fahrzeugprofile**: CRUD + Validierung (parallel zu E03 startbar).
- **E04 Navigation**: Turn-by-Turn, Rerouting, ETA, Tempolimit, Sprachansagen.
- **E05 Suche & Favoriten**: Photon, Favoriten, Verlauf.
- **Gate G2:** Golden-Route-Testsuite besteht (inkl. Höhen-/Gewichts-Testfälle!);
  simulierte Fahrt (GPS-Replay) von Start bis Ziel ohne manuelle Eingriffe;
  Rerouting < 3 s.

### Phase 3 – Integration & UX (Woche 13–17)
- **E07 UI-Shell**: Widget-System, Customizing, Tag/Nacht, Fahrmodus-UX.
- **E08 Home Assistant**: MQTT-Topics, Discovery, REST-Steuerung, HA-Add-on, Ingress.
- **Gate G3:** HA zeigt alle Nav-Entitäten via Auto-Discovery; Ziel-Setzen und
  Start/Stopp aus HA funktioniert; Add-on installierbar aus eigenem Add-on-Repo;
  UI-Layout persistiert.

### Phase 4 – Plattform & Release (Woche 18–22)
- **E09 Add-on-System**: Plugin-Runtime, SDK, Registry, Store, zwei Referenz-Add-ons.
- **E10 Qualität & Release**: E2E-Suite komplett, Performance-Budgets in CI,
  Doku, Release v1.0.
- **Gate G4 (= Release-Gate v1.0):** vollständige Checkliste in `docs/07-testing-qa.md` §7.

## Abhängigkeitsgraph

```
E00 ─┬─▶ E01 ─┬─▶ E04 ─▶ E07 ─▶ E10
     ├─▶ E02 ─┤            ▲
     ├─▶ E03 ─┘            │
     ├─▶ E06 ─▶ E03        │
     ├─▶ E05 ──────────────┤
     └─▶ E08 (ab G2) ──────┴─▶ E09 (ab G3)
```

Parallelisierbar für mehrere Umsetzungs-Modelle gleichzeitig:
- Ab G0: E01, E02, E06 parallel; E03 sobald E06-Schema steht.
- Ab G2: E07 und E08 parallel.
- E05 ist fast unabhängig (braucht nur E00-Schemata + Karte für Ergebnis-Anzeige).

## Meilenstein-Deliverables

| Meilenstein | Sichtbares Ergebnis (Demo-fähig) |
|---|---|
| M0 (G0) | Leere App-Shell im Browser, Health-API, CI-Badge grün |
| M1 (G1) | Offline-Karte mit Live-Position, 2D/3D-Umschaltung, Rotation |
| M2 (G2) | Vollständige simulierte Navigation Hamburg→München mit 3,5-m-Camper-Profil, Route meidet 3,2-m-Unterführung im Testfall |
| M3 (G3) | HA-Dashboard mit ETA/Speed/Anweisung; Ziel aus HA gesetzt; App läuft als HA-Add-on |
| M4 (G4) | Store mit 2 installierbaren Add-ons (POI-Overlay, Track-Recorder); Release v1.0 getaggt |

## Arbeitsteilung Mensch ↔ AI-Modelle

| Rolle | Aufgabe |
|---|---|
| **Architekt (dieses Repo)** | Task-Prompts pflegen, Gates prüfen, ADR-Änderungen genehmigen |
| **Umsetzungs-Modell (günstig)** | Einzelne Tasks aus `tasks/` exakt nach Prompt umsetzen |
| **Review-Modell (mittel) oder Mensch** | PR-Review gegen Akzeptanzkriterien + Abnahme-Checkliste (`tasks/README.md` §4) |
| **Mensch** | Hardware-Tests (echtes GPS, echter Mini-PC, echte Fahrt), Release-Freigabe |

**Regel:** Ein Task = ein Branch = ein PR. PR-Titel = Task-ID + Kurzbeschreibung
(z. B. `E03-T2: Valhalla route endpoint with vehicle profile costing`).
