# Kickoff-Prompt: Komplette Umsetzung starten

Dieses Dokument enthält **einen einzigen Copy-Paste-Prompt**, der die gesamte
Umsetzung von Yapaja Go startet, plus die **Modell-Zuordnungsmatrix** und die
**Abnahme-Anleitung** für den Menschen am Ende.

## Voraussetzungen (einmalig, ~10 Minuten)

1. **Wo einfügen:** In eine Agent-Umgebung mit Zugriff auf dieses Repository,
   die Subagenten mit wählbarem Modell starten kann (z. B. Claude Code mit
   Agent-Tool). Das Orchestrator-Modell selbst sollte die stärkste verfügbare
   Klasse sein (Opus-Klasse oder höher) — es trifft alle Review- und
   Gate-Entscheidungen.
2. **Planungs-Branch mergen:** Der Branch `claude/yapaia-go-planning-ygl63q`
   (docs/ + tasks/) muss in den Default-Branch gemergt sein, damit der
   Orchestrator auf `main` aufsetzt.
3. **Rechte:** Der Orchestrator braucht Push-Rechte, PR-Erstellung und
   Issue-Schreibrechte auf dieses Repository sowie eine Umgebung, in der
   `docker compose`, `pnpm` und Playwright laufen.

---

## 1. DER MASTER-PROMPT (ab hier kopieren)

```
Du bist der ORCHESTRATOR für die vollständige Umsetzung der App "Yapaja Go"
(browserbasierte Offline-Navigations-App für Wohnmobile). Deine Aufgabe ist es,
die gesamte Implementierung eigenständig zu steuern, bis Release-Gate G4
erreicht ist oder du auf einen definierten Stopp-Grund triffst. Du schreibst
selbst KEINEN Feature-Code — du beauftragst Umsetzungs-Modelle, prüfst ihre
Ergebnisse, führst Tests aus und triffst Merge-Entscheidungen.

== SCHRITT 0: EINLESEN (Pflicht, vor allem anderen) ==
Lies in dieser Reihenfolge vollständig:
1. README.md
2. docs/02-roadmap-milestones.md   (Phasen, Gates, Abhängigkeitsgraph)
3. tasks/README.md                 (Prompt-Zusammenbau, globaler Systemprompt,
                                    Abnahme-Checkliste §4, Eskalationsregel)
4. tasks/KICKOFF-PROMPT.md §2      (Modell-Zuordnungsmatrix — verbindlich)
5. docs/07-testing-qa.md           (Gates, Definition of Done)
Die übrigen docs/ liest du gezielt, wenn ein Task sie als Kontext nennt.

== ARBEITSMODELL ==
- Basis-Branch: main. Pro Task: Branch task/<TASK-ID>-kurzname, ein PR,
  Merge nur durch dich nach bestandener Abnahme.
- Die GitHub-Issues #1–#11 sind die Epics. Nach jedem gemergten Task hakst du
  die entsprechende Checkbox im Epic-Issue ab. Nach jeder Welle schreibst du
  einen kurzen Status-Kommentar ins betroffene Epic-Issue.
- Du führst eine Datei ORCHESTRATION-LOG.md im Repo-Root: je Task eine Zeile
  (Task-ID, Modell, Versuche, Ergebnis, PR-Link, Besonderheiten). Diese Datei
  ist deine persistente Wahrheit, falls deine Session neu startet: Lies sie
  bei Wiederaufnahme ZUERST und mache exakt dort weiter.

== WELLENPLAN (Reihenfolge verbindlich, innerhalb einer Welle parallelisierbar) ==
Welle 0: E00-T1 → E00-T2 → E00-T3 → E00-T4          → GATE G0
Welle 1a (parallel): E01-T1→T2→T3→T4 | E02-T1→T2→T3→T4 | E06-T1
Welle 1b (parallel): E01-T5, E01-T6, E02-T5          → GATE G1
Welle 2a (parallel): E03-T1→T2 | E05-T1, E05-T4 | E06-T2
Welle 2b (parallel): E03-T3→T4, E03-T5, E03-T6 | E05-T2→T3, E05-T5
Welle 2c: E04-T1 → (parallel: E04-T2, E04-T3, E04-T4) → E04-T5, E04-T6, E06-T3
                                                      → GATE G2
Welle 3 (parallel): E07-T1→T2→T3→T4→T5 | E08-T1→T2→T3 → E08-T4, E08-T5, E08-T6
                                                      → GATE G3
Welle 4: E09-T1 → (parallel: E09-T2, E09-T3) → E09-T4 → E09-T5, E09-T7, E09-T8
         → E09-T6, dann E10-T1→T2→T3→T4→T5            → GATE G4 (E10-T6)
"A→B" heißt: B erst starten, wenn A gemergt ist. "A | B" heißt: parallel erlaubt.

== JE TASK: ABLAUF ==
1. PROMPT BAUEN nach tasks/README.md §1: Block 1 = globaler Systemprompt aus
   tasks/README.md §2 wörtlich; Block 2 = die im Task genannten Kontext-
   Dokument-Abschnitte (nur die Abschnitte, nicht ganze Dateien); Block 3 =
   der komplette Task-Abschnitt aus der Epic-Datei; Block 4 = aktueller Inhalt
   der im Task genannten "Berührten Pfade" (bei neuen Pfaden: die relevanten
   Nachbar-Module, z. B. bestehende Service-Registrierung).
2. MODELL WÄHLEN exakt nach der Matrix in tasks/KICKOFF-PROMPT.md §2.
   Du darfst NIE ein billigeres Modell nehmen als angegeben. Ein teureres nur
   über die Eskalationsregel unten.
3. DISPATCH an das Umsetzungs-Modell als Subagent im Task-Branch.
4. VERIFIKATION durch dich selbst (nicht dem Subagent glauben):
   a. pnpm lint && pnpm typecheck && pnpm test lokal ausführen.
   b. Die Pflicht-Tests des Tasks existieren und testen Verhalten (Stichprobe
      lesen: mindestens 2 Testdateien inhaltlich prüfen).
   c. Akzeptanzkriterien einzeln gegen das Verhalten prüfen (bei UI: Playwright-
      Lauf bzw. E2E-Subset des Epics; bei API: curl/Testcontainer).
   d. Abnahme-Checkliste tasks/README.md §4 komplett durchgehen.
   e. Plausibilitäts-Checks des Tasks stichprobenartig nachvollziehen.
5. REVIEW: Bei Tasks mit Review-Stufe "Opus" in der Matrix zusätzlich ein
   Review-Subagent (Opus-Klasse) mit dem Diff + Akzeptanzkriterien + Checkliste;
   dessen Findings müssen behoben sein vor Merge. Alle anderen Tasks reviewst
   du selbst.
6. MERGE in main, Issue-Checkbox abhaken, ORCHESTRATION-LOG.md fortschreiben.

== ESKALATION & STOPP-REGELN ==
- Scheitert ein Umsetzungs-Modell (Verifikation rot oder Kriterien verfehlt):
  1 Retry beim selben Modell mit konkretem Fehler-Feedback. Scheitert es
  erneut: einmalig eine Modellstufe hoch (haiku→sonnet→opus) mit frischem
  Prompt. Scheitert auch das: STOPP für diesen Task, Eintrag "BLOCKED" im Log,
  GitHub-Issue-Kommentar mit Diagnose. Unabhängige Tasks laufen weiter.
- Meldet ein Modell KLÄRUNGSBEDARF: Beantworte ihn selbst, WENN die Antwort
  eindeutig aus docs/ ableitbar ist (zitiere die Stelle im Log). Sonst: Task
  auf BLOCKED, Frage als Issue-Kommentar an den Menschen, weiterarbeiten.
- Sicherheitskritische Tasks (E03-T2, E03-T5, E09-T2, E09-T3, E09-T6): hier
  gibt es KEINE Toleranz — rote restriction-/security-Tests sind nie "flaky",
  Eskalation sofort, notfalls BLOCKED.
- Globaler Stopp: >5 gleichzeitig geblockte Tasks ODER ein Gate zweimal in
  Folge nicht bestanden → Gesamtstopp + ausführlicher Report an den Menschen.

== GATES ==
Am Ende jeder Gate-Welle führst du die Gate-Kriterien aus
docs/02-roadmap-milestones.md + docs/07-testing-qa.md aus (CI-Läufe verlinken,
E2E-Flows des Standes ausführen, Budgets messen soweit definiert). Gate-Ergebnis
als Kommentar in alle betroffenen Epic-Issues. Erst bei GRÜN beginnt die
nächste Welle.

== WAS DU NICHT TUST ==
- Keine Architektur-Änderungen ohne ADR-Nachtrag + Issue-Kommentar (und nur,
  wenn ein Task sonst unlösbar ist).
- Keine neuen Dependencies außer den in Tasks erlaubten durchwinken.
- Keine Tasks überspringen, zusammenlegen oder "vereinfachen".
- Menschliche Pflichtanteile nicht simulieren: echte Hardware-Tests
  (docs/07 §7) und die finale Freigabe E10-T6 bleiben beim Menschen — du
  bereitest die Checklisten-Issues vor und markierst sie als "HUMAN REQUIRED".

== ABSCHLUSS ==
Wenn G4 erreicht ist (bzw. beim Gesamtstopp): Erstelle ABSCHLUSSBERICHT.md
im Repo-Root: umgesetzte Tasks je Modell, Gesamtkosten-Schätzung (Anzahl
Dispatches je Modellklasse), offene BLOCKED-Punkte, Gate-Nachweise (Links),
und verweise den Menschen auf tasks/KICKOFF-PROMPT.md §3 für den Abnahmetest.

Beginne jetzt mit Schritt 0.
```

*(Ende des Master-Prompts)*

---

## 2. Modell-Zuordnungsmatrix (verbindlich für den Orchestrator)

Modellklassen (aktuelle Claude-Generation, bei Nachfolgern äquivalent ersetzen):

| Klasse | Modell-ID | Einsatz |
|---|---|---|
| **haiku** | `claude-haiku-4-5-20251001` | Boilerplate, CRUD, klar spezifizierte UI, Skripte, Doku |
| **sonnet** | `claude-sonnet-5` | Integrationslogik, zustandsbehaftete Services, anspruchsvolle UI |
| **opus** | `claude-opus-4-8` | Sicherheitskritisches, Nebenläufigkeit, Security, Algorithmik |

**Review-Stufe:** `—` = Orchestrator reviewt selbst · `Opus` = zusätzlicher
Review-Subagent der Opus-Klasse ist Pflicht.

| Task | Modell | Review | Begründung (Kurzform) |
|---|---|---|---|
| E00-T1 Monorepo | haiku | — | Standard-Scaffolding, präzise Spezifikation |
| E00-T2 Schemata | haiku | — | mechanisch: Spezifikation → JSON-Schema |
| E00-T3 Docker/Compose | haiku | — | Standard-Patterns |
| E00-T4 CI | haiku | — | Standard-Workflows |
| E01-T1 PMTiles-Range | sonnet | — | HTTP-Range-Semantik fehleranfällig (206/416, Streams, FD-Leaks) |
| E01-T2 MapLibre-Basis | sonnet | — | Protokoll-Registrierung, Offline-Constraints |
| E01-T3 Ansichtsmodi | haiku | — | Kamera-API-Nutzung, klar spezifiziert |
| E01-T4 Style-System | sonnet | — | „setStyle mit Layer-Erhalt" ist ein bekanntes Fallen-Pattern |
| E01-T5 Region-Manager | sonnet | — | Job-System, Resume, atomare Dateioperationen |
| E01-T6 Perf-Wächter | haiku | — | Hysterese-Logik ist klein und exakt beschrieben |
| E02-T1 Bus+PositionService | sonnet | — | Failover-Timing, Rate-Limits, WS-Protokoll |
| E02-T2 Browser-GPS | haiku | — | schmale API, Fälle aufgezählt |
| E02-T3 gpsd+Guard | sonnet | — | TCP-Protokoll-Parsing, Reconnect, Filterlogik |
| E02-T4 Simulator | sonnet | — | Geodäsie-Interpolation, Mutations-Engine |
| E02-T5 GPS-Verlust-UX | haiku | — | UI-Zustände, klar definiert |
| E03-T1 Valhalla-Pipeline | sonnet | — | Infra-Skripte mit Swap-Logik |
| **E03-T2 RoutingService** 🔴 | **opus** | Opus | Profil-Mapping = Sicherheitskern; Fehler ⇒ Route unter zu niedrige Brücke |
| E03-T3 Routen-UI | sonnet | — | Karten-Interaktion, mehrere Zustände |
| E03-T4 Vermeidungen | sonnet | — | Schema-Erweiterung + Geometrie |
| **E03-T5 Golden-Routes** 🔴 | **opus** | Opus | Testsuite, die die Sicherheit beweist; Fall-Kuratierung braucht Sorgfalt |
| E03-T6 Coverage-Handling | haiku | — | Bounds-Checks + Meldungen |
| **E04-T1 Nav-Kern/Matching** 🔴 | **opus** | Opus | Map-Matching-Algorithmik + State-Machine = Herzstück |
| E04-T2 ETA | sonnet | — | EWMA + Zeitzonen-Disziplin |
| E04-T3 Manöver/Ansagen | sonnet | — | Schwellenlogik, Queue, i18n |
| **E04-T4 Rerouting** | **opus** | — | Zeitverhalten + Loop-Schutz, viele Randfälle |
| E04-T5 Steuerung E2E | sonnet | — | Verdrahtung vieler Teile |
| E04-T6 Dead-Reckoning | sonnet | Opus | Extrapolation auf Polyline, sicherheitsnah (Tunnel-Ansagen) |
| E05-T1 SearchService | sonnet | — | Backend-Kette, Parser, Rate-Limit |
| E05-T2 Such-UI | haiku | — | Standard-Autocomplete nach Spezifikation |
| E05-T3 Favoriten | haiku | — | CRUD + Drawer-UI |
| E05-T4 Photon-Setup | haiku | — | Container + Skripte |
| E05-T5 Lite-Index | sonnet | — | PBF-Extraktion + FTS5-Ranking |
| E06-T1 Profil-Backend | haiku | — | CRUD mit Invariante, exakt beschrieben |
| E06-T2 Profil-UI | haiku | — | Formular + SVG-Silhouette |
| E06-T3 Wechsel-Reroute | sonnet | — | Drei Auslösepfade, Zustands-Restore |
| E07-T1 Widget-Engine | sonnet | — | Registry + Persistenz-Merge, Add-on-Schnittstelle |
| E07-T2 Edit-Modus | sonnet | — | Drag & Drop mit Constraints |
| E07-T3 Tag/Nacht | haiku | — | NOAA-Formel ist Standardstoff, Edge-Cases benannt |
| E07-T4 Fahr-Härtung | haiku | — | Audits + Sperr-Overlay |
| E07-T5 PWA/Kiosk | sonnet | — | Service-Worker-Caching-Fallen |
| E08-T1 MQTT-Bridge | sonnet | — | LWT, Raten, Reconnect-Semantik |
| E08-T2 Discovery | haiku | — | Payload-Generierung nach Tabelle |
| E08-T3 Auth+HA-REST | sonnet | Opus | Auth-Code: Review-Pflicht durch stärkste Klasse |
| E08-T4 HA-Add-on | sonnet | — | s6/Ingress/bashio-Eigenheiten |
| E08-T5 Onboarding | haiku | — | Wizard nach Drehbuch |
| E08-T6 Migrationen | sonnet | — | Backup/Rollback-Korrektheit |
| E09-T1 Install-Pipeline | sonnet | Opus | Tarball-Security (Traversal/Symlink/Bomb) |
| **E09-T2 iframe-Sandbox** 🔴 | **opus** | Opus | Sandbox-Korrektheit = Sicherheitsgrenze des Ökosystems |
| **E09-T3 Service-Runtime** 🔴 | **opus** | Opus | Token-Scopes, Prozess-Isolation, Watchdog |
| E09-T4 SDK | sonnet | — | API-Design nach Spezifikation |
| E09-T5 Referenz-Add-ons | haiku | — | nutzen nur das SDK; dienen als Doku |
| **E09-T6 Escape-Suite** 🔴 | **opus** | Opus | Angriffs-Denke erforderlich |
| E09-T7 Registry/Store | sonnet | — | Katalog, Cache, Offline-Pfade |
| E09-T8 Add-on-MQTT | haiku | — | Mapping + Limits |
| E10-T1 E2E komplett | sonnet | — | Entflaken erfordert Urteilsvermögen |
| E10-T2 Perf-Budgets | sonnet | — | Messaufbau-Stabilität |
| E10-T3 Golden-DE + Runbook | sonnet | Opus | Fall-Kuratierung (Web-Recherche!); Review sichert Qualität |
| E10-T4 Audits | haiku | — | Werkzeug-Verdrahtung |
| E10-T5 Doku/Release | haiku | — | Schreiben nach Vorlagen |
| E10-T6 Release | Orchestrator + **Mensch** | — | Checkliste belegen; Freigabe ist menschlich |

**Kostenlogik:** ~24× haiku, ~24× sonnet, ~8× opus (+9 Opus-Reviews). Der
Orchestrator protokolliert die tatsächlichen Dispatches im ABSCHLUSSBERICHT.

---

## 3. Abnahmetest für den Menschen (wenn der Orchestrator „G4 erreicht" meldet)

### 3.1 Automatisierte Bestätigung (~30 Min., auf deinem Rechner oder Mini-PC)

```bash
git clone <repo> yapaja-go && cd yapaja-go
pnpm install
pnpm lint && pnpm typecheck && pnpm test          # muss komplett grün sein
./services/valhalla/build-tiles.sh liechtenstein  # kleiner Test-Datensatz
docker compose up -d
pnpm e2e                                          # alle 11 Pflicht-Flows grün
```

Danach `ABSCHLUSSBERICHT.md` lesen: keine offenen BLOCKED-Punkte in 🔴-Tasks;
alle Gate-Kommentare in den Issues #1–#11 verlinkt und grün.

### 3.2 Manueller Smoke-Test (~20 Min., Browser auf http://localhost:8080)

1. Onboarding durchlaufen (Region Liechtenstein, Profil „Camper 3,0 m" anlegen).
2. Internet trennen (WLAN aus) → App neu laden → Karte funktioniert weiter.
3. Suche „Vaduz" → Route → Navigation starten → Simulator aktivieren
   (Settings → GPS-Quelle → Simulator, Route abfahren lassen):
   Manöverpfeile, Distanz-Countdown, ETA, Tempo/Limit beobachten.
4. Während der Simulation Seite neu laden → Navigation wird angeboten/fortgesetzt.
5. Profil auf „Alkoven 3,8 m" wechseln → Bestätigungs-Banner → Reroute.
6. Widget per Long-Press verschieben → Reload → Position bleibt.
7. 2D/3D und Nord/Kurs umschalten; Dark-Mode erzwingen → Karte + UI wechseln zusammen.
8. Favorit anlegen → über Favoriten-Chip Route starten.
9. Store öffnen → Referenz-Add-on „Stellplätze" installieren → Layer sichtbar
   → deinstallieren → Layer weg.
10. MQTT prüfen (falls Broker konfiguriert):
    `mosquitto_sub -t 'yapaja/#' -v` zeigt Position/ETA/Anweisung;
    `mosquitto_pub -t yapaja/cmd/navigation -m '"stop"'` stoppt die Navigation.

### 3.3 Ziel-Umgebung (dein Mini-PC, ~1–2 Std. inkl. Downloads)

1. HA-Add-on-Repo in Home Assistant hinzufügen → Yapaja Go installieren →
   Region Deutschland laden → UI über die HA-Seitenleiste öffnen (Ingress).
2. USB-GPS-Maus anschließen → Settings → GPS-Quelle: gpsd → Fix abwarten
   (kalt < 60 s), Position plausibel.
3. HA: Gerät „Yapaja Go" unter MQTT-Integrationen → Entitäten (Speed, ETA,
   Anweisung, Höhe …) vorhanden; Test-Automation: `select.yapaja_profile`
   umschalten wirkt in der App.
4. Erst danach: echte Probefahrt nach Hardware-Checkliste
   (docs/07-testing-qa.md §7) — Beifahrer bedient!

**Nicht bestanden?** → Befund als Kommentar ins passende Epic-Issue, dann den
Orchestrator mit dem Master-Prompt erneut starten: er liest
ORCHESTRATION-LOG.md, nimmt die offenen Punkte auf und arbeitet weiter.
