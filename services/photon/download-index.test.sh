#!/usr/bin/env bash
#
# download-index.test.sh — Fixture-Test fuer download-index.sh: Resume
# (HTTP-Range) + Checksummen-Pflicht + atomarer Install, komplett OFFLINE
# gegen einen lokalen Loopback-HTTP-Server (127.0.0.1) -- kein echtes
# Netzwerk noetig. Deckt den Pflicht-Test "Skript-Test mit Abbruch-Fixture"
# und Akzeptanz #3 ("Download-Resume nachgewiesen") ab.
#
# Ehrlich gesagt: dies beweist NUR die Skript-LOGIK (Resume-Mechanik,
# Checksummen-Verifikation, atomarer Swap) gegen einen synthetischen
# Loopback-Server, der absichtlich Range-Requests korrekt beantwortet -- es
# beweist NICHT, dass die echten Photon-Dump-Server (graphhopper/r2) exakt so
# reagieren. Das ist eine reale Grenze dieses Sandbox-Tests (kein
# Internetzugriff hier) und wird in services/photon/README.md so dokumentiert.
#
# Usage: services/photon/download-index.test.sh
# Exit 0 wenn alle Tests bestehen, exit 1 sonst (mit FAIL-Zeilen auf stderr).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOAD_SCRIPT="$SCRIPT_DIR/download-index.sh"

command -v python3 >/dev/null 2>&1 || { echo "FEHLER: python3 nicht im PATH gefunden (fuer den lokalen Test-HTTP-Server)." >&2; exit 1; }

WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

FAILS=0
pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1" >&2
  FAILS=$((FAILS + 1))
}

# --- Fixture-Archiv bauen ----------------------------------------------------
FIXTURE_SRC="$WORK/fixture_src"
mkdir -p "$FIXTURE_SRC/photon_data"
echo "fake-lucene-index-marker" > "$FIXTURE_SRC/photon_data/marker.txt"
# Ein paar hundert KB Fuellmasse, damit ein Range-Resume ueberhaupt etwas zu
# tun hat (ein winziges Archiv liesse sich in einem einzigen Request laden,
# ohne dass ein Resume-Pfad je genommen wird).
head -c 300000 /dev/urandom > "$FIXTURE_SRC/photon_data/blob.bin"

SERVE_ROOT="$WORK/serve"
mkdir -p "$SERVE_ROOT"
ARCHIVE_NAME="photon-db-test-latest.tar.bz2"
tar -cjf "$SERVE_ROOT/$ARCHIVE_NAME" -C "$FIXTURE_SRC" photon_data
md5sum "$SERVE_ROOT/$ARCHIVE_NAME" | awk '{print $1}' > "$SERVE_ROOT/$ARCHIVE_NAME.md5"
ARCHIVE_SIZE="$(stat -c '%s' "$SERVE_ROOT/$ARCHIVE_NAME" 2>/dev/null || stat -f '%z' "$SERVE_ROOT/$ARCHIVE_NAME")"

# --- Range-faehiger lokaler HTTP-Server --------------------------------------
# python3's eingebauter http.server unterstuetzt Range-Requests nicht
# zuverlaessig versionsuebergreifend -- ein winziger eigener Handler stellt
# sicher, dass `curl -C -` (Range: bytes=N-) hier tatsaechlich getestet wird,
# und protokolliert jede Anfrage (Pfad + Range-Header + gesendete Bytes) nach
# stderr, damit der Test unten nachweisen kann, dass ein Resume wirklich nur
# den REST der Datei nachgeladen hat (nicht alles neu).
cat > "$WORK/range_server.py" <<'PYEOF'
import http.server
import os
import sys

root = sys.argv[1]
port = int(sys.argv[2])


class RangeHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        rel = self.path.lstrip("/")
        fpath = os.path.join(root, rel)
        if not os.path.isfile(fpath):
            self.send_response(404)
            self.end_headers()
            return
        size = os.path.getsize(fpath)
        range_header = self.headers.get("Range")
        start = 0
        if range_header and range_header.startswith("bytes="):
            spec = range_header[len("bytes="):].split("-")[0]
            if spec:
                start = int(spec)
        with open(fpath, "rb") as f:
            f.seek(start)
            data = f.read()
        if range_header and start > 0:
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{size - 1}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(data)
        sys.stderr.write(f"REQLOG path={rel} range={range_header} sent={len(data)}\n")
        sys.stderr.flush()

    def log_message(self, fmt, *args):
        pass  # eigenes REQLOG statt Standard-Zugriffslog


http.server.HTTPServer(("127.0.0.1", port), RangeHandler).serve_forever()
PYEOF

PORT=18422
SERVER_LOG="$WORK/server.log"
python3 "$WORK/range_server.py" "$SERVE_ROOT" "$PORT" 2>"$SERVER_LOG" &
SERVER_PID=$!

# Warten bis der Server tatsaechlich antwortet, statt eines festen Sleeps.
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/$ARCHIVE_NAME.md5" >/dev/null 2>&1 && break
  sleep 0.1
done

BASE_URL="http://127.0.0.1:$PORT"

# ============================================================================
# Test 1: happy path -- sauberer Download, Checksumme OK, atomarer Install.
# ============================================================================
T1_DATA="$WORK/t1/photon_data"
if PHOTON_DATA_DIR="$T1_DATA" PHOTON_INDEX_URL="$BASE_URL/$ARCHIVE_NAME" \
  "$DOWNLOAD_SCRIPT" test >"$WORK/t1.out" 2>&1; then
  if [ -f "$T1_DATA/marker.txt" ] && [ -f "$T1_DATA/blob.bin" ]; then
    pass "Test 1: happy path installiert den Index atomar"
  else
    fail "Test 1: Skript meldete Erfolg, aber $T1_DATA fehlt Dateien"
    cat "$WORK/t1.out" >&2
  fi
else
  fail "Test 1: happy-path-Download ist fehlgeschlagen (sollte erfolgreich sein)"
  cat "$WORK/t1.out" >&2
fi

# ============================================================================
# Test 2: Resume -- ein vorab abgelegter Teil-Download wird per `curl -C -`
# fortgesetzt, nicht neu gestartet.
# ============================================================================
T2_DATA="$WORK/t2/photon_data"
T2_DOWNLOAD_DIR="$WORK/t2/.download"
mkdir -p "$T2_DOWNLOAD_DIR"
# Exakt derselbe Tmp-Pfad, den download-index.sh selbst verwenden wuerde
# (basename der URL im .download-Verzeichnis neben photon_data).
PARTIAL_BYTES=100000
head -c "$PARTIAL_BYTES" "$SERVE_ROOT/$ARCHIVE_NAME" > "$T2_DOWNLOAD_DIR/$ARCHIVE_NAME"

# Statt den Log zu leeren (ein `: > "$SERVER_LOG"` waehrend der Server-Prozess
# noch denselben Filehandle offen haelt, erzeugt eine sparse/NUL-korrumpierte
# Datei -- der laufende Python-Prozess schreibt danach weiter an seiner alten
# Offset-Position) wird nur der Byte-Offset VOR Test 2 gemerkt und danach nur
# der NEUE Log-Abschnitt ausgewertet.
LOG_OFFSET_BEFORE="$(stat -c '%s' "$SERVER_LOG" 2>/dev/null || stat -f '%z' "$SERVER_LOG" 2>/dev/null || echo 0)"
if PHOTON_DATA_DIR="$T2_DATA" PHOTON_INDEX_URL="$BASE_URL/$ARCHIVE_NAME" \
  "$DOWNLOAD_SCRIPT" test >"$WORK/t2.out" 2>&1; then
  if [ -f "$T2_DATA/marker.txt" ] && [ -f "$T2_DATA/blob.bin" ]; then
    pass "Test 2a: Resume-Download landet in einem korrekt installierten Index"
  else
    fail "Test 2a: Skript meldete Erfolg, aber $T2_DATA fehlt Dateien nach Resume"
  fi
  # Beweis, dass es sich WIRKLICH um einen Resume handelte: der (neue
  # Abschnitt des) Server-Log muss eine Anfrage mit Range-Header zeigen,
  # deren gesendete Byte-Anzahl kleiner als die volle Archivgroesse ist
  # (sonst waere es ein kompletter Neu-Download gewesen).
  tail -c "+$((LOG_OFFSET_BEFORE + 1))" "$SERVER_LOG" > "$WORK/t2_server.log"
  if grep -aq "REQLOG path=$ARCHIVE_NAME range=bytes=" "$WORK/t2_server.log"; then
    SENT="$(grep -a "REQLOG path=$ARCHIVE_NAME range=bytes=" "$WORK/t2_server.log" | head -n1 | sed -n 's/.*sent=\([0-9]*\).*/\1/p')"
    if [ -n "$SENT" ] && [ "$SENT" -lt "$ARCHIVE_SIZE" ]; then
      pass "Test 2b: Server-Log beweist einen echten Range-Resume (gesendet $SENT von $ARCHIVE_SIZE Bytes, nicht neu von 0)"
    else
      fail "Test 2b: Range-Request gesehen, aber gesendete Byte-Anzahl ($SENT) nicht < Archivgroesse ($ARCHIVE_SIZE)"
    fi
  else
    fail "Test 2b: kein Range-Request im Server-Log gefunden -- Resume hat nicht wie erwartet stattgefunden"
    cat -v "$WORK/t2_server.log" >&2
  fi
else
  fail "Test 2: Resume-Download ist fehlgeschlagen (sollte erfolgreich fortsetzen)"
  cat "$WORK/t2.out" >&2
fi

# ============================================================================
# Test 3: Checksummen-Mismatch -> lauter Fehler, NICHTS wird installiert.
# ============================================================================
T3_DATA="$WORK/t3/photon_data"
BAD_MD5_URL="$BASE_URL/bad-checksum-does-not-exist.md5"
if PHOTON_DATA_DIR="$T3_DATA" PHOTON_INDEX_URL="$BASE_URL/$ARCHIVE_NAME" \
  PHOTON_INDEX_SHA256="0000000000000000000000000000000000000000000000000000000000000" \
  "$DOWNLOAD_SCRIPT" test >"$WORK/t3.out" 2>&1; then
  fail "Test 3: Skript hat trotz falscher Checksumme Erfolg gemeldet (sollte fehlschlagen)"
else
  if [ ! -e "$T3_DATA" ]; then
    pass "Test 3: falsche Checksumme fuehrt zu lautem Fehler, nichts installiert"
  else
    fail "Test 3: Skript ist fehlgeschlagen, aber $T3_DATA existiert trotzdem"
  fi
  grep -qi "checksumme stimmt nicht" "$WORK/t3.out" || fail "Test 3: Fehlermeldung nennt nicht klar die Checksummen-Ursache"
fi

# ============================================================================
# Test 4: ein vorhandener guter Index bleibt bei einem fehlgeschlagenen
# Re-Download-Versuch UNANGETASTET (atomare Sicherheit, wie build-tiles.sh).
# ============================================================================
T4_DATA="$WORK/t4/photon_data"
mkdir -p "$T4_DATA"
echo "existing-good-index" > "$T4_DATA/sentinel.txt"
if PHOTON_DATA_DIR="$T4_DATA" PHOTON_INDEX_URL="$BASE_URL/$ARCHIVE_NAME" \
  PHOTON_INDEX_SHA256="0000000000000000000000000000000000000000000000000000000000000" \
  "$DOWNLOAD_SCRIPT" test >"$WORK/t4.out" 2>&1; then
  fail "Test 4: Skript hat trotz falscher Checksumme Erfolg gemeldet"
else
  if [ -f "$T4_DATA/sentinel.txt" ] && [ "$(cat "$T4_DATA/sentinel.txt")" = "existing-good-index" ]; then
    pass "Test 4: bestehender guter Index bleibt nach fehlgeschlagenem Re-Download unangetastet"
  else
    fail "Test 4: bestehender Index wurde durch den fehlgeschlagenen Versuch beschaedigt/entfernt"
  fi
fi

# ============================================================================
# Test 5: PHOTON_ALLOW_UNVERIFIED=1 installiert bewusst OHNE Checksumme, wenn
# weder Sidecar noch SHA256 verfuegbar sind (explizites Opt-in, keine
# versteckte Standardeinstellung).
# ============================================================================
T5_DATA="$WORK/t5/photon_data"
if PHOTON_DATA_DIR="$T5_DATA" PHOTON_INDEX_URL="$BASE_URL/$ARCHIVE_NAME" \
  PHOTON_INDEX_CHECKSUM_URL="$BAD_MD5_URL" \
  PHOTON_ALLOW_UNVERIFIED=1 \
  "$DOWNLOAD_SCRIPT" test >"$WORK/t5.out" 2>&1; then
  if [ -f "$T5_DATA/marker.txt" ]; then
    grep -qi "unverifiziert" "$WORK/t5.out" && pass "Test 5: PHOTON_ALLOW_UNVERIFIED=1 installiert mit lauter Warnung, ohne Checksumme" \
      || fail "Test 5: Installation ohne Checksumme lief durch, aber ohne die erwartete Warnung"
  else
    fail "Test 5: Skript meldete Erfolg, aber $T5_DATA fehlt Dateien"
  fi
else
  fail "Test 5: sollte mit PHOTON_ALLOW_UNVERIFIED=1 trotz fehlender Checksumme erfolgreich sein"
  cat "$WORK/t5.out" >&2
fi

# ============================================================================
echo
if [ "$FAILS" -eq 0 ]; then
  echo "ALLE FIXTURE-TESTS BESTANDEN (download-index.sh: Resume + Checksumme + atomarer Swap)"
  exit 0
else
  echo "$FAILS FIXTURE-TEST(S) FEHLGESCHLAGEN" >&2
  exit 1
fi
