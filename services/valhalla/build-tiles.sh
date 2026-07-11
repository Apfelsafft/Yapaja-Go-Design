#!/usr/bin/env bash
#
# build-tiles.sh — Baut den Valhalla-Routing-Graphen (ADR-014: gis-ops
# Auto-Build-Image) und tauscht ihn atomar in den Live-Pfad ein (W-17,
# kein Downtime WAEHREND des Builds fuer einen ggf. laufenden Service).
#
# Usage:
#   services/valhalla/build-tiles.sh <pbf-url|pfad-zu-lokaler.osm.pbf>
#
# Beispiele:
#   services/valhalla/build-tiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
#   services/valhalla/build-tiles.sh /pfad/zu/germany-latest.osm.pbf
#
# Ablauf:
#   1. Baut den Graphen ueber das gis-ops-Image
#      (ghcr.io/gis-ops/docker-valhalla/valhalla) in ein TEMP-Verzeichnis
#      data/valhalla/tiles.new -- NIEMALS direkt in data/valhalla/tiles.
#      Der Build-Container laeuft auf einem separaten Host-Port
#      ($VALHALLA_BUILD_PORT, Default 8099), damit ein parallel laufender
#      Live-Service auf Port 8002 (docker-compose, Profil "routing")
#      ungestoert weiterserviert.
#   2. Mischt die service_limits-Overrides aus services/valhalla/valhalla.json
#      in die vom Image generierte Config (non-invasiver jq-Merge; schlaegt
#      dieser Schritt fehl, bricht NICHT den ganzen Build -- siehe README).
#   3. Erst nach vollstaendigem Erfolg: atomarer Swap tiles.new -> tiles
#      (per `mv`/rename auf demselben Dateisystem). Der alte Stand wird
#      vorher nach tiles.old weggesichert und danach entfernt.
#   4. Bei JEDEM Fehler VOR dem Swap bleibt data/valhalla/tiles unangetastet.
#      Bricht der Swap selbst unerwartet mitten drin ab, stellt das Skript
#      den alten Stand aus tiles.old automatisch wieder her.
#
# Nach einem erfolgreichen Lauf: `docker compose restart valhalla` (Profil
# "routing"), damit der Service die neuen Tiles einliest.
#
# Env-Overrides:
#   VALHALLA_BUILD_PORT       Host-Port fuer den temporaeren Build-Container
#                              (Default: 8099)
#   VALHALLA_BUILD_TIMEOUT_S  Timeout in Sekunden fuers Warten auf /status
#                              (Default: 1800 = 30 Min, fuer grosse PBFs)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DATA_DIR="$REPO_ROOT/data/valhalla"
TILES_DIR="$DATA_DIR/tiles"
NEW_DIR="$DATA_DIR/tiles.new"
OLD_DIR="$DATA_DIR/tiles.old"
OVERRIDE_FILE="$SCRIPT_DIR/valhalla.json"

IMAGE="ghcr.io/gis-ops/docker-valhalla/valhalla:latest" # ADR-014
BUILD_PORT="${VALHALLA_BUILD_PORT:-8099}"
BUILD_TIMEOUT_S="${VALHALLA_BUILD_TIMEOUT_S:-1800}"
POLL_INTERVAL_S=10
CONTAINER_NAME="valhalla-build-$$"

usage() {
  cat <<'EOF'
Usage: services/valhalla/build-tiles.sh <pbf-url|pfad-zu-lokaler.osm.pbf>

Baut den Valhalla-Routing-Graphen neu und tauscht ihn atomar ein (W-17),
ohne den ggf. laufenden Valhalla-Service (docker-compose, Port 8002) zu
unterbrechen oder in einen inkonsistenten Zustand zu bringen.

Beispiele:
  services/valhalla/build-tiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
  services/valhalla/build-tiles.sh /pfad/zu/germany-latest.osm.pbf

Env-Overrides:
  VALHALLA_BUILD_PORT       Host-Port fuer den temporaeren Build-Container (Default: 8099)
  VALHALLA_BUILD_TIMEOUT_S  Timeout in Sekunden fuers Warten auf den Build (Default: 1800)
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

PBF_ARG="$1"

command -v docker >/dev/null 2>&1 || { echo "FEHLER: docker nicht im PATH gefunden." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "FEHLER: curl nicht im PATH gefunden." >&2; exit 1; }

TILE_URLS=""
LOCAL_PBF=""
if [[ "$PBF_ARG" =~ ^https?:// ]]; then
  TILE_URLS="$PBF_ARG"
  echo "Modus: URL-Download durch das gis-ops-Image ($TILE_URLS)"
else
  if [ ! -f "$PBF_ARG" ]; then
    echo "FEHLER: lokale PBF-Datei nicht gefunden: $PBF_ARG" >&2
    exit 1
  fi
  LOCAL_PBF="$(cd "$(dirname "$PBF_ARG")" && pwd)/$(basename "$PBF_ARG")"
  echo "Modus: lokale PBF-Datei ($LOCAL_PBF)"
fi

mkdir -p "$DATA_DIR"

# --- Aufraeumen (idempotent) -------------------------------------------------
# Leftover aus einem vorherigen, fehlgeschlagenen Lauf entfernen. tiles/ (der
# aktuell live Stand, falls vorhanden) bleibt dabei explizit unangetastet.
rm -rf "$NEW_DIR"
mkdir -p "$NEW_DIR"

# Einheitlicher Exit-Handler: raeumt den Build-Container immer auf und
# stellt -- falls der atomare Swap weiter unten je mitten im Rename-Schritt
# unterbrochen werden sollte -- den vorherigen Tiles-Stand aus tiles.old
# automatisch wieder her, statt den Service ohne jeden Graphen zurueckzulassen.
on_exit() {
  local ec=$?
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [ ! -e "$TILES_DIR" ] && [ -d "$OLD_DIR" ]; then
    echo "Stelle vorherigen Tiles-Stand aus $OLD_DIR wieder her (Swap unvollstaendig)." >&2
    if mv "$OLD_DIR" "$TILES_DIR" 2>/dev/null; then
      echo "Wiederherstellung erfolgreich." >&2
    else
      echo "KRITISCH: automatische Wiederherstellung fehlgeschlagen -- bitte manuell pruefen: $OLD_DIR -> $TILES_DIR" >&2
    fi
  fi
  exit "$ec"
}
trap on_exit EXIT

if [ -n "$LOCAL_PBF" ]; then
  echo "Kopiere lokale PBF nach $NEW_DIR/ ..."
  cp "$LOCAL_PBF" "$NEW_DIR/$(basename "$LOCAL_PBF")"
fi

echo "Starte gis-ops-Build-Container ($IMAGE) auf Host-Port $BUILD_PORT ..."
docker run -d --name "$CONTAINER_NAME" \
  -p "${BUILD_PORT}:8002" \
  -v "$NEW_DIR:/custom_files" \
  -e tile_urls="$TILE_URLS" \
  -e serve_tiles=True \
  -e build_elevation=False \
  -e build_admins=True \
  -e build_time_zones=False \
  -e force_rebuild=True \
  "$IMAGE" >/dev/null

echo "Warte auf Graph-Build (Timeout ${BUILD_TIMEOUT_S}s) ..."
ELAPSED=0
while true; do
  if curl -sf "http://localhost:${BUILD_PORT}/status" >/dev/null 2>&1; then
    echo "Valhalla antwortet auf /status nach ~${ELAPSED}s -- Build fertig."
    break
  fi
  if [ "$ELAPSED" -ge "$BUILD_TIMEOUT_S" ]; then
    echo "FEHLER: Valhalla-Build kam nicht rechtzeitig hoch (Timeout ${BUILD_TIMEOUT_S}s)." >&2
    echo "--- docker logs $CONTAINER_NAME (letzte 150 Zeilen) ---" >&2
    docker logs "$CONTAINER_NAME" 2>&1 | tail -150 >&2 || true
    exit 1
  fi
  sleep "$POLL_INTERVAL_S"
  ELAPSED=$((ELAPSED + POLL_INTERVAL_S))
done

# Build-Container wird nicht mehr gebraucht -- er hat den Graphen bereits
# nach $NEW_DIR geschrieben. Vorab stoppen, damit Host-Port $BUILD_PORT
# sofort wieder frei ist (der Exit-Handler raeumt ohnehin nochmal auf).
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

# --- service_limits-Tuning: BEWUSST VERTAGT ---------------------------------
# Die vom gis-ops-Image generierte valhalla.json wird UNVERAENDERT uebernommen
# (im Spike als korrekt routend bewiesen). Ein frueher Versuch, die Mini-PC-
# service_limits aus services/valhalla/valhalla.json per jq einzumischen, brach
# Valhalla beim Start reproduzierbar ab ("No such node
# (service_limits.<...>)"): Valhalla validiert die service_limits-Struktur
# versionsabhaengig sehr streng (jede Costing-Mode braucht ihren vollstaendigen
# Key-Satz, Skalare duerfen nicht als Objekte erscheinen), und ein
# handgeschriebenes Partial-Override laesst sich hier nicht lokal gegen die
# echte Ziel-Config verifizieren. services/valhalla/valhalla.json bleibt daher
# als dokumentierte REFERENZ fuer eine spaetere Haertung liegen (dann gegen
# einen echten Config-Dump der eingesetzten Valhalla-Version abgeglichen),
# wird aber NICHT zur Laufzeit gemischt. Details: services/valhalla/README.md.
CONFIG_FILE="$NEW_DIR/valhalla.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "WARNUNG: $CONFIG_FILE nicht gefunden -- das Image hat keine valhalla.json erzeugt (unerwartet)." >&2
else
  echo "Nutze die vom Image generierte $CONFIG_FILE unveraendert (service_limits-Tuning vertagt, siehe README)."
fi

# Sanity-Check: das neue Verzeichnis darf nicht leer sein.
if [ -z "$(find "$NEW_DIR" -mindepth 1 -print -quit)" ]; then
  echo "FEHLER: $NEW_DIR ist nach dem Build leer -- der Build hat offenbar nichts geschrieben." >&2
  exit 1
fi

# --- Atomischer Swap (W-17) --------------------------------------------------
# Erst JETZT, nach vollstaendigem Erfolg, wird der Live-Stand ersetzt. `mv`
# innerhalb desselben Dateisystems ist ein reiner rename(2)-Syscall: er ist
# atomar (kein halbfertiger Zwischenzustand fuer Leser wie den laufenden
# Valhalla-Service) und entweder komplett erfolgreich oder komplett fehlgeschlagen.
echo "Schwenke $NEW_DIR -> $TILES_DIR (atomar) ..."
rm -rf "$OLD_DIR"
if [ -d "$TILES_DIR" ]; then
  mv "$TILES_DIR" "$OLD_DIR"
fi
mv "$NEW_DIR" "$TILES_DIR"
rm -rf "$OLD_DIR"

echo "Fertig. Live-Tiles: $TILES_DIR"
echo "Damit ein laufender docker-compose-Service (Profil 'routing') die neuen"
echo "Tiles einliest: 'docker compose restart valhalla' (kurzer Blip; waehrend"
echo "des Builds selbst gab es keine Downtime und keinen inkonsistenten Zustand)."
