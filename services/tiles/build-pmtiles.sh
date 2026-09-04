#!/usr/bin/env bash
#
# build-pmtiles.sh — Baut die Vektor-Kartenkacheln (PMTiles, ADR-003) aus
# einem OSM-Extrakt und tauscht sie atomar in den Live-Pfad ein (W-17).
#
# ─── WARUM ES DIESES SKRIPT GIBT ────────────────────────────────────────────
# ADR-003 (docs/01-architecture.md) legt fest: „Offline-Karten = PMTiles
# (Protomaps-Builds von OSM)". Die Kacheln sind also ein ERZEUGNIS aus
# OSM-Rohdaten, kein Fremd-Download. Der Regionen-Katalog
# (apps/core/src/map/regions/regions-catalog.json) verwies bis
# `feat/gui-install-path` trotzdem auf
# `https://download.geofabrik.de/europe/<region>-latest.pmtiles` — offenbar
# entstanden, indem an der funktionierenden `.osm.pbf`-URL die Endung
# getauscht wurde. Geofabrik verteilt ausschliesslich Rohdaten
# (`.osm.pbf`, `.shp.zip`); diese `.pmtiles`-URLs liefern 404. Es gab damit
# KEINEN funktionierenden Weg zu Kartenkacheln. Dieses Skript ist dieser Weg.
#
# Es ist das Gegenstueck zu `services/valhalla/build-tiles.sh` (Routing-Graph)
# und `services/valhalla/build-lite-index.sh` (Lite-Suchindex): dieselbe
# `.osm.pbf`, drei Erzeugnisse.
#
# ─── WAS HIER NICHT VERIFIZIERT WERDEN KONNTE ───────────────────────────────
# Die Umgebung, in der dieses Skript geschrieben wurde, hat KEINEN
# Docker-Daemon und KEINEN Netzwerkzugriff auf ghcr.io/Geofabrik. Der
# eigentliche planetiler-Lauf (die `docker run`-Zeile weiter unten) wurde
# hier deshalb NIE ausgefuehrt. Getestet ist alles darum herum:
# Argumentbehandlung, Regions-Ableitung, Ausgabepfad, PMTiles-Magic-Pruefung,
# atomarer Swap und jeder Fehlerpfad — siehe `build-pmtiles.test.ts`, das
# `docker` durch ein Stub-Programm ersetzt und dadurch die komplette
# Swap-/Fehlerlogik real durchspielt.
#
# Damit eine etwaige Abweichung in planetilers CLI NICHT bedeutet, dass man
# dieses Skript editieren muss, sind Image und Argumente per Env
# ueberschreibbar (`PLANETILER_IMAGE`, `PLANETILER_ARGS`). Und weil ein
# falscher Aufruf sonst still eine Schrott-Datei installieren wuerde, prueft
# das Skript vor dem Swap die PMTiles-Signatur der erzeugten Datei.
#
# Usage:
#   services/tiles/build-pmtiles.sh <pbf-url|pfad-zu-lokaler.osm.pbf> [region-id]
#
# Beispiele:
#   services/tiles/build-pmtiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
#   services/tiles/build-pmtiles.sh data/pbf/li.osm.pbf liechtenstein
#
# Ohne explizite `region-id` wird sie aus dem Dateinamen abgeleitet:
# `liechtenstein-latest.osm.pbf` -> `liechtenstein`. Sie muss danach dem
# Regions-Slug-Muster aus `apps/core/src/map/paths.ts` genuegen
# (`^[a-zA-Z0-9_-]+$`), weil der Core genau danach die Datei
# `<TILES_DIR>/<region>.pmtiles` ausliefert.
#
# Ablauf:
#   1. PBF beschaffen (URL -> Download nach Arbeitsverzeichnis, sonst lokale
#      Datei verwenden).
#   2. planetiler im Docker-Container laufen lassen; Ausgabe geht in ein
#      TEMP-Verzeichnis, NIEMALS direkt auf `<TILES_DIR>/<region>.pmtiles`.
#   3. Erzeugnis pruefen: existiert, nicht leer, beginnt mit der
#      PMTiles-Signatur `PM`.
#   4. Erst danach atomarer Swap (rename(2) im selben Dateisystem). Ein
#      laufender Core sieht nie eine halbfertige Datei; schlaegt irgendetwas
#      davor fehl, bleibt die bisherige Kartendatei unangetastet.
#
# Nach einem erfolgreichen Lauf ist KEIN Neustart noetig: der Core listet
# Regionen bei jeder Anfrage frisch aus dem Verzeichnis
# (apps/core/src/map/regions.ts). In der App genuegt „Kartenregionen
# verwalten" neu zu oeffnen bzw. ein Reload.
#
# ─── WO DARF MAN BAUEN? (Referenz: HAOS-VM mit 8 GB unter Proxmox) ──────────
# Das RAM-Budget dieser VM ist bereits weitgehend vergeben:
#   Core 300 MB + Valhalla 1,5 GB + Photon 1 GB  = <= 2,9 GB (docs/01 §4)
#   Home Assistant selbst + Mosquitto            = ~1-1,5 GB
#   -----------------------------------------------------------------
#   frei fuer alles Weitere                      = ~3,5 GB
# (Die Add-on-Doku empfiehlt >= 6 GB; 8 GB liegen darueber, aber eben nicht
# beliebig weit.) Der Kachelbau ist der speicherhungrigste Schritt der ganzen
# Kette -- er konkurriert genau mit HA, Valhalla und Photon. Daraus folgt eine
# klare Zweiteilung:
#
#   KLEINE REGION (Liechtenstein, ein US-Bundesstaat, ein Bundesland):
#     im Add-on baubar. ~3 MB..einige 100 MB PBF, Minuten bis ~1 h,
#     PLANETILER_XMX=1g..2g passt neben allem anderen in die 8 GB.
#
#   GANZES LAND (Deutschland, ~4 GB PBF): NICHT auf dieser VM bauen.
#     Stunden Laufzeit und ein Heap-/Disk-Bedarf, der die ~3,5 GB Luft
#     sprengt. Drei Auswege, alle ohne SSH auf der HAOS-VM:
#       a) Proxmox-VM temporaer vergroessern (z. B. auf 16 GB), bauen,
#          wieder verkleinern;
#       b) einen separaten LXC nur fuer den Build anlegen (Docker + dieses
#          Skript, danach die Datei kopieren);
#       c) die `.pmtiles` auf einem Desktop/Server bauen und per
#          „Samba share"- oder „File editor"-Add-on nach
#          `/share/yapaja/tiles/<region>.pmtiles` legen.
#     Weg (c) ist der einzige, der gar keinen zweiten Rechner voraussetzt,
#     falls jemand die Datei bereitstellt. Details: docs/installation.md §C.
#
# (Die Zeit-/RAM-Angaben sind Groessenordnungen aus planetilers eigener
# Dokumentation und den Extraktgroessen -- hier NICHT gemessen, siehe
# „WAS HIER NICHT VERIFIZIERT WERDEN KONNTE" oben.)
#
# Env-Overrides:
#   TILES_DIR          Zielverzeichnis der Kacheln
#                       (Default: <repo>/data/tiles; im HA-Add-on:
#                        /share/yapaja/tiles, siehe
#                        yapaja_go/rootfs/etc/yapaja/init-yapaja-config.sh)
#   PLANETILER_IMAGE   Container-Image (Default: ghcr.io/onthegomap/planetiler:v0.10.2)
#   PLANETILER_JAR     Pfad zu planetiler.jar. Ist er gesetzt, laeuft der Bau
#                      per `java -jar` STATT per Docker -- der einzige Weg
#                      dort, wo kein Docker-Socket verfuegbar ist (z. B. IM
#                      HA-Add-on-Container). Bezugsquelle (belegt):
#                      github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar
#   PLANETILER_XMX     JVM-Heap fuer planetiler (Default: 1g)
#   PLANETILER_SOURCES_DIR  Dauerhafte Ablage der NICHT regionsspezifischen
#                       Basisdaten des OpenMapTiles-Profils (Wasserflaechen,
#                       Natural Earth, Seen-Mittellinien). Default:
#                       <TILES_DIR>/../planetiler-sources. Beim ERSTEN Bau
#                       werden sie geladen (mehrere hundert MB), danach nutzt
#                       jede weitere Region dieselben Dateien.
#   PLANETILER_ARGS    ERSETZT die planetiler-Argumente komplett. Fuer den
#                       Fall, dass die CLI der verwendeten Version von der
#                       hier hinterlegten abweicht -- dann muss niemand
#                       dieses Skript patchen. `%INPUT%` und `%OUTPUT%`
#                       werden durch die containerinternen Pfade ersetzt.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TILES_DIR="${TILES_DIR:-$REPO_ROOT/data/tiles}"
PLANETILER_IMAGE="${PLANETILER_IMAGE:-ghcr.io/onthegomap/planetiler:v0.10.2}"
PLANETILER_XMX="${PLANETILER_XMX:-1g}"

usage() {
  cat <<'EOF'
Usage: services/tiles/build-pmtiles.sh <pbf-url|pfad-zu-lokaler.osm.pbf> [region-id]

Baut die Vektor-Kartenkacheln (PMTiles, ADR-003) aus einem OSM-Extrakt und
tauscht sie atomar nach <TILES_DIR>/<region-id>.pmtiles ein (W-17).

Beispiele:
  services/tiles/build-pmtiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
  services/tiles/build-pmtiles.sh data/pbf/li.osm.pbf liechtenstein

Ohne region-id wird sie aus dem Dateinamen abgeleitet
("liechtenstein-latest.osm.pbf" -> "liechtenstein").

Env-Overrides:
  TILES_DIR          Zielverzeichnis (Default: <repo>/data/tiles)
  PLANETILER_IMAGE   Container-Image (Default: ghcr.io/onthegomap/planetiler:v0.10.2)
  PLANETILER_JAR     Pfad zu planetiler.jar -- laeuft dann per `java -jar`
                     statt per Docker (noetig, wo kein Docker-Socket da ist,
                     z. B. im HA-Add-on-Container)
  PLANETILER_XMX     JVM-Heap (Default: 1g)
  PLANETILER_SOURCES_DIR  Dauerhafte Ablage der gemeinsamen Basisdaten
                     (Wasserflaechen, Natural Earth, Seen-Mittellinien;
                     Default: <TILES_DIR>/../planetiler-sources). Einmalig
                     mehrere hundert MB, danach von jeder Region genutzt.
  PLANETILER_ARGS    Ersetzt die planetiler-Argumente (%INPUT%/%OUTPUT%/%SOURCES%
                     werden ersetzt). Wer das setzt, muss `--download` und
                     `--download_dir=%SOURCES%` selbst mitgeben.
EOF
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 1
fi

PBF_ARG="$1"
REGION_ARG="${2:-}"

# --- Regions-Slug ableiten ---------------------------------------------------
# "…/liechtenstein-latest.osm.pbf" -> "liechtenstein". Der `-latest`-Suffix
# ist Geofabrik-Konvention; ohne ihn bleibt der Basisname stehen.
derive_region_id() {
  local base
  base="$(basename "$1")"
  base="${base%%\?*}"      # etwaigen Query-String einer URL abschneiden
  base="${base%.pbf}"
  base="${base%.osm}"
  base="${base%-latest}"
  printf '%s' "$base"
}

REGION_ID="${REGION_ARG:-$(derive_region_id "$PBF_ARG")}"

# Dasselbe Muster, das apps/core/src/map/paths.ts erzwingt. Waere es hier
# lockerer, entstuende eine Datei, die der Core nie ausliefert.
if ! [[ "$REGION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "FEHLER: ungueltige Regions-ID \"$REGION_ID\"." >&2
  echo "Erlaubt sind nur Buchstaben, Ziffern, '-' und '_' (siehe apps/core/src/map/paths.ts)." >&2
  echo "Gib sie als zweites Argument explizit an, z. B.:" >&2
  echo "  services/tiles/build-pmtiles.sh \"$PBF_ARG\" meine-region" >&2
  exit 1
fi

OUTPUT_FILE="$TILES_DIR/$REGION_ID.pmtiles"

# Docker wird NUR im Docker-Modus gebraucht. Diese Pruefung stand bis
# 2026-09-02 ungeschuetzt hier und lief damit auch dann, wenn
# PLANETILER_JAR gesetzt war -- also genau in dem Fall, fuer den der
# JAR-Modus ueberhaupt existiert.
#
# Die Folge war der Fehlschlag, mit dem der Kachelbau im Add-on aus der
# Oberflaeche abbrach: der Wrapper `yapaja-build-pmtiles` setzt
# PLANETILER_JAR korrekt, laedt die JAR nach /share -- und dieses Skript
# stieg trotzdem mit „docker nicht im PATH gefunden" aus, samt dem Rat,
# die Kacheln „auf einem anderen Rechner" zu bauen. Der Betreiber sah
# einen Knopf, der genau das Gegenteil des Beworbenen tat, und einen
# Ratschlag, der ihn wieder aus der Oberflaeche hinausschickte.
#
# Unbemerkt blieb es, weil `build-pmtiles.test.ts` fuer JEDEN Fall ein
# `docker`-Stub in den PATH legt -- der eine Fall ohne Docker, der im
# Add-on der Normalfall ist, kam darin nicht vor.
if [ -z "${PLANETILER_JAR:-}" ]; then
  command -v docker >/dev/null 2>&1 || {
    echo "FEHLER: docker nicht im PATH gefunden." >&2
    echo "planetiler laeuft hier als Container. Ohne Docker gibt es zwei Alternativen:" >&2
    echo "  - planetiler als JAR direkt mit einer JRE 21+ starten (PLANETILER_JAR setzen, siehe services/tiles/README.md), oder" >&2
    echo "  - die .pmtiles auf einem anderen Rechner bauen und nach $TILES_DIR/ kopieren." >&2
    exit 1
  }
fi

# --- Eingabe beschaffen ------------------------------------------------------
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yapaja-pmtiles-XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

INPUT_NAME="input.osm.pbf"
if [[ "$PBF_ARG" =~ ^https?:// ]]; then
  command -v curl >/dev/null 2>&1 || { echo "FEHLER: curl nicht im PATH gefunden (fuer den PBF-Download)." >&2; exit 1; }
  echo "Lade OSM-Extrakt herunter: $PBF_ARG"
  if ! curl -fL --retry 3 -o "$WORK_DIR/$INPUT_NAME" "$PBF_ARG"; then
    echo "FEHLER: Download der PBF fehlgeschlagen: $PBF_ARG" >&2
    echo "Pruefe die URL im Browser. Geofabrik verteilt Rohdaten als '.osm.pbf'" >&2
    echo "(NICHT '.pmtiles' -- daraus baut genau dieses Skript die Kacheln)." >&2
    exit 1
  fi
else
  if [ ! -f "$PBF_ARG" ]; then
    echo "FEHLER: lokale PBF-Datei nicht gefunden: $PBF_ARG" >&2
    echo "Erwartet wird ein OSM-Extrakt im '.osm.pbf'-Format, z. B. von" >&2
    echo "https://download.geofabrik.de/ -- oder gib eine URL statt eines Pfades an." >&2
    exit 1
  fi
  echo "Nutze lokale PBF-Datei: $PBF_ARG"
  cp "$PBF_ARG" "$WORK_DIR/$INPUT_NAME"
fi

# --- Passt das ueberhaupt auf die Platte? ------------------------------------
# ─── WARUM HIER UND NICHT ERST BEIM SCHREIBEN ───────────────────────────────
# Der Kachelbau laeuft fuer ein ganzes Land STUNDEN. Geht dabei der Platz aus,
# ist die Zeit weg -- und die Fehlermeldung, die dann kommt, stammt irgendwo
# aus planetilers Innerem und sagt niemandem, dass schlicht die Platte voll
# war. Die vorhandene Vorabpruefung (`apps/core/src/map/regions/disk.ts`)
# misst nur den DOWNLOAD; sie kennt den Bau nicht.
#
# ─── DIE ZAHL IST EINE SCHAETZUNG, UND SIE SAGT DAS AUCH ────────────────────
# Waehrend des Baus liegen gleichzeitig auf der Platte:
#   * der OSM-Extrakt selbst,
#   * planetilers Zwischenstaende (Knoten- und Wege-Ablagen, sortiert), mit
#     Abstand der groesste Posten,
#   * die entstehende .pmtiles.
# Zusammen erfahrungsgemaess das Mehrfache des Extrakts. Der Faktor unten ist
# bewusst grosszuegig und NICHT gemessen -- ein Deutschland-Bau war hier nicht
# durchzufuehren. Deshalb ist er ueberschreibbar, und deshalb nennt die
# Meldung Zahlen statt nur "zu wenig Platz".
PMTILES_DISK_FACTOR="${PMTILES_DISK_FACTOR:-8}"
PMTILES_DISK_MARGIN_MB="${PMTILES_DISK_MARGIN_MB:-2048}"

# ─── EINE PRUEFUNG, DIE NICHT MESSEN KANN, DARF NICHTS VERHINDERN ──────────
# `df` und `awk` sind auf jedem normalen System da, aber diese Pruefung ist
# eine Bequemlichkeit und keine Voraussetzung fuer den Bau. Fehlt eines der
# beiden, wird sie uebersprungen -- mit einem Hinweis, statt den Bau an einem
# fehlenden Hilfsprogramm scheitern zu lassen.
mkdir -p "$TILES_DIR"

if ! command -v df >/dev/null 2>&1 || ! command -v awk >/dev/null 2>&1; then
  echo "Hinweis: df/awk nicht verfuegbar -- die Platzpruefung wird uebersprungen."
else
free_mb() { df -Pm "$1" 2>/dev/null | awk 'NR==2 {print $4}'; }

INPUT_MB=$(( $(stat -c %s "$WORK_DIR/$INPUT_NAME") / 1024 / 1024 ))
NEED_MB=$(( INPUT_MB * PMTILES_DISK_FACTOR + PMTILES_DISK_MARGIN_MB ))

# Zwei Dateisysteme koennen betroffen sein: das Arbeitsverzeichnis und das
# Ziel. Im Add-on liegen beide auf /share (der Wrapper setzt TMPDIR dorthin) --
# dann ist es dasselbe und die Pruefung laeuft doppelt, was nicht schadet.
DISK_OK=1
for dir in "$WORK_DIR" "$TILES_DIR"; do
  FREE_MB="$(free_mb "$dir")"
  [ -n "${FREE_MB:-}" ] || continue
  if [ "$FREE_MB" -lt "$NEED_MB" ]; then
    echo "FEHLER: zu wenig freier Speicherplatz fuer diesen Bau." >&2
    echo "  Verzeichnis:      $dir" >&2
    echo "  frei:             ${FREE_MB} MB" >&2
    echo "  geschaetzt noetig: ${NEED_MB} MB  (Extrakt ${INPUT_MB} MB x ${PMTILES_DISK_FACTOR} + ${PMTILES_DISK_MARGIN_MB} MB Reserve)" >&2
    DISK_OK=0
  fi
done

if [ "$DISK_OK" -eq 0 ]; then
  echo "" >&2
  echo "Der Bau wurde NICHT gestartet -- fuer ein ganzes Land laeuft er Stunden," >&2
  echo "und ein Abbruch wegen voller Platte kostet diese Zeit vollstaendig." >&2
  echo "" >&2
  echo "Moeglichkeiten:" >&2
  echo "  * Platz schaffen (alte Regionen, Zwischenstaende unter /share/yapaja/tmp)." >&2
  echo "  * Eine kleinere Region bauen (Bundesland statt Land)." >&2
  echo "  * Die Schaetzung ist konservativ. Wer es besser weiss, setzt" >&2
  echo "    PMTILES_DISK_FACTOR (aktuell ${PMTILES_DISK_FACTOR}) oder" >&2
  echo "    PMTILES_DISK_MARGIN_MB (aktuell ${PMTILES_DISK_MARGIN_MB})." >&2
  exit 1
fi

echo "Platzpruefung bestanden: Extrakt ${INPUT_MB} MB, geschaetzter Bedarf ${NEED_MB} MB."
fi

# --- Bauen -------------------------------------------------------------------
# Ausgabe geht bewusst in $WORK_DIR, nicht nach $TILES_DIR: erst nach der
# Signaturpruefung unten wird geschwenkt (W-17).
OUT_NAME="out.pmtiles"

# ─── GEMEINSAME BASISDATEN, DIE NICHT AUS DER PBF KOMMEN ────────────────────
# Das OpenMapTiles-Profil, das planetiler hier benutzt, braucht neben dem
# OSM-Extrakt DREI weitere Quellen, die nicht regionsspezifisch sind:
# `lake_centerline.shp.zip`, `water-polygons-split-3857.zip` und
# `natural_earth_vector.sqlite.zip` (Seen-Mittellinien, Wasserflaechen,
# Natural-Earth-Basis fuer kleine Zoomstufen).
#
# Ohne sie bricht planetiler ab, BEVOR auch nur eine Kachel entsteht:
#
#   java.lang.IllegalArgumentException: data/sources/lake_centerline.shp.zip
#   does not exist. Run with --download to fetch it
#
# Genau das ist im Add-on passiert. Die Argumente hier nannten `--download`
# nicht -- der Aufruf war also von Anfang an unvollstaendig und konnte in
# KEINER Umgebung durchlaufen, auch nicht per Docker. Dass es nie auffiel,
# liegt daran, dass planetiler in den Tests durch ein Stub ersetzt ist: das
# Stub schreibt eine PMTiles-Datei und schert sich nicht um fehlende Quellen.
# Der Aufruf selbst war nie gegen ein echtes planetiler gelaufen.
#
# `--download` holt laut planetilers eigenem Quelltext (`Planetiler.java`,
# `getPath`) NUR, was noch nicht da ist -- die PBF wird also nicht erneut
# geladen, und ein zweiter Regionsbau laedt gar nichts mehr nach. Deshalb
# zeigt `--download_dir` auf ein DAUERHAFTES Verzeichnis neben den Kacheln
# und nicht ins Arbeitsverzeichnis: sonst wuerden mehrere hundert MB
# Basisdaten bei jedem Lauf neu geholt und danach weggeworfen.
SOURCES_DIR="${PLANETILER_SOURCES_DIR:-$(dirname "$TILES_DIR")/planetiler-sources}"
mkdir -p "$SOURCES_DIR"

# `%INPUT%`/`%OUTPUT%` sind die CONTAINER-internen Pfade ($WORK_DIR ist als
# /data eingehaengt). `%SOURCES%` bleibt bis zur Laufart stehen und wird erst
# dort aufgeloest -- als Mount-Ziel /sources (Docker) bzw. als echter Pfad
# (JAR). Ein Platzhalter und kein fester Pfad, weil die JAR-Variante die
# /data-Ersetzung als globales Suchen-und-Ersetzen macht: stuende hier schon
# ein echter Pfad, der selbst `/data` enthaelt (im Repo-Fall
# `<repo>/data/planetiler-sources`), wuerde diese Ersetzung ihn zerlegen.
DEFAULT_ARGS="--osm-path=/data/$INPUT_NAME --output=/data/$OUT_NAME --force --nodemap-type=sortedtable --download --download_dir=%SOURCES%"
RAW_ARGS="${PLANETILER_ARGS:-$DEFAULT_ARGS}"
RAW_ARGS="${RAW_ARGS//%INPUT%//data/$INPUT_NAME}"
RAW_ARGS="${RAW_ARGS//%OUTPUT%//data/$OUT_NAME}"
# Wortweise aufsplitten: die Argumente sind kontrollierte, leerzeichenfreie
# Flags -- Anfuehrungszeichen innerhalb von PLANETILER_ARGS werden bewusst
# NICHT unterstuetzt (waere ein eval, und das ist es nicht wert).
read -r -a PLANETILER_ARGV <<< "$RAW_ARGS"

# ZWEI LAUFARTEN. Docker ist der Default; die JAR-Variante ist NICHT bloss
# eine Bequemlichkeit, sondern der einzige Weg an Stellen OHNE Docker-Zugriff
# -- namentlich INNERHALB eines Home-Assistant-Add-on-Containers, der selbst
# schon ein Container ist und keinen Docker-Socket hat. Wer die Kacheln also
# aus der HA-Oberflaeche heraus bauen lassen will, braucht diesen Pfad.
#
# Die JAR-Bezugsquelle ist BELEGT (vom Betreiber im Browser geprueft):
#   https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar
# Das Container-Image ist auf dieselbe Version gepinnt; ob es unter genau
# diesem Tag existiert, konnte hier mangels Netz NICHT geprueft werden --
# deshalb ist es ueberschreibbar und die JAR-Variante die belegte Alternative.
if [ -n "${PLANETILER_JAR:-}" ]; then
  RUNNER_DESC="planetiler.jar ($PLANETILER_JAR)"
else
  RUNNER_DESC="$PLANETILER_IMAGE"
fi
echo "Baue Kacheln fuer Region \"$REGION_ID\" mit $RUNNER_DESC (Xmx=$PLANETILER_XMX) ..."
echo "Das kann je nach Extraktgroesse Minuten (Liechtenstein) bis Stunden (Deutschland) dauern."

if [ -n "${PLANETILER_JAR:-}" ]; then
  if [ ! -f "$PLANETILER_JAR" ]; then
    echo "FEHLER: PLANETILER_JAR=\"$PLANETILER_JAR\" existiert nicht." >&2
    echo "Herunterladen mit:" >&2
    echo "  curl -fL -o planetiler.jar \\" >&2
    echo "    https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar" >&2
    exit 1
  fi
  if ! command -v java >/dev/null 2>&1; then
    echo "FEHLER: PLANETILER_JAR gesetzt, aber kein java im PATH." >&2
    echo "planetiler braucht eine JRE (17+). Ohne Java bleibt nur der" >&2
    echo "Docker-Weg (PLANETILER_JAR leer lassen)." >&2
    exit 1
  fi
  # Die Argumente zeigen auf /data (Container-Sicht); im JAR-Modus gibt es
  # kein Mount, also auf die echten Pfade umbiegen.
  #
  # REIHENFOLGE IST HIER WESENTLICH: erst `/data`, dann `%SOURCES%`. Umgekehrt
  # wuerde die /data-Ersetzung in den gerade eingesetzten Quellen-Pfad
  # hineinschlagen, sobald dieser selbst `/data` enthaelt -- im Repo-Fall
  # (`<repo>/data/planetiler-sources`) ist das der Normalfall. Der Platzhalter
  # `%SOURCES%` enthaelt kein `/data` und ueberlebt den ersten Schritt
  # unversehrt.
  JAR_ARGV=()
  for a in "${PLANETILER_ARGV[@]}"; do
    a="${a//\/data/$WORK_DIR}"
    JAR_ARGV+=("${a//%SOURCES%/$SOURCES_DIR}")
  done
  RUN_CMD=(java "-Xmx$PLANETILER_XMX" -jar "$PLANETILER_JAR" "${JAR_ARGV[@]}")
else
  DOCKER_ARGV=()
  for a in "${PLANETILER_ARGV[@]}"; do DOCKER_ARGV+=("${a//%SOURCES%//sources}"); done
  RUN_CMD=(docker run --rm
    -e JAVA_TOOL_OPTIONS="-Xmx$PLANETILER_XMX"
    -v "$WORK_DIR:/data"
    -v "$SOURCES_DIR:/sources"
    "$PLANETILER_IMAGE"
    "${DOCKER_ARGV[@]}")
fi

if ! "${RUN_CMD[@]}"; then
  echo "FEHLER: planetiler-Lauf fehlgeschlagen." >&2
  echo "Haeufigste Ursachen: zu wenig RAM (PLANETILER_XMX erhoehen), zu wenig" >&2
  echo "Plattenplatz unter ${TMPDIR:-/tmp}, oder eine abweichende planetiler-CLI." >&2
  echo "Im letzten Fall die Argumente per PLANETILER_ARGS setzen, ohne dieses" >&2
  echo "Skript zu aendern -- siehe services/tiles/README.md." >&2
  exit 1
fi

# --- Erzeugnis pruefen -------------------------------------------------------
BUILT_FILE="$WORK_DIR/$OUT_NAME"
if [ ! -f "$BUILT_FILE" ]; then
  echo "FEHLER: planetiler meldete Erfolg, aber $OUT_NAME wurde nicht erzeugt." >&2
  echo "Vermutlich zeigt --output= auf einen anderen Pfad (PLANETILER_ARGS pruefen)." >&2
  exit 1
fi

if [ ! -s "$BUILT_FILE" ]; then
  echo "FEHLER: die erzeugte Datei ist leer." >&2
  exit 1
fi

# PMTiles v3 beginnt mit der ASCII-Signatur "PM" (siehe
# apps/core/src/map/pmtiles-metadata.ts, das exakt dieselbe Pruefung macht,
# bevor es eine Region als installiert listet). Ohne diese Pruefung wuerde
# z. B. eine HTML-Fehlerseite als Karte "installiert".
MAGIC="$(head -c 2 "$BUILT_FILE")"
if [ "$MAGIC" != "PM" ]; then
  echo "FEHLER: die erzeugte Datei ist keine PMTiles-Datei (Signatur \"$MAGIC\" statt \"PM\")." >&2
  echo "Der Core wuerde sie ignorieren. Es wurde NICHTS eingetauscht." >&2
  exit 1
fi

# --- Atomischer Swap (W-17) --------------------------------------------------
# `mv` innerhalb desselben Dateisystems ist ein reiner rename(2)-Syscall:
# atomar, kein halbfertiger Zwischenzustand fuer einen parallel lesenden
# Core-Prozess. Deshalb wird zuerst NEBEN das Ziel kopiert (der Weg ueber
# $WORK_DIR kann ein anderes Dateisystem kreuzen) und dann umbenannt.
STAGING_FILE="$TILES_DIR/.$REGION_ID.pmtiles.new"
rm -f "$STAGING_FILE"
cp "$BUILT_FILE" "$STAGING_FILE"
mv "$STAGING_FILE" "$OUTPUT_FILE"

BYTES="$(wc -c < "$OUTPUT_FILE" | tr -d ' ')"
echo "Fertig: $OUTPUT_FILE ($BYTES Bytes)"
echo "Die Region \"$REGION_ID\" ist damit installiert -- kein Neustart noetig."
echo "In der App unter \"Kartenregionen verwalten\" bzw. \"Systempruefung\" sichtbar."
