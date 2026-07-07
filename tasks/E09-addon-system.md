# E09 – Add-on-System (Runtime, SDK, Store)

**Ziel:** Add-ons installieren/betreiben ohne Core-Änderungen; SDK; Store;
zwei Referenz-Add-ons. **Gate-Beitrag G4. Sicherheits-Schwerpunkt (W-10/11/13/14).**

---

## E09-T1: Manifest, Installation & Lifecycle im Core

- **Abhängigkeiten:** E08-T3 (Auth) · **Kontext:** docs/05 §1/§2/§5; docs/03 §2 Add-ons
- **Pfade:** `apps/core/src/addons/`

**Aufgabe:** Manifest-Schema (`yapaja-addon.json`, docs/05 §2) in shared.
Installations-Pipeline: Tarball (Upload ODER URL) → sha256-Check (bei
Registry-Install Pflicht) → Manifest validieren → `core_api`-semver-Check
(inkompatibel: Abbruch mit klarer Meldung, W-11) → Scope-Liste an UI zur
Bestätigung (Install erst nach Confirm-Call) → entpacken nach `data/addons/{id}`
(Pfad-Traversal-Schutz beim Entpacken!) → DB-Eintrag. Lifecycle-Endpoints nach
docs/03 §2 (enable/disable/uninstall — uninstall löscht Code+Storage restlos).
Update: neue Version parallel entpacken, altes Verzeichnis erst nach
erfolgreichem Start ersetzen (Rollback, docs/05 §5).

**Akzeptanz:** 1. Fixture-Add-on via Upload installierbar inkl. Scope-Confirm-
Schritt; 2. sha256-Mismatch/inkompatible core_api/böser Tarball (`../`-Pfade)
werden abgewiesen; 3. Uninstall rückstandsfrei (FS+DB-Assertion); 4. fehlgeschlagenes
Update rollt zurück.
**Pflicht-Tests:** Pipeline-Integration alle Pfade; Tarball-Security-Unit
(traversal, symlink, 500-MB-Bombe → Größenlimit 50 MB); Rollback-Test.
**Plausibilität:** Ein disabled Add-on hat KEINE laufenden Effekte (kein Prozess,
Token invalidiert, Layer entfernt).

---

## E09-T2: Frontend-Plugin-Runtime (iframe-Sandbox + Bridge)

- **Abhängigkeiten:** E09-T1, E07-T1 · **Kontext:** docs/05 §1A/§3/§4; Wargame W-10
- **Pfade:** `apps/web/src/addons/`, `apps/core/src/addons/ui-host.ts`

**Aufgabe:** UI-Add-ons laden: Core serviert `data/addons/{id}/ui/` unter
`/addons/{id}/ui/` mit **strikter CSP** (default-src 'self' des Add-on-Pfads,
keine externen Hosts außer via Bridge). Host-Seite: iframe
`sandbox="allow-scripts"` (KEIN allow-same-origin zur Parent-Origin — Add-on-
Origin separat), postMessage-Bridge mit Handshake (Origin-Check, Add-on-ID,
Scope-Set). Bridge-Methoden serverseitig/hostseitig gegen Scopes geprüft
(nicht nur im SDK!): position.subscribe, nav.state, map.addLayer/addMarkers/
removeLayer, widgets.update/register (in E07-Registry als Add-on-Widget),
events.publish (nur `addon/{id}/*`), storage (KV via Core-API, Namespace erzwungen),
route.propose (rendert IMMER Bestätigungs-Banner im Host — W-10).

**Akzeptanz:** 1. Fixture-UI-Add-on zeichnet GeoJSON-Layer + Widget und empfängt
Positionen; 2. nicht-deklarierter Scope → Bridge-Call abgelehnt + geloggt;
3. route.propose ohne Nutzer-Ja hat keinerlei Routing-Effekt; 4. Layer/Widgets
verschwinden bei disable sofort.
**Pflicht-Tests:** Bridge-Unit (Handshake, Origin-Spoof abgelehnt); Scope-Matrix-
Test (jede Methode × mit/ohne Scope); Playwright: Fixture-Add-on-Flow.
**Plausibilität:** Add-on-iframe kann Parent-DOM nachweislich nicht lesen
(Testversuch im Fixture — muss scheitern).

---

## E09-T3: Service-Plugin-Runtime (Node-Prozesse + Scoped Tokens)

- **Abhängigkeiten:** E09-T1 · **Kontext:** docs/05 §1B/§2; Wargame W-14
- **Pfade:** `apps/core/src/addons/service-host.ts`

**Aufgabe:** `runtime: node18|20`-Add-ons als Child-Prozess starten:
Env enthält `YAPAJA_API_URL`, `YAPAJA_TOKEN` (scoped, pro Add-on, bei disable
sofort invalidiert), `YAPAJA_DATA_DIR`; Prozess-CWD = Add-on-Dir; Node mit
`--permission --allow-fs-read/write` auf Add-on-Dirs beschränkt (dokumentierte
Best-Effort-Härtung; echte Isolation = runtime external). Scoped-Token-Auth im
Core: Token→Scope-Prüfung auf jeder REST/WS-Route (Scope-Mapping aus docs/05 §2;
`net.fetch:<host>` via Core-Proxy-Endpunkt `/api/v1/addons/proxy?url=` mit
Host-Allowlist). Watchdog (W-14): CPU > 25 % über 60 s → SIGSTOP-Drossel-Zyklen +
Warnung; > 5 Crashes/10 min → auto-disable + UI-Hinweis; RSS-Limit aus Manifest
(Default 256 MB) → Kill+Restart. `runtime: external`: kein Prozess, nur
Token-Ausstellung (Anzeige in UI zum Kopieren).

**Akzeptanz:** 1. Fixture-Service (subscribed pos, published addon-Event) läuft
und stoppt mit enable/disable; 2. Token-Scope-Matrix serverseitig durchgesetzt;
3. Amok-Fixture (Busy-Loop) wird gedrosselt+gemeldet, Crash-Loop-Fixture
auto-disabled; 4. Proxy verweigert nicht-deklarierte Hosts.
**Pflicht-Tests:** Scope-Matrix (REST+WS); Watchdog mit Amok/Crash-Fixtures
(Fake-Metriken wo nötig); Token-Invalidierung wirkt < 1 s.
**Plausibilität:** Add-on-Prozess kann `data/db.sqlite` nachweislich nicht lesen
(Fixture versucht es — Fehler erwartet).

---

## E09-T4: Add-on-SDK (`@yapaja/addon-sdk`)

- **Abhängigkeiten:** E09-T2/T3 · **Kontext:** docs/05 §3
- **Pfade:** `packages/addon-sdk/`

**Aufgabe:** SDK-Paket mit den Oberflächen aus docs/05 §3, zwei Transporte
(postMessage im iframe / REST+WS mit Token im Service — automatisch erkannt),
vollständige TS-Typen (aus shared re-exportiert), Fehlerklassen
(`ScopeDeniedError`, `IncompatibleCoreError`), Reconnect-Handling im
Service-Transport. Doku: `docs/addon-dev-guide.md` — Schnellstart „Add-on in
10 Minuten" (beide Typen), Manifest-Referenz, Scope-Referenz, Test-Rezept
(Add-on gegen lokalen Core testen). Semver: SDK-Major == core_api-Major.

**Akzeptanz:** 1. Beide Referenz-Add-ons (T5) nutzen ausschließlich das SDK
(kein direkter fetch/postMessage); 2. Guide von einer unbeteiligten Person/Modell
nachvollziehbar (Review-Check); 3. Typen vollständig (SDK-Build mit strict, keine any-Exports).
**Pflicht-Tests:** SDK-Unit gegen Mock-Host (alle Methoden, Fehlerfälle);
Transport-Autodetekt.
**Plausibilität:** ScopeDeniedError enthält den fehlenden Scope-Namen (DX).

---

## E09-T5: Referenz-Add-ons: POI-Overlay „Stellplätze" & Track-Recorder

- **Abhängigkeiten:** E09-T4 · **Kontext:** docs/05 §6
- **Pfade:** `addons-examples/poi-campsites/`, `addons-examples/track-recorder/`

**Aufgabe:** (a) **POI-Overlay** (Typ A): gebündeltes GeoJSON (Fixture ~200
Stellplätze), Layer + Cluster-Marker, Klick → Widget mit Details + Button
„Route hierhin" (via route.propose → Nutzerbestätigung). Settings-Page
(Kategorie-Filter). (b) **Track-Recorder** (Typ B + Mini-UI): Service subscribed
`pos/update`, schreibt GPX (Segmente bei GPS-Verlust korrekt trennen!) in
storage; UI-Widget Start/Stop/Dauer/Distanz + Liste aufgezeichneter Tracks mit
GPX-Download. Beide: sauberes Manifest mit minimalen Scopes, Build-Skript →
Tarball, README nach Guide.

**Akzeptanz:** 1. Beide installierbar aus Tarball und voll funktional (E2E-Flow
10 + Recorder-Flow: Simulator-Fahrt aufzeichnen → GPX exportieren → Datei ist
valides GPX mit plausibler Distanz ±2 %); 2. Scopes minimal (Review gegen
Scope-Referenz); 3. dienen als Doku (Code kommentiert).
**Pflicht-Tests:** E2E beide Flows; GPX-Validierung (Schema + Distanz);
POI-Klick→propose→Bestätigung→Route.
**Plausibilität:** Recorder-GPX-Distanz == Simulator-Solldistanz ±2 %.

---

## E09-T6: Sandbox-Escape- & Sicherheits-Testsuite (🔴 W-10)

- **Abhängigkeiten:** E09-T2/T3 · **Kontext:** Wargame W-10; docs/07 §7
- **Pfade:** `e2e/security/`, `addons-examples/evil-fixture/` (nicht im Store!)

**Aufgabe:** „Evil-Fixture"-Add-on, das systematisch Verbotenes versucht:
Parent-DOM-Zugriff, fetch zu fremden Hosts (UI+Service), undeklarierte
Bridge-Methoden, fremde Event-Topics, storage außerhalb Namespace, FS außerhalb
Datadir, Route-Aktivierung ohne Confirm, Token-Replay nach disable,
Tarball-Angriffe (traversal/symlink/bomb — Wiederverwendung E09-T1-Fixtures in
E2E-Kontext). Suite asserted: JEDER Versuch geblockt UND als `security`-Event
geloggt. Läuft in jeder Release-Pipeline; jeder neue Scope erweitert die Suite
(Checklisten-Eintrag in tasks/README-Abnahme).

**Akzeptanz:** 1. Alle Angriffsvektoren geblockt+geloggt (Einzelnachweis je
Vektor im PR); 2. Suite bricht nachweislich, wenn man eine Schutzmaßnahme
deaktiviert (ein dokumentierter Mutations-Nachweis); 3. in Release-Pipeline verdrahtet.
**Pflicht-Tests:** — (die Suite IST der Test)
**Plausibilität:** Kein Vektor wird durch Test-Mocks „geblockt" — Suite läuft
gegen echten Core im Compose-Setup.

---

## E09-T7: Registry & Store-UI

- **Abhängigkeiten:** E09-T1, E09-T5 · **Kontext:** docs/05 §5; Wargame W-11/W-13
- **Pfade:** `apps/core/src/addons/registry.ts`, `apps/web/src/store/`, separates Repo-Layout dokumentieren

**Aufgabe:** Registry-Client: `index.json` von konfigurierbarer URL laden
(Default: offizielles Registry-Repo raw-URL), Schema validieren, lokal cachen
(`GET /addons/registry` + Alter des Caches; `POST /addons/registry/sync`).
Store-UI: Katalog (Karten mit Icon, Beschreibung, Scopes-Vorschau, Screenshots),
Detailseite, Install-Button → Scope-Confirm → Job-Progress; Updates-Tab
(installiert vs. Registry-Version, core_api-Kompatibilität VOR Install geprüft,
W-11); Offline-Verhalten (W-13): Cache-Stand-Anzeige, Upload-Install prominent.
Registry-Repo-Struktur + Einreichungs-PR-Checkliste als `docs/registry-guide.md`
(inkl. Review-Punkte aus docs/05 §5, signature-Feld reserviert).

**Akzeptanz:** 1. E2E-Flow 10 gegen lokale Fixture-Registry; 2. inkompatibles
Add-on zeigt Sperr-Hinweis statt Install-Button; 3. Registry unerreichbar →
Store nutzbar mit Cache+Upload; 4. sha256 aus Index wird erzwungen.
**Pflicht-Tests:** Index-Schema-Validierung (auch böse Fixtures: falscher Hash,
fehlende Felder); Playwright: Store-Flows on/offline.
**Plausibilität:** Update behält Nutzer-Settings des Add-ons (Storage bleibt bei Update, nur bei Uninstall weg).

---

## E09-T8: MQTT-Erweiterung für Add-ons

- **Abhängigkeiten:** E09-T3, E08-T1 · **Kontext:** docs/03 §3/§4; docs/05 §2 `events.publish`
- **Pfade:** `apps/core/src/mqtt/`, `apps/core/src/addons/`

**Aufgabe:** Add-on-Events (`addon/{id}/*` mit Scope events.publish) zusätzlich
als `yapaja/addon/{id}/*` via MQTT publizieren (Rate-Limit 5 msg/s pro Add-on,
Payload ≤ 16 KB, Drossel-Log). Optional pro Add-on abschaltbar (Store-Detail-
Toggle „In Home Assistant verfügbar"). Doku-Beispiel: HA-Automation, die auf
Track-Recorder-Event reagiert.

**Akzeptanz:** 1. Recorder-Start/Stop-Events erscheinen als MQTT-Topics;
2. Rate-Limit greift nachweislich; 3. Toggle wirkt sofort.
**Pflicht-Tests:** Integration mit Testcontainer; Limit-Unit.
**Plausibilität:** Add-on kann keine `yapaja/cmd/*`- oder Core-Status-Topics
publizieren (Topic-Namespace-Test).
