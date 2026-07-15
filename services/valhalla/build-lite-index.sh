#!/usr/bin/env bash
#
# build-lite-index.sh — Baut den Lite-Suchindex (E05-T5, Wargame W-12:
# Offline-Fallback wenn Photon down/deaktiviert ist) aus einem OSM-PBF.
#
# Warum unter services/valhalla/ statt einem eigenen services/lite-search/:
# die Datenquelle ist DIESELBE Geofabrik-PBF, die build-tiles.sh schon fuer
# Valhalla verwendet (siehe E05-T5-Task: "Pfade: ...  services/valhalla/
# (Datenquelle)"). Ein eigenes services/-Verzeichnis nur fuer ein einzelnes
# Build-Skript ohne eigenen laufenden Service (keine Runtime-Komponente wie
# bei Photon/Valhalla -- der Lite-Index wird von apps/core direkt als Datei
# gelesen, siehe apps/core/src/search/lite/liteBackend.ts) haette hier keinen
# Mehrwert; der Skript-NAME macht seinen Zweck trotzdem eindeutig.
#
# Usage:
#   services/valhalla/build-lite-index.sh <pbf-datei>
#
# Beispiel (CI, siehe .github/workflows/ci.yml Job "lite-search-li-build"):
#   curl -fLo li.osm.pbf https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
#   services/valhalla/build-lite-index.sh li.osm.pbf
#
# Ablauf:
#   1. `osmium tags-filter` extrahiert zwei Teilmengen aus der PBF:
#        - Orte:     Nodes mit place=city,town,village
#        - Strassen:  Ways mit einem highway-Tag (Namensfilter passiert im
#                      Node-Normalizer, apps/core/src/search/lite/extract.ts
#                      -- unbenannte Ways werden dort verworfen)
#   2. `osmium export --geometry-types=point -f geojsonseq` wandelt beide
#      Teilmengen in GeoJSONSeq (eine Feature-Zeile pro Datensatz) --
#      Ways/Areas werden dabei auf ihren Zentroid reduziert ("Zentroid" laut
#      Task-Spec). Der Node-Extraktor akzeptiert defensiv AUCH LineString/
#      Polygon-Geometrien und berechnet dann selbst einen Zentroid (siehe
#      extract.ts) -- falls das osmium-Verhalten hier je abweicht, bricht
#      der Build trotzdem nicht.
#   3. `tsx src/search/lite/cli.ts` (im @yapaja/core-Workspace) liest beide
#      GeoJSONSeq-Dateien, normalisiert + filtert (extract.ts), baut eine
#      neue SQLite-FTS5-DB (lite_search.db, trigram-Tokenizer, buildIndex.ts)
#      in einer TEMP-Datei und tauscht sie per `rename(2)` atomar ein
#      (dieselbe "temp file + rename"-Disziplin wie build-tiles.sh, W-17 --
#      ein laufender Core-Prozess sieht nie eine halbfertige Datei).
#
# Nach einem erfolgreichen Lauf: kein Neustart des Core-Prozesses noetig,
# solange `LiteBackend` die Datei bei jedem Cold-Start neu oeffnet (sie oeffnet
# lazy+einmalig pro Prozesslauf) -- ein Core-Neustart macht die neue DB
# jedenfalls sicher sichtbar.
#
# Env-Overrides:
#   LITE_SEARCH_DB_PATH   Zielpfad fuer lite_search.db
#                          (Default: data/lite-search/lite_search.db, siehe
#                          apps/core/src/search/lite/paths.ts)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

OUT_DB="${LITE_SEARCH_DB_PATH:-$REPO_ROOT/data/lite-search/lite_search.db}"

usage() {
  cat <<'EOF'
Usage: services/valhalla/build-lite-index.sh <pbf-datei>

Baut den Lite-Suchindex (lite_search.db, SQLite FTS5 trigram) aus einem
OSM-PBF: Orte (place=city/town/village) + benannte Strassen, je mit
Zentroid. Atomarer Swap (W-17).

Beispiel:
  services/valhalla/build-lite-index.sh /pfad/zu/liechtenstein-latest.osm.pbf

Env-Overrides:
  LITE_SEARCH_DB_PATH   Zielpfad fuer lite_search.db
                         (Default: data/lite-search/lite_search.db)
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

PBF="$1"

command -v osmium >/dev/null 2>&1 || {
  echo "FEHLER: osmium (osmium-tool) nicht im PATH gefunden. Installation (Debian/Ubuntu): apt-get install -y osmium-tool" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || { echo "FEHLER: pnpm nicht im PATH gefunden." >&2; exit 1; }

if [ ! -f "$PBF" ]; then
  echo "FEHLER: PBF-Datei nicht gefunden: $PBF" >&2
  exit 1
fi
PBF="$(cd "$(dirname "$PBF")" && pwd)/$(basename "$PBF")"

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

mkdir -p "$(dirname "$OUT_DB")"

echo "== Filtere Orte (place=city,town,village) aus $PBF =="
osmium tags-filter --overwrite -o "$WORK_DIR/places.osm.pbf" "$PBF" n/place=city,town,village

echo "== Filtere Strassen (highway=*) aus $PBF =="
osmium tags-filter --overwrite -o "$WORK_DIR/streets.osm.pbf" "$PBF" w/highway

echo "== Exportiere GeoJSONSeq (Zentroid fuer Ways/Areas) =="
osmium export --overwrite --geometry-types=point -f geojsonseq -o "$WORK_DIR/places.geojsonseq" "$WORK_DIR/places.osm.pbf"
osmium export --overwrite --geometry-types=point -f geojsonseq -o "$WORK_DIR/streets.geojsonseq" "$WORK_DIR/streets.osm.pbf"

echo "== Baue lite_search.db (tsx-CLI, atomarer Swap nach $OUT_DB) =="
(
  cd "$REPO_ROOT"
  pnpm --filter @yapaja/core exec tsx src/search/lite/cli.ts \
    --places "$WORK_DIR/places.geojsonseq" \
    --streets "$WORK_DIR/streets.geojsonseq" \
    --out "$OUT_DB"
)

test -s "$OUT_DB" || { echo "FEHLER: $OUT_DB fehlt oder ist leer nach dem Build." >&2; exit 1; }

echo "Fertig: $OUT_DB"
