# Home Assistant Add-on Packaging (E08-T4)

Packaging notes for the Yapaja Go add-on. See [`README.md`](./README.md) for
the add-on's own layout and [`DOCS.md`](./DOCS.md) for operator-facing
install/RAM/GPS/update docs and the manual VM test protocol.

## Repository layout: this monorepo IS the add-on repository

docs/04-home-assistant.md §3 originally described the target as a *separate*
`yapaja-go-ha-addon` GitHub repository, with the package built here first
(under `ha-addon/yapaja_go/`) and mirrored out later. That mirror step never
happened, and the practical consequence was that the documented GUI install
path did not work at all: the Supervisor recognizes a Git repository as an
add-on repository only when a `repository.yaml` sits in its **root**, and it
discovers add-ons as directories **one level below that root**, each with a
`config.yaml`. Two levels deep, `ha-addon/yapaja_go/` was invisible to it —
`docs/installation.md` §A carried an explicit warning saying exactly that.

`feat/gui-install-path` fixes this in place instead of waiting on a mirror:

- `repository.yaml` now sits in the monorepo root (name / url / maintainer);
- the add-on package moved (`git mv`) from `ha-addon/yapaja_go/` to
  `yapaja_go/` — repo root, one level below `repository.yaml`.

An operator therefore adds
`https://github.com/Apfelsafft/Yapaja-Go-Design` under **Settings → Add-ons →
Add-on Store → ⋮ → Repositories** and gets "Yapaja Go" as an installable
add-on. Everything else in this monorepo (`apps/`, `packages/`, `services/`,
`docs/`, …) is simply ignored by the Supervisor, which only looks for
directories containing a `config.yaml`.

Splitting the package into its own repository later remains possible (a
`git subtree`/mirror step, not a code change), but it is no longer a
prerequisite for anything a user does.

## CI strategy (per-PR vs nightly) — why the split

An HA add-on fundamentally cannot be *fully* verified by fast, deterministic,
third-party-service-free per-PR CI: real acceptance requires a real HAOS
Supervisor, a real Mosquitto add-on, and (for the multi-arch image) real
`amd64`+`aarch64` builds. Per this repo's existing pattern for exactly this
kind of tradeoff (see `valhalla-li-build` vs `golden-routes-de`, or
`photon-setup` vs `photon-li-nightly` in `.github/workflows/`), we split:

| Check | Where | Why |
|---|---|---|
| `config.yaml` structural validity (`ingress: true`, `slug`, `arch`, `map`, `services`, required option keys present, well-formed YAML) | **Per-PR** — `.github/workflows/ci.yml` job `addon-config-check`, backed by `yapaja_go/config.test.ts` (Vitest, `js-yaml`) | Fully in-repo, deterministic, sub-second. No network, no third-party Action, no Docker daemon needed — cannot flake, so it's safe as a merge gate. |
| `frenck/action-addon-linter` (the "real" HA add-on schema linter) | **Nightly** — `.github/workflows/nightly.yml` job `addon-lint`, `continue-on-error: true` | It's a third-party GitHub Action whose availability/behavior in THIS CI environment was not something we could verify from inside the authoring sandbox (no outbound network to actually exercise it here). A third-party Action that turns out to be flaky, rate-limited, or occasionally unavailable must never be a merge-blocker — same reasoning as `golden-routes-de`'s and `photon-li-nightly`'s `continue-on-error: true`. It still runs every night and surfaces real findings for a human to act on; it just can't fail a PR on its own say-so until it's been observed to be reliable. |
| Ingress `<base href>` injection (Flow 9, the ONE piece of this task that IS ordinary application code) | **Per-PR** — `apps/core/src/static.test.ts` (Vitest, part of the normal `apps/core` suite) | This is real Fastify/TypeScript code in `apps/core/src/static/ingressHtml.ts`, not add-on packaging — it belongs in, and is fully covered by, the existing per-PR `quality` job like any other Core change. |
| Add-on-Image (`yapaja_go/Dockerfile`, amd64) bauen **und im Container nachsehen** | **Per-PR, pfadgefiltert** — `.github/workflows/addon-image.yml`, laeuft nur bei Aenderungen unter `yapaja_go/**` | Seit 0.3.8. Vorher wurde dieses Image in KEINEM Job gebaut — `Docker Build & Health Check` baut `apps/core/Dockerfile`, ein anderes Image. Das war der strukturelle Grund, warum jeder Fehler darin erst beim Betreiber auffiel: fehlendes `osmium-tool`, ein Startskript unter falschem Pfad, ein gebuendeltes CLI, das wortlos nichts tat. Der Job baut deshalb nicht nur, sondern prueft IM Container, was zur Laufzeit gebraucht wird — Werkzeuge, Bau-Skripte, Glyphen, s6-Dienste, Shebangs — und startet den Core gegen `/api/v1/health`. Pfadgefiltert, damit er nur laeuft, wenn er etwas finden kann. |
| Zweite Architektur (`aarch64`) | **Manuell** — `workflow_dispatch` auf `addon-image.yml` mit `BUILD_FROM` aus `build.yaml` | Das Zielgeraet ist ein Mini-PC (amd64). Eine zweite Architektur verdoppelte die Laufzeit fuer einen Fall, den es hier noch nicht gibt. |

**Bottom line:** nothing flaky or third-party-network-dependent can block a
merge. Everything genuinely verifiable in-repo, fast, and deterministically
(`config.yaml` shape, the base-href injection code) already does, per-PR,
today.
