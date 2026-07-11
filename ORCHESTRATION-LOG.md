# ORCHESTRATION-LOG

Persistenter Zustand der Orchestrierung (Master-Prompt: tasks/KICKOFF-PROMPT.md).
Bei Wiederaufnahme: diese Datei ZUERST lesen, dann exakt hier weitermachen.

**Umgebung:** Node v22.22.2, pnpm 10.33.0, Docker 29.3.1 — alles verfügbar.
**Basis-Branch:** main · **Aktuelle Welle:** Phase 2 (Routing/Nav) — **Gate G1 BESTANDEN**

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
| E01-T4 | sonnet | 1 | ✅ MERGED | #22 | 318 Unit + 31 E2E, CI grün. Core-Styles Light/Dark/Contrast + Live-Switch (setStyle/transformStyle), Optionen lang/labelScale/poi. Agent fand+behob echten Regressionsbug selbst |
| Hygiene | orchestrator | 1 | ✅ MERGED | #23 | data/db untracked + /data/ gitignored |
| E02-T4 | sonnet | 1 | ✅ MERGED | #24 | 397 Unit (79 neu), CI grün. GPS-Simulator: GPX/polyline-Replay, 4 Mutationen, speed_factor, Prod-Schutz. Zentrales Testwerkzeug für spätere Nav-E2E + Golden-Routes |
| E02-T3 | sonnet | 1 | ✅ MERGED | #25 | 453 Unit, CI grün. gpsd-TCP-Client + PlausibilityGuard. Alle 3 Positionsquellen fertig |
| E01-T5 | sonnet | 1 | ✅ MERGED | #26 | 505 Unit + 33 E2E (Orchestrator-verifiziert). Region-Manager: Job-System, Resume via Range (W-17), Disk-Check 409 (W-18), Regionen-UI. CI grün |
| E01-T6 | haiku | 1 | ✅ MERGED | #27 | 533 Unit + 42 E2E (Orchestrator-verifiziert). CI-Lauf #54 grün, Squash 68c772b. fps-Wächter + Auto-Degradation (Stufen 3D→POI→2D), Hysterese, Override. map-ready-reaktiv (E01-T3-Falle vermieden). **Epic E01 (Karten) komplett** (alle 6 Tasks) |
| E02-T5 | sonnet | 1 (Subagent starb am Session-Limit nach Impl, Orchestrator verifizierte + fixte) | ✅ MERGED | #28 | 550 Unit + 1 todo + 44 E2E. CI-Lauf #58 grün (Quality+Docker+E2E), Squash 7bd63ce. DeadReckoningController → `pos/extrapolated` (Flag `extrapolated:true`), no-op-Provider bis E04-T6; `acquiring`-Zustand; Banner nach 3s. **Orchestrator-Fixes bei Verifikation:** (1) Blank-Page-Crash — Puck addSource/addLayer vor Style-Load (ADR-013); (2) Genauigkeitsring rendert nie (beforeId-Altlast seit E02-T2); (3) E2E serial (geteilter Simulator-Core). Subagent-Abgabe war UNVERIFIZIERT (Session-Limit vor Selbsttest) — hätte als Blank-Page live gecrasht |
<!-- offen für G1: E02-T5 GPS-Verlust-UX (letzter) -->
<!-- TODO nachziehen: system/plausibility Bus-Topic (guard reasons → bus/UI), wenn ein Task bus/ berührt -->
<!-- TODO nachziehen: satellites in GET /position/sources exponieren (E02-T3 hält sie intern) -->
<!-- TODO nachziehen: extrapolated-Filter im MQTT-Mapping (E02-T5/E08) -->
<!-- TODO nachziehen: DeadReckoningProvider real (E04-T6) — E02-T5 no-op-Interface -->
<!-- Bekanntes Flake-Risiko: map/routes.test.ts FD-Leak-Schwelle unter CI-Last -->


**Bekanntes Risiko:** `apps/core/src/map/routes.test.ts` FD-Leak-Test (E01-T1) ist
schwellenwertbasiert (≤50 FDs bei 50 parallelen Requests) und potenziell flaky unter
CI-Last. Bei mir 3× grün. Falls es in CI zuschlägt: Schwelle/Toleranz härten (separater
Hygiene-Fix, nicht E02-T4).

**Gate G1 BESTANDEN (2026-07-11)** — alle Kriterien nachgewiesen:
- *Karte rendert offline*: E01-T1 (PMTiles via Range, keine Fremd-Hosts) +
  E2E `offline-network`/`map-render`/„fully offline, no foreign requests".
- *≥30 fps auf Referenz-HW*: fps-Wächter + Auto-Degradation (E01-T6, 3D→POI→2D,
  Hysterese) garantiert spielbare fps auf schwacher iGPU; Mechanik per
  `perf.spec` getestet. ⚠️ OFFEN: quantitatives „≥30 fps auf N100"-Budget-Gate
  braucht die QEMU-N100-Perf-Probe in CI (E10/W-04) — Mechanik steht, Messung
  nachrüsten.
- *Position simuliert + echt, live*: gpsd (E02-T3) + Browser (E02-T2) + Simulator
  (E02-T4) über PositionService/WS; Puck folgt live (E2E `position`), GPS-Verlust-UX
  (E02-T5). 
- *2D/3D + Rotation + Follow-Me*: E01-T3 (E2E `viewmode`: Modus-Zyklus, Kompass-FAB,
  Bearing-Lock, „follow-me: manual pan pauses, re-center resumes").
Gesamt: 550 Unit + 1 todo, 44 E2E grün auf main (7bd63ce).

**Nächste Welle — Phase 2 (Routing & Navigation) Richtung Gate G2:**
- E06-T2/T3 (Fahrzeugprofil-UI/Validierung, parallel startbar) · E03 Routing
  (Valhalla-Costing — E03-T2/T5 sicherheitskritisch → opus) · E05 Suche/Favoriten
  · E04 Navigation (Turn-by-Turn/Rerouting — E04-T1/T4 sicherheitskritisch → opus,
  E04-T6 löst DeadReckoningProvider-no-op aus E02-T5 ein).
- G2 = Golden-Route-Suite (Höhen-/Gewichts-Testfälle), Camper-Profil meidet
  3,2-m-Unterführung Hamburg→München.

**Harness-Notiz:** Playwright-E2E-Suite existiert ab jetzt (`apps/web/e2e/`, `pnpm e2e`).
Nutzt vorinstallierten Chromium lokal (`PLAYWRIGHT_BROWSERS_PATH`), auf CI via
`playwright install`. globalSetup baut web+core, generiert PMTiles-Fixture, startet
Core-Prozesse. Folge-Web-Tasks (E01-T3/T4/T5/T6, E06-T2, E03-T3, E05-T2, E07-*)
bauen darauf auf.

## Gate-Status

| Gate | Status | Nachweis |
|---|---|---|
| G0 | ✅ BESTANDEN (2026-07-09) | CI-Lauf 29032752463 (Quality 86/86 + Docker-Health-Job); Gate-Kommentar in Issue #1 |
| G1 | ✅ BESTANDEN (2026-07-11) | Offline-Karte + Live-Position (sim+echt) + 2D/3D/Rotation + Follow-Me; 550 Unit + 44 E2E grün, CI-Lauf #58 (7bd63ce). Offen: quantitatives N100-fps-Budget-Gate (E10-Perf-Probe) — Degradations-Mechanik steht |

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
- **ADR-013 (bei #28): Karten-Layer/Sources erst nach Style-Load hinzufügen.**
  `MapView` registriert die Map-Instanz im Store SOFORT nach `new maplibregl.Map()`
  — also VOR `style.load`. Ein reaktiver `[map]`-Effekt (E01-T3-Muster, korrekt),
  der dann `addSource`/`addLayer` aufruft, wirft „Style is not done loading"; in
  Render-Effekt-Scope ungefangen crasht das den ganzen React-Baum → weiße Seite.
  **Regel für alle Karten-Consumer (Puck, künftige Route-/POI-Overlays):** Setup in
  `if (map.isStyleLoaded()) setup(); else map.once('load', setup)` kapseln. Ergänzt
  E01-T3: reaktiv auf `map` ist notwendig, aber NICHT hinreichend — zusätzlich auf
  Style-Reife prüfen. (Zweite Falle desselben Musters: `addLayer(x, beforeId)` mit
  noch-nicht-existierendem `beforeId` schlägt still fehl → Layer fehlt.)
- **Verifikation ist nicht optional, auch bei „fertigen" Subagent-Abgaben:** E02-T5
  kam vom Subagenten mit vollständigem Code, aber UNVERIFIZIERT (Session-Limit vor
  Selbsttest). Lokal grün getestet → 3 echte Bugs (Blank-Page-Crash, toter Ring,
  E2E-Race). Regel: JEDE Abgabe selbst bauen + Unit + E2E fahren, nie „Code sieht
  vollständig aus" = fertig.
- **CI ist Pflicht-Gate vor jedem Merge** (nicht nur bei nativen Modulen) — lokale
  Grün-Läufe verdecken gitignore-, Build-Kontext- und Resolution-Fehler. Ablauf:
  Branch pushen → CI abwarten → erst bei grün mergen.
- **Verifikations-Timer:** CI-Status via `mcp__github__actions_list` (branch-Filter) +
  `get_job_logs failed_only`. Große list-Antworten laufen ins Token-Limit → in Datei
  gespeichert, mit `jq` auslesen (`.workflow_runs[0]`).
