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

## Lite-Suchindex (`build-lite-index.sh`, E05-T5, Wargame W-12)

Zweiter, unabhängiger Build-Skript in diesem Verzeichnis: `build-lite-index.sh`
baut aus **derselben** Geofabrik-PBF (die Valhalla-Datenquelle, siehe oben)
einen Offline-Fallback-Suchindex für `apps/core`'s `SearchService` -- aktiv,
wenn Photon down oder per Setting deaktiviert ist (W-12: "Photon abschalten,
was passiert dann?"). Ergebnisquelle heißt dann `source: 'lite'` und die
Web-UI zeigt einen dezenten Hinweis ("vereinfachte Suche aktiv").

```bash
services/valhalla/build-lite-index.sh /pfad/zu/liechtenstein-latest.osm.pbf
```

Kurzfassung (Details/Kommentare im Skript selbst und in
`apps/core/src/search/lite/`):

1. `osmium tags-filter` extrahiert Orte (`place=city,town,village`) und
   benannte Straßen (`highway=*`) aus der PBF in zwei kleinere PBF-Dateien.
2. `osmium export --geometry-types=point -f geojsonseq` wandelt beide in
   GeoJSONSeq (eine Zeile pro Datensatz, Ways/Areas auf ihren Zentroid
   reduziert).
3. `apps/core/src/search/lite/cli.ts` (via `tsx`) normalisiert/filtert
   (`extract.ts`, rein/unit-getestet) und baut eine neue SQLite-FTS5-DB
   (`lite_search.db`, `tokenize='trigram'` für Tippfehler-Toleranz,
   `buildIndex.ts`) in einer Temp-Datei, dann atomarer Swap per `rename(2)`
   (dieselbe "temp file + rename"-Disziplin wie `build-tiles.sh`, W-17).

Zielpfad: `data/lite-search/lite_search.db` (Default; override via Env
`LITE_SEARCH_DB_PATH`, siehe `apps/core/src/search/lite/paths.ts`) -- `data/`
ist gitignored, der Index ist reines Build-Artefakt, nie committet.

**Ranking** (dokumentiert in `apps/core/src/search/lite/ranking.ts`): simpel,
4-stufig -- Prefix-Treffer > Städte/Orte-Kind (city>town>village>street) >
FTS-Rang (`bm25`) > Distanz-Bias zur übergebenen Position. Keine Hausnummern
(nur Orts-/Straßen-Zentroide).

**Warum `osmium-tool` statt einer Node-PBF-Bibliothek:** dieses Sandbox-
Environment hat kein PBF-Tooling und keinen Netzwerkzugriff auf Geofabrik
(siehe E05-T5-Task-Feasibility-Notiz) -- der volle PBF→Index-Build ist daher
**nur in CI verifizierbar** (Job `lite-search-li-build`, mirrors
`valhalla-li-build`s CI-only-PBF-Handling). Was lokal/unit-getestet ist: die
gesamte Normalisierungs-/Filter-Logik (`extract.ts`) gegen handgeschriebene
GeoJSON-Feature-Fixtures, der FTS5-Build+Query+Ranking-Pfad gegen ECHTES
`better-sqlite3` (kein Mock, siehe `buildIndex.test.ts`), und der komplette
CLI-Swap-Mechanismus (`cli.test.ts`) -- nur die `osmium`-Aufrufe selbst sind
ungetestet-lokal.

### CI-Nachweis (`lite-search-li-build`)

`.github/workflows/ci.yml` Job `lite-search-li-build`: installiert
`osmium-tool`, lädt die LI-PBF, ruft `build-lite-index.sh` auf (getimt, sollte
für LI deutlich unter 1 Minute bleiben), und verifiziert direkt gegen die
gebaute SQLite-Datei per FTS5-`MATCH`, dass "Vaduz" (kind `city`) gefunden
wird und mindestens eine Straße im Index liegt (Akzeptanz #1). Akzeptanz #3
("Index DE < 400 MB") ist eine DE-Scale-/Nightly-Behauptung und wird hier für
den winzigen LI-Extract nicht assertet, nur der Dateigröße informativ
ausgegeben -- ein DE-Build/Nightly-Nachweis ist ein separater, nicht in
diesem Task enthaltener Job (analog zu Valhalla, das ebenfalls nur LI in
CI baut).
