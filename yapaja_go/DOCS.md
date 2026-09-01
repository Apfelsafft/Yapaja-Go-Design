# Yapaja Go — Home Assistant Add-on

Offline-capable motorhome navigation (maps, truck/RV-aware routing, GPS,
search) running as a Home Assistant add-on, with a full MQTT + Auto-Discovery
integration into HA (docs/04-home-assistant.md §1–2 in the main repo).

## Installation

1. Settings → Add-ons → Add-on Store → ⋮ → Repositories → add this
   repository's URL.
2. Find "Yapaja Go" in the store, click Install.
3. **Before starting it the first time**, open the add-on's Configuration
   tab and set at least `region` (see "Configuration options" below) —
   without it the add-on starts into an onboarding-ish idle state rather
   than crashing (routing/search simply have nothing to serve yet), but you
   won't get a usable app until a region is set and its map data installed.
4. Start the add-on, then open it from the HA sidebar (Ingress — no
   separate login, HA's own auth/session covers it, including over Nabu
   Casa remote access).

## RAM recommendation (IMPORTANT — read before installing on a shared HAOS-VM)

Home Assistant itself, Mosquitto, and any other add-ons you run all share
the SAME HAOS-VM's RAM budget as Yapaja Go. The reference "Mini-PC" budget
from the main repo (docs/01-architecture.md §4) is per-*service*, not
per-VM:

| Component | Typical RAM |
|---|---|
| Core (Node/Fastify) | ≤ 300 MB |
| Valhalla (routing, DE-scale map) | ≤ 1.5 GB |
| Photon (search, DE-scale index, default `-Xmx1g`) | ~600 MB – 1 GB RSS (`Xmx` + 150–300 MB JVM overhead) |
| gpsd | negligible (a few MB) |
| **Yapaja subtotal** | **~2.4 – 2.9 GB** |

Add Home Assistant Core + Supervisor + Mosquitto + whatever else you run
(commonly another 1–1.5 GB+) and a comfortable **HAOS-VM should have ≥ 6 GB
RAM** if you intend to install a Germany-scale (or similarly large) map
region with Photon search enabled.

**If you're tighter on RAM:**

- Turn `photon_enabled` **off** in the add-on options. Search automatically
  falls back to the built-in offline lite-search index (place names +
  street names, no house numbers, "vereinfachte Suche" — see the main
  repo's `services/photon/README.md` "Abschalt-Option W-12" for exactly
  what you lose/keep). This alone removes the single biggest RAM consumer.
- Lower `photon_xmx_mb` instead of disabling it entirely, if you want
  search but with a smaller heap (smaller/regional map extracts need much
  less than the DE-scale numbers above — see `services/photon/README.md`'s
  RAM table for smaller-region estimates).
- Install a smaller region (a single country/state) instead of all of
  Germany — Valhalla's own RAM footprint scales with graph size.
- If even that doesn't fit: run the **standalone `docker-compose.yml`**
  variant instead, in its own LXC/VM alongside (not inside) your HAOS-VM —
  see the main repo's root `README.md` / `docker-compose.yml`. This is also
  the repo's own CI/development reference environment, so it's a
  well-exercised path, not a second-class one.

## USB-GPS passthrough

Set `gps_source: usb` (the default) in the add-on's Configuration tab.
`config.yaml` declares `usb: true` + `udev: true`, which makes the
Supervisor pass USB device nodes and udev events through into the add-on's
container — this is what lets our internal `gpsd` service actually see a
plugged-in GPS receiver.

1. Plug in a USB GPS receiver (most USB-CDC-ACM "GPS mice" show up as
   `/dev/ttyACM0`; USB-serial-adapter-based ones as `/dev/ttyUSB0`).
2. Restart the add-on (device passthrough is evaluated at container start).
3. Check the add-on log: the internal `gpsd` service logs either "found GPS
   device at /dev/ttyACMx" or a warning that it's still waiting for one
   (retried every 15 s, does not crash the add-on).
4. In the Yapaja Go UI, Settings → GPS should show a live fix once gpsd has
   one.

If you don't have (or don't yet have) a GPS receiver connected, leave
`gps_source: usb` set anyway (harmless — gpsd idles and retries) or switch
to `gps_source: none` to silence the retry warnings; the app remains fully
usable via the simulator/dead-reckoning position source either way.

## Configuration options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `region` | string (optional) | *(empty)* | Which map region to use. Empty = onboarding/no-data state (E08-T5 builds the full setup wizard; this add-on version simply doesn't crash without one). |
| `mqtt_prefix` | string | `yapaja` | MQTT topic prefix (docs/03-api-spec.md §4). |
| `photon_enabled` | bool | `true` | Full-text search via Photon. `false` = RAM-saver, falls back to the offline lite-search index (W-12). |
| `gps_source` | `usb` \| `network` \| `none` | `usb` | Where the Core's position service gets a GPS fix from. |
| `log_level` | `debug` \| `info` \| `warn` \| `error` | `info` | Core log verbosity (pino). |
| `photon_xmx_mb` | int 256–4096 | `1024` | Photon JVM heap cap (`-Xmx`). See the RAM table above. |
| `valhalla_memory_mb` | int 512–8192 | `2048` | Documented RAM budget for Valhalla; informational (Valhalla's actual runtime cache size is set at graph-build time, not per-start — see `yapaja_go/rootfs/.../valhalla/run`'s comment). |

## MQTT

Automatic: with the Mosquitto add-on (or any add-on providing the `mqtt`
service) installed and running, Yapaja Go picks up its host/credentials via
the Supervisor's Services API — no manual entry. See
`docs/04-home-assistant.md` §1 in the main repo for the full topic/entity
table that then appears under HA's MQTT integration (Auto-Discovery).

## Data & updates (W-16)

All map/routing/search/database data lives under `/share/yapaja/` on the
host (via `config.yaml`'s `map: [share:rw]`), **not** inside the add-on
container's own filesystem. Updating the add-on to a new version replaces
the container image only — everything under `/share/yapaja/` (your
installed map region, Valhalla graph, Photon/lite-search index, profiles/
favorites database) survives untouched. See "VM test protocol" below for
how this is actually verified.

## Manual / nightly VM test protocol

A real HAOS install can't run inside this repo's per-PR CI (needs a real
Supervisor, a real Mosquitto add-on, a real VM/hardware). The following is
the checklist an operator (or a nightly job against a HAOS test VM) runs
instead, covering the acceptance criteria from `tasks/E08-home-assistant.md`
E08-T4 that per-PR CI structurally cannot:

### 1. Flow 9 — Add-on install + Ingress UI (acceptance #1)

1. Fresh HAOS VM, add this repository under Add-ons → Repositories.
2. Install "Yapaja Go", set a small `region` (e.g. Liechtenstein, for a
   fast test cycle — see the main repo's `services/valhalla/build-tiles.sh`
   for how a region's tiles get built; for this manual protocol, pre-stage
   a built region's data under `/share/yapaja/` before starting the
   add-on, OR extend the wizard once E08-T5 ships).
3. Start the add-on. Confirm the add-on log shows, in order: valhalla
   ready → core listening on :8099 → (if configured) MQTT connected.
4. Open the add-on from the HA sidebar. Confirm:
   - The map renders (canvas visible, tiles load).
   - The browser's network tab shows every asset/API/WS request scoped
     under the Ingress path (`/api/hassio_ingress/<token>/...`) — this is
     the SAME thing `apps/core/src/static.test.ts`'s "Flow 9 simulation"
     unit-tests server-side (base-href injection); this step is the
     real-Ingress-proxy end-to-end confirmation of it.
   - The WS connection (nav state / position updates) is alive (e.g.
     nudge the simulator source and watch the map marker move).

### 2. MQTT auto-configuration (acceptance #2)

1. With the Mosquitto add-on installed and running, start Yapaja Go.
2. In HA: Settings → Devices & Services → MQTT → confirm a "Yapaja Go"
   device appears with the full entity table from
   `docs/04-home-assistant.md` §1, populated with live values during a
   simulator drive.
3. Restart Mosquitto (or the whole HAOS VM) → confirm entities reappear
   (Discovery replay, W-07) without any manual reconfiguration.

### 3. Update preserves data (acceptance #3, W-16)

1. Note the installed add-on version, the current map region, and create a
   test favorite + vehicle profile in the UI.
2. Record a checksum/listing of `/share/yapaja/` (tiles, db, index files).
3. Upgrade the add-on to a newer version (or, for a repeatable nightly
   test, reinstall the SAME version to simulate an update cycle).
4. Confirm: `/share/yapaja/` contents are byte-identical (except any
   expected new files from a real schema migration, see E08-T6), the test
   favorite/profile are still present, and the map/search still work
   without re-downloading anything.

### 4. USB-GPS (acceptance #4)

1. Plug a USB GPS receiver into the HAOS host before starting the add-on.
2. Confirm the add-on log's `gpsd` service line reports the found device
   (see "USB-GPS passthrough" above).
3. Confirm the Yapaja Go UI's GPS status shows a live fix (outdoors / with
   a view of the sky, or using a GPS signal simulator/replay device).
4. Unplug it while the add-on is running → confirm gpsd logs the loss and
   the Core degrades to its documented "GPS lost" behavior (dead-reckoning
   pause per the main repo's navigation/deadreckoning.ts) rather than
   crashing.

Record the outcome of each numbered step (pass/fail + log excerpt) in the
nightly job's summary, or in the PR description if run manually for a
release.
