#!/command/with-contenv bashio
# ==============================================================================
# init-yapaja-config -- s6-rc oneshot (E08-T4, docs/04 §3, W-16).
#
# Runs ONCE, before any of the longrun services (valhalla/photon/gpsd/core)
# start (they all declare `dependencies.d/init-yapaja-config`, see
# ../s6-overlay/s6-rc.d/*/dependencies.d/). Responsibilities:
#
#   1. Read the add-on's `options`/`schema` (config.yaml) via bashio::config.
#   2. Read MQTT broker credentials automatically via `bashio::services mqtt`
#      (works because config.yaml declares `services: [mqtt:need]`) --
#      "MQTT-Credentials automatisch" (docs/04 §3).
#   3. Ensure the W-16 data layout exists under /share/yapaja/ (survives
#      add-on updates/reinstalls -- NEVER write persistent data into the
#      container's own writable layer).
#   4. Export everything the Core / Valhalla / Photon / gpsd `run` scripts
#      need as s6-overlay CONTAINER ENVIRONMENT variables
#      (/run/s6/container_environment/<NAME>), which `with-contenv` in each
#      `run` script then re-imports automatically.
#
# Bashio is provided by the Supervisor's base image tooling that our
# `Dockerfile` installs (see Dockerfile comment "bashio"). `set -e`: a failure
# in this oneshot MUST fail add-on startup loudly (bad partial config is worse
# than a crash-with-a-clear-log) -- this is DELIBERATELY the one place in the
# whole service tree allowed to hard-fail; every downstream `run` script
# instead degrades gracefully (see their own comments) once this oneshot has
# succeeded once.
# ==============================================================================
set -euo pipefail

# ---- s6-overlay container-environment helper -------------------------------
# Writes NAME=VALUE so that every `run` script sourced via
# `#!/command/with-contenv bash` sees it as a normal env var. (Der Pfad stand
# hier bis 2026-09-02 als `/usr/bin/with-contenv` -- den gibt es nur in den
# offiziellen HA-Basisimages, nicht in dem selbst mitgebrachten s6-overlay
# v3.1.6.2 dieses Add-ons; genau daran scheiterten die Dienste in 0.1.0.)
# This is the
# s6-overlay v3 mechanism for sharing computed config across services (the
# alternative -- a shared `/etc/yapaja/env` file each `run` script sources --
# would ALSO work and is a fine substitute if `with-contenv` behaves
# differently than expected on the actual target image; noted here for
# whoever verifies this against a live build).
export_env() {
  local name="$1" value="$2"
  echo -n "${value}" > "/run/s6/container_environment/${name}"
}

bashio::log.info "init-yapaja-config: reading add-on options..."

REGION="$(bashio::config 'region')"
MQTT_PREFIX="$(bashio::config 'mqtt_prefix')"
PHOTON_ENABLED="$(bashio::config 'photon_enabled')"
GPS_SOURCE="$(bashio::config 'gps_source')"
LOG_LEVEL="$(bashio::config 'log_level')"
PHOTON_XMX_MB="$(bashio::config 'photon_xmx_mb')"
VALHALLA_MEMORY_MB="$(bashio::config 'valhalla_memory_mb')"

# --- Plausibilitäts-Kriterium (E08-T4): no region configured -> onboarding, ---
# --- NOT a crash. We only LOG here; apps/core/src/ already starts cleanly  ---
# --- with an empty/nonexistent region (see the existing `empty-regions`   ---
# --- test suite apps/core/src/map/*.test.ts / regionsStore behavior) --   ---
# --- the full onboarding UI itself is E08-T5, out of scope here.         ---
if [ -z "${REGION}" ]; then
  bashio::log.warning "init-yapaja-config: no 'region' configured -- Core starts in an onboarding/no-region state (E08-T5 builds the setup wizard; this add-on version does not crash, it just has nothing to route/search yet). Set 'region' in the add-on's Configuration tab once you know which map to install."
fi

# ---- W-16: persistent data lives under /share/yapaja/, never in-container --
DATA_ROOT="/share/yapaja"
mkdir -p \
  "${DATA_ROOT}/db" \
  "${DATA_ROOT}/tiles" \
  "${DATA_ROOT}/valhalla/tiles" \
  "${DATA_ROOT}/photon/photon_data" \
  "${DATA_ROOT}/lite-search" \
  "${DATA_ROOT}/nav-recovery"

# ---- MQTT credentials via bashio (docs/04 §3 "MQTT-Credentials automatisch") ---
# `services: [mqtt:need]` in config.yaml guarantees the Mosquitto add-on's
# service info is available here without any manual host/user/pass entry.
if bashio::services.available 'mqtt'; then
  MQTT_HOST="$(bashio::services 'mqtt' 'host')"
  MQTT_PORT="$(bashio::services 'mqtt' 'port')"
  MQTT_USER="$(bashio::services 'mqtt' 'username')"
  MQTT_PASSWORD="$(bashio::services 'mqtt' 'password')"
  MQTT_SSL="$(bashio::services 'mqtt' 'ssl')"
  MQTT_SCHEME="mqtt"
  if [ "${MQTT_SSL}" = "true" ]; then
    MQTT_SCHEME="mqtts"
  fi
  MQTT_BROKER_URL="${MQTT_SCHEME}://${MQTT_HOST}:${MQTT_PORT}"
  bashio::log.info "init-yapaja-config: MQTT broker resolved via Supervisor (${MQTT_SCHEME}://${MQTT_HOST}:${MQTT_PORT})."
  export_env "MQTT_BROKER_URL" "${MQTT_BROKER_URL}"
  export_env "MQTT_USERNAME" "${MQTT_USER}"
  export_env "MQTT_PASSWORD" "${MQTT_PASSWORD}"
else
  # W-06: the Core is fully functional without a broker -- so we simply don't
  # export MQTT_BROKER_URL. apps/core/src/mqtt/config.ts treats an absent
  # broker URL as "MQTT disabled" (see its own tests) rather than an error.
  bashio::log.warning "init-yapaja-config: no MQTT service available (Mosquitto add-on not installed/started) -- Yapaja runs WITHOUT the Home-Assistant MQTT/discovery integration (W-06: fully functional otherwise)."
fi
# apps/core/src/mqtt/config.ts reads `MQTT_PREFIX` (NOT `MQTT_TOPIC_PREFIX`)
# -- confirmed against that file before wiring this.
export_env "MQTT_PREFIX" "${MQTT_PREFIX}"

# ---- Ingress mode (docs/04 §3 + apps/core/src/index.ts resolveBindHost) ----
# Always on for the add-on: HA's Ingress proxy handles auth + remote access,
# so the Core's own bearer-token guard (apps/core/src/auth/) stays OFF.
export_env "INGRESS_MODE" "1"
export_env "PORT" "8099"
export_env "HOST" "0.0.0.0"
export_env "NODE_ENV" "production"
# ─── NICHT `LOG_LEVEL` ─────────────────────────────────────────────────────
# Alles, was hier exportiert wird, landet in /run/s6/container_environment/
# und damit in JEDEM Skript, das mit `with-contenv` startet -- auch in
# bashio selbst. Und bashio liest genau diesen Namen:
#
#     lib/bashio.sh:31
#     declare __BASHIO_LOG_LEVEL=${LOG_LEVEL:-${__BASHIO_DEFAULT_LOG_LEVEL}}
#
# Es erwartet dort eine ZAHL (1..8). Unsere Add-on-Option liefert aber einen
# NAMEN ("info"). Ergebnis war, dass bashios `log.sh:107`
#
#     if [[ "${level}" -gt "${__BASHIO_LOG_LEVEL}" ]]; then
#
# den String arithmetisch auswerten wollte und unter `set -u` bei JEDEM
# Log-Aufruf abbrach: „info: unbound variable". Das Add-on-Protokoll bestand
# danach fast nur noch aus dieser Zeile, und keiner unserer s6-Dienste konnte
# ueberhaupt etwas protokollieren.
#
# Deshalb heisst die geteilte Variable jetzt `YAPAJA_LOG_LEVEL`. Der Core
# erwartet weiterhin `LOG_LEVEL` (pino) -- das setzt `core/run` lokal fuer
# genau diesen einen Prozess, statt es global zu streuen.
export_env "YAPAJA_LOG_LEVEL" "${LOG_LEVEL}"

# ---- Data paths (W-16) ----
export_env "DB_PATH" "${DATA_ROOT}/db/yapaja.db"
# `TILES_DIR` (apps/core/src/map/paths.ts) is the Core's PMTiles MAP-region
# store -- distinct from Valhalla's own routing graph below, which the Core
# never reads directly (it only talks to VALHALLA_URL over HTTP). Exporting
# these under two clearly different names avoids the two completely
# different kinds of "tiles" colliding on one directory.
export_env "TILES_DIR" "${DATA_ROOT}/tiles"
# Consumed only by our OWN valhalla/run script (not by the Core) -- see
# ../s6-overlay/s6-rc.d/valhalla/run.
export_env "VALHALLA_TILES_DIR" "${DATA_ROOT}/valhalla/tiles"
export_env "NAV_RECOVERY_PATH" "${DATA_ROOT}/nav-recovery/nav-recovery.json"
export_env "LITE_SEARCH_DB_PATH" "${DATA_ROOT}/lite-search/lite_search.db"

# ---- Routing / search backends (in-container, same container = localhost) --
export_env "VALHALLA_URL" "http://127.0.0.1:8002"
export_env "VALHALLA_MEMORY_MB" "${VALHALLA_MEMORY_MB}"
export_env "PHOTON_ENABLED" "${PHOTON_ENABLED}"
export_env "PHOTON_URL" "http://127.0.0.1:2322"
export_env "PHOTON_XMX_MB" "${PHOTON_XMX_MB}"
export_env "PHOTON_DATA_DIR" "${DATA_ROOT}/photon/photon_data"

# ---- GPS source (docs/04 §3 "GPS-Quelle") ----
export_env "GPS_SOURCE" "${GPS_SOURCE}"
if [ "${GPS_SOURCE}" = "usb" ] || [ "${GPS_SOURCE}" = "network" ]; then
  export_env "GPSD_ENABLED" "true"
  export_env "GPSD_HOST" "127.0.0.1"
  export_env "GPSD_PORT" "2947"
else
  export_env "GPSD_ENABLED" "false"
fi

# ---- HA output channel (E08-T3, docs/04 §2) via the Supervisor-proxied API -
# `homeassistant_api: true` in config.yaml grants access to
# http://supervisor/core/api using $SUPERVISOR_TOKEN (already exported into
# the container environment by the Supervisor itself -- we only need to point
# the Core at the proxy URL; it re-reads $SUPERVISOR_TOKEN itself).
export_env "HA_API_URL" "http://supervisor/core/api"

bashio::log.info "init-yapaja-config: done. region='${REGION:-<none, onboarding>}' photon_enabled=${PHOTON_ENABLED} gps_source=${GPS_SOURCE}"
