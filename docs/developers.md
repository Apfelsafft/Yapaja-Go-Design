# Developer Guide

How Yapaia Go is built, how to work on it, and the things that have cost
someone a day already.

This is the entry point for contributors. The numbered documents
(`00-vision-scope` … `08-wargame`) are design records from the planning phase —
excellent for understanding *why* a decision was made, but where they describe
a future that has since arrived, **this document describes what actually
ships**.

**Contents**

1. [Getting set up](#getting-set-up)
2. [Repository layout](#repository-layout)
3. [Architecture](#architecture)
4. [Interfaces](#interfaces)
5. [Things that will trip you up](#things-that-will-trip-you-up)
6. [Testing](#testing)
7. [CI/CD pipeline](#cicd-pipeline)
8. [Releasing](#releasing)
9. [Conventions](#conventions)

---

## Getting set up

**Requirements**

| | |
|---|---|
| Node | **22** (what CI runs; the toolchain assumes its built-in `WebSocket` and `fetch`) |
| pnpm | **10.33.0** (pinned via `packageManager` — use Corepack) |
| Docker | Only for the containerised services and the add-on image |

```bash
pnpm install --frozen-lockfile
pnpm dev            # core + web in watch mode
```

The web app comes up on `http://localhost:5173`, the core API on
`http://localhost:8080`. Inside the Home Assistant add-on the core listens on
8099 instead and is reached exclusively through Ingress — never assume 8080 in
add-on code.

**The essential four commands:**

```bash
pnpm lint           # eslint across everything
pnpm typecheck      # tsc --noEmit per package
npx vitest run      # the whole unit suite — see the warning below
pnpm build          # production build of both apps
```

> ⚠️ **`pnpm -r test` does not work.** Use `npx vitest run` **from the
> repository root**. The include globs in `vitest.config.ts` are root-relative,
> so running vitest from inside `apps/core` reports "No test files found" —
> which looks like a green run and is not one.

> ⚠️ **Playwright must run from `apps/web`** (or via `pnpm e2e` at the root,
> which filters correctly).

---

## Repository layout

```
Yapaja-Go-Design/
├── apps/
│   ├── core/           @yapaia/core — Fastify 5 API, SQLite, the brain
│   └── web/            @yapaia/web  — React 18 + Vite frontend
├── packages/
│   ├── shared/         @yapaia/shared    — types + validators, used by both
│   ├── ui/             @yapaia/ui        — shared React components
│   └── addon-sdk/      @yapaia/addon-sdk — public SDK for third-party add-ons
├── services/           Containerised backends: valhalla, photon, tiles, gpsd
├── yapaja_go/          The Home Assistant add-on (manifest, Dockerfile, s6)
├── addons-examples/    Reference add-ons — deliberately NOT workspace members
├── e2e/                security/, perf/, golden-routes/ suites
├── scripts/            CI gate scripts (audit, licences, wargame, openapi …)
├── docs/               This directory
└── tasks/              Historical task prompts from the planning phase
```

`repository.yaml` at the root is what makes this repo installable as a Home
Assistant add-on repository; the Supervisor looks for add-on directories
exactly one level below it, which is why `yapaja_go/` sits where it does.

---

## Architecture

### The shape of it

```
   Browser (React)                    Core (Fastify)              Services
  ┌────────────────┐              ┌──────────────────┐        ┌─────────────┐
  │ MapLibre       │◀── PMTiles ──│ /tiles           │◀───────│ tiles       │
  │ Zustand stores │◀── REST ────▶│ /api/v1/*        │───────▶│ valhalla    │
  │ Drive overlay  │◀── WS ──────▶│ /ws/v1           │───────▶│ photon      │
  └────────────────┘              │                  │◀───────│ gpsd        │
                                  │   Event bus      │        └─────────────┘
                                  └────────┬─────────┘
                                           │
                              ┌────────────┴────────────┐
                              │  MQTT     │  HA REST/WS │──▶ Home Assistant
                              └───────────┴─────────────┘
```

**The core owns the truth.** Trip state, position and routes live in the core,
not in the browser. This is why closing the tablet does not end your trip, and
why several browsers can watch the same journey. Every browser is a view.

**One internal event bus.** Position updates, navigation state and route
changes are published once and fan out to every consumer — the WebSocket, the
MQTT bridge, the HA-internal channel. Adding a consumer means subscribing, not
threading a call through the navigation code.

### Core modules (`apps/core/src/`)

| Module | Responsibility |
|---|---|
| `position/` | Source fusion: gpsd, browser, HA device_tracker, simulator. Dead reckoning, plausibility guard |
| `routing/` | Valhalla client, vehicle-profile → routing-cost translation, polyline handling |
| `navigation/` | Turn-by-turn state machine, map matching, instruction generation, rerouting |
| `search/` | Photon client plus the offline `lite` index and its CLI builder |
| `profiles/` | Vehicle profiles, activation, dimension-confirmation tracking |
| `map/` | Region catalogue, download/build jobs, PMTiles serving, styles |
| `ha/` | Everything Home Assistant: states bridge, command watcher, helpers, dashboard generation, config resolution |
| `mqtt/` | MQTT bridge and HA auto-discovery payloads |
| `addons/` | Add-on runtime, manifest handling, sandbox enforcement |
| `bus/` | The internal event bus and the WebSocket server |
| `auth/`, `security/` | Token auth, security headers, violation events |
| `system/` | Health, info, and the preflight (🩺) check |

### Web modules (`apps/web/src/`)

`map/` (MapLibre), `drive/` (drive mode, lock, resume), `routing/`, `search/`,
`profiles/`, `favorites/`, `settings/`, `onboarding/`, `shell/` (layout,
handedness, screen-awake), `theme/`, `addons/`, `embed/` (the page the Lovelace
card frames), `pwa/`, `state/` + `store/` (Zustand).

### Key decisions

Recorded as ADRs in [`01-architecture.md`](01-architecture.md). The short
version:

- **Valhalla** for routing, because it handles height/width/length/weight
  natively and runs offline. This is the single decision the whole product
  rests on.
- **PMTiles** for maps: one file per region, HTTP range requests, no tile
  server process.
- **Photon** for search, with a home-grown lightweight index as a fallback so
  that search still works on a memory-constrained machine.
- **SQLite** for persistence: one file, no server, trivially backed up.
- **One container** for the add-on, s6-overlay supervised, so the Supervisor
  has one thing to start and stop.

---

## Interfaces

### REST — `/api/v1/*`

66 paths, generated into [`openapi.json`](openapi.json) from the Fastify routes
and the `@yapaia/shared` schemas. **The spec is CI-enforced**: change a route
without regenerating and the `docs-freshness` job fails.

```bash
pnpm openapi:generate     # after any route change
pnpm openapi:check        # what CI runs
```

Groups: `addons` (16), `map` (9), `navigation` (8), `simulator` (5),
`position` (4), `profiles` (4), `favorites` (3), `system` (3), `auth`,
`history`, `routes`, `search`, `settings` (2 each), plus `health`, `jobs`,
`security` and the `/tiles/{region}` endpoint.

The one endpoint worth knowing if you integrate from outside:
`POST /api/v1/navigation/destination` takes `{query | latlng, profile_id?,
autostart?}`, geocodes, routes and optionally starts — the whole flow in one
call.

### WebSocket — `/ws/v1`

Client sends `{type:'subscribe', topics:['pos/*','nav/*']}`. Server sends
`{topic, payload, ts}`. Topics are the internal bus topics:

| Topic | Payload | Frequency |
|---|---|---|
| `pos/update` | `Position` | 1 Hz (up to 5 Hz) |
| `nav/state` | `NavState` | 1 Hz while navigating |
| `nav/instruction` | `{maneuver, distance_m, say}` | on change / announce threshold |
| `route/updated` | `{route, reason}` | on change |
| `route/deviation` | `{distance_from_route_m}` | on detection |
| `system/health` | as REST health | on change + every 30 s |
| `event/security_violation` | `{vector, addonId, detail, at}` | on every blocked sandbox escape |

### Home Assistant — two channels

Both write the **same entity IDs**, and they coordinate rather than compete.

| | MQTT | HA-internal |
|---|---|---|
| Transport | Broker + auto-discovery | `POST /api/states` via Supervisor |
| Option | `mqtt_enabled` | `ha_internal` |
| Device & history | Yes | No |
| Survives HA restart | Yes | No — hence the 5-minute refresh |
| Commands | `button.*` / `select.*` | `input_button.*` / `input_select.*` helpers |

**While MQTT is connected, the internal channel holds back.** Two writers on
one entity would flap and nobody could say which value was current. When the
broker drops, the internal channel takes over — collision avoidance that
doubles as failover. The command side mirrors this exactly: the helpers idle
while MQTT is live.

Details, including why helpers must be created over the WebSocket API and not
REST: [`04-home-assistant.md`](04-home-assistant.md).

### The add-on SDK

`@yapaia/addon-sdk` is the public surface for third-party add-ons: a manifest
format, two plugin types (sandboxed frontend, service), and a git-based
registry. Changing it is a compatibility event — the `addon-compat-check` job
runs reference add-ons against your change. See
[`addon-dev-guide.md`](addon-dev-guide.md) and [`05-addon-system.md`](05-addon-system.md).

---

## Things that will trip you up

Each of these cost real debugging time. They are here so they cost you none.

### MapLibre 6's worker

MapLibre 6 derives its worker URL from `import.meta.url`, which **breaks when
bundled**. A dead worker fails silently and spectacularly: labels don't render,
circles don't draw, no console error, no failed request. It looks like a style
problem and is not.

`apps/web/src/map/maplibreWorker.ts` sets the worker URL explicitly, and
`MapView.tsx` calls `ensureMaplibreWorkerUrl()` immediately before
`new maplibregl.Map(…)`. Keep that call there.

MapLibre 6 is also ESM-only and requires WebGL2.

### Never hardcode `/api/...` in the frontend

Under Home Assistant Ingress the app is served from
`/api/hassio_ingress/<token>/`. An absolute `/api/v1/foo` resolves against the
Home Assistant root and silently misses the add-on. **Always** build URLs from
`import.meta.env.BASE_URL`:

```ts
fetch(`${import.meta.env.BASE_URL}api/v1/system/preflight`)
```

This is wargame case W-15, and `apps/web/e2e/subpath.spec.ts` guards it.

### ESM: relative imports need `.js`

The core is ESM. `import { x } from './thing.js'` — even though the file is
`thing.ts`. Omitting it fails at runtime, not at compile time.

### Entity IDs are `yapaja_`, helpers are `yapaia_`

The product is *Yapaia*; the older entities say `yapaja` because Home Assistant
never renames an ID once assigned, and the name predates the correction in
0.6.7. Anything **new** gets the correct spelling. They cannot collide:
`button.*` and `input_button.*` are different domains.

### Never check an exit status through a pipe

```bash
# wrong — you get grep's status, not the command's
pnpm test | grep -c passed

# right
pnpm test > /tmp/out.log 2>&1; echo "EXIT=$?"
```

### Mutation-check every new assertion

House rule, and it has repeatedly earned its keep. Break the code the test
covers and confirm the test goes **red**. Two tests in a recent release passed
without their feature being present at all — a green run does not prove a test
works, only a red one does.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit | `npx vitest run` (from root) | ~3255 tests across apps, packages, add-on config, reference add-ons |
| E2E | `pnpm e2e` | 167 Playwright tests: full user flows, offline guarantees, touch targets |
| Security | `pnpm e2e:security` | Sandbox-escape vectors, all must be blocked *and* logged |
| Performance | `pnpm perf` | Budgets on the N100 reference profile |
| Golden routes | `pnpm golden-routes` | Routing correctness against known restrictions — needs a running core |

The **GPS simulator** is the central test tool: it replays a route, a GPX file,
or a deliberate wrong turn to exercise rerouting, at a configurable speed
factor. Documented in [`07-testing-qa.md`](07-testing-qa.md) §2.

Two suites carry their own **mutation proofs** in CI — the security suite and
the performance pipeline each have a job that deliberately breaks something and
requires the suite to go red. A safety net that cannot demonstrate it catches
anything is decoration.

---

## CI/CD pipeline

### On every pull request (`ci.yml`) — 14 jobs, all blocking

| Job | Gate |
|---|---|
| **Quality Checks** | lint, typecheck, unit tests, build |
| **E2E (Playwright)** | 167 browser tests |
| **Security Suite** | Sandbox escapes blocked and logged, plus a mutation proof |
| **API-Security-Smoke** | Auth matrix and security headers against a real built core |
| **Performance Budgets** | N100 profile budgets |
| **Perf-Degradation-Nachweis** | A 200 ms fixture *must* turn the pipeline red |
| **Dependency-Audit & Licence Gate** | osv-scanner; prod vulnerabilities block; licence inventory current; audit exceptions need a reason and expire within 90 days |
| **Doku-Aktualität** | OpenAPI spec current, wargame IDs covered by troubleshooting, changeset breaking-change category present |
| **HA Add-on Config Validity** | `config.yaml` structure, and that `CHANGELOG.md` has an entry for the shipped version |
| **Docker Build & Health Check** | The core image builds and answers |
| **Add-on-Image bauen** | The add-on image builds and is inspected inside the container |
| **Golden-Routes LI** | Routing safety gate — explicitly a merge blocker |
| **Valhalla / Lite-Search / Photon** | Build and smoke each data pipeline |

Performance jobs are skipped on pull requests by design and run nightly.

### Nightly (`nightly.yml`)

The full suite plus what is too slow or too heavy for a PR: the 24-hour
performance soak, multi-architecture builds, the HA add-on linter, ETA
plausibility, and a data-update runbook smoke test.

### Release (`release.yml`)

Runs the whole nightly suite again, re-runs the docs and changeset gates as a
double check, verifies reference add-on compatibility, merges changesets and
bumps the add-on version, pushes multi-arch images to ghcr.io, and creates the
GitHub release.

### Minimising Actions usage

This project deliberately keeps Actions consumption low. Run the gates locally
before pushing — `pnpm lint && pnpm typecheck && npx vitest run && pnpm build`
catches most of it, and `pnpm e2e` catches nearly all the rest.

---

## Releasing

1. Work on a branch; never push straight to `main`.
2. Bump `version:` in `yapaja_go/config.yaml`. **The add-on config test fails
   if `yapaja_go/CHANGELOG.md` has no matching `## <version>` heading** — this
   is on purpose. Home Assistant shows that changelog to operators before they
   click "Update", so shipping without one means shipping a change nobody was
   told about.
3. Write the changelog entry for a *person*, not a diff: what changes for them,
   and the error message they saw if it fixes one.
4. Open a PR. **CI is a mandatory merge blocker** — no merging on a partial
   green.
5. Squash-merge.

The add-on has no `image:` in `config.yaml`, so the Supervisor builds locally
on the user's machine. That is why the install progress bar sits at 0 % and why
the first install takes minutes.

---

## Conventions

**Commits and comments explain *why*.** The codebase deliberately carries long
explanatory comments where a decision is non-obvious or where a previous
attempt failed. When you remove such a mechanism, remove its comment; when you
add one, say what breaks without it.

**Delete code that does nothing.** A line that has no effect looks like the
reason something works and will mislead the next person. If measurement shows a
call is ineffective, it goes — not into a comment as decoration.

**Prefer measuring movement over endpoints in tests.** "Zoom > 10" passed
without the feature because the fixture region was small enough to satisfy it
anyway. "Set zoom to 6, then assert it moved" does not.

**German and English.** Code comments, the changelog and the older docs are
German. This guide, the manual and the README are English. Match the file you
are editing rather than mixing within one.

---

## Where to look next

| | |
|---|---|
| Why a decision was made | [`01-architecture.md`](01-architecture.md) (ADRs) |
| Full API detail | [`03-api-spec.md`](03-api-spec.md), [`openapi.json`](openapi.json) |
| Home Assistant internals | [`04-home-assistant.md`](04-home-assistant.md) |
| Add-on system | [`05-addon-system.md`](05-addon-system.md), [`addon-dev-guide.md`](addon-dev-guide.md) |
| UI/UX rules | [`06-ui-ux-guidelines.md`](06-ui-ux-guidelines.md) |
| Test strategy | [`07-testing-qa.md`](07-testing-qa.md) |
| Known risk scenarios (W-IDs) | [`08-wargame.md`](08-wargame.md), [`troubleshooting.md`](troubleshooting.md) |
| Open work | [`backlog.md`](backlog.md) |
