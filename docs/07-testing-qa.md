# 07 – Teststrategie, Plausibilitätsprüfungen & Release-Gates

**Grundsatz:** Jeder Task in `tasks/` enthält eigene Testanweisungen; dieses
Dokument definiert die übergreifende Strategie, die Werkzeuge und die Gates.
Umsetzungs-Modelle dürfen einen Task nur als „fertig" melden, wenn alle
zugehörigen Tests **lokal grün** laufen und in CI reproduzierbar sind.

## 1. Testpyramide & Werkzeuge

| Ebene | Werkzeug | Scope | Pflicht-Coverage |
|---|---|---|---|
| Unit | Vitest | reine Logik: ETA-Berechnung, Map-Matching, Formatter, Schema-Validierung, Ansage-Schwellen | ≥ 90 % auf `packages/shared` + Services-Logik |
| Integration | Vitest + Testcontainers/Docker | Core ↔ Valhalla/Photon/gpsd-Mock/MQTT-Broker (mosquitto im Container) | jeder REST-/WS-/MQTT-Vertrag |
| Contract | JSON-Schema-Validierung | jede Bus-/WS-/MQTT-Payload gegen `packages/shared/schemas` | 100 % der Topics |
| E2E | Playwright (Chromium) | reale UI-Flows gegen `docker compose` mit **Liechtenstein/Monaco-Extrakt** (klein, schnell in CI) | Kern-Flows (s. §5) |
| Performance | Playwright-Traces + eigene fps-/RSS-Probes | Budgets aus docs/00 | jede Release-Pipeline |
| Hardware/Manuell | Checkliste | echtes GPS, echter Mini-PC, echte Fahrt | vor jedem Release durch Menschen |

## 2. GPS-Simulator (zentrales Testwerkzeug, gebaut in E02-T4)

- Modul `apps/core/src/position/simulator.ts` + CLI/REST-Steuerung
  (`PUT /position/source {simulator}`, `POST /simulator/play {track, speed_factor}`).
- Spielt Tracks ab: (a) GPX-Dateien, (b) **Routen-Geometrien aus Valhalla selbst**
  (perfekte Fahrt), (c) mutierte Varianten: Rauschen (±3–25 m), GPS-Aussetzer,
  Sprünge, Stillstand, absichtliche Falschabbiegung (für Rerouting-Tests).
- Damit sind **komplette Navigationen deterministisch in CI testbar** – kein
  Test darf echtes GPS voraussetzen.

## 3. Plausibilitätsprüfungen (zweistufig)

### 3a. Laufzeit-Plausibilität (im Produkt, `PlausibilityGuard` im Core)
Invarianten aus docs/03 §5 werden **zur Laufzeit** geprüft; Verstoß ⇒ Wert wird
verworfen/als unbekannt markiert + `system/plausibility`-Event geloggt (nie
stillschweigend falsche Daten anzeigen):
- Position: Sprung > 300 m/s zwischen Fixes ⇒ Fix verwerfen (max. 3 in Folge,
  dann als „neue Wahrheit" akzeptieren — Fährüberfahrt/Neustart-Fall).
- Geschwindigkeit 0–250 km/h, Höhe −450–4900 m, Genauigkeit > 100 m ⇒ „ungenau"-UI.
- ETA monoton sinnvoll; Restdistanz fällt; Limit nie 0.
- Routen: Distanz ∈ [Luftlinie, 4×Luftlinie]; Dauer ∈ [Distanz/130 km/h, Distanz/15 km/h].

### 3b. Test-Plausibilität (Golden-Route-Suite, gebaut in E03-T5, erweitert laufend)
Fixture-Datei `e2e/golden-routes.json` mit Fällen gegen den CI-Kartenextrakt
**plus** separat gegen DE-Extrakt (nightly, nicht je PR):
- **Distanz-Toleranz:** bekannte Strecken ±10 % (z. B. per Referenz einmalig mit
  ORS/Google verifiziert und eingefroren).
- **Maßrestriktionen (sicherheitskritisch):** kuratierte Fälle
  „Unterführung X (3,2 m): Profil 2,0 m fährt durch, Profil 3,5 m NICHT"
  (Assertion: Routen-Geometrie schneidet Sperr-Bounding-Box nicht).
  Gleiches Muster für Gewicht (Brücke) und Breite. **Diese Tests sind
  Merge-Blocker ab G2** – ein Fehlschlag ist niemals „flaky", sondern Stopp.
- **Profil-Monotonie:** größeres/schwereres Fahrzeug ⇒ Routendauer ≥ kleineres
  (gleiches OD-Paar) — fängt vertauschte Parameter-Mappings.
- **ETA-Plausibilität:** simulierte Fahrt mit Faktor 1.0 ⇒ tatsächliche Ankunftszeit
  weicht < 5 % von initialer ETA ab.
- **Geocoding:** 20 kuratierte Suchanfragen (inkl. Tippfehler „Müchen") müssen den
  erwarteten Ort in Top-3 liefern.

## 4. Definition of Done (gilt für JEDEN Task)

1. Akzeptanzkriterien des Tasks erfüllt (einzeln nachgewiesen im PR-Text).
2. Neue Logik hat Unit-Tests; geänderte Verträge haben Contract-Tests.
3. `pnpm lint && pnpm typecheck && pnpm test` grün; E2E-Subset des Epics grün.
4. Keine neuen Konsolen-Errors/Warnings im Browser (Playwright assertion).
5. Performance-Budget nicht verschlechtert (CI-Vergleich, Toleranz 10 %).
6. Doku aktualisiert (OpenAPI regeneriert, README des Pakets, ggf. ADR).
7. Selbst-Review gegen `tasks/README.md` §4 (Abnahme-Checkliste) im PR dokumentiert.

## 5. E2E-Pflicht-Flows (Playwright, ab jeweiligem Epic aktiv)

> **Umsetzung & Nachweis:** `apps/web/e2e/FLOWS.md` ordnet jeden der elf Flows
> seinem kanonischen Test zu (Titel-Präfix `[Flow N]`, alle zusammen laufbar mit
> `npx playwright test --grep "\[Flow "`) und listet je Flow, wie der Endzustand
> über **API** und über **UI** geprüft wird. Dort stehen auch die bewusst
> gewählten Abweichungen von der wörtlichen Formulierung unten (Compose,
> mosquitto-Testcontainer, Reverse-Proxy) mit Begründung.

1. Kaltstart offline (Netzwerk-Block via Playwright-Route) ⇒ Karte interaktiv < 5 s.
2. Suche „Vaduz" ⇒ Ergebnis wählen ⇒ Route mit Profil „Camper 3,2 m" ⇒ Navigation
   starten ⇒ Simulator fährt ⇒ Manöver-Anzeigen wechseln korrekt ⇒ Ankunft.
3. Falschabbiegung (Simulator-Mutation) ⇒ Rerouting < 3 s ⇒ neue Anweisung.
4. GPS-Verlust 45 s ⇒ UI-Zustand „Signal verloren" ⇒ Wiederaufnahme nahtlos.
5. Profilwechsel während Navigation ⇒ Reroute + Warnbanner.
6. Favorit anlegen → App-Reload → Favorit vorhanden → Route via Favorit.
7. Widget-Customizing: Widget verschieben → Reload → Layout persistiert.
8. MQTT: mosquitto-Testcontainer; Kommando `cmd/destination` ⇒ `nav/state`
   wird `navigating`; alle Status-Topics erscheinen mit validen Payloads.
9. Ingress-Simulation: App unter `/hassio_ingress/xyz/` Sub-Pfad ⇒ alle Assets,
   WS und Tiles laden (Reverse-Proxy im Compose-Testsetup).
10. Add-on: Referenz-POI-Add-on installieren (lokaler Registry-Fixture) ⇒ Layer
    sichtbar ⇒ deinstallieren ⇒ rückstandsfrei (Layer weg, Storage weg).
11. Berechtigung verweigert (Geolocation denied) ⇒ verständlicher Hinweis + gpsd-Hinweis.

## 6. CI-Pipeline (GitHub Actions, definiert in E00, erweitert je Epic)

- **PR:** lint → typecheck → unit → contract → build → E2E-Smoke (Flows 1–2)
  → Budget-Diff. Laufzeitziel < 15 min.
- **Nightly:** volle E2E-Matrix, Golden-Routes gegen DE-Extrakt, RAM/fps-Messung
  im QEMU-Profil „N100" (2 vCPU, 4 GB), Dependency-Audit + Lizenz-/Copyleft-Gate,
  Sicherheitssuite (E09-T6) und API-Security-Smoke, Docker-Multi-Arch-Build.
  > Die beiden Sicherheits-Jobs stehen hier, weil die Release-Pipeline unten als
  > „Nightly-Suite + …" definiert ist: liefe die E09-T6-Suite nur je PR, wäre sie
  > formal nicht Teil der Release-Pipeline, obwohl §7 sie ausdrücklich verlangt
  > (Lücke gefunden und geschlossen in E10-T4 (d)).
- **Release:** Nightly-Suite + Add-on-Kompatibilitätstest (Referenz-Add-ons gegen
  neue Core-API) + Changelog + signierte Images.

## 7. Release-Gate-Checkliste v1.0 (G4)

- [ ] Alle E2E-Flows 1–11 grün, 3 Läufe in Folge (Flake-Nachweis).
- [ ] ~~Golden-Routes DE: 100 % bestanden, inkl. aller Maßrestriktions-Fälle.~~
      **AUSNAHME FÜR v1.0 (Entscheidung Betreiber, 2026-08-05):** v1.0 wird
      bewusst mit einem **Liechtenstein-only-Gate** ausgeliefert. Die 16
      DE-Fälle bleiben `unverified` — der Nachweis braucht einen echten
      DE-Valhalla-Graphen, der auf einem Standard-Runner nicht baubar ist
      (2-h-Timeout in jedem Lauf). Details, Auswirkung und Wiederaufnahme:
      [`docs/backlog.md` B-01](backlog.md#b-01--golden-routes-de-verifizieren-maßrestriktionen-deutschland).
      **Diese Einschränkung MUSS in den Release-Notes von v1.0 stehen:** das
      Gate belegt die Routing-*Mechanik*, nicht die Richtigkeit der deutschen
      Maßrestriktionen in den ausgelieferten Kartendaten.
- [ ] Budgets: Kaltstart < 5 s, Rendering ≥ 30 fps, Reroute < 3 s, RAM-Tabelle docs/01 §4 eingehalten (gemessen im N100-Profil).
- [ ] 24-h-Soak-Test: Simulator-Dauerfahrt, kein Memory-Leak (RSS-Drift < 5 %), keine WS/MQTT-Verbindungslecks.
- [ ] HA: Add-on-Installation auf frischem HAOS, Discovery vollständig, Ingress ok, Update von Vorversion ohne Kartendaten-Verlust.
- [ ] Sicherheit — belegt durch drei benannte CI-Jobs (E10-T4):
  - [ ] `dependency-audit`: `pnpm audit --prod` + osv-scanner ohne High/Critical.
        **Umfang, bewusst gewählt:** blockierend sind nur Produktions-Abhängigkeiten
        (das Image installiert mit `--prod`); Dev-Werkzeuge (vitest, vite, esbuild …)
        werden bei jedem Lauf *gemeldet*, blockieren aber nicht. Ausnahmen brauchen
        Begründung **und** Ablaufdatum < 90 Tage und stehen in
        `security/audit-exceptions.json` — maschinell erzwungen von
        `scripts/dependency-audit.mjs`.
  - [ ] `security-suite`: Add-on-Sandbox-Escape-Tests (E09-T6) grün, `retries: 0`,
        inkl. Mutations-Nachweis. Läuft je PR **und** nightly (= Release-Pipeline).
  - [ ] `api-security-smoke`: API ohne Token nicht zugreifbar (Auth-Matrix E08-T3)
        und Security-Header (CSP, `X-Content-Type-Options: nosniff`,
        `frame-ancestors`) auf jeder Antwort — gegen den **gebauten** Core über
        echtes HTTP, nicht nur `fastify.inject()`.
- [ ] Manuelle Hardware-Checkliste durch Menschen: USB-GPS-Fix < 60 s kalt, echte Fahrt ≥ 30 min ohne Eingriff, Touch im Fahrbetrieb, Nachtmodus-Lesbarkeit.
- [ ] Doku: Installations-Guide (Add-on + Compose), Add-on-Entwickler-Guide, Troubleshooting.
- [ ] Lizenz-/Attributions-Prüfung (OSM, Fonts, Icons, Dependencies) —
      [`docs/licenses.md`](licenses.md), generiert von `scripts/generate-licenses.mjs`.
      CI prüft im Job `dependency-audit`, dass das Inventar zum Abhängigkeitsstand
      passt, und lässt **Copyleft im ausgelieferten Bundle fehlschlagen** (GPL-
      Abhängigkeit ⇒ rot). Die ODbL-Attribution ist zusätzlich per E2E-Assertion
      abgesichert (Nachweise in `docs/licenses.md` §1).
