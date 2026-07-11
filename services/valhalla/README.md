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
2. Übernimmt die vom Image generierte `valhalla.json` **unverändert**
   (`service_limits`-Tuning ist bewusst vertagt — siehe unten).
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

## `service_limits`-Tuning für Mini-PC-Hardware — VERTAGT

`services/valhalla/valhalla.json` in diesem Verzeichnis ist ein **Referenz-
Fragment** für das geplante `service_limits`-Tuning (Budget-Tabelle in
`docs/01-architecture.md`: Valhalla ≤ 1,5 GB RAM, 1–2 Kerne beim Routing). Es
wird zur Laufzeit **derzeit NICHT angewendet** — `build-tiles.sh` übernimmt die
vom gis-ops-Image generierte `valhalla.json` unverändert.

**Warum vertagt:** Ein erster Versuch, dieses Fragment per `jq`-Merge in die
generierte Config einzumischen, brach Valhalla beim Start reproduzierbar ab
(`terminate ... No such node (service_limits.<...>)`). Valhalla validiert die
`service_limits`-Struktur **versionsabhängig sehr streng**: jede Costing-Mode
braucht ihren vollständigen Key-Satz (u. a. `max_matrix_distance`,
`max_matrix_locations`), und Skalar-Limits (`max_exclude_polygons`,
`max_reachability`, …) dürfen nicht wie Costing-Objekte aussehen. Ein
handgeschriebenes Partial-Override lässt sich in dieser Sandbox **nicht lokal**
gegen die echte Ziel-Config verifizieren (Docker-Daemon aus, geofabrik
blockiert), und jeder Rateversuch kostet eine volle CI-Runde. Die vom Image
generierte Config ist dagegen nachweislich korrekt (Spike + CI: LKW-Route
Vaduz→Schaan routet sauber).

**Nachzuholen (eigener Härtungs-Task):** Das Tuning gegen einen **echten
Config-Dump** der eingesetzten Valhalla-Version abgleichen (im laufenden
Container `cat /custom_files/valhalla.json`), nur die tatsächlich vorhandenen
Leaf-Werte reduzieren und die vollständige Struktur je Costing-Mode erhalten.
Bis dahin läuft Valhalla mit den (großzügigeren) Image-Defaults — funktional
korrekt, nur nicht ressourcenoptimiert.

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
