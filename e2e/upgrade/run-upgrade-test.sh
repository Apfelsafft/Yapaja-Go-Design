#!/usr/bin/env bash
#
# Upgrade-E2E (E08-T6, Wargame W-16, docs/07 §6): start the PREVIOUS release
# image, create a profile/favorite/settings-layout entry through the real
# REST API, switch the SAME data volume to the NEW image, and assert
# everything is still there + the migration log (`schema_version` table)
# looks clean.
#
# THIS RUNS IN THE RELEASE PIPELINE / MANUALLY, NOT PER-PR -- see
# ./README.md and apps/core/src/db/migrations/README.md for why (there is no
# n-1 release image to test against before v1.0).
#
# Usage:
#   PREV_IMAGE=ghcr.io/<org>/yapaja-core:v0.9.0 \
#   NEW_IMAGE=ghcr.io/<org>/yapaja-core:v1.0.0 \
#     ./run-upgrade-test.sh
#
# Both env vars are required (no defaults) -- silently picking "the current
# build" for both would defeat the point of an UPGRADE test.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
BASE_URL="http://localhost:8080"

: "${PREV_IMAGE:?set PREV_IMAGE to the previous release's core image (e.g. ghcr.io/.../core:v0.9.0)}"
: "${NEW_IMAGE:?set NEW_IMAGE to the new core image to upgrade to}"

log() { echo "[upgrade-e2e] $*"; }
fail() {
  echo "[upgrade-e2e] FAIL: $*" >&2
  log 'Container logs:'
  docker compose -f "$COMPOSE_FILE" logs core || true
  cleanup
  exit 1
}

cleanup() {
  YAPAJA_CORE_IMAGE="${NEW_IMAGE}" docker compose -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy() {
  local label="$1"
  for i in $(seq 1 60); do
    if curl -sf "${BASE_URL}/api/v1/health" >/dev/null 2>&1; then
      log "${label}: healthy after ~${i}s"
      return 0
    fi
    if [ "$i" -eq 60 ]; then
      fail "${label}: did not become healthy in time"
    fi
    sleep 1
  done
}

# --- Phase 1: start the PREVIOUS release, create data ------------------

log "Starting PREV_IMAGE=${PREV_IMAGE}"
YAPAJA_CORE_IMAGE="${PREV_IMAGE}" docker compose -f "$COMPOSE_FILE" up -d
wait_healthy 'prev'

log 'Creating a profile, a favorite, and a settings key on the old version'
PROFILE_JSON=$(curl -sf -X POST "${BASE_URL}/api/v1/profiles" \
  -H 'Content-Type: application/json' \
  -d '{"name":"UpgradeE2E-Camper","height_m":3.1,"width_m":2.3,"length_m":6.8,"weight_t":3.6,"avg_speed_kmh":80,"hazmat":false,"avoid":{"motorway":false,"toll":false,"ferry":false,"unpaved":false}}') \
  || fail 'POST /profiles failed on prev image'
PROFILE_ID=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).data.id)' <<<"$PROFILE_JSON")
log "Created profile ${PROFILE_ID}"

FAVORITE_JSON=$(curl -sf -X POST "${BASE_URL}/api/v1/favorites" \
  -H 'Content-Type: application/json' \
  -d '{"name":"UpgradeE2E-Home","latlng":{"lat":47.14,"lon":9.52},"icon":"home","category":"home"}') \
  || fail 'POST /favorites failed on prev image'
FAVORITE_ID=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).data.id)' <<<"$FAVORITE_JSON")
log "Created favorite ${FAVORITE_ID}"

curl -sf -X PATCH "${BASE_URL}/api/v1/settings" \
  -H 'Content-Type: application/json' \
  -d '{"layouts":{"upgrade_e2e_marker":true}}' >/dev/null \
  || fail 'PATCH /settings failed on prev image'
log 'Wrote settings.layouts marker'

# --- Phase 2: swap to the NEW image on the SAME volume ------------------

log 'Stopping prev container (keeping the data volume)'
YAPAJA_CORE_IMAGE="${PREV_IMAGE}" docker compose -f "$COMPOSE_FILE" stop core

log "Starting NEW_IMAGE=${NEW_IMAGE} against the same data volume"
YAPAJA_CORE_IMAGE="${NEW_IMAGE}" docker compose -f "$COMPOSE_FILE" up -d core
wait_healthy 'new'

# --- Phase 3: assert data survived ---------------------------------------

log 'Verifying profile survived'
curl -sf "${BASE_URL}/api/v1/profiles/${PROFILE_ID}" | grep -q 'UpgradeE2E-Camper' \
  || fail "profile ${PROFILE_ID} missing or renamed after upgrade"

log 'Verifying favorite survived'
curl -sf "${BASE_URL}/api/v1/favorites" | grep -q 'UpgradeE2E-Home' \
  || fail 'favorite missing after upgrade'

log 'Verifying settings/layouts marker survived'
curl -sf "${BASE_URL}/api/v1/settings/layouts" | grep -q 'upgrade_e2e_marker' \
  || fail 'settings.layouts marker missing after upgrade'

# --- Phase 4: assert a clean migration log -------------------------------
#
# `schema_version` (one row per successfully-applied migration, see
# apps/core/src/db/migrations/runner.ts) is dumped straight out of the
# container's DB file via the SAME better-sqlite3 the app runs on -- no
# extra tooling needed in the image.
log 'Dumping schema_version (migration log) from the upgraded container'
MIGRATION_LOG=$(docker compose -f "$COMPOSE_FILE" exec -T core node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/db/yapaja.db', { readonly: true });
  const rows = db.prepare('SELECT version, name, applied_at FROM schema_version ORDER BY version').all();
  console.log(JSON.stringify(rows));
") || fail 'could not read schema_version from the new container'

echo "[upgrade-e2e] schema_version: ${MIGRATION_LOG}"
node -e '
  const rows = JSON.parse(process.argv[1]);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("schema_version is empty -- migration log not clean");
    process.exit(1);
  }
  const versions = rows.map((r) => r.version);
  const sorted = [...versions].sort((a, b) => a - b);
  if (JSON.stringify(versions) !== JSON.stringify(sorted) || new Set(versions).size !== versions.length) {
    console.error("schema_version has duplicate/out-of-order versions:", versions);
    process.exit(1);
  }
' "$MIGRATION_LOG" || fail 'migration log is not clean (see above)'

log 'PASS: data survived the upgrade and the migration log is clean.'
