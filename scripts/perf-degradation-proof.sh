#!/usr/bin/env bash
#
# E10-T2, Akzeptanzkriterium 2 -- NACHWEIS DER KUENSTLICHEN VERSCHLECHTERUNG.
#
# "Kuenstliche Verschlechterung (Test-Fixture mit 200 ms-Delay) macht Pipeline
#  nachweislich rot."
#
# Dieses Skript beweist das ausfuehrbar statt behauptend -- gebaut nach dem
# Vorbild von scripts/security-mutation-proof.sh (E09-T6):
#
#   0. BASISLAUF (ohne Fixture) -- muss GRUEN sein und liefert die Referenz.
#      Ohne diesen Schritt waere jedes spaetere Rot wertlos.
#   1. FIXTURE 200 ms -- exakt der in der Aufgabenstellung genannte Wert.
#      -> Die Pipeline MUSS rot werden (Regressions-Gate).
#      -> Zusaetzlich wird BELEGT, dass die absoluten Budgets dabei NICHT
#         reissen. Das ist der eigentliche Punkt: ein reines Budget-Gate
#         wuerde eine 200-ms-Verschlechterung verschlafen, weil der Kaltstart
#         mit ~2,3 s gegen 5 s und die WS-Latenz mit ~5 ms gegen 500 ms
#         Budget laufen. Genau deshalb hat diese Pipeline zwei Tore.
#   2. FIXTURE 1200 ms -- so gross, dass auch das ABSOLUTE Budget-Gate reisst.
#      -> Beweist, dass auch Tor 1 nicht bloss Dekoration ist.
#   3. ERHOLUNG -- ohne Fixture wieder GRUEN.
#
# Das Fixture ist reiner TESTCODE: `PERF_DEGRADE_DELAY_MS` verzoegert in
# `e2e/perf/support/page.js` jede Core-Antwort an die Seite und im
# Stub-Valhalla jede Routing-Antwort. Es wird KEIN Produktionscode angefasst
# und KEIN Feature-Flag in die App eingebaut.
#
# Aufruf:  bash scripts/perf-degradation-proof.sh   (oder: pnpm perf:degradation-proof)
# Laufzeit: 4 gefilterte Suite-Laeufe (Kaltstart + WS-Latenz) inkl. Build,
#           zusammen ca. 8-12 min.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CONFIG="e2e/perf/playwright.config.ts"
RESULTS="e2e/perf/.tmp/perf-results.json"
TREND="e2e/perf/.tmp/perf-trend.md"
# Nur die beiden Metriken, die das HTTP-Delay-Fixture erreicht -- die anderen
# wuerden den Nachweis nur verlangsamen, ohne etwas zu belegen.
FILTER='Kaltstart|WS-Latenz'

WORK_DIR="$(mktemp -d)"
BASELINE="$WORK_DIR/baseline.json"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

fail() {
  echo "::error::$*" >&2
  exit 1
}

# $1 = Delay in ms (0 = aus), $2 = Referenzdatei oder "" fuer keine
run_suite() {
  local delay="$1" baseline="${2:-}"
  local env_args=()
  [ "$delay" -gt 0 ] && env_args+=("PERF_DEGRADE_DELAY_MS=$delay")
  [ -n "$baseline" ] && env_args+=("PERF_BASELINE=$baseline")
  if [ ${#env_args[@]} -gt 0 ]; then
    env "${env_args[@]}" npx playwright test -c "$CONFIG" -g "$FILTER"
  else
    npx playwright test -c "$CONFIG" -g "$FILTER"
  fi
}

# Liest das Ergebnis-JSON aus und gibt eine Zeile je Metrik aus, plus die
# beiden Gate-Verdikte. Exit 0 = kein Gate rot, 1 = mindestens eines rot.
summarise() {
  python3 - "$RESULTS" <<'PYEOF'
import json, sys

report = json.load(open(sys.argv[1], encoding='utf-8'))
evaluation = report['evaluation']
trend = report.get('trend', {})

for metric in evaluation['metrics']:
    value = metric['value']
    shown = '—' if value is None else f"{value:.1f}"
    violation = metric['violationPct']
    violation_shown = '—' if violation is None else f"{violation:+.1f}%"
    print(f"    {metric['id']:16} {shown:>10} {metric['unit']:<3} "
          f"Budget {metric['budget']:>8.1f}  Verstoss {violation_shown:>9}  {metric['status']}")

budget_red = evaluation['blockingRedIds']
trend_red = trend.get('regressedIds', []) if trend.get('red') else []
print(f"    BUDGET-GATE      : {'ROT ' + ', '.join(budget_red) if budget_red else 'gruen'}")
print(f"    REGRESSIONS-GATE : {'ROT ' + ', '.join(trend_red) if trend_red else 'gruen'}")

# Maschinenlesbar fuer die bash-Seite.
with open(sys.argv[1] + '.verdict', 'w', encoding='utf-8') as handle:
    handle.write(f"budget_red={','.join(budget_red)}\ntrend_red={','.join(trend_red)}\n")

sys.exit(1 if budget_red or trend_red else 0)
PYEOF
}

verdict_field() {
  # $1 = Feldname
  grep -E "^$1=" "$RESULTS.verdict" | cut -d= -f2-
}

echo "==============================================================="
echo "0/4  BASISLAUF (ohne Fixture) -- muss GRUEN sein"
echo "==============================================================="
if ! run_suite 0 ""; then
  fail "Der BASISLAUF ist bereits rot. Der Nachweis waere damit wertlos -- erst die Suite/Umgebung reparieren."
fi
summarise || fail "Der Basislauf meldet ein rotes Gate."
cp "$RESULTS" "$BASELINE"
echo "Basislauf gruen; Referenz gesichert."

echo
echo "==============================================================="
echo "1/4  FIXTURE 200 ms -- die in E10-T2 geforderte Verschlechterung"
echo "==============================================================="
echo "PERF_DEGRADE_DELAY_MS=200 (Test-Fixture, kein Produktionscode)"
run_suite 200 "$BASELINE"
DEGRADED_RC=$?
summarise
SUMMARY_RC=$?

if [ "$DEGRADED_RC" -eq 0 ] || [ "$SUMMARY_RC" -eq 0 ]; then
  fail "Die Pipeline blieb mit dem 200-ms-Fixture GRUEN -- sie erkennt diese Verschlechterung NICHT."
fi
TREND_RED="$(verdict_field trend_red)"
BUDGET_RED="$(verdict_field budget_red)"
[ -n "$TREND_RED" ] || fail "Das Regressions-Gate hat NICHT ausgeloest (erwartet: Kaltstart und/oder WS-Latenz)."
echo "OK: Regressions-Gate ROT ($TREND_RED) -- die Pipeline ist wie gefordert rot."
if [ -n "$BUDGET_RED" ]; then
  echo "Hinweis: hier hat zusaetzlich das absolute Budget-Gate ausgeloest ($BUDGET_RED)."
else
  echo "Beleg fuer die Notwendigkeit des zweiten Tores: die ABSOLUTEN Budgets"
  echo "halten bei 200 ms noch (Kaltstart gegen 5 s, WS-Latenz gegen 500 ms)."
  echo "Eine Pipeline mit nur einem Budget-Gate haette hier 'gruen' gemeldet."
fi

echo
echo "==============================================================="
echo "2/4  FIXTURE 1200 ms -- muss zusaetzlich das ABSOLUTE Budget reissen"
echo "==============================================================="
run_suite 1200 "$BASELINE"
HARD_RC=$?
summarise
HARD_SUMMARY_RC=$?
if [ "$HARD_RC" -eq 0 ] || [ "$HARD_SUMMARY_RC" -eq 0 ]; then
  fail "Die Pipeline blieb mit dem 1200-ms-Fixture GRUEN."
fi
BUDGET_RED="$(verdict_field budget_red)"
[ -n "$BUDGET_RED" ] || fail "Das absolute Budget-Gate hat NICHT ausgeloest, obwohl das Budget klar gerissen sein muss."
echo "OK: Budget-Gate ROT ($BUDGET_RED) -- auch das absolute Tor beisst."

echo
echo "==============================================================="
echo "3/4  ERHOLUNG -- ohne Fixture wieder GRUEN"
echo "==============================================================="
if ! run_suite 0 "$BASELINE"; then
  fail "Nach dem Entfernen des Fixtures ist die Pipeline NICHT wieder gruen geworden."
fi
summarise || fail "Nach dem Entfernen des Fixtures meldet die Pipeline weiterhin ein rotes Gate."
echo "OK: Pipeline wieder gruen."

echo
echo "==============================================================="
echo "4/4  Aufraeumen pruefen"
echo "==============================================================="
if ! git diff --quiet -- e2e/perf apps/web/src apps/core/src; then
  fail "Der Arbeitsbaum wurde durch den Nachweis veraendert -- das darf nicht passieren."
fi
echo "Kein Quellcode veraendert (das Fixture ist reine Testkonfiguration)."

echo
echo "NACHWEIS BESTANDEN:"
echo "  * Basislauf gruen."
echo "  * 200-ms-Fixture  -> Pipeline ROT (Regressions-Gate)."
echo "  * 1200-ms-Fixture -> Pipeline ROT (auch absolutes Budget-Gate)."
echo "  * Ohne Fixture    -> wieder gruen."
echo "  * Trend-Kommentar des letzten Laufs: $TREND"
exit 0
