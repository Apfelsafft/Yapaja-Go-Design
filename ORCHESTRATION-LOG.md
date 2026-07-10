# ORCHESTRATION-LOG

Persistenter Zustand der Orchestrierung (Master-Prompt: tasks/KICKOFF-PROMPT.md).
Bei Wiederaufnahme: diese Datei ZUERST lesen, dann exakt hier weitermachen.

**Umgebung:** Node v22.22.2, pnpm 10.33.0, Docker 29.3.1 — alles verfügbar.
**Basis-Branch:** main · **Aktuelle Welle:** 1a→1b (E06-T1, E02-T1, E01-T1 fertig; weiter mit E01-T2)

> ℹ️ GitHub-Token-Ausfall (2026-07-09) inzwischen behoben (Connector reconnected von selbst).

| Task | Modell | Versuche | Status | PR | Anmerkungen |
|---|---|---|---|---|---|
| E00-T1 | haiku | 1 | ✅ MERGED | #12 | Verifiziert: 5/5 Tests, health ok, relative Pfade, SIGTERM 20 ms |
| E00-T2 | haiku | 1 | ✅ MERGED | #13 | Verifiziert: 82/82 Tests, Schema-Bereiche zeichengenau, speed_limit-0-Regel korrekt |
| E00-T3 | haiku | 2 | ✅ MERGED | #14 | Retry: fehlender Pflicht-Test ergänzt (86/86). Static-Serving manuell verifiziert. OFFEN: docker build nur via CI verifizierbar (Sandbox-Netzpolicy blockiert Registry-CDNs) → E00-T4-CI muss Nachweis liefern, sonst kein G0 |
| E00-T4 | haiku | 1 (+5 CI-Iterationen durch Orchestrator) | ✅ MERGED | #15 | CI-Lauf #6 grün inkl. Docker-Health-Nachweis. Härtungs-Fixes: Lockfile committet, tsconfig.base ins Image, CI=true, node_modules-Wipe vor gefiltertem Prod-Install |
| E06-T1 | haiku | 1 (+Orchestrator-Infra-Fixes) | ✅ MERGED | #16 | 137 Tests, single-active-Invariante transaktional. CI deckte 4 Schichten auf: better-sqlite3 als core-dep, pnpm-Build-Freigabe (natives Modul), tsup-Bundling (paths→shared-Quelle), rekursive eslint-ignores. Bundled-Output lokal E2E verifiziert (health db:ok + Camper-Profil) |
| E02-T1 | sonnet | 1 | ✅ MERGED | #17 | 171 Tests, CI grün, Bundle E2E ok. Event-Bus (ADR-010) + PositionService + WS |
| E01-T1 | sonnet | 1 | ✅ MERGED | #18 | 178 Tests, CI grün, auf main rebased (Union mit E02-T1), Gesamtsuite 212 grün, Path-Traversal live geprüft |
| E01-T2 | sonnet | 1 | ✅ MERGED | #19 | 223 Unit + 9 Playwright-E2E, CI (inkl. neuem e2e-Job) grün. Playwright-Harness bootstrapped |
| E02-T2 | haiku | 1 (+Orchestrator-tsconfig-Fix) | ✅ MERGED | #20 | 234 Unit + 14 E2E, CI grün. Puck folgt Position via WS, W-03-Hinweise. CI deckte web-composite-ref-Problem auf (ADR-012) |
| E01-T3 | haiku | 2 (+Orchestrator-Harness-Fix) | ✅ MERGED | #21 | RETRY: Erstabgabe 5/21 E2E rot als „Timing" abgetan → zurückgewiesen, echte Bugs (map-ready-Subscriptions). Retry grün. CI deckte zusätzlich Harness-Flake auf (2 E2E-Cores teilten DB → SQLITE_BUSY) → Fix DB_PATH=:memory: pro Core |
| E01-T4 | sonnet | 0 | IN_PROGRESS | – | Style-System Light/Dark/Contrast |

**Gate G1 offen** — braucht noch: E01-T4, E02-T3 (gpsd), E02-T4 (Simulator),
E01-T5, E01-T6, E02-T5. Erst dann G1-Prüfung.

**Harness-Notiz:** Playwright-E2E-Suite existiert ab jetzt (`apps/web/e2e/`, `pnpm e2e`).
Nutzt vorinstallierten Chromium lokal (`PLAYWRIGHT_BROWSERS_PATH`), auf CI via
`playwright install`. globalSetup baut web+core, generiert PMTiles-Fixture, startet
Core-Prozesse. Folge-Web-Tasks (E01-T3/T4/T5/T6, E06-T2, E03-T3, E05-T2, E07-*)
bauen darauf auf.

## Gate-Status

| Gate | Status | Nachweis |
|---|---|---|
| G0 | ✅ BESTANDEN (2026-07-09) | CI-Lauf 29032752463 (Quality 86/86 + Docker-Health-Job); Gate-Kommentar in Issue #1 |

## Entscheidungen / Klärungen (ADR-Nachträge & wiederkehrende Regeln)

- **ADR-011 (bei #16): Core wird mit tsup gebündelt.** `tsconfig.base.json` `paths`
  lösen `@yapaja/shared` auf die QUELLE auf → reiner `tsc`-Emit einer App, die shared
  importiert, erzeugt verschachtelten `dist`-Baum + unaufgelösten Bare-Import → im
  Container nicht lauffähig. Lösung: `apps/core` baut via tsup zu einer self-contained
  `dist/index.js` (shared+ajv inline; better-sqlite3/fastify/pino extern).
  **Regel für Folge-Tasks:** Jede weitere App (E01/E02/…-Frontend baut via vite, ok),
  jeder weitere Node-Service, der shared importiert, nutzt denselben Bundling-Ansatz.
- **ADR-012 (bei #20): Apps lösen `@yapaja/shared` via base-`paths` (Quelle) auf,
  NICHT via composite-Projekt-Referenz.** `apps/web` hatte `references:[packages/shared]`
  + `composite:true` → verlangte vorgebautes `packages/shared/dist`, das im frischen
  CI-Checkout fehlt (TS6305/TS6059). Erster Web-Code, der shared importiert (E02-T2),
  legte es offen. Fix: reference entfernt, web-`tsc` läuft `--noEmit` (vite baut), shared
  via paths→Quelle wie apps/core. **Regel:** jede App, die shared importiert, so
  konfigurieren — kein composite/dist. Gilt für alle Folge-Web-Tasks.
- **Native Module** (better-sqlite3, künftige Add-on-Deps, evtl. Bilderkennung): müssen
  in `package.json` → `pnpm.onlyBuiltDependencies` eingetragen werden, sonst wird ihr
  Build-Skript in pnpm 10 blockiert und das Modul lädt im frischen CI/Container nicht.
- **CI ist Pflicht-Gate vor jedem Merge** (nicht nur bei nativen Modulen) — lokale
  Grün-Läufe verdecken gitignore-, Build-Kontext- und Resolution-Fehler. Ablauf:
  Branch pushen → CI abwarten → erst bei grün mergen.
- **Verifikations-Timer:** CI-Status via `mcp__github__actions_list` (branch-Filter) +
  `get_job_logs failed_only`. Große list-Antworten laufen ins Token-Limit → in Datei
  gespeichert, mit `jq` auslesen (`.workflow_runs[0]`).
