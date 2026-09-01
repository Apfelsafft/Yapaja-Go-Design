# Yapaja Go (Home Assistant Add-on)

Packages Yapaja Go — offline motorhome navigation (`apps/core` + `apps/web`
in the parent repo) — as a Home Assistant add-on: single container, s6-overlay-
supervised, MQTT-integrated, served through HA Ingress.

For install steps, RAM sizing, USB-GPS setup, and the manual/nightly VM test
protocol, see [`DOCS.md`](./DOCS.md) (this is also what HA shows in the
add-on's own "Documentation" tab once installed).

## Layout

```
yapaja_go/
├── config.yaml   # HA add-on manifest: name/slug/version, arch, ingress,
│                 # map (share:rw, W-16), services (mqtt:need), usb+udev,
│                 # options/schema (region, mqtt_prefix, photon_enabled,
│                 # gps_source, log_level, memory tuning)
├── build.yaml    # per-arch base image for the Supervisor's multi-arch builder
├── Dockerfile    # builds apps/core+web, bundles Valhalla/Photon/gpsd, s6-overlay
├── rootfs/
│   └── etc/
│       ├── yapaja/init-yapaja-config.sh   # bashio config + MQTT creds -> env
│       └── s6-overlay/s6-rc.d/            # service tree (see below)
├── DOCS.md       # operator docs (HA "Documentation" tab)
├── README.md     # this file
└── icon.png      # add-on store icon
```

## Service tree (`rootfs/etc/s6-overlay/s6-rc.d/`)

```
init-yapaja-config (oneshot)   -- bashio config + MQTT creds -> container env
        │
        ├── valhalla (longrun)  -- routing, :8002 (idles if no graph installed)
        │       │
        │       └── core (longrun) -- Fastify app, :8099 (config.yaml ingress_port)
        ├── photon (longrun)    -- search, :2322 (idles if disabled/no index)
        └── gpsd (longrun)      -- USB-GPS bridge, :2947 (idles if gps_source != usb)
```

`core` declares `dependencies.d/valhalla` (starts after it, per docs/04 §3's
"Abhängigkeits-Reihenfolge") but NOT `photon`/`gpsd` — both degrade
gracefully on their own (Photon → lite-search fallback, W-12; gpsd → the
Core's existing GPS-source handling), so neither should be able to block
Core's own startup. See each `run` script's header comment for the full
reasoning, and `rootfs/etc/yapaja/init-yapaja-config.sh` for exactly which
env vars get set and why (cross-checked against the actual `process.env.*`
reads in `apps/core/src/index.ts`, `apps/core/src/mqtt/config.ts`, and
`apps/core/src/map/paths.ts`).

## What was NOT verified here

This add-on could not be built/run against a live Docker daemon inside the
sandbox this was authored in (no daemon available). Two things most likely
to need a one-line fix once actually built for real:

1. `Dockerfile`'s `photon-src` stage assumes `photon.jar` lives at
   `/photon/photon.jar` in `rtuszik/photon-docker:latest`.
2. The final stage assumes `valhalla_service` is already on `PATH` in
   `ghcr.io/gis-ops/docker-valhalla/valhalla:latest` (the base per
   `build.yaml`).

Everything else (the s6-rc.d service tree itself, bashio config plumbing,
env-var wiring against the real Core code, `config.yaml`'s schema) does not
depend on those two specifics and was cross-checked directly against
`apps/core/src/`.

## Why this folder sits at the repository root

The HA Supervisor only recognizes a Git repository as an *add-on repository*
if a `repository.yaml` sits in its ROOT, and it then looks for add-ons in
directories one level below that root, each containing a `config.yaml`. So
this package lives at `yapaja_go/` (repo root), not two levels deep — that
is what makes **Settings → Add-ons → Add-on Store → ⋮ → Repositories →
`https://github.com/Apfelsafft/Yapaja-Go-Design`** actually list "Yapaja Go".

## CI strategy

See [`PACKAGING.md`](./PACKAGING.md) (next to this file) for why the
config-validity check runs per-PR (in-repo, deterministic) while
`frenck/action-addon-linter` and the full multi-arch Supervisor-builder
build run nightly/manual only.
