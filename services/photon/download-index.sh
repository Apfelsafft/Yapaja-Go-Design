#!/usr/bin/env bash
#
# download-index.sh — Laedt einen Photon-Suchindex fuer ein Land/eine Region
# herunter und installiert ihn atomar nach data/photon/photon_data (E05-T4).
#
# Quelle: die von komoot/photon offiziell verlinkten Dumps
# (https://download1.graphhopper.com/public, "planet" + "selected country
# datasets") bzw. der von rtuszik/photon-docker (das in docker-compose.yml
# verwendete Image) genutzte Spiegel-Mirror (Default-BASE_URL unten, siehe
# services/photon/README.md fuer die vollstaendige Recherche-Notiz). BEIDE
# Quellen liefern nur GROSSE Laender/Kontinente als vorgebaute Indizes --
# Liechtenstein alleine gibt es dort NICHT (nur "switzerland-liechtenstein"
# als experimentelles JSONL-Dump, kein fertiger DB-Index). Fuer CI heisst das:
# dieses Skript ist fuer echte Laender-Downloads gedacht (Betrieb/Nightly),
# nicht fuer einen schnellen LI-Build wie services/valhalla/build-tiles.sh
# ihn hinbekommt -- Details/Konsequenzen in README.md.
#
# Usage:
#   services/photon/download-index.sh <country>
#
# Beispiele:
#   services/photon/download-index.sh germany
#   PHOTON_INDEX_URL=https://example.invalid/photon-db-li-latest.tar.bz2 \
#     services/photon/download-index.sh li
#
# Ablauf (bewusst identische Disziplin wie services/valhalla/build-tiles.sh):
#   1. Download in einen STABIL benannten Tmp-Pfad
#      (data/photon/.download/<basename-der-url>) mit `curl -C -` -- ein
#      Abbruch+Neustart des Skripts setzt den Download an genau der Stelle
#      fort, an der er abgebrochen ist (kein Neustart bei Timeout/LTE-Abbruch,
#      W-17-Analogie). `-C -` funktioniert, weil derselbe Tmp-Pfad bei jedem
#      Versuch wiederverwendet wird (nicht `mktemp`).
#   2. Checksummen-Verifikation: entweder MD5 aus der Sidecar-Datei
#      "<url>.md5" (Standardfall bei Photon-Dumps) oder eine manuell
#      gepinnte SHA256 (PHOTON_INDEX_SHA256). Eine fehlende/nicht erreichbare
#      Checksumme fuehrt zu einem LAUTEN Fehler -- niemals stillschweigend
#      unverifiziert installieren (Ausnahme: explizites
#      PHOTON_ALLOW_UNVERIFIED=1, siehe unten, nicht empfohlen).
#   3. Erst nach bestandener Pruefung: Entpacken in ein Staging-Verzeichnis,
#      dann atomarer Swap (rename(2)) nach data/photon/photon_data. Schlaegt
#      irgendein Schritt VOR dem Swap fehl, bleibt ein vorhandener Live-Index
#      unangetastet. Bricht der Swap selbst mitten im Rename ab, wird der
#      alte Stand aus dem .old-Verzeichnis automatisch wiederhergestellt.
#
# Env-Overrides:
#   PHOTON_INDEX_BASE_URL     Basis-URL fuer die Vorlage
#                              "<BASE_URL>/photon-db-<country>-latest.tar.bz2"
#                              (Default: https://r2.koalasec.org/public, der
#                              von rtuszik/photon-docker genutzte Spiegel).
#   PHOTON_INDEX_URL           Exakte Download-URL, ueberschreibt die Vorlage
#                              komplett -- notwendig, sobald die geratene
#                              Namenskonvention fuer ein konkretes Land nicht
#                              passt (unbestaetigt, siehe README.md).
#   PHOTON_INDEX_CHECKSUM_URL  Checksummen-Sidecar-URL
#                              (Default: "<url>.md5").
#   PHOTON_INDEX_SHA256        Manuell gepinnter SHA256-Hash. Wenn gesetzt,
#                              wird DIESER statt der Remote-.md5-Datei
#                              geprueft.
#   PHOTON_ALLOW_UNVERIFIED    "1" erlaubt die Installation OHNE jede
#                              Checksumme, falls weder Sidecar noch
#                              PHOTON_INDEX_SHA256 verfuegbar sind. Nur fuer
#                              Testzwecke -- druckt eine deutliche Warnung.
#   PHOTON_DATA_DIR            Zielpfad fuer den Live-Index
#                              (Default: data/photon/photon_data, wie in
#                              docker-compose.yml gemountet).
#   PHOTON_DOWNLOAD_RETRIES    Anzahl Gesamtversuche bei Verbindungsfehlern
#                              (Default: 5). Jeder Versuch setzt via `-C -`
#                              am vorherigen Tmp-Stand fort.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DATA_DIR="${PHOTON_DATA_DIR:-$REPO_ROOT/data/photon/photon_data}"
DATA_PARENT="$(dirname "$DATA_DIR")"
DOWNLOAD_DIR="$DATA_PARENT/.download"
RAW_EXTRACT_DIR="$DATA_PARENT/.raw-extract"
NEW_DIR="${DATA_DIR}.new"
OLD_DIR="${DATA_DIR}.old"

BASE_URL="${PHOTON_INDEX_BASE_URL:-https://r2.koalasec.org/public}"
RETRIES="${PHOTON_DOWNLOAD_RETRIES:-5}"

usage() {
  cat <<'EOF'
Usage: services/photon/download-index.sh <country>

Laedt einen vorgebauten Photon-Suchindex fuer <country> herunter (Resume via
curl -C -, Checksummen-Pflicht) und installiert ihn atomar nach
data/photon/photon_data.

Beispiele:
  services/photon/download-index.sh germany
  PHOTON_INDEX_URL=https://example.invalid/photon-db-li-latest.tar.bz2 \
    services/photon/download-index.sh li

Env-Overrides: siehe Kommentarblock im Skript-Header oder services/photon/README.md.
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

COUNTRY="$1"

command -v curl >/dev/null 2>&1 || { echo "FEHLER: curl nicht im PATH gefunden." >&2; exit 1; }
command -v tar >/dev/null 2>&1 || { echo "FEHLER: tar nicht im PATH gefunden." >&2; exit 1; }
command -v md5sum >/dev/null 2>&1 || { echo "FEHLER: md5sum nicht im PATH gefunden." >&2; exit 1; }

URL="${PHOTON_INDEX_URL:-${BASE_URL}/photon-db-${COUNTRY}-latest.tar.bz2}"
CHECKSUM_URL="${PHOTON_INDEX_CHECKSUM_URL:-${URL}.md5}"

mkdir -p "$DOWNLOAD_DIR" "$DATA_PARENT"

ARCHIVE="$DOWNLOAD_DIR/$(basename "$URL")"
CHECKSUM_FILE="$ARCHIVE.md5"

# Einheitlicher Exit-Handler: raeumt Staging-Reste auf und stellt -- falls
# der atomare Swap weiter unten mitten im Rename-Schritt unterbrochen werden
# sollte -- den vorherigen Index-Stand aus OLD_DIR automatisch wieder her
# (identisches Muster zu services/valhalla/build-tiles.sh).
on_exit() {
  local ec=$?
  if [ ! -e "$DATA_DIR" ] && [ -d "$OLD_DIR" ]; then
    echo "Stelle vorherigen Photon-Index aus $OLD_DIR wieder her (Swap unvollstaendig)." >&2
    if mv "$OLD_DIR" "$DATA_DIR" 2>/dev/null; then
      echo "Wiederherstellung erfolgreich." >&2
    else
      echo "KRITISCH: automatische Wiederherstellung fehlgeschlagen -- bitte manuell pruefen: $OLD_DIR -> $DATA_DIR" >&2
    fi
  fi
  exit "$ec"
}
trap on_exit EXIT

# --- 1. Download, resume-faehig ---------------------------------------------
# $ARCHIVE ist ein STABILER Pfad (kein mktemp) -- ein vorheriger Teil-Download
# an genau dieser Stelle wird von `curl -C -` erkannt und fortgesetzt statt neu
# gestartet. Funktioniert, solange der Server Range-Requests unterstuetzt
# (uebliche statische Dateiserver/CDNs tun das; unser Fixture-Test
# download-index.test.sh implementiert das gezielt gegen einen lokalen
# Loopback-Server, um genau dieses Verhalten offline nachzuweisen).
echo "Lade Photon-Index fuer '$COUNTRY' von $URL nach $ARCHIVE ..."
attempt=1
while true; do
  if curl -fL --retry 2 --retry-delay 5 -C - -o "$ARCHIVE" "$URL"; then
    break
  fi
  if [ "$attempt" -ge "$RETRIES" ]; then
    echo "FEHLER: Download von $URL nach $RETRIES Versuch(en) fehlgeschlagen (Resume via -C - wurde bei jedem Versuch probiert)." >&2
    exit 1
  fi
  echo "Download-Versuch $attempt fehlgeschlagen -- resume + retry (Versuch $((attempt + 1))/$RETRIES) ..." >&2
  attempt=$((attempt + 1))
  sleep 3
done

test -s "$ARCHIVE" || { echo "FEHLER: $ARCHIVE ist nach dem Download leer." >&2; exit 1; }

# --- 2. Checksummen-Pflicht --------------------------------------------------
echo "Verifiziere Checksumme ..."
if [ -n "${PHOTON_INDEX_SHA256:-}" ]; then
  ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  if [ "$ACTUAL_SHA256" != "$PHOTON_INDEX_SHA256" ]; then
    echo "FEHLER: SHA256-Checksumme stimmt nicht (erwartet $PHOTON_INDEX_SHA256, erhalten $ACTUAL_SHA256) -- Installation abgebrochen, $ARCHIVE bleibt liegen (fuer Diagnose)." >&2
    exit 1
  fi
  echo "SHA256 OK (PHOTON_INDEX_SHA256)."
elif curl -fsL -o "$CHECKSUM_FILE" "$CHECKSUM_URL" 2>/dev/null; then
  # Veroeffentlichte .md5-Sidecar-Dateien enthalten entweder nur den Hash
  # oder "hash  dateiname" -- in beiden Faellen liefert das erste Feld den Hash.
  EXPECTED_MD5="$(awk '{print $1}' "$CHECKSUM_FILE" | head -n1)"
  ACTUAL_MD5="$(md5sum "$ARCHIVE" | awk '{print $1}')"
  if [ -z "$EXPECTED_MD5" ] || [ "$EXPECTED_MD5" != "$ACTUAL_MD5" ]; then
    echo "FEHLER: MD5-Checksumme stimmt nicht (erwartet '$EXPECTED_MD5' aus $CHECKSUM_URL, erhalten '$ACTUAL_MD5') -- Installation abgebrochen, $ARCHIVE bleibt liegen (fuer Diagnose)." >&2
    exit 1
  fi
  echo "MD5 OK ($CHECKSUM_URL)."
else
  if [ "${PHOTON_ALLOW_UNVERIFIED:-}" = "1" ]; then
    echo "WARNUNG: keine Checksumme verfuegbar ($CHECKSUM_URL nicht erreichbar) -- PHOTON_ALLOW_UNVERIFIED=1 gesetzt, installiere trotzdem UNVERIFIZIERT. Nicht fuer den Produktivbetrieb empfohlen." >&2
  else
    echo "FEHLER: keine Checksumme verfuegbar ($CHECKSUM_URL nicht erreichbar) und PHOTON_INDEX_SHA256 nicht gesetzt -- Installation abgebrochen (keine stillen Fehler)." >&2
    echo "        Zum bewussten Ueberspringen (NICHT empfohlen): PHOTON_ALLOW_UNVERIFIED=1 setzen." >&2
    exit 1
  fi
fi

# --- 3. Entpacken + atomarer Swap -------------------------------------------
echo "Entpacke $ARCHIVE ..."
rm -rf "$RAW_EXTRACT_DIR"
mkdir -p "$RAW_EXTRACT_DIR"
tar -xjf "$ARCHIVE" -C "$RAW_EXTRACT_DIR"

test -n "$(find "$RAW_EXTRACT_DIR" -mindepth 1 -print -quit)" || {
  echo "FEHLER: $RAW_EXTRACT_DIR ist nach dem Entpacken leer -- das Archiv hat offenbar nichts geschrieben." >&2
  exit 1
}

# Photon-Dumps koennen ein einzelnes Wurzelverzeichnis (z.B. "photon_data/")
# ODER die Index-Dateien direkt im Archiv-Root enthalten -- beide Layouts
# werden unterstuetzt statt eine Struktur zu erraten (unbestaetigtes Detail
# der offiziellen/gespiegelten Dumps, siehe README.md).
ENTRIES=("$RAW_EXTRACT_DIR"/*)
if [ "${#ENTRIES[@]}" -eq 1 ] && [ -d "${ENTRIES[0]}" ]; then
  SOURCE_DIR="${ENTRIES[0]}"
else
  SOURCE_DIR="$RAW_EXTRACT_DIR"
fi

rm -rf "$NEW_DIR"
mkdir -p "$(dirname "$NEW_DIR")"
mv "$SOURCE_DIR" "$NEW_DIR"
rm -rf "$RAW_EXTRACT_DIR"

echo "Schwenke $NEW_DIR -> $DATA_DIR (atomar) ..."
rm -rf "$OLD_DIR"
if [ -d "$DATA_DIR" ]; then
  mv "$DATA_DIR" "$OLD_DIR"
fi
mv "$NEW_DIR" "$DATA_DIR"
rm -rf "$OLD_DIR"

# Download-Artefakte aufraeumen -- nur nach vollstaendigem Erfolg.
rm -f "$ARCHIVE" "$CHECKSUM_FILE"

echo "Fertig: $DATA_DIR"
echo "Damit ein laufender docker-compose-Service (Profil 'search') den neuen Index einliest:"
echo "  docker compose restart photon"
