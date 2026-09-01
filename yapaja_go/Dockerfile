# ==============================================================================
# Yapaja Go -- Home Assistant Add-on image (E08-T4, docs/04 §3).
#
# Multi-stage build:
#   1. `core-build`    -- builds apps/core + apps/web exactly like the
#                          standalone `apps/core/Dockerfile` does.
#   2. `photon-src`     -- source of `photon.jar` (a portable JAR, unlike
#                          native binaries -- safe to lift out of its image).
#   3. final stage      -- `FROM $BUILD_FROM` (build.yaml points this at
#                          `ghcr.io/gis-ops/docker-valhalla/valhalla:latest`,
#                          amd64+aarch64 -- see build.yaml's comment for why
#                          we build ON TOP OF the Valhalla image rather than
#                          copying Valhalla's binaries into a Node base: its
#                          native binary + shared-library graph is exactly
#                          what that image already gets right, and re-linking
#                          it against an unrelated distro's libc is a classic
#                          way to end up with a container that "builds fine"
#                          and then segfaults at runtime).
#
# NOTE for whoever runs this against a live Docker daemon for the first time
# (this add-on's Dockerfile could not be built/executed inside the sandbox
# this was authored in -- no docker daemon available, see
# yapaja_go/README.md "What was NOT verified here"): the exact base-OS
# package name for the JRE, and confirming `valhalla_service` is already on
# PATH in the gis-ops image, are the two most likely things to need a
# one-line fix once actually built. Everything else (s6-rc.d service tree,
# bashio config plumbing, env wiring) is independent of those specifics.
# ==============================================================================

# ---- Stage 1: build apps/core + apps/web (identical recipe to apps/core/Dockerfile) ----
FROM node:22-slim AS core-build
RUN corepack enable
WORKDIR /app
ENV CI=true
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN rm -rf node_modules apps/core/node_modules apps/web/node_modules packages/shared/node_modules \
  && pnpm install --prod --frozen-lockfile --filter @yapaja/core...

# ---- Stage 2: Photon JAR source (JAR files are portable across JVMs) ----
FROM rtuszik/photon-docker:latest AS photon-src
# ASSUMPTION (documented above): photon.jar lives at /photon/photon.jar in
# this image, matching its own published usage docs (`java -jar photon.jar`
# run from /photon). Verify against the live image if the nightly multi-arch
# build job (`addon-multiarch-build`) fails to find it here.

# ---- Final stage: Valhalla's own base image + Node.js + JRE + gpsd + s6-overlay ----
ARG BUILD_FROM
FROM ${BUILD_FROM}
ARG S6_OVERLAY_VERSION=3.1.6.2
ARG TARGETARCH

# `valhalla_service` + its shared libs are ALREADY present on PATH in this
# base image (that's the entire point of building FROM it -- see the header
# comment). We only need to add: Node.js (to run the Core), a JRE (to run
# Photon's JAR), gpsd (USB-GPS bridge), bashio (Supervisor config/services
# API used by rootfs/etc/yapaja/init-yapaja-config.sh), and s6-overlay itself
# (our own init/service-supervisor -- see config.yaml's `init: false`, which
# tells the Supervisor we bring our own instead of relying on a HA base
# image's bundled one).
#
# `default-jre-headless` (Debian/Ubuntu metapackage) rather than pinning an
# exact `openjdk-XX-jre-headless` version number: keeps this Dockerfile
# working across whatever Ubuntu release the upstream Valhalla image tracks
# without us having to chase its version. Photon (komoot) targets modern
# JREs (11+); any `default-jre-headless` on a currently-maintained Ubuntu
# base satisfies that.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    xz-utils \
    default-jre-headless \
    gpsd \
    jq \
  && rm -rf /var/lib/apt/lists/*

# ---- Node.js: official prebuilt tarball (works regardless of the base ----
# ---- image's own package manager/repos having a recent-enough Node). ----
ENV NODE_VERSION=22.11.0
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH} (config.yaml only lists amd64/aarch64)"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm /tmp/node.tar.xz; \
    node --version

# ---- s6-overlay v3 (our own PID 1 / service supervisor) ----
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/s6-overlay-noarch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz"; \
    curl -fsSL -o /tmp/s6-overlay-arch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz"; \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz; \
    rm /tmp/s6-overlay-*.tar.xz

# ---- bashio (Supervisor config/services helper used by our init script) ----
# Bundled by all official HA base images; installed manually here since we
# build FROM the (non-HA) Valhalla image instead (see header comment).
ARG BASHIO_VERSION=0.16.2
RUN curl -fsSL "https://github.com/hassio-addons/bashio/archive/refs/tags/v${BASHIO_VERSION}.tar.gz" \
    | tar -xz -C /tmp \
  && mv "/tmp/bashio-${BASHIO_VERSION}/lib" /usr/lib/bashio \
  && ln -sf /usr/lib/bashio/bashio /usr/bin/bashio \
  && rm -rf "/tmp/bashio-${BASHIO_VERSION}"

# ---- Photon ----
RUN mkdir -p /opt/photon
COPY --from=photon-src /photon/photon.jar /opt/photon/photon.jar

# ---- Core (built app + its production node_modules) ----
WORKDIR /app
COPY --from=core-build /app/package.json ./package.json
COPY --from=core-build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=core-build /app/node_modules ./node_modules
COPY --from=core-build /app/apps/core/node_modules ./apps/core/node_modules
COPY --from=core-build /app/apps/core/package.json ./apps/core/package.json
COPY --from=core-build /app/apps/core/dist ./apps/core/dist
COPY --from=core-build /app/apps/web/dist ./apps/core/public

# ---- Our rootfs overlay: s6-rc.d service tree + init script (see ----
# ---- rootfs/etc/s6-overlay/s6-rc.d/ and rootfs/etc/yapaja/) ----
COPY rootfs/ /

# All `run`/`up`/`finish` scripts must be executable; git preserves the exec
# bit set on them in this repo, but this RUN is a belt-and-braces guarantee
# for build environments that don't (e.g. some CI checkout configurations).
RUN chmod +x \
    /etc/s6-overlay/s6-rc.d/init-yapaja-config/up \
    /etc/s6-overlay/s6-rc.d/valhalla/run \
    /etc/s6-overlay/s6-rc.d/photon/run \
    /etc/s6-overlay/s6-rc.d/gpsd/run \
    /etc/s6-overlay/s6-rc.d/core/run \
    /etc/s6-overlay/s6-rc.d/core/finish \
    /etc/yapaja/init-yapaja-config.sh

# 8099 matches config.yaml's `ingress_port` -- Ingress-only by default (see
# config.yaml's `ports: {}` comment for the documented opt-in direct-access
# path). 8002/2322/2947 (Valhalla/Photon/gpsd) are intentionally NOT exposed
# here: they're internal, container-local (127.0.0.1) links the Core talks
# to, never meant to be reachable from outside this container.
EXPOSE 8099

ENTRYPOINT ["/init"]
