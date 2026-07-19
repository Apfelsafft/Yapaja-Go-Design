# `ha-addon/` — Home Assistant Add-on Packaging (E08-T4)

Contains the Home Assistant add-on package for Yapaja Go. See
[`yapaja_go/README.md`](./yapaja_go/README.md) for the add-on's own layout
and [`yapaja_go/DOCS.md`](./yapaja_go/DOCS.md) for operator-facing install/
RAM/GPS/update docs and the manual VM test protocol.

docs/04-home-assistant.md §3 describes the EVENTUAL target as a separate
`yapaja-go-ha-addon` GitHub repository (HA's "add-on repository" format, so
users add it via Settings → Add-ons → Repositories). E08-T4 builds the
package itself here, inside the monorepo, first — splitting it into its own
repo (a `git subtree`/mirror step, not a code change) is a release-process
follow-up, not part of this task.

## CI strategy (per-PR vs nightly) — why the split

An HA add-on fundamentally cannot be *fully* verified by fast, deterministic,
third-party-service-free per-PR CI: real acceptance requires a real HAOS
Supervisor, a real Mosquitto add-on, and (for the multi-arch image) real
`amd64`+`aarch64` builds. Per this repo's existing pattern for exactly this
kind of tradeoff (see `valhalla-li-build` vs `golden-routes-de`, or
`photon-setup` vs `photon-li-nightly` in `.github/workflows/`), we split:

| Check | Where | Why |
|---|---|---|
| `config.yaml` structural validity (`ingress: true`, `slug`, `arch`, `map`, `services`, required option keys present, well-formed YAML) | **Per-PR** — `.github/workflows/ci.yml` job `addon-config-check`, backed by `ha-addon/yapaja_go/config.test.ts` (Vitest, `js-yaml`) | Fully in-repo, deterministic, sub-second. No network, no third-party Action, no Docker daemon needed — cannot flake, so it's safe as a merge gate. |
| `frenck/action-addon-linter` (the "real" HA add-on schema linter) | **Nightly** — `.github/workflows/nightly.yml` job `addon-lint`, `continue-on-error: true` | It's a third-party GitHub Action whose availability/behavior in THIS CI environment was not something we could verify from inside the authoring sandbox (no outbound network to actually exercise it here). A third-party Action that turns out to be flaky, rate-limited, or occasionally unavailable must never be a merge-blocker — same reasoning as `golden-routes-de`'s and `photon-li-nightly`'s `continue-on-error: true`. It still runs every night and surfaces real findings for a human to act on; it just can't fail a PR on its own say-so until it's been observed to be reliable. |
| Ingress `<base href>` injection (Flow 9, the ONE piece of this task that IS ordinary application code) | **Per-PR** — `apps/core/src/static.test.ts` (Vitest, part of the normal `apps/core` suite) | This is real Fastify/TypeScript code in `apps/core/src/static/ingressHtml.ts`, not add-on packaging — it belongs in, and is fully covered by, the existing per-PR `quality` job like any other Core change. |
| Full multi-arch (`amd64`+`aarch64`) Supervisor-builder image build | **Nightly/manual only** — not yet wired as an automated job (documented here as a TODO); would follow the exact same `docker buildx build --platform linux/amd64,linux/arm64` pattern as `.github/workflows/nightly.yml`'s existing `multiarch` job, pointed at `ha-addon/yapaja_go/Dockerfile` | Slow (compiles/links native Valhalla-adjacent + Node.js dependencies for two architectures), and — like the DE Golden-Routes / Photon-CH+LI nightly jobs — could not be exercised end-to-end from the authoring sandbox (no Docker daemon available there), so it is deliberately left as a documented, not-yet-automated nightly/manual step rather than claimed as "done and passing" without ever having actually run. |

**Bottom line:** nothing flaky or third-party-network-dependent can block a
merge. Everything genuinely verifiable in-repo, fast, and deterministically
(`config.yaml` shape, the base-href injection code) already does, per-PR,
today.
