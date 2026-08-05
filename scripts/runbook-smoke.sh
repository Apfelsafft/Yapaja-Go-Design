#!/usr/bin/env bash
#
# runbook-smoke.sh — Rauchtest fuer docs/data-update-runbook.md (E10-T3,
# Pflicht-Test der Aufgabe: "Runbook-Smoke als Skript").
#
# ─── Zweck ────────────────────────────────────────────────────────────────────
# Ein Runbook, das niemand ausfuehrt, verrottet still: ein Skript wird
# umbenannt, ein Workflow-Job faellt weg, ein Kommando aendert seine Optionen —
# und das Dokument behauptet weiter, der Prozess funktioniere. Dieses Skript
# laeuft die Schritte des Runbooks in REDUZIERTER Form ab (Fixtures statt
# 4-GB-PBF, Stub-Router statt Valhalla-Graph) und wird in CI ausgefuehrt.
#
# ─── Was echt ist und was reduziert ──────────────────────────────────────────
# Jeder Schritt sagt selbst an, was er tut. Zusammengefasst:
#   S1  Praeflug            ECHT       jede vom Runbook genannte Datei/jeder
#                                      Workflow-Job existiert und ist ausfuehrbar
#   S2  PBF -> Provenienz   REDUZIERT  synthetische Kandidaten statt osmium+PBF;
#                                      die AUSWERTUNG ist echt (dieselbe CLI)
#   S3  Graph-Swap (W-17)   REDUZIERT  nur der Fehlerpfad: build-tiles.sh bricht
#                                      ohne Docker ab und laesst den Live-Stand
#                                      data/valhalla/tiles NACHWEISLICH intakt
#   S4  Lite-Index          ECHT       echte SQLite-FTS5-DB aus Fixture-Daten,
#                                      inklusive atomarem rename
#   S5  Abnahme-Gate gruen  ECHT       echter Core + echter Runner gegen den Stub
#   S6  Abnahme-Gate ROT    ECHT       derselbe Lauf mit "verlorener" Restriktion
#                                      MUSS fehlschlagen -- das ist der Beweis,
#                                      dass ein Datenupdate mit OSM-Regression
#                                      nicht durchkommt
#
# Nicht abgedeckt (strukturell unmoeglich ohne Docker/Netz, siehe Runbook §7):
# der echte PBF-Download, der echte Valhalla-Graph-Bau und der echte
# PMTiles-Download. Das Skript behauptet an keiner Stelle, diese getan zu haben.
#
# ─── Usage ────────────────────────────────────────────────────────────────────
#   scripts/runbook-smoke.sh            # alle Schritte
#   RUNBOOK_SMOKE_SKIP_LIVE=1 scripts/runbook-smoke.sh
#                                       # ohne S5/S6 (kein `pnpm build` noetig)
#
# Voraussetzungen: node, pnpm, curl; fuer S5/S6 zusaetzlich ein gebautes
# apps/core (`pnpm build`). Ports 8002 (Stub) und 8080 (Core) muessen frei sein
# bzw. koennen ueber SMOKE_STUB_PORT / SMOKE_CORE_PORT verschoben werden.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

TMP_DIR="$REPO_ROOT/e2e/golden-routes/.tmp/runbook-smoke"
STUB_PORT="${SMOKE_STUB_PORT:-8002}"
CORE_PORT="${SMOKE_CORE_PORT:-8080}"
FIXTURE_ROUTES="$REPO_ROOT/e2e/golden-routes/__fixtures__/runbook-smoke-routes.json"
TSX="$REPO_ROOT/apps/core/node_modules/.bin/tsx"

FAILURES=0
STEP=0

log()  { printf '%s\n' "$*"; }
step() { STEP=$((STEP + 1)); printf '\n=== S%d  %s ===\n' "$STEP" "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
skip() { printf '  [SKIP] %s\n' "$*"; }

STUB_PID=""
CORE_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  [ -n "$CORE_PID" ] && kill "$CORE_PID" 2>/dev/null
  wait 2>/dev/null
  return 0
}
trap cleanup EXIT

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

log "Runbook-Rauchtest — docs/data-update-runbook.md"
log "Repo: $REPO_ROOT"

# ─────────────────────────────────────────────────────────────────────────────
step "Praeflug: existiert alles, was das Runbook benennt? (ECHT)"

require_file() {
  if [ -f "$1" ]; then ok "vorhanden: $1"; else fail "FEHLT: $1 (Runbook verweist darauf)"; fi
}
require_exec() {
  if [ -x "$1" ]; then ok "ausfuehrbar: $1"; else fail "nicht ausfuehrbar/fehlt: $1"; fi
}
require_grep() {
  # $1 = Datei, $2 = Muster, $3 = Beschreibung
  if grep -q -- "$2" "$1" 2>/dev/null; then ok "$3"; else fail "$3 — Muster '$2' nicht in $1"; fi
}

require_file "docs/data-update-runbook.md"
require_exec "services/valhalla/build-tiles.sh"
require_exec "services/valhalla/build-lite-index.sh"
require_exec "scripts/osm-restriction-provenance.sh"
require_file "e2e/golden-routes.json"
require_file "$FIXTURE_ROUTES"
require_file "e2e/golden-routes/stubValhalla.ts"
require_grep ".github/workflows/nightly.yml" "golden-routes-de" "nightly-Job golden-routes-de ist verdrahtet"
require_grep ".github/workflows/nightly.yml" "osm-restriction-provenance.sh" "Provenienz-Schritt haengt im nightly-Job"
require_grep ".github/workflows/nightly.yml" "runbook-smoke.sh" "dieser Rauchtest laeuft selbst in CI"
require_grep ".github/workflows/ci.yml" "golden-routes-li" "per-PR-Gate golden-routes-li existiert weiterhin"
# Die W-17-Zusage des Runbooks steht und faellt mit dem `mv`-Swap.
require_grep "services/valhalla/build-tiles.sh" "tiles.new" "build-tiles.sh baut in ein TEMP-Verzeichnis"

# ─────────────────────────────────────────────────────────────────────────────
step "Neue PBF -> Restriktions-Provenienz (REDUZIERT: synthetische Kandidaten, echte Auswertung)"

CAND="$TMP_DIR/candidates.geojsonseq"
# Ein Mini-"Extrakt" in genau dem Format, das
# `osmium export -f geojsonseq --add-unique-id=type_id` liefert. Bewusst
# SYNTHETISCH und ausserhalb jeder echten forbidden_bbox: der Rauchtest prueft
# die Pipeline, nicht die Kartendaten -- er darf auf keinen Fall Belege ueber
# OSM erzeugen.
cat > "$CAND" <<'EOF'
{"type":"Feature","properties":{"@id":"w900001","maxheight":"3.2","highway":"residential","name":"SMOKE Unterfuehrung"},"geometry":{"type":"LineString","coordinates":[[11.004,48.0],[11.006,48.0]]}}
{"type":"Feature","properties":{"@id":"w900002","maxweight":"3.5","highway":"unclassified","name":"SMOKE Bruecke"},"geometry":{"type":"LineString","coordinates":[[11.02,48.0],[11.021,48.0]]}}
{"type":"Feature","properties":{"@id":"w900003","maxwidth":"2.1","highway":"residential","name":"SMOKE Stadttor"},"geometry":{"type":"LineString","coordinates":[[11.03,48.0],[11.031,48.0]]}}
{"type":"Feature","properties":{"@id":"w900004","maxheight":"default","highway":"residential"},"geometry":{"type":"LineString","coordinates":[[11.04,48.0],[11.041,48.0]]}}
EOF

if [ ! -x "$TSX" ]; then
  fail "tsx nicht gefunden ($TSX) — 'pnpm install' fehlt?"
else
  # discover: muss die drei numerisch getaggten Wege finden und den
  # "default"-Weg AUSLASSEN (kein erfundener Wert -- die Kernzusage).
  if "$TSX" e2e/golden-routes/provenanceCli.ts discover \
      --candidates "$CAND" --kind maxheight --limit 10 > "$TMP_DIR/discover.txt" 2>&1; then
    if grep -q "way 900001" "$TMP_DIR/discover.txt"; then
      ok "discover findet den getaggten Weg (900001)"
    else
      fail "discover findet den getaggten Weg NICHT (siehe $TMP_DIR/discover.txt)"
    fi
    if grep -q "way 900004" "$TMP_DIR/discover.txt"; then
      fail "discover hat einen nicht-numerischen Tag ('default') als Wert ausgegeben — das ist genau die Erfindung, die verboten ist"
    else
      ok "discover ignoriert den nicht-numerischen Tag ('default') — kein erfundener Wert"
    fi
  else
    fail "provenanceCli discover ist fehlgeschlagen (siehe $TMP_DIR/discover.txt)"
    cat "$TMP_DIR/discover.txt"
  fi

  # verify gegen die ECHTE Fixture: keiner der DE-Faelle liegt in diesem
  # Mini-Extrakt, also MUSS jeder Fall 'no_candidates' melden und darf
  # KEINEN restriction-Block ausgeben.
  if "$TSX" e2e/golden-routes/provenanceCli.ts verify \
      --candidates "$CAND" --region de --source-label "SMOKE fixture" \
      --out "$TMP_DIR/provenance-report.json" > "$TMP_DIR/verify.txt" 2>&1; then
    if grep -q "NO_CANDIDATES" "$TMP_DIR/verify.txt"; then
      ok "verify meldet fuer die DE-Faelle NO_CANDIDATES (korrekt: der Mini-Extrakt enthaelt sie nicht)"
    else
      fail "verify meldet kein NO_CANDIDATES — die bbox-Zuordnung stimmt nicht (siehe $TMP_DIR/verify.txt)"
    fi
    # Gesucht ist die JSON-Zeile eines ausgegebenen Blocks ('"osm_way_id": 123'),
    # NICHT die Prosa-Warnung "Do NOT hand-fill an osm_way_id", die genau dann
    # erscheint, wenn korrekterweise kein Block ausgegeben wurde.
    if grep -Eq '"osm_way_id": *[0-9]+' "$TMP_DIR/verify.txt"; then
      fail "verify hat einen restriction-Block MIT osm_way_id ausgegeben, obwohl nichts gefunden wurde"
    else
      ok "verify gibt ohne Fund KEINEN restriction-Block aus (keine erfundene Provenienz)"
    fi
    [ -s "$TMP_DIR/provenance-report.json" ] && ok "maschinenlesbarer Report geschrieben" \
      || fail "kein Report unter $TMP_DIR/provenance-report.json"
  else
    fail "provenanceCli verify ist fehlgeschlagen (siehe $TMP_DIR/verify.txt)"
    cat "$TMP_DIR/verify.txt"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
step "Valhalla-Neubau + atomarer Swap, W-17 (REDUZIERT: nur der Fehlerpfad)"

# Der ECHTE Graph-Bau braucht einen Docker-Daemon und mehrere GB Download --
# das kann ein Rauchtest nicht leisten. Pruefbar ist aber die Zusage, auf der
# das ganze Runbook aufbaut: "bei JEDEM Fehler VOR dem Swap bleibt
# data/valhalla/tiles unangetastet". Genau das wird hier erzwungen, indem
# build-tiles.sh mit einer nicht existierenden PBF aufgerufen wird, waehrend im
# Live-Verzeichnis eine Markierung liegt.
LIVE_TILES="$REPO_ROOT/data/valhalla/tiles"
MARKER="$LIVE_TILES/SMOKE-LIVE-MARKER"
PRE_EXISTING=0
[ -d "$LIVE_TILES" ] && PRE_EXISTING=1
mkdir -p "$LIVE_TILES"
echo "runbook-smoke marker $(date -u +%s)" > "$MARKER"
MARKER_SUM_BEFORE="$(cksum < "$MARKER")"

set +e
services/valhalla/build-tiles.sh "$TMP_DIR/gibt-es-nicht.osm.pbf" > "$TMP_DIR/build-tiles.txt" 2>&1
BUILD_RC=$?
set -e

if [ "$BUILD_RC" -ne 0 ]; then
  ok "build-tiles.sh bricht bei fehlender PBF ab (rc=$BUILD_RC) statt halb zu bauen"
else
  fail "build-tiles.sh hat eine fehlende PBF NICHT als Fehler behandelt"
fi
if [ -f "$MARKER" ] && [ "$(cksum < "$MARKER")" = "$MARKER_SUM_BEFORE" ]; then
  ok "W-17: der Live-Tiles-Stand ist nach dem Fehlschlag unveraendert"
else
  fail "W-17 VERLETZT: der Live-Tiles-Stand wurde durch einen fehlgeschlagenen Bau beschaedigt"
fi
if [ -e "$REPO_ROOT/data/valhalla/tiles.new" ]; then
  fail "tiles.new blieb liegen — ein Folgelauf wuerde auf Muell aufsetzen"
else
  ok "kein tiles.new-Ueberbleibsel"
fi
rm -f "$MARKER"
[ "$PRE_EXISTING" -eq 0 ] && rmdir "$LIVE_TILES" 2>/dev/null
skip "echter Graph-Bau + echter Swap: braucht Docker-Daemon + mehrere GB PBF (siehe Runbook §7)"

# ─────────────────────────────────────────────────────────────────────────────
step "Lite-Suchindex neu bauen (ECHT, nur mit Fixture-Eingabe statt osmium)"

# `build-lite-index.sh` besteht aus zwei Haelften: osmium-Filter/Export (braucht
# osmium + PBF) und dem CLI, das daraus die SQLite-FTS5-DB baut und ATOMAR
# einschwenkt. Die zweite Haelfte laeuft hier echt -- inklusive rename(2).
PLACES="$TMP_DIR/places.geojsonseq"
STREETS="$TMP_DIR/streets.geojsonseq"
cat > "$PLACES" <<'EOF'
{"type":"Feature","properties":{"name":"Smoketown","place":"town"},"geometry":{"type":"Point","coordinates":[11.0,48.0]}}
{"type":"Feature","properties":{"name":"Rauchdorf","place":"village"},"geometry":{"type":"Point","coordinates":[11.1,48.1]}}
EOF
cat > "$STREETS" <<'EOF'
{"type":"Feature","properties":{"name":"Teststrasse","highway":"residential"},"geometry":{"type":"LineString","coordinates":[[11.0,48.0],[11.001,48.001]]}}
EOF

LITE_DB="$TMP_DIR/lite_search.db"
set +e
pnpm --filter @yapaja/core exec tsx src/search/lite/cli.ts \
  --places "$PLACES" --streets "$STREETS" --out "$LITE_DB" > "$TMP_DIR/lite.txt" 2>&1
LITE_RC=$?
set -e
if [ "$LITE_RC" -eq 0 ] && [ -s "$LITE_DB" ]; then
  ok "lite_search.db gebaut ($(wc -c < "$LITE_DB") Bytes) und atomar eingeschwenkt"
else
  fail "Lite-Index-Bau fehlgeschlagen (rc=$LITE_RC, siehe $TMP_DIR/lite.txt)"
  tail -20 "$TMP_DIR/lite.txt"
fi
skip "osmium-Haelfte (tags-filter/export aus der echten PBF): osmium+PBF nicht im Rauchtest-Umfang"

# ─────────────────────────────────────────────────────────────────────────────
if [ "${RUNBOOK_SMOKE_SKIP_LIVE:-0}" = "1" ]; then
  step "Abnahme-Gate (UEBERSPRUNGEN via RUNBOOK_SMOKE_SKIP_LIVE=1)"
  skip "S5/S6 brauchen ein gebautes apps/core (pnpm build)"
else

CORE_ENTRY="$REPO_ROOT/apps/core/dist/index.js"
if [ ! -f "$CORE_ENTRY" ]; then
  step "Abnahme-Gate"
  fail "apps/core/dist/index.js fehlt — vorher 'pnpm build' laufen lassen (oder RUNBOOK_SMOKE_SKIP_LIVE=1 setzen)"
else

start_stub() {
  # $1 = "normal" | "regression"
  local regression=""
  [ "$1" = "regression" ] && regression="1"
  STUB_REGRESSION="$regression" STUB_PORT="$STUB_PORT" \
    "$TSX" "$REPO_ROOT/e2e/golden-routes/stubValhalla.ts" > "$TMP_DIR/stub-$1.log" 2>&1 &
  STUB_PID=$!
  for _ in $(seq 1 40); do
    curl -sf "http://localhost:$STUB_PORT/status" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}
stop_stub() { [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; STUB_PID=""; sleep 1; return 0; }

start_core() {
  DB_PATH=:memory: VALHALLA_URL="http://localhost:$STUB_PORT" PORT="$CORE_PORT" \
    node "$CORE_ENTRY" > "$TMP_DIR/core.log" 2>&1 &
  CORE_PID=$!
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:$CORE_PORT/api/v1/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
stop_core() { [ -n "$CORE_PID" ] && kill "$CORE_PID" 2>/dev/null; CORE_PID=""; sleep 1; return 0; }

run_gate() {
  # $1 = Logdatei. Faehrt denselben Runner wie die echten Gates, nur gegen die
  # Fixture-Faelle und den Stub. GOLDEN_NIGHTLY=1 nimmt den ETA-Fall mit.
  GOLDEN_LIVE=1 GOLDEN_NIGHTLY=1 GOLDEN_REGION=li \
  CORE_URL="http://localhost:$CORE_PORT" \
  GOLDEN_ROUTES_FILE="$FIXTURE_ROUTES" \
    npx vitest run --config vitest.golden.config.ts e2e/golden-routes/runner.test.ts > "$1" 2>&1
}

step "Abnahme-Gate gegen intakte Daten: MUSS GRUEN sein (ECHT: Core + Runner)"
if start_stub normal; then
  ok "Stub-Router laeuft (modelliert maxheight 3.2 m)"
  if start_core; then
    ok "Core laeuft gegen den Stub"
    set +e
    run_gate "$TMP_DIR/gate-green.txt"
    GATE_RC=$?
    set -e
    if [ "$GATE_RC" -eq 0 ]; then
      ok "Golden-Routes gruen (Distanz, Restriktion in BEIDEN Richtungen, ETA-Plausibilitaet)"
      grep -E '^\[golden:li\]' "$TMP_DIR/gate-green.txt" | sed 's/^/         /'
    else
      fail "Golden-Routes rot, obwohl die Daten intakt sind (siehe $TMP_DIR/gate-green.txt)"
      tail -30 "$TMP_DIR/gate-green.txt"
    fi
  else
    fail "Core kam nicht hoch (siehe $TMP_DIR/core.log)"
  fi
  stop_core
  stop_stub
else
  fail "Stub-Router kam nicht hoch (siehe $TMP_DIR/stub-normal.log)"
fi

step "Abnahme-Gate gegen ein Datenupdate mit VERLORENER Hoehenbeschraenkung: MUSS ROT sein (ECHT)"
# Das ist die eigentliche Zusage des Runbooks: "Datenupdate ohne gruene Suite
# wird nicht ausgerollt -- faengt OSM-Regressionen". Der Stub verhaelt sich
# jetzt wie eine PBF, in der das maxheight-Tag verschwunden ist (W-08/W-17).
if start_stub regression; then
  ok "Stub-Router laeuft im Regressionsmodus (Restriktion verschwunden)"
  if start_core; then
    set +e
    run_gate "$TMP_DIR/gate-red.txt"
    GATE_RC=$?
    set -e
    if [ "$GATE_RC" -ne 0 ] && grep -q "SAFETY VIOLATION" "$TMP_DIR/gate-red.txt"; then
      ok "Gate ist ROT mit der richtigen Begruendung (SAFETY VIOLATION, rc=$GATE_RC)"
      grep -m1 "SAFETY VIOLATION" "$TMP_DIR/gate-red.txt" | sed 's/^/         /'
    elif [ "$GATE_RC" -ne 0 ]; then
      fail "Gate ist rot, aber NICHT wegen der Restriktion — das Runbook wuerde die falsche Ursache lernen (siehe $TMP_DIR/gate-red.txt)"
      tail -30 "$TMP_DIR/gate-red.txt"
    else
      fail "🔴 Gate blieb GRUEN, obwohl die Hoehenbeschraenkung verloren ging — die Abnahme des Runbooks ist wirkungslos"
    fi
  else
    fail "Core kam nicht hoch (siehe $TMP_DIR/core.log)"
  fi
  stop_core
  stop_stub
else
  fail "Stub-Router (Regressionsmodus) kam nicht hoch"
fi

fi
fi

# ─────────────────────────────────────────────────────────────────────────────
printf '\n==================== ERGEBNIS ====================\n'
if [ "$FAILURES" -eq 0 ]; then
  log "Runbook-Rauchtest bestanden. Artefakte: $TMP_DIR"
  exit 0
fi
log "Runbook-Rauchtest FEHLGESCHLAGEN: $FAILURES Punkt(e). Artefakte: $TMP_DIR"
exit 1
