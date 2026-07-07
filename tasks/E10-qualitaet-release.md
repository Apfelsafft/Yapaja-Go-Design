# E10 – Qualität, Performance & Release v1.0

**Ziel:** Alle Gates automatisiert, Budgets in CI, Doku komplett, Release-Prozess.
**Gate G4 = Release.**

---

## E10-T1: E2E-Suite vervollständigen & entflaken

- **Abhängigkeiten:** E01–E09 · **Kontext:** docs/07 §5 (Flows 1–11)
- **Pfade:** `e2e/`

**Aufgabe:** Alle 11 Pflicht-Flows implementiert, gegen Compose-Setup (LI-Daten),
deterministisch: Simulator statt Echtzeit (speed_factor), keine sleep-basierten
Waits (nur Event-/State-Waits), Netzwerk-Blocks für Offline-Flows, saubere
Testdaten-Isolation (frische DB je Suite). Flake-Nachweis: 3× voller Lauf in CI
ohne Retry-Erfolg-Maskierung (retries: 0 im Nachweis-Lauf). Trace/Video bei
Fehlschlag als Artefakt.

**Akzeptanz:** 1. Flows 1–11 grün, 3 Läufe in Folge (CI-Links im PR); 2. Gesamt-
Laufzeit < 20 min; 3. retries im Regelbetrieb ≤ 1, Nachweis-Lauf 0.
**Pflicht-Tests:** — (Suite selbst)
**Plausibilität:** Jeder Flow prüft Endzustand über API UND UI (nicht nur UI).

---

## E10-T2: Performance-Budgets in CI

- **Abhängigkeiten:** E10-T1 · **Kontext:** docs/00 Erfolgskriterien; docs/01 §4; Wargame W-04
- **Pfade:** `e2e/perf/`, `.github/workflows/nightly.yml`

**Aufgabe:** Automatisierte Messungen im gedrosselten Profil („N100-Profil":
Playwright CPU-Throttle 4×, Container-Limits 2 vCPU/4 GB): Kaltstart bis
interaktive Karte (< 5 s), fps beim scripted Pan/Zoom/Fahrt (≥ 30), Reroute-
Latenz (< 3 s), WS-Latenz pos→UI (< 500 ms), RSS aller Container gegen Tabelle
docs/01 §4. Ergebnisse als JSON-Artefakt + Trend-Kommentar; Budget-Verstoß >
10 % = rot. 24-h-Soak-Test (nightly-wöchentlich, cron): Simulator-Dauerfahrt,
RSS-Drift < 5 %, keine Verbindungs-/FD-Lecks.

**Akzeptanz:** 1. Alle Budgets gemessen+grün auf aktuellem Stand; 2. künstliche
Verschlechterung (Test-Fixture mit 200 ms-Delay) macht Pipeline nachweislich rot;
3. Soak-Report lesbar.
**Pflicht-Tests:** — (Messungen selbst); Unit für Auswertungs-/Schwellenlogik.
**Plausibilität:** Messungen streuen < 15 % zwischen zwei Läufen (sonst
Messaufbau fixen, nicht Schwellen aufweichen!).

---

## E10-T3: Golden-Routes DE + Datenaktualisierungs-Prozess

- **Abhängigkeiten:** E03-T5 · **Kontext:** docs/07 §3b; Wargame W-08/W-17
- **Pfade:** `e2e/golden-routes/`, `docs/data-update-runbook.md`

**Aufgabe:** DE-Golden-Routes auf ≥ 15 Fälle ausbauen (≥ 6 restriction-Fälle:
Höhe×3, Gewicht×2, Breite×1 — reale, per OSM-Tags belegte Stellen, Quellen im
JSON). Runbook für Kartendaten-Updates: neue PBF → Valhalla-Neubau (Swap-Prozess
E03-T1) → PMTiles-Update → Photon/Lite-Index → **Golden-Routes als Abnahme**
(Datenupdate ohne grüne Suite wird nicht ausgerollt — fängt OSM-Regressionen).
ETA-Plausibilitätsfall (docs/07 §3b) als nightly-Test.

**Akzeptanz:** 1. 15+ Fälle nightly grün; 2. Runbook einmal komplett durchlaufen
(Protokoll im PR); 3. ETA-Fall automatisiert.
**Pflicht-Tests:** — (Suite); Runbook-Smoke als Skript.
**Plausibilität:** restriction-Fälle decken beide Richtungen ab (E03-T5-Regel).

---

## E10-T4: Sicherheits- & Lizenz-Audit

- **Abhängigkeiten:** E08, E09 · **Kontext:** docs/07 §7; docs/00 Rechtliches
- **Pfade:** `.github/workflows/`, `docs/licenses.md`

**Aufgabe:** (a) Dependency-Audit-Gate (pnpm audit + osv-scanner, Fail High/
Critical, Ausnahme-Datei mit Begründung+Ablaufdatum). (b) API-Security-Smoke:
Auth-Matrix aus E08-T3 in Release-Pipeline; Security-Header-Check (CSP, no-sniff,
frame-ancestors). (c) Lizenz-Inventar generieren (license-checker) →
`docs/licenses.md`; OSM/ODbL-Attribution verifizieren (E2E-Assertion existiert —
verlinken); Fonts/Icons-Lizenzen prüfen. (d) E09-T6-Suite in Release-Pipeline
verdrahtet (Doppel-Check).

**Akzeptanz:** 1. Audit-Gates aktiv+grün; 2. Lizenz-Doku vollständig generiert;
3. keine Copyleft-Konflikte (GPL-Dependency in ausgeliefertem Bundle → Fail).
**Pflicht-Tests:** — (Gates selbst); Header-Check-Test.
**Plausibilität:** Ausnahme-Datei leer oder jede Ausnahme mit Ablaufdatum < 90 Tage.

---

## E10-T5: Dokumentation & Release-Prozess

- **Abhängigkeiten:** alle · **Kontext:** docs/07 §7; docs/02
- **Pfade:** `docs/`, `.github/workflows/release.yml`, `CHANGELOG.md`

**Aufgabe:** Nutzer-Doku: Installations-Guide (HA-Add-on + Compose/Proxmox-LXC
inkl. USB-Durchreichung), Erste-Schritte, Troubleshooting (aus Wargame-Szenarien
generiert: Symptom→Ursache→Lösung je W-Fall!), FAQ. Entwickler-Doku: Add-on-Guide
(E09-T4) verlinkt, OpenAPI veröffentlicht (aus Fastify-Schemas generiert,
CI-Check „Spec aktuell"). Release-Workflow: Tag → volle Pipeline (docs/07 §6
Release) → Multi-Arch-Images pushen → HA-Add-on-Repo-Version bump →
GitHub-Release mit Changelog (Changesets). Manuelle Hardware-Checkliste
(docs/07 §7) als Issue-Template `release-hardware-check.md`.

**Akzeptanz:** 1. Testleser (anderes Modell) installiert nach Guide erfolgreich
in frischer VM (Protokoll); 2. Release-Dry-Run vollständig durchlaufen;
3. Troubleshooting deckt alle 🔴/🟠-Wargame-Fälle ab (Abgleich-Test: W-IDs im Doc).
**Pflicht-Tests:** OpenAPI-Aktualitäts-Check; W-ID-Abgleich-Skript.
**Plausibilität:** Changelog erwähnt Breaking Changes der Add-on-API explizit
(Changesets-Kategorie erzwungen).

---

## E10-T6: Release v1.0 (Abschluss)

- **Abhängigkeiten:** E10-T1–T5 · **Kontext:** docs/07 §7 KOMPLETT

**Aufgabe:** Release-Gate-Checkliste docs/07 §7 Punkt für Punkt abarbeiten und
im Release-Issue dokumentieren (jeder Punkt: Link auf CI-Lauf/Protokoll).
Menschliche Punkte (Hardware-Checkliste) als Sub-Issues an den Menschen.
Erst wenn ALLE Punkte belegt sind: Tag `v1.0.0`.

**Akzeptanz:** Release-Issue vollständig belegt; v1.0.0 getaggt; Add-on im
HA-Repo installierbar.
**Plausibilität:** Kein Checklisten-Punkt „per Aussage" erledigt — jeder hat
einen Link-Beleg.
