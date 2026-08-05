#!/usr/bin/env bash
#
# api-security-smoke.sh — API-Security-Smoke (E10-T4 (b), docs/07 §7).
#
# ─── Zweck ────────────────────────────────────────────────────────────────────
# Zwei Dinge, die die Release-Pipeline zusagt, werden hier gegen einen ECHT
# gestarteten Core ueber ECHTES HTTP geprueft:
#
#   1. die Auth-Matrix aus E08-T3 — ohne Token kein Zugriff auf /api/*,
#      mit falschem Token 401, mit richtigem Token 200, health/auth-status offen;
#   2. die Security-Header aus E10-T4 — CSP, X-Content-Type-Options: nosniff und
#      frame-ancestors auf JEDER Antwort (SPA-Shell, Asset, API, Fehlerseite).
#
# ─── Warum zusaetzlich zu den Unit-Tests ─────────────────────────────────────
# `apps/core/src/auth/authMatrix.test.ts` und `apps/core/src/security/
# headers.test.ts` pruefen dasselbe ueber `fastify.inject()` — also OHNE echten
# Socket, ohne @fastify/static-Stream und ohne den gebauten `dist/`-Stand. Genau
# dort koennen Header verloren gehen: ein `onSend`-Hook, der bei gestreamten
# Dateien nicht greift, faellt per `inject` nicht auf. Dieser Rauchtest laeuft
# deshalb gegen `node apps/core/dist/index.js` mit dem echten Web-Bundle als
# public/ — dieselbe Konstellation wie im Docker-Image.
#
# Aufruf:  bash scripts/api-security-smoke.sh
# Voraussetzung: `pnpm build` ist gelaufen (das Skript baut sonst selbst).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${SMOKE_PORT:-8199}"
BASE="http://127.0.0.1:${PORT}"
TOKEN="smoke-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
WRONG_TOKEN="$(printf '%*s' "${#TOKEN}" '' | tr ' ' 'x')"   # gleiche Laenge, falscher Wert
CORE_PID=""
FAILURES=0
CHECKS=0

cleanup() {
  if [[ -n "$CORE_PID" ]] && kill -0 "$CORE_PID" 2>/dev/null; then
    kill "$CORE_PID" 2>/dev/null || true
    wait "$CORE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

log()  { printf '%s\n' "$*"; }
pass() { CHECKS=$((CHECKS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# ─── Vorbereitung ────────────────────────────────────────────────────────────

# Immer neu bauen (nicht nur wenn dist/ fehlt). Beim ersten Lauf dieses Skripts
# lag ein aelterer Core-Build herum und der Rauchtest meldete "Header fehlen" —
# gepruefter Stand war der von vorgestern. Ein Rauchtest, der stillschweigend
# ein altes Artefakt testet, ist schlimmer als keiner. `SMOKE_SKIP_BUILD=1`
# ueberspringt den Schritt bewusst (CI baut in einem eigenen Schritt davor).
if [[ "${SMOKE_SKIP_BUILD:-0}" != "1" ]]; then
  log "Baue Web + Core (frischer Stand) ..."
  pnpm --filter @yapaja/web build >/dev/null
  pnpm --filter @yapaja/core build >/dev/null
fi

# public/ genau wie apps/core/Dockerfile stagen (COPY apps/web/dist apps/core/public).
rm -rf apps/core/public
cp -r apps/web/dist apps/core/public

log "Starte Core auf ${BASE} (Auth erzwungen, In-Memory-DB) ..."
(
  cd apps/core
  PORT="$PORT" HOST=127.0.0.1 DB_PATH=':memory:' API_AUTH_TOKEN="$TOKEN" \
    GPSD_ENABLED=false NODE_ENV=production \
    node dist/index.js
) >/tmp/yapaja-security-smoke.log 2>&1 &
CORE_PID=$!

for _ in $(seq 1 60); do
  if curl -fsS "${BASE}/api/v1/health" >/dev/null 2>&1; then break; fi
  if ! kill -0 "$CORE_PID" 2>/dev/null; then
    log "Core-Prozess ist gestorben:"; cat /tmp/yapaja-security-smoke.log; exit 1
  fi
  sleep 0.5
done
curl -fsS "${BASE}/api/v1/health" >/dev/null || {
  log "Core wurde nicht gesund:"; cat /tmp/yapaja-security-smoke.log; exit 1
}

# ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

# status <erwartet> <beschreibung> <curl-args...>
status() {
  local expected="$1" desc="$2"; shift 2
  local actual
  actual="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [[ "$actual" == "$expected" ]]; then pass "$desc (HTTP $actual)"
  else fail "$desc — erwartet HTTP $expected, war HTTP $actual"; fi
}

# header_contains <pfad> <header> <erwarteter-teilstring> <beschreibung>
header_contains() {
  local path="$1" header="$2" needle="$3" desc="$4"
  local value
  value="$(curl -s -D - -o /dev/null -H "Authorization: Bearer ${TOKEN}" "${BASE}${path}" \
           | tr -d '\r' | awk -v h="$(printf '%s' "$header" | tr 'A-Z' 'a-z')" \
             'BEGIN{IGNORECASE=1} tolower($0) ~ "^" h ":" {sub(/^[^:]*: */,""); print}')"
  if [[ "$value" == *"$needle"* ]]; then pass "$desc"
  else fail "$desc — Header \"$header\" auf $path war: \"${value:-<fehlt>}\""; fi
}

# ─── 1. Auth-Matrix (E08-T3) ─────────────────────────────────────────────────

log ""
log "=== Auth-Matrix (E08-T3), Token erzwungen ==="

status 200 "GET /api/v1/health ist OHNE Token offen (Liveness-Probe)" \
  "${BASE}/api/v1/health"
status 200 "GET /api/v1/auth/status ist OHNE Token offen (nur Posture-Flags)" \
  "${BASE}/api/v1/auth/status"

status 401 "GET /api/v1/profiles OHNE Token -> 401" \
  "${BASE}/api/v1/profiles"
status 401 "GET /api/v1/profiles mit FALSCHEM Token -> 401" \
  -H "Authorization: Bearer ${WRONG_TOKEN}" "${BASE}/api/v1/profiles"
status 401 "GET /api/v1/settings OHNE Token -> 401" \
  "${BASE}/api/v1/settings"
status 401 "POST /api/v1/navigation/start OHNE Token -> 401 (schreibender Pfad)" \
  -X POST -H 'Content-Type: application/json' -d '{}' "${BASE}/api/v1/navigation/start"

status 200 "GET /api/v1/profiles MIT gueltigem Token -> 200" \
  -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/v1/profiles"

# E09-T3: der Guard entscheidet auf dem PERZENT-DEKODIERTEN Pfad, weil der
# Router (find-my-way) vor dem Matching dekodiert. `/%61pi/...` erreicht also
# den `/api/...`-Handler — und muss denselben 401 bekommen. Genau diese
# Bypass-Klasse steckt auch in den @fastify/static-Advisories, die der
# Upgrade auf 10.x geschlossen hat.
status 401 "GET /%61pi/v1/profiles (perzent-kodiert) OHNE Token -> 401, kein Guard-Bypass" \
  "${BASE}/%61pi/v1/profiles"
status 401 "GET /api/v1/../api/v1/profiles (nicht-kanonisch) OHNE Token -> 401" \
  --path-as-is "${BASE}/api/v1/../api/v1/profiles"

# Der Token darf nie im Log auftauchen (Plausibilitaet E08-T3).
if grep -qF "$TOKEN" /tmp/yapaja-security-smoke.log; then
  fail "Der API-Token taucht im Server-Log auf"
else
  pass "Der API-Token taucht in keiner Log-Zeile auf"
fi

# ─── 2. Security-Header (E10-T4) ─────────────────────────────────────────────

log ""
log "=== Security-Header (CSP, nosniff, frame-ancestors) ==="

for path in "/" "/api/v1/health" "/tief/verlinkte/spa-route"; do
  header_contains "$path" 'X-Content-Type-Options' 'nosniff' \
    "nosniff auf ${path}"
  header_contains "$path" 'Content-Security-Policy' "frame-ancestors 'self'" \
    "CSP frame-ancestors auf ${path}"
  header_contains "$path" 'Content-Security-Policy' "default-src 'self'" \
    "CSP default-src auf ${path}"
  header_contains "$path" 'Content-Security-Policy' "script-src 'self';" \
    "CSP script-src ohne 'unsafe-inline' auf ${path}"
done

# Das gestreamte statische Asset ist der Fall, den `fastify.inject()` NICHT
# abdeckt: @fastify/static antwortet mit einem Stream, nicht mit einem Payload.
ASSET="$(cd apps/core/public/assets && ls -1 *.js | head -n1)"
header_contains "/assets/${ASSET}" 'X-Content-Type-Options' 'nosniff' \
  "nosniff auf dem gestreamten Asset /assets/${ASSET}"
header_contains "/assets/${ASSET}" 'Content-Security-Policy' "frame-ancestors 'self'" \
  "CSP auf dem gestreamten Asset /assets/${ASSET}"

# ─── Ergebnis ────────────────────────────────────────────────────────────────

log ""
if [[ "$FAILURES" -eq 0 ]]; then
  log "API-SECURITY-SMOKE GRUEN — ${CHECKS} Pruefungen bestanden."
  exit 0
fi
log "API-SECURITY-SMOKE ROT — ${FAILURES} von ${CHECKS} Pruefungen fehlgeschlagen."
log "Server-Log:"; cat /tmp/yapaja-security-smoke.log
exit 1
