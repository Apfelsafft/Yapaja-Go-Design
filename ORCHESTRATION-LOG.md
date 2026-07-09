# ORCHESTRATION-LOG

Persistenter Zustand der Orchestrierung (Master-Prompt: tasks/KICKOFF-PROMPT.md).
Bei Wiederaufnahme: diese Datei ZUERST lesen, dann exakt hier weitermachen.

**Umgebung:** Node v22.22.2, pnpm 10.33.0, Docker 29.3.1 — alles verfügbar.
**Basis-Branch:** main · **Aktuelle Welle:** 1a

> ⚠️ **BLOCKIERT (2026-07-09):** GitHub-MCP-Token abgelaufen. Merge-Queue: PR #17
> (E02-T1) + E01-T1 (branch gepusht, PR noch anzulegen) — beide lokal verifiziert
> und CI-getriggert. Sobald Connector re-autorisiert: CI beider prüfen → E02-T1
> mergen → E01-T1 PR anlegen+mergen → Issues #3/#2 abhaken → nächste Welle.

| Task | Modell | Versuche | Status | PR | Anmerkungen |
|---|---|---|---|---|---|
| E00-T1 | haiku | 1 | ✅ MERGED | #12 | Verifiziert: 5/5 Tests, health ok, relative Pfade, SIGTERM 20 ms |
| E00-T2 | haiku | 1 | ✅ MERGED | #13 | Verifiziert: 82/82 Tests, Schema-Bereiche zeichengenau, speed_limit-0-Regel korrekt |
| E00-T3 | haiku | 2 | ✅ MERGED | #14 | Retry: fehlender Pflicht-Test ergänzt (86/86). Static-Serving manuell verifiziert. OFFEN: docker build nur via CI verifizierbar (Sandbox-Netzpolicy blockiert Registry-CDNs) → E00-T4-CI muss Nachweis liefern, sonst kein G0 |
| E00-T4 | haiku | 1 (+5 CI-Iterationen durch Orchestrator) | ✅ MERGED | #15 | CI-Lauf #6 grün inkl. Docker-Health-Nachweis. Härtungs-Fixes: Lockfile committet, tsconfig.base ins Image, CI=true, node_modules-Wipe vor gefiltertem Prod-Install |
| E06-T1 | haiku | 1 (+Orchestrator-Infra-Fixes) | ✅ MERGED | #16 | 137 Tests, single-active-Invariante transaktional. CI deckte 4 Schichten auf: better-sqlite3 als core-dep, pnpm-Build-Freigabe (natives Modul), tsup-Bundling (paths→shared-Quelle), rekursive eslint-ignores. Bundled-Output lokal E2E verifiziert (health db:ok + Camper-Profil) |
| E02-T1 | sonnet | 1 | ⏳ VERIFIED, PR #17, MERGE-PENDING (GitHub-Token) | #17 | 171 Tests, Bundle E2E ok (health/position/sources). Wartet auf CI-Check+Merge → GitHub-Connector re-auth nötig |
| E01-T1 | sonnet | 1 | ⏳ VERIFIED, gepusht, PR/MERGE-PENDING (GitHub-Token) | – | 178 Tests, Bundle E2E ok, Path-Traversal live geprüft (400/400/404). Branch task/E01-T1-tiles gepusht (CI läuft). PR-Erstellung+Merge → GitHub-Connector re-auth nötig |

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
- **Native Module** (better-sqlite3, künftige Add-on-Deps, evtl. Bilderkennung): müssen
  in `package.json` → `pnpm.onlyBuiltDependencies` eingetragen werden, sonst wird ihr
  Build-Skript in pnpm 10 blockiert und das Modul lädt im frischen CI/Container nicht.
- **CI ist Pflicht-Gate vor jedem Merge** (nicht nur bei nativen Modulen) — lokale
  Grün-Läufe verdecken gitignore-, Build-Kontext- und Resolution-Fehler. Ablauf:
  Branch pushen → CI abwarten → erst bei grün mergen.
- **Verifikations-Timer:** CI-Status via `mcp__github__actions_list` (branch-Filter) +
  `get_job_logs failed_only`. Große list-Antworten laufen ins Token-Limit → in Datei
  gespeichert, mit `jq` auslesen (`.workflow_runs[0]`).
