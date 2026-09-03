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
#
# ─── WARUM STAGE 1 DEN QUELLTEXT HERUNTERLAEDT, STATT IHN ZU KOPIEREN ────────
# Der Home-Assistant-Supervisor baut ein Add-on mit dem ADD-ON-VERZEICHNIS
# als Docker-Build-Kontext -- also mit `yapaja_go/`, nicht mit der
# Repo-Wurzel. Das gilt fuer beide Installationswege gleichermassen: beim
# Store-Weg klont der Supervisor zwar das ganze Repository nach
# `/data/apps/git/<hash>/`, baut aber trotzdem aus
# `/data/apps/git/<hash>/yapaja_go/`.
#
# Diese Datei enthielt bis 2026-09-02:
#     COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
#     COPY packages/ ./packages/
#     COPY apps/ ./apps/
# Keiner dieser Pfade liegt im Kontext, und `COPY ../..` ist in Docker
# verboten. Der Bau haette also mit „COPY failed: file not found" abgebrochen
# -- was nur deshalb nie jemand sah, weil `config.yaml` ein `image:` deklarierte
# und der Supervisor deshalb gar nicht erst zu bauen versuchte (er scheiterte
# vorher am Pull eines Images, das es nicht gibt). Zwei Fehler hintereinander,
# von denen der erste den zweiten verdeckte.
#
# Stage 1 holt den Quelltext daher selbst. Das macht diesen Dockerfile
# kontextunabhaengig: er baut identisch, egal ob der Kontext `yapaja_go/`
# (Supervisor) oder die Repo-Wurzel (CI, `docker build -f`) ist.
#
# BEWUSSTE FOLGE: gebaut wird der Stand von `YAPAJA_REF` (Default `main`),
# nicht der Inhalt des lokal vorliegenden Add-on-Ordners. Beim Store-Weg ist
# das dasselbe -- der Supervisor klont ohnehin `main`. Wer einen Ordner von
# Hand nach `/addons/` kopiert und lokal aendert, muss `YAPAJA_REF` (in
# `build.yaml` unter `args:`) auf seinen Stand setzen, sonst baut er den
# Quelltext von GitHub statt seinen eigenen. Sobald es Release-Tags gibt,
# gehoert dort der Tag hinein statt `main`.
#
# `config.test.ts` erzwingt beides: kein `COPY`/`ADD` aus einer Quelle
# ausserhalb von `yapaja_go/`, und jedes `ARG` aus `build.yaml` muss hier
# deklariert sein.
# ==============================================================================

# ─── GLOBALER SCOPE: ARGs, die in einem `FROM` verwendet werden ──────────────
# Ein `ARG`, das in einer `FROM`-Zeile steht, MUSS vor dem ERSTEN `FROM`
# deklariert sein. Docker kennt zwei getrennte Gueltigkeitsbereiche: alles vor
# dem ersten `FROM` ist global und steht jeder `FROM`-Zeile zur Verfuegung;
# alles danach gehoert zu genau der Stufe, in der es steht.
#
# `ARG BUILD_FROM` stand bis 2026-09-02 unmittelbar VOR der letzten
# `FROM`-Zeile -- aber eben nach den beiden Stufen darueber, also im Scope
# von niemandem. Der Supervisor uebergab `--build-arg BUILD_FROM=...`
# korrekt, der Wert kam aber nie an, und `FROM ${BUILD_FROM}` expandierte zu
# nichts:
#
#     ERROR: failed to solve: base name (${BUILD_FROM}) should not be blank
#
# Der Fehler steckte seit E08-T4 in dieser Datei. Aufgefallen ist er erst
# jetzt, weil `config.yaml` bis dahin ein `image:` deklarierte und der
# Supervisor deshalb nie baute, sondern am Pull scheiterte.
#
# Der Default macht den Dockerfile ausserdem eigenstaendig baubar
# (`docker build -f yapaja_go/Dockerfile yapaja_go/`) und ueberlebt die vom
# Supervisor angekuendigte Abkuendigung von `build.yaml` -- solange
# `build.yaml` gelesen wird, gewinnt dessen `build_from`.
ARG BUILD_FROM=ghcr.io/gis-ops/docker-valhalla/valhalla:latest

# ---- Stage 1: build apps/core + apps/web (identical recipe to apps/core/Dockerfile) ----
FROM node:22-slim AS core-build
# Vom Supervisor bzw. `build.yaml` gesetzt; siehe Kopfkommentar.
ARG YAPAJA_REPO=Apfelsafft/Yapaja-Go-Design
ARG YAPAJA_REF=main
# Der Supervisor uebergibt hier die Add-on-Version aus `config.yaml`
# (`--build-arg BUILD_VERSION=0.1.5`). Sie wird unten im Fetch-Schritt
# GELESEN -- warum, steht dort ausfuehrlich.
ARG BUILD_VERSION=dev
RUN corepack enable
WORKDIR /app
ENV CI=true

# `curl`/`ca-certificates` sind in node:22-slim nicht enthalten; `tar` schon,
# wird aber mit angefordert, damit ein kuenftig noch schlankeres Basis-Image
# diesen Schritt nicht still zerlegt.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

# ─── WARUM HIER DIE VERSION AUFTAUCHT ───────────────────────────────────────
# Docker bildet den Cache-Schluessel einer `RUN`-Zeile aus ihrem BEFEHLSTEXT,
# nicht aus dem, was der Befehl herunterlaedt. `${YAPAJA_REF}` ist `main`,
# also ein BEWEGLICHER Zeiger, dessen Text sich nie aendert. Ergebnis vor
# 2026-09-02: dieser Schritt wurde ein einziges Mal ausgefuehrt und danach
# bei JEDEM weiteren Bau aus dem Cache genommen --
#
#     #10 [core-build 5/8] RUN set -eux; curl ... tar.gz/main
#     #10 CACHED
#
# -- im Log des Betreibers nachweisbar. Die Folge war besonders tueckisch,
# weil sie wie ein erfolgreiches Update aussah: der Supervisor liest
# `version:` aus dem GIT-KLON und zeigte brav 0.1.4 an, waehrend das Image
# den Quelltext von Stunden zuvor enthielt. Zwei aufeinanderfolgende Releases
# kamen auf dem Geraet schlicht nie an; der Betreiber suchte in der
# Oberflaeche nach einem Knopf, der in seinem Image nicht existierte.
#
# `${BUILD_VERSION}` steht deshalb IM Befehl. Es aendert sich mit jeder
# Add-on-Version, der Cache-Schluessel damit auch, und der Quelltext wird neu
# geholt. Das `echo` ist kein Debug-Rest: es IST der Mechanismus.
#
# Damit wird die ohnehin geltende Regel tragend: jede Aenderung braucht einen
# Versions-Bump in `config.yaml`. Ohne ihn liefert der Supervisor nicht nur
# kein Update aus -- der Bau wuerde jetzt auch den alten Quelltext behalten.
#
# `--strip-components=1` entfernt das von GitHub erzeugte
# `<repo>-<ref>/`-Wurzelverzeichnis, sodass in /app exakt dieselbe
# Verzeichnisstruktur liegt wie vorher durch die COPY-Zeilen.
RUN set -eux; \
    echo "Quelltext fuer Add-on-Version ${BUILD_VERSION} aus ${YAPAJA_REF}"; \
    curl -fsSL --retry 3 --retry-delay 5 \
      "https://codeload.github.com/${YAPAJA_REPO}/tar.gz/${YAPAJA_REF}" \
      -o /tmp/yapaja-src.tar.gz; \
    tar -xzf /tmp/yapaja-src.tar.gz -C /app --strip-components=1; \
    rm /tmp/yapaja-src.tar.gz; \
    test -f pnpm-lock.yaml && test -d apps/core && test -d apps/web && test -d packages

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
# `BUILD_FROM` ist oben im GLOBALEN Scope deklariert (siehe Begruendung dort)
# -- eine erneute Deklaration an dieser Stelle wuerde den Wert nicht etwa
# bereitstellen, sondern war genau der Fehler.
FROM ${BUILD_FROM}

# ─── WARUM HIER `USER root` STEHEN MUSS ─────────────────────────────────────
# Das Valhalla-Basisimage setzt einen eigenen, NICHT-privilegierten `USER`.
# Docker fuehrt jedes `RUN` als den zuletzt gesetzten Benutzer aus, und der
# wird von `FROM` mit uebernommen -- der erste `apt-get` scheiterte deshalb
# am 2026-09-02 mit:
#
#     E: Could not open lock file /var/lib/apt/lists/lock
#        - open (13: Permission denied)
#
# Das ist kein Netz- und kein Paketproblem: der Bau darf schlicht nicht in
# /var/lib schreiben. Betroffen waere danach ohnehin jeder weitere Schritt
# dieser Stufe (Node nach /usr/local, s6-overlay nach /, bashio nach
# /usr/lib, rootfs nach /).
#
# `USER root` bleibt auch zur LAUFZEIT bestehen, und das ist beabsichtigt,
# nicht bloss geduldet: dieses Add-on bringt sein eigenes s6-overlay als PID 1
# mit (`ENTRYPOINT ["/init"]`, `config.yaml`s `init: false`). s6-overlay
# richtet Dienstverzeichnisse ein, legt Fifos an und startet Dienste als
# verschiedene Nutzer -- das geht nur als root. Home-Assistant-Add-ons laufen
# standardmaessig als root; die Absicherung leisten hier `apparmor` und der
# Verzicht auf `full_access` (siehe config.yaml, Abschnitt
# „SECURITY POSTURE"), nicht ein unprivilegierter Benutzer im Container.
USER root

ARG S6_OVERLAY_VERSION=3.1.6.2

# ZWEI Architektur-Quellen, und die Reihenfolge ist wichtig:
#   `BUILD_ARCH`  setzt der HA-Supervisor bei JEDEM Add-on-Bau (amd64 |
#                 aarch64 | armv7 | ...). Das ist hier die verlaessliche.
#   `TARGETARCH`  ist ein automatisches BuildKit-ARG (amd64 | arm64) und
#                 damit nur gesetzt, wenn wirklich mit BuildKit gebaut wird.
#
# Vorher stand hier nur `${TARGETARCH:-amd64}`. Baut der Supervisor ohne
# BuildKit -- was er darf --, ist `TARGETARCH` leer und der Ausdruck faellt
# still auf `amd64` zurueck. Auf einem Raspberry Pi haette das eine
# x86-Node-Binary in ein aarch64-Image gelegt: ein Bau, der GRUEN durchlaeuft
# und dessen Ergebnis beim ersten Start mit „exec format error" stirbt.
ARG BUILD_ARCH
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
    osmium-tool \
  && rm -rf /var/lib/apt/lists/*

# ---- Node.js: official prebuilt tarball (works regardless of the base ----
# ---- image's own package manager/repos having a recent-enough Node). ----
ENV NODE_VERSION=22.11.0
RUN set -eux; \
    ARCH="${BUILD_ARCH:-${TARGETARCH:-}}"; \
    test -n "$ARCH" || { echo "neither BUILD_ARCH nor TARGETARCH is set -- refusing to guess"; exit 1; }; \
    case "$ARCH" in \
      amd64|x86_64) NODE_ARCH=x64 ;; \
      aarch64|arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported arch=$ARCH (config.yaml only lists amd64/aarch64)"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    rm /tmp/node.tar.xz; \
    node --version

# ---- s6-overlay v3 (our own PID 1 / service supervisor) ----
RUN set -eux; \
    ARCH="${BUILD_ARCH:-${TARGETARCH:-}}"; \
    test -n "$ARCH" || { echo "neither BUILD_ARCH nor TARGETARCH is set -- refusing to guess"; exit 1; }; \
    case "$ARCH" in \
      amd64|x86_64) S6_ARCH=x86_64 ;; \
      aarch64|arm64) S6_ARCH=aarch64 ;; \
      *) echo "unsupported arch=$ARCH"; exit 1 ;; \
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
RUN set -eux; \
    curl -fsSL "https://github.com/hassio-addons/bashio/archive/refs/tags/v${BASHIO_VERSION}.tar.gz" \
      | tar -xz -C /tmp; \
    mv "/tmp/bashio-${BASHIO_VERSION}/lib" /usr/lib/bashio; \
    ln -sf /usr/lib/bashio/bashio /usr/bin/bashio; \
    rm -rf "/tmp/bashio-${BASHIO_VERSION}"; \
    # `ln -sf` legt auch dann einen Symlink an, wenn das Ziel gar nicht
    # existiert -- der Bau bliebe gruen und der Fehler kaeme erst zur
    # Laufzeit als "unable to spawn ./run: No such file or directory", also
    # an der Stelle, an der er am schwersten zuzuordnen ist. Diese beiden
    # Zeilen machen daraus einen Bauabbruch mit klarer Ursache.
    test -x /usr/lib/bashio/bashio; \
    test -x /usr/bin/bashio

# Dieselbe Absicherung fuer s6-overlay: die Shebangs unter `rootfs/` zeigen
# auf `/command/with-contenv` (das ist der Pfad, den s6-overlay v3
# tatsaechlich mitbringt -- ein `/usr/bin/with-contenv` gibt es dort NICHT,
# das liefern nur die offiziellen HA-Basisimages, auf denen wir nicht
# bauen). Fehlt die Datei, sollen die Dienste nicht erst beim Start
# scheitern.
RUN test -x /command/with-contenv && test -x /command/execlineb

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

# ---- Datenaufbereitungs-Skripte (Kacheln, Routinggraph, Lite-Suchindex) ----
# ─── WARUM DIESE DREI DATEIEN INS IMAGE GEHOEREN ────────────────────────────
# Ohne sie ist JEDE Anweisung, die dieses Produkt seinem Betreiber gibt, auf
# seinem Geraet unausfuehrbar. Der Fehlercode `NO_DOWNLOAD_URL` sagt
# „services/tiles/build-pmtiles.sh <pfad>", die Installationspruefung sagt
# dasselbe, `docs/installation.md` §C beschreibt es ausfuehrlich -- und bis
# 2026-09-02 lag keine dieser Dateien im Add-on-Image. Wer Yapaja ueber den
# HA-Store installiert, hat dieses Repository nicht; fuer ihn verwiesen alle
# drei Stellen auf etwas, das es bei ihm nirgends gibt.
#
# Das ist derselbe Fehler wie der Katalog, der auf 404-URLs zeigte: eine
# Anweisung, die nicht befolgt werden KANN, ist schlimmer als keine -- sie
# schickt den Betreiber auf die Fehlersuche in seiner eigenen Installation.
#
# Sie kommen aus dem in Stufe 1 heruntergeladenen Quelltext, nicht aus dem
# Build-Kontext (der ist `yapaja_go/`, siehe Kopfkommentar).
#
# NUR `build-pmtiles.sh` -- und das ist Absicht, keine Nachlaessigkeit.
#   * `services/valhalla/build-tiles.sh` braucht einen Docker-Socket, den es
#     in einem HA-Add-on nicht gibt. Der ROUTINGGRAPH wird deshalb NICHT ueber
#     dieses Skript gebaut, sondern ueber `yapaja-build-graph` (rootfs), das
#     die Bau-Werkzeuge benutzt, die in diesem Image ohnehin schon liegen --
#     siehe den Abschnitt „/custom_files" weiter unten.
#   * `services/valhalla/build-lite-index.sh` ruft `pnpm exec tsx src/...` aus
#     dem Repository auf, das hier nicht liegt. Der SUCHINDEX wird deshalb
#     nicht ueber dieses Skript gebaut, sondern ueber
#     `yapaja-build-lite-index` (rootfs) gegen das gebaute Werkzeug
#     `/app/apps/core/dist/lite-index.js`.
#
#     KORREKTUR 0.3.4: hier stand bis dahin, dieses eine bleibe „ein Weg auf
#     einem anderen Rechner bauen und die Datei ablegen", weil `osmium` nicht
#     installiert sei. Das beschrieb keine Grenze, sondern zwei Auslassungen:
#     `osmium-tool` ist ein gewoehnliches Ubuntu-Paket (steht jetzt oben in
#     der apt-Zeile), und das Index-Werkzeug fehlte nur, weil
#     `apps/core/tsup.config.ts` allein `src/index.ts` als Einstiegspunkt
#     fuehrte. Der Satz hat den Betreiber die Adresssuche gekostet, obwohl
#     der Quelltext dafuer seit E05-T5 fertig war.
COPY --from=core-build /app/services/tiles/build-pmtiles.sh /opt/yapaja/bin/build-pmtiles.sh
RUN chmod +x /opt/yapaja/bin/build-pmtiles.sh && test -x /opt/yapaja/bin/build-pmtiles.sh

# ---- Nachweis, dass die drei Bau-Wege im Image WIRKLICH begehbar sind ------
# Kein Kommentar, sondern ein Abbruch: fehlt eines dieser Stuecke, faellt der
# BAU um, nicht erst der Betreiber beim Draufdruecken. Genau diese Sorte
# Luecke -- Werkzeug dokumentiert, aber nicht im Image -- hat diese Serie
# dreimal gekostet (planetiler-JAR-Modus, Routinggraph, Suchindex).
RUN set -eux; \
    command -v osmium; \
    test -f /app/apps/core/dist/lite-index.js; \
    node /app/apps/core/dist/lite-index.js 2>&1 | grep -q 'Usage:'

# ---- /custom_files: die eine Zeile, ohne die kein Routinggraph laeuft ------
#
# `valhalla_build_config` backt ABSOLUTE Pfade in die erzeugte
# `valhalla.json` -- `--mjolnir-tile-dir ${TILE_DIR}` und Geschwister, wobei
# TILE_DIR beim gis-ops-Image immer unter `/custom_files` liegt
# (`scripts/helpers.sh` setzt es hart). Im Compose-Stack stimmt das, weil
# dort das Datenverzeichnis GENAU dorthin gemountet ist.
#
# In diesem Add-on gibt es kein solches Mount: `valhalla_service` startet mit
# `/share/yapaja/valhalla/tiles/valhalla.json`. Ein Graph, dessen Config auf
# `/custom_files/valhalla_tiles` zeigt, findet seine Kacheln dort also nicht.
# Das betraf BEIDE Wege zu einem Graphen -- den Bau im Add-on ebenso wie den
# dokumentierten „woanders bauen und per Samba ablegen": eine anderswo
# erzeugte valhalla.json trug denselben Pfad und waere hier ebenso ins Leere
# gelaufen.
#
# Der Symlink loest beides auf einmal, ohne eine einzige Zeile in der von
# Valhalla erzeugten Config anzufassen (was frueher schon einmal in
# „No such node (service_limits...)" endete, siehe
# services/valhalla/build-tiles.sh). Er zeigt ins Leere, bis der Supervisor
# /share einhaengt -- das ist bei einem Symlink kein Problem, er wird erst
# beim Zugriff aufgeloest.
RUN rm -rf /custom_files && ln -s /share/yapaja/valhalla/tiles /custom_files

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

# 8099 ist der Supervisor-Default fuer `ingress_port`, den config.yaml
# bewusst NICHT setzt (der Add-on-Linter verwirft Schluessel, die nur den
# Default wiederholen -- siehe dortiger Kommentar). Ingress-only by default (see
# config.yaml's `ports: {}` comment for the documented opt-in direct-access
# path). 8002/2322/2947 (Valhalla/Photon/gpsd) are intentionally NOT exposed
# here: they're internal, container-local (127.0.0.1) links the Core talks
# to, never meant to be reachable from outside this container.
EXPOSE 8099

ENTRYPOINT ["/init"]
