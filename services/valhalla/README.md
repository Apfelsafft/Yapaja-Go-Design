# Valhalla Routing Service

Valhalla liefert Routenberechnung (inkl. LKW/Wohnmobil-Costing), Turn-by-Turn-
Manöver, Isochronen und Map-Matching für Yapaja Go. Der Service läuft als Teil
des Docker-Compose-Stacks (`docker compose --profile routing up -d`).

## ADR-014: gis-ops Auto-Build-Image statt offiziellem `valhalla/valhalla`

**Entscheidung:** `ghcr.io/gis-ops/docker-valhalla/valhalla:latest` statt des
offiziellen `ghcr.io/valhalla/valhalla`.

**Begründung:** Das gis-ops-Image kapselt den kompletten Graph-Bau (PBF-Download,
`valhalla_build_config`, `valhalla_build_tiles`, `valhalla_build_admins`) hinter
einfachen Environment-Variablen (`tile_urls`, `serve_tiles`, `force_rebuild`, …)
und startet danach `valhalla_service` selbst. Das offizielle Image liefert nur
die Binaries — Config-Erzeugung und Tile-Build müssten manuell orchestriert
werden. Ein CI-Spike (`spike/valhalla-feasibility`, 2026-07-11, Workflow-Log
verifiziert) bewies: das gis-ops-Image zieht + baut den Liechtenstein-Graph aus
`tile_urls=https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf`
automatisch und beantwortet danach eine LKW-Route Vaduz→Schaan
(3,17 km / 4,2 min, echte Straßen, has_toll/ferry=false) — Gesamtjob ~25 s.

**Verworfen:** offizielles `ghcr.io/valhalla/valhalla` (fummelige manuelle
`valhalla_build_config`/`valhalla_build_tiles`-Schritte, kein eingebauter
PBF-Download).

Siehe auch `docs/01-architecture.md` ADR-004 (Grundsatzentscheidung "Routing =
Valhalla"); ADR-014 ist eine Verfeinerung auf Image-Ebene für E03-T1.

## Verzeichnislayout (Runtime, nicht committet — `/data/` ist gitignored)

```
data/valhalla/
├── tiles/       # LIVE-Stand — von docker-compose als /custom_files gemountet
├── tiles.new/   # Build-Staging (nur waehrend build-tiles.sh laeuft)
└── tiles.old/   # transient waehrend des atomischen Swaps, danach entfernt
```

`docker-compose.yml` mountet **`./data/valhalla/tiles`** (nicht das
Elternverzeichnis) nach `/custom_files` — der Container sieht ausschließlich
den fertigen, geschwenkten Live-Stand, nie die Build-Staging-Verzeichnisse.

## Graph-(Neu-)Bau mit atomischem Swap (W-17)

```bash
services/valhalla/build-tiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
# oder mit einer bereits lokal heruntergeladenen PBF:
services/valhalla/build-tiles.sh /pfad/zu/germany-latest.osm.pbf
```

Ablauf (Details/Kommentare im Skript):

1. Baut den Graphen über das gis-ops-Image in `data/valhalla/tiles.new`
   (temporäres Verzeichnis, eigener Host-Port `8099`, damit ein parallel
   laufender Live-Service auf Port 8002 ungestört weiterserviert — **kein
   Downtime während des Builds**).
2. Mischt die `service_limits`-Overrides aus `services/valhalla/valhalla.json`
   in die vom Image generierte Config (jq-Merge, siehe unten).
3. Erst nach vollständigem Erfolg: atomarer Swap `tiles.new` → `tiles` per
   `mv` (rename(2) auf demselben Dateisystem — kein Zwischenzustand für
   Leser). Der alte Stand wird vorher nach `tiles.old` weggesichert und nach
   dem Swap entfernt.
4. Schlägt der Build fehl (Timeout, Docker-Fehler), bleibt `data/valhalla/tiles`
   **unangetastet**. Bricht der Swap selbst unerwartet mitten im Rename ab,
   stellt das Skript `tiles.old` automatisch als `tiles` wieder her.

Danach den laufenden Service die neuen Tiles einlesen lassen:

```bash
docker compose restart valhalla
```

## `valhalla.json`-Overrides (`service_limits` für schwache Mini-PC-Hardware)

Das gis-ops-Image generiert seine eigene `valhalla.json` beim Build (inkl.
`tile_dir`, `mjolnir`-Pfade etc. — die dürfen nicht überschrieben werden, sonst
findet der Service seine eigenen Tiles nicht mehr). `services/valhalla/valhalla.json`
in diesem Verzeichnis ist deshalb **kein vollständiges Config-File**, sondern
ein reines **Override-Fragment** nur für den `service_limits`-Block. `build-tiles.sh`
mischt es per `jq -s '.[0] * .[1]'` (rekursiver Objekt-Merge) in die generierte
Config, NACHDEM der Build bereits erfolgreich war — der Merge kann den
Graph-Build selbst also nicht brechen.

Tuning-Ziel: Budget-Tabelle in `docs/01-architecture.md` (Valhalla ≤ 1,5 GB RAM,
1–2 Kerne beim Routing). Deshalb in den Overrides:

- **Matrix (`sources_to_targets`)**: `max_locations: 3` — faktisch auf ein
  Minimum reduziert (kein Vollformat-"aus"-Schalter in Valhalla; Add-ons, die
  großflächige Matrizen brauchen, sind damit bewusst ausgeschlossen).
- **`isochrone`**: `max_contours: 2`, `max_locations: 1`, `max_distance: 25000` —
  klein gehalten, nur für einzelne Reichweitenabfragen (z. B. Add-ons).
- **`route` (`auto`/`truck`)**: `max_distance: 500000` m / `max_locations: 20` —
  reicht für eine landesweite Wohnmobil-Tour mit mehreren Wegpunkten, begrenzt
  aber Missbrauch/Ressourcenlast.

### KLÄRUNGSBEDARF (dokumentiert statt riskant erraten)

Der exakte Ablagepfad der vom gis-ops-Image generierten `valhalla.json`
innerhalb von `/custom_files` ist **nicht lokal verifizierbar** (Docker-Daemon
in dieser Sandbox aus, geofabrik netzseitig blockiert) — `build-tiles.sh` nimmt
`$NEW_DIR/valhalla.json` an (Top-Level von `/custom_files`), basierend auf dem
im Spike beobachteten Verhalten des Images. Trifft das nicht exakt zu, meldet
das Skript **nur eine Warnung** und fährt mit der vom Image generierten
Standard-Config fort (Tiles-Build ist davon komplett unabhängig — siehe
Kommentare in `build-tiles.sh`, Abschnitt "service_limits-Overrides
einmischen"). Der CI-Job `valhalla-li-build` zeigt den tatsächlich
angewendeten `service_limits`-Block informativ an (nicht build-brechend), damit
das beim ersten echten CI-Lauf sofort sichtbar ist. Sollte der Merge dort
tatsächlich fehlschlagen: Pfad in `build-tiles.sh` (`CONFIG_FILE=...`) anhand
der dann sichtbaren Container-Logs/Verzeichnisstruktur korrigieren — reiner
Ein-Zeilen-Fix, kein Architekturproblem.

## Betrieb über docker-compose

```bash
docker compose --profile routing up -d valhalla
```

- **Mit vorhandenen Tiles** (`data/valhalla/tiles` gefüllt durch
  `build-tiles.sh`): `serve_tiles=True`, `force_rebuild=False`, `tile_urls=`
  (leer) → der Service serviert ausschließlich den vorhandenen Graphen, ohne
  eigenständig etwas nachzuladen oder neu zu bauen.
- **Ohne Tiles** (frischer Checkout, `build-tiles.sh` noch nie gelaufen):
  `data/valhalla/tiles` ist leer/nicht vorhanden. Der Container kann ohne
  Graphen nicht sinnvoll hochkommen. `restart: on-failure:3` in
  `docker-compose.yml` begrenzt die Neustartversuche bewusst (**kein
  endloses Crash-Loopen**) statt `unless-stopped`. Abhilfe: einmalig
  `services/valhalla/build-tiles.sh <pbf-url>` laufen lassen, danach
  `docker compose up -d valhalla` erneut ausführen.

Endpoint (innerhalb des Compose-Netzwerks bzw. via Port-Mapping):
`http://valhalla:8002` / `http://localhost:8002`.

## CI-Nachweis (`valhalla-li-build`)

`.github/workflows/ci.yml` Job `valhalla-li-build` baut den
Liechtenstein-Graphen (winzig, gesamter Job ~25 s laut Spike) bei jedem PR:
ruft `build-tiles.sh` mit der LI-PBF-URL auf, prüft den atomischen Swap auf
Dateisystemebene, startet Valhalla exakt wie `docker-compose.yml` es im
Normalbetrieb tut (serve-only), wartet auf `/status` und verifiziert eine
LKW-Route Vaduz→Schaan gegen einen Plausibilitäts-Korridor (2–8 km / 3–20 min).
Details siehe Kommentare im Workflow-Job selbst.
