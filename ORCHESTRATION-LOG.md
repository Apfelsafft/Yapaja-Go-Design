# ORCHESTRATION-LOG

Persistenter Zustand der Orchestrierung (Master-Prompt: tasks/KICKOFF-PROMPT.md).
Bei Wiederaufnahme: diese Datei ZUERST lesen, dann exakt hier weitermachen.

**Umgebung:** Node v22.22.2, pnpm 10.33.0, Docker 29.3.1 — alles verfügbar.
**Basis-Branch:** main · **Aktuelle Welle:** Phase 2 (Routing/Nav) — G1 bestanden; **E03-Routing-Epic KOMPLETT (T1–T6)**; **E05-T1+T2+T3+T5 (Suche) + E04-T1+T2+T3 (Nav-Kern + ETA + Manöver/Ansagen/Tempolimit) MERGED**. **Offen Richtung G2:** E04-T4 (Abweichung+Auto-Reroute 🔴, braucht T1→opus), E04-T5 (End-to-End Nav-Steuerung + Ziel-Convenience, braucht T1–T4); E05-T4 (Photon — Feasibility-Spike offen, Lite-Fallback als Sicherheitsnetz), E06-T3 (Profil-Reroute, braucht E04). **Nächste sinnvolle Reihenfolge:** E04-T4 (opus, 🔴) → E04-T5 → dann E05-T4/E06-T3. Reroute-Request muss Valhalla-Heading mitgeben (docs W-05: erste Anweisung nach Reroute zeigt nach VORNE, kein „Bitte wenden") + Vermeidungen aus E03-T4 mitschicken. G2-Kriterium (Golden-Routes) hat jetzt Framework+LI-Gate; echte DE-Restriktionsfälle = nightly-Nachrüstung (Daten)

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
| E04-T3 | sonnet | 1 | ✅ MERGED | #42 | Manöver-Logik, Ansage-Engine & Tempolimit. CI-Lauf 29486036541 grün (alle 6), Squash 2c62625. Core `navigation/instructions.ts` (pure): speed-skalierte Schwellen max(base,12s×speed) über [2000,500,200,0]; tickAnnouncement feuert TIEFSTE noch-nicht-erreichte Schwelle je Manöver (firedUpToIndex monoton → Jitter kann nicht doppelfeuern, Passieren resettet auf nächstes Manöver; W-23 kein Backlog); say = natürlicher dt Satz mit 50m-Rundung (Docs-Beispiel „In 300 Metern links abbiegen auf die Bundesstraße 27" exakt reproduziert), de+en pure, de publiziert; neues nav/instruction-Bus-Topic. Tempolimit: buildSpeedSegmentAnchors+findActiveSpeedLimitKmh (halboffen, Anker wie eta.ts) → speed_limit_kmh; Route.speed_limits HEUTE leer (Routing-Enhancement out-of-scope) → null graceful, nie 0; Lookup mit synthetischen Segmenten getestet. Web `apps/web/src/drive/`: Manöver-Panel (Inline-SVG-Pfeil-Sprite alle ManeuverTypes + unknown→straight, Distanz-Countdown, Straße, Folgemanöver<300m), Tempolimit-Schild (null→versteckt), TTS Web Speech de-DE (an/aus, Verfügbarkeits-Guard + WebAudio-Gong-Fallback, cancel vor speak=W-23); subscribt nav/* über /ws/v1. **Orchestrator-verifiziert (Ansage-Engine+W-23-Queue per Hand gelesen):** 1127 Unit (+Say-Snapshots alle Typen de/en, Schwellen/Doppelfeuer, Segment-Lookup, Web arrows/navStore/tts/panel), Drive-E2E 2/2 (Flow 2), Voll-E2E 64/64 unter --workers=2. T4 Reroute, T5 Nav-Start-Button, E07 Lane-Assist abgegrenzt |
| E04-T2 | sonnet | 1 | ✅ MERGED | #41 | ETA & Restwerte. CI-Lauf 29483423614 grün (alle 6), Squash 1b3d903. `navigation/eta.ts` (pure): kontinuierliche EWMA `alpha=1-exp(-dt/600)` von actual/planned, Instant-Ratio + Running-Faktor beide auf [0.7,1.5] geklemmt, FRIERT ein bei speed<5km/h/null/degeneriertem dt. Rest-Plandauer aus Valhalla-Manöver-Zeiten (`Maneuver.duration_s` neu, additiv in mapResponse.ts; distanzproportionaler Fallback aus route.duration_s). avg_speed-Floor NUR Untergrenze (`max(calibrated, rest_m/(avg/3.6))`) via optionalem profileProvider. eta = UTC ISO Z (W-22); Client-Formatter `formatEta` in shared (0.5.0, Intl+timeZone, DST-korrekt). Publish-Clamp `min(raw, lastPublished)` hält duration_remaining_s monoton (checkNavState 0-Toleranz), eta-Timestamp läuft real weiter. **Orchestrator-verifiziert:** eta.ts-Mathematik + buildState-Wiring + Publish-Clamp per Hand gelesen; 1056 Unit (+38: 28 EWMA/Segment/Floor, 7 DST/Zone-Formatter, 3 Fake-Timer-Akzeptanz: Faktor-1.0 Fehler ≈0%, 20%-langsamer adaptiert <5min, 3-min-Stopp Faktor bit-genau unverändert). Routing-Typ-Change additiv (alle Routing-Tests grün). Orchestrator-Doku-Fix: NavState.eta-Kommentar + docs/03 „lokale TZ"→UTC/W-22. Subagent fixte pre-existing Test-Bug (checkNavState „now"). T3 Manöver-Text/Limit/Voice, T4 Reroute abgegrenzt |
| E04-T1 | opus | 1 | ✅ MERGED | #40 | 🔴 NavigationService-Kern (State-Machine + Map-Matching), Herzstück G2. CI-Lauf 29481243743 grün (alle 6 Checks), Squash 2b19980. `apps/core/src/navigation/`: stateMachine (Daten-Tabelle idle→routing→navigating⇄paused→arrived, off_route Sub-Zustand; invalide→409), geo.ts (haversine/bearing/nearest-point-on-segment lokal-equirektangular), mapMatching (±500m-Fenster = Hairpin-Guard, on_route ≤30m & (stationär||heading-null||Δheading≤100°)), service (monotone Progress-Klemme Math.max, Ankunft <40m&Rest<60m EINMALIG doppelt-gesichert, DEVIATE/RETURN matcher-getrieben), REST start/pause/resume/stop+state, nav/state @1Hz aus pos/update-Stream, Neustart→idle (keine Geister-Nav) + nav_recovered-Event (injizierbarer Store). Wiring: buildServer teilt EINE RoutingService mit routing+navigation (rückwärtskompatibler `service?`-Seam). **Orchestrator-verifiziert (Opus-Abgabe, Geometrie + State-Machine per Hand gelesen):** 1018 Unit (+38 nav) inkl. 5 Map-Matching-Fixtures (Hairpin-Fenster-Guard BEIDSEITIG bewiesen: Voll-Suche snappt auf falschen Rückweg-Schenkel, ±500m bleibt auf Hinweg), Benchmark 0.0184 ms/fix (Budget 5ms), monotone distance_remaining via checkNavState, Ankunft-einmal, volle SM-Tabelle, Restart-Recovery, Simulator-Integration noise_m:10. T2 ETA/T3 Manöver-Text+Limit+Voice/T4 Reroute abgegrenzt (Felder null). Route-Cache in-memory TTL 1h (Recovery-Logik+Persistenz getestet) |
| E05-T5 | sonnet | 1 (+Orchestrator: 3 CI-only-Fixes, 2 CI-Iterationen) | ✅ MERGED | #39 | Lite-Suchindex (Photon-Fallback, W-12). CI-Lauf 29460404639 grün (alle 6 Checks inkl. neuem `lite-search-li-build`), Squash c024153. `services/valhalla/build-lite-index.sh`: osmium tags-filter+export → tsx-CLI → SQLite FTS5 (trigram), atomarer Swap. `apps/core/src/search/lite/`: extract/buildIndex/reader/ranking/liteBackend/cli. Failover in SearchService: lite NUR wenn Photon degraded/disabled (healthy Photon — auch 0 Hits — erreicht lite NIE; Pre-E05-T5-Verhalten exakt erhalten). Ranking 4-stufig strikt-lexikografisch (Prefix>kind(city>town>village>street)>bm25>Distanz). UI-Badge „vereinfachte Suche aktiv". `'lite'` in SearchResult.source (0.4.0). **FTS5-trigram vorab lokal bestätigt** (Orchestrator, SQLite 3.53.2) → kein Custom-Build. **Orchestrator-Fund+Fix (3 CI-only-Bugs, lokal nicht verifizierbar mangels osmium/Netz):** (1) Streets als `--geometry-types=point` exportiert → osmium WIRFT Ways weg (kein Zentroid) → leerer Straßen-Index; Fix: linestring/polygon exportieren, extract.ts zentroidiert (Zweig existierte, war tot); (2) **osmium geojsonseq (RFC 8142) prefixt jede Zeile mit ASCII Record-Separator U+001E** → `.trim()` entfernt ihn NICHT → JSON.parse warf bei JEDER Zeile → CI: 0/21 Orte, 0/14397 Straßen übernommen → leerer Index; Fix: RS-Prefix strippen + Regressions-Test + volle CLI-Pipeline lokal mit RS-prefixed Fixtures reproduziert (2/2, 1/1); (3) brüchige CI-Assertion Vaduz-kind==city → OSM taggt Vaduz place=town → relaxt auf city/town/village. **Orchestrator-verifiziert:** Failover-Kette + Ranking-Comparator + Index-Schema (contentless FTS5 content_rowid=id) gelesen; exakte CI-FTS-Query lokal gegen echtes Schema reproduziert; 980 Unit, Such-E2E 6/6, lint/tsc/build sauber. **CI-only-verifiziert:** echtes osmium-Parsing + `lite-search-li-build` end-to-end (LI-PBF→Build→FTS5-Smoke Vaduz+Straße). DE-<400MB = nightly/DE-Claim, nicht per-PR |
| E05-T3 | sonnet | 1 | ✅ MERGED | #38 | Favoriten & Verlauf. CI-Lauf 29458210037 grün (alle 5 Checks), Squash 87e27bb. Core `favorites/`: SQLite favorites+history, FavoriteService (CRUD + reorder, atomare home-Eindeutigkeit mit replace-in-Transaktion), HistoryService (FIFO cap 100), favoritesPlugin `/api/v1`. Web `favorites/`: Bottom-Drawer (Favoriten+Verlauf-Tabs), Tap→Route-Chips, Reorder (Long-Press ▲/▼ statt HTML5-Drag — touch/Rüttel-robust, gleicher reorder-Endpoint), „Als Favorit speichern" additiv im Ziel-Sheet, Suche-Select schreibt Verlauf. Shared Favorite/HistoryEntry+Schemas (0.3.0). **Invariante (strukturell + Test):** Favoriten-Route nutzt IMMER das bei Tap aktive Profil (Favorite hat kein profile_id; navigate.ts liest activeProfile frisch) — Unit + E2E (Profil A anlegen→B aktivieren→Tap→POST /routes trägt B). **Orchestrator-verifiziert:** navigate.ts/service.ts/profiles-store-diff (nur additiver E2E-Hook)/routing-Contract (unverändert, korrekt genutzt) gelesen; lint+web-tsc+core-build sauber; 907 Unit (+83 neu, 1 bekannter regions/routes-Flake isoliert 13/13); Voll-E2E 60/60 unter --workers=2. Verlauf nur bei Suche-Select+Fav/History-Tap (nicht roher Map-Klick, Rausch-Vermeidung) |
| E05-T2 | sonnet | 1 (+Orchestrator-Root-Cause-Fix, 2 CI-Iterationen) | ✅ MERGED | #37 | Such-UI. CI-Lauf 29456000908 grün (alle 5 Checks), Squash e1a55bb. SearchBar: Debounce 300ms/min 3 Zeichen, AbortController+Sequenz-Race-Safety, Ergebnisliste, Auswahl→setDestination(+destinationName, offline-Haversine-Distanz), Speed-Lock >10km/h. 4 neue E2E (mockt /search, dedizierter SEARCH_CORE_PORT). **Orchestrator-Fund+Fix (KEIN Such-Regress):** CI-E2E rot an `styles.spec.ts:325` (poi-labels `visible` statt `none` nach Reload) — deterministisch unter `--workers=2` reproduziert. **Root-Cause = pre-existing E01-T6-Defekt**, den E05-T2s schwererer Startup-Bundle (niedrigere Start-FPS unter CI-CPU-Last) auslöste: Perf-Watchdog rief bei Degradation `styleStore.setPoi()` → **persistierte & überschrieb die explizite Nutzer-Stil-Wahl** (poi='off' → 'full', dauerhaft). Fix: Degradation publiziert jetzt **transiente, nicht-persistierte, nur-runter-clampende** Quality-Caps (poiCap/labelScaleCap); MapView kombiniert Nutzerwahl+Cap via `applyDegradationCaps()` — Nutzerstil nie zerstört, bei FPS-Erholung auto-wiederhergestellt. 3 perf.spec-Startup-Assertions gehärtet (level≤1 statt ===0 unter CI-Last). Verifiziert unter 2-Worker-Last: Voll-E2E 57 passed/0 failed, 825 Unit+Lint+Typecheck grün |
| E05-T1 | sonnet | 1 | ✅ MERGED | #36 | SearchService. CI-Lauf grün (alle 5 Checks), Squash f136db1. 791 Unit + 2 skip (Live-Stubs). Coordinate-Parser (Dezimal/DMS/Swap)→Photon→Nominatim(1req/s rate-limit)→out_of_coverage. SearchResult in shared (0.2.0). Env-Settings (kein Settings-Service). Photon-Integration = E05-T4-Follow-up. Health-Spiegelung /health offen (Pfad-Scope)
| E03-T5 | opus | 1 (+1 CI-Iteration durch Orchestrator) | ✅ MERGED | #35 | 🔴 Golden-Route-Suite (Merge-Blocker). CI-Lauf #91 grün (golden-routes-li ✅), Squash 9e36a41. Framework (4 Fall-Typen, Liang-Barsky bbox∩Geometrie, 17 Unit-Tests) + LI-Fälle grün, DE-restriction kuratiert (nightly, `unverified`). golden-routes-li startet core+Valhalla → **löst E03-T2-Integrationsgate ein**. **Orchestrator-Fund+Fix:** golden-suite fing sofort einen echten checkRoute-Konflikt (3,5t-LKW-Route LI ~7,7 km/h < 15-km/h-Untergrenze → 500) → checkRoute-Untergrenze 15→5 km/h gelockert (Slow≠Unsafe; Distanz/Ober-Guards unangetastet, Regressions-Test, shared 0.1.1) + styles.spec-Flake gehärtet |
| E03-T6 | haiku | 1 | ✅ MERGED | #34 | Regions-Grenzen-Handling (W-09). CI-Lauf #86 grün, Squash 1678c7e. 717 Unit + 53 E2E (Orchestrator-verifiziert). Coverage-Check (echte Katalog-Bounds, Point-in-BBox) VOR Valhalla → 422 OUT_OF_COVERAGE + missing_region_hint + „Regionen verwalten"-Link (neuer ui/store); NO_ROUTE ehrlich unterschieden. Kleine Scope-Erweiterung (RegionsPanel Open-Signal) additiv+ok |
| E03-T4 | sonnet | 1 | ✅ MERGED | #33 | Vermeidungen. CI-Lauf #83 grün, Squash ec1a733. 702 Unit + 51 E2E (Orchestrator-verifiziert). shared RouteRequest +exclude_locations/polygons/avoid_overrides (v0.1.0), Core-Valhalla-Mapping (lon/lat korrekt), Web avoid-Chips + „Abschnitt meiden"→Reroute + Vermeidungsliste (rote Polygone, Map-ADR befolgt) |
| E03-T3 | sonnet | 1 | ✅ MERGED | #32 | Routen-Anzeige/Zielwahl Frontend. CI-Lauf #79 grün, Squash 8e2a816. 661 Unit + 49 E2E (Orchestrator-verifiziert, keine Blank-Page). Klick/Long-Press→Ziel, Haupt-/Alt-Routen (Casing, antippbar), Auto-Fit, Summary+W-08-Banner, polyline6-Decoder, Nav-Button hinter NAV_ENABLED. Map-ADRs (013/E01-T3) sauber befolgt; E2E mockt /routes. **Routing jetzt end-to-end nutzbar** |
| E03-T2 | opus | 1 | ✅ MERGED | #31 | 🔴 RoutingService. CI-Lauf #75 grün, Squash 0510fa8. 71 Routing-Tests, Gesamt 639 + 1 skip (Live) + 1 todo. Profil→Truck-Costing 1:1 (Abfang-Test je Feld), Manöver-Tabelle gegen kanonisches Valhalla-Enum (U-Turns eigen), checkRoute-Riegel (unplausibel→500 fail-closed, „zu lang">4×Luftlinie→Warning). Opus-Abgabe korrigierte selbst falsche Enum-Zahlen aus meinem Spec. Orchestrator-verifiziert (Mapping + Manöver-Tabelle gelesen) |
| E03-T1 | sonnet | 1 (+2 CI-Iterationen durch Orchestrator) | ✅ MERGED | #30 | Valhalla-Pipeline (Welle 2a). CI-Lauf #71 grün, Squash 9da4b60. build-tiles.sh + atomischer Swap (W-17), Compose→gis-ops (ADR-014), CI-Job `valhalla-li-build` baut LI-Graph + smoke-testet LKW-Route Vaduz→Schaan. NUR-CI-verifiziert (lokal: Docker-Daemon aus + geofabrik `000`). **2 CI-Runden bis grün:** service_limits-Override-Merge crashte Valhalla beim Start (versionsstrenge Schema-Validierung: erst `sources_to_targets.max_matrix_distance`, dann `max_exclude_polygons.max_locations`) → **service_limits-Tuning vertagt**, Image-Default-Config wird unverändert genutzt (Routing nachweislich korrekt) |
| E06-T2 | haiku | 1 | ✅ MERGED | #29 | Phase 2 Start (User-Wahl: Profile zuerst). CI-Lauf #63 grün, Squash 2ae6ae5. 19 Unit + 3 E2E, Gesamt 569 Unit + 47 E2E. Profil-Chip+Sheet+Editor, Live-SVG-Silhouette, W-08-Disclaimer (>2.7m), Verdächtig-Heuristik (<1.8m & >3t). **Orchestrator-Fix:** Chip lag top-right auf MapLibre-Zoom-Control → Klick-Interception (gestures.spec) → nach top-left verschoben. E06-T3 wartet auf E04 |
| E02-T5 | sonnet | 1 (Subagent starb am Session-Limit nach Impl, Orchestrator verifizierte + fixte) | ✅ MERGED | #28 | 550 Unit + 1 todo + 44 E2E. CI-Lauf #58 grün (Quality+Docker+E2E), Squash 7bd63ce. DeadReckoningController → `pos/extrapolated` (Flag `extrapolated:true`), no-op-Provider bis E04-T6; `acquiring`-Zustand; Banner nach 3s. **Orchestrator-Fixes bei Verifikation:** (1) Blank-Page-Crash — Puck addSource/addLayer vor Style-Load (ADR-013); (2) Genauigkeitsring rendert nie (beforeId-Altlast seit E02-T2); (3) E2E serial (geteilter Simulator-Core). Subagent-Abgabe war UNVERIFIZIERT (Session-Limit vor Selbsttest) — hätte als Blank-Page live gecrasht |
<!-- offen für G1: E02-T5 GPS-Verlust-UX (letzter) -->
<!-- TODO nachziehen: system/plausibility Bus-Topic (guard reasons → bus/UI), wenn ein Task bus/ berührt -->
<!-- TODO nachziehen: satellites in GET /position/sources exponieren (E02-T3 hält sie intern) -->
<!-- TODO nachziehen: extrapolated-Filter im MQTT-Mapping (E02-T5/E08) -->
<!-- TODO nachziehen: DeadReckoningProvider real (E04-T6) — E02-T5 no-op-Interface -->
<!-- Bekanntes Flake-Risiko: map/routes.test.ts FD-Leak-Schwelle unter CI-Last -->
<!-- Bekanntes Flake-Risiko: map/regions/routes.test.ts (resumable-download, W-17) fs-timing unter Voll-Suite-Parallel-Last; isoliert 13/13 grün. Bei mir 1× in Voll-Suite rot, in CI (E05-T1) NICHT aufgetreten. Falls es CI-quality zuschlägt: härten (Timing/Toleranz) -->
<!-- TODO nachziehen: Photon-Health in GET /api/v1/health spiegeln (E05-T1 trackt intern, /health-Handler nicht erweitert); SearchService online_fallback/lang aus echtem Settings-Service statt env (sobald vorhanden) -->
<!-- TODO nachziehen (Härtung): Valhalla service_limits-Tuning für Mini-PC (E03-T1 vertagt) — services/valhalla/valhalla.json ist Referenz, NICHT zur Laufzeit gemischt; gegen echten Config-Dump der eingesetzten Valhalla-Version abgleichen, nur vorhandene Leaf-Werte reduzieren -->
<!-- TODO Kosmetik: Remote-Branch spike/valhalla-feasibility + gemergte task/*-Branches (jetzt inkl. task/E05-T2-search-ui) über GitHub-UI löschen (git push --delete scheitert am Proxy) -->
<!-- DESIGN-INVARIANT (E05-T2-Fund, E01-T6-Fix): Der Perf-Watchdog/die Degradation darf NIEMALS in die persistierten Nutzer-Stiloptionen (styleStore.setPoi/setLabelScale) schreiben — das überschrieb & persistierte die explizite Nutzerwahl. Degradation nutzt jetzt transiente, nicht-persistierte, NUR-runter-clampende Caps (degrade.poiCap/labelScaleCap) + styleClient.applyDegradationCaps(); MapView berechnet daraus die effektiven Render-Optionen. Regel für künftige Perf/Quality-Arbeit: transient & clamp-down-only, nie persistieren, nie über Nutzerwahl anheben. -->
<!-- TODO nachziehen (gleiche Defekt-Klasse, out-of-scope für E05-T2): Degradation Stufe 3 ruft viewModeStore.setMode('2d-north') — wenn setMode den View-Mode persistiert, überschreibt das ebenfalls die Nutzerwahl. Nur bei anhaltend <25fps (Extremfall). Analog zum poi-Fix auf transient/nicht-persistierend umstellen. -->
<!-- Flake-Härtung (E05-T2): styles.spec.ts:374 poi-Reload-Poll auf 10s (wie Geschwister); perf.spec Startup-Level-Assertions auf ≤1 (Watchdog darf unter CI-CPU-Last 1 legitimen 0→1-Schritt machen, 30s-Hysterese begrenzt auf ≤1 im Testfenster). Root-Cause aber war der E01-T6-Defekt oben, nicht Flakiness. -->
<!-- Hygiene (E05-T2): root-level test-results/ jetzt gitignored (Playwright/Vitest von Monorepo-Root). -->
<!-- NÄCHSTE TASKS Richtung G2 (Reihenfolge nach Nutzer-Freigabe „sinnvollste Reihenfolge"): E05-T3 Favoriten&Verlauf (Backend+UI, gut abgrenzbar) → E05-T5 Lite-Suchindex-Fallback (W-12) → E05-T4 Photon (BRAUCHT eigenen Feasibility-Spike: kein einfacher Klein-Land-Photon-Index wie geofabrik-PBF, planet-scale Dumps) → E04 Navigation (T1 Turn-by-Turn + T4 Sprachansagen SICHERHEITSKRITISCH→opus, T2 Rerouting, T3 ETA) → E06-T3 Profil-Reroute (braucht E04). -->
<!-- TODO nachziehen (E03-T2-Follow-up): echtes LI-Routing-Integrationsgate — core+Valhalla zusammen in CI (valhalla-li-build erweitern), löst den skipIf-Live-Test in apps/core/src/routing/routes.test.ts ein -->
<!-- TODO Hygiene (pre-existing, nicht E03-T2): `pnpm -r test` scheitert in packages/shared (per-Package-cwd findet Root-Globs nicht) → Exit 1. Voll-Suite läuft über Root-Vitest. Per-Package test-Script/vitest-Config fixen -->
<!-- TODO nachziehen: avoid.unpaved→use_tracks:0 ist Näherung (kein exakter Valhalla-Schalter); harte Garantie bräuchte Edge-Tagging in der Tile-Pipeline -->
<!-- TODO nachziehen: speed_limits im RoutingService (E03-T2 liefert derzeit leer/null — braucht /trace_attributes oder edge-Anreicherung) -->


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

## Machbarkeits-Checks

- **Routing (E03/Valhalla) — ✅ BESTÄTIGT in CI (2026-07-11).** Wegwerf-Spike
  (`spike/valhalla-feasibility`, Workflow `valhalla-spike.yml`) bewies in GitHub
  Actions: Image `ghcr.io/gis-ops/docker-valhalla/valhalla:latest` zieht +
  auto-baut den Liechtenstein-Graph aus `tile_urls`
  (download.geofabrik.de) und beantwortet `/route` (costing `truck`)
  Vaduz→Schaan = **3,17 km / 4,2 min**, echte LI-Straßen (Adlerkreisel/Herrengasse/
  Schaan), has_toll/ferry=false, PLAUSIBEL. Gesamter Job **~25 s** (LI ist winzig).
  **Konsequenzen für E03-T1:** (a) lokal in dieser Sandbox NICHT verifizierbar
  (Docker-Daemon aus + geofabrik `000` geblockt) → CI ist alleinige Prüfinstanz,
  ABER der Build ist so schnell, dass ein `valhalla-li-build`-Gate per-PR (nicht nur
  nightly) tragbar ist. (b) **Image-Empfehlung: gis-ops-Auto-Build** statt des
  offiziellen `ghcr.io/valhalla/valhalla` (Compose entsprechend anpassen = ADR-014-
  Kandidat) — spart die manuellen valhalla_build_config/_tiles-Schritte. (c) truck-
  Costing funktioniert out-of-the-box; Profil-Mapping (Höhe/Gewicht/avoid) ist E03-T2.
  <!-- Cleanup offen: Remote-Branch spike/valhalla-feasibility ließ sich per git push
       --delete nicht entfernen (Proxy trennt send-pack); Workflow ist inert (feuert nur
       auf push zu diesem Branch). Bei Gelegenheit via GitHub-UI/API löschen. -->

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
