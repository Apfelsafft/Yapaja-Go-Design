# E04 – Turn-by-Turn-Navigation

**Ziel:** Vollständige Navigation: Map-Matching, Manöveranzeige, Ansagen,
Rerouting, ETA, Tempolimit. **Gate-Beitrag G2 (Herzstück).**

---

## E04-T1: NavigationService-Kern (State-Machine + Map-Matching)

- **Abhängigkeiten:** E02-T1, E03-T2 · **Kontext:** docs/01 §5; docs/03 §1 `NavState`; docs/07 §3a
- **Pfade:** `apps/core/src/navigation/`

**Aufgabe:** `NavigationService` mit State-Machine
(`idle→routing→navigating⇄paused→arrived`, plus `off_route` als Sub-Zustand von
navigating; Übergänge nur über definierte Aktionen, ungültige → 409).
REST: `POST /navigation/start|pause|resume|stop`, `GET /navigation/state`.
**Map-Matching:** Projektion der Position auf die Routen-Polyline
(nearest-point-on-segment mit Suchfenster ±500 m um letzte Match-Position —
Performance!), liefert: Fortschritt (Meter auf Route), Querabstand,
matched heading. On-Route wenn Querabstand ≤ 30 m UND |heading-Differenz| ≤ 100°
(Stillstand: heading ignorieren). Publiziert `nav/state` (1 Hz) mit allen
NavState-Feldern außer ETA/Limit (kommen T2/T3; Felder bis dahin null).
Ankunft: < 40 m ans Ziel UND Restdistanz < 60 m → `arrived` + `event/arrived`.
Zustand überlebt Core-Neustart NICHT als „navigating", sondern startet als
`idle` mit Event `event/nav_recovered_route_available` (Route bleibt im Cache;
UI kann Wiederaufnahme anbieten — W-19-freundlich, aber ohne Geister-Navigation).

**Akzeptanz:** 1. Simulator fährt LI-Route ab: Fortschritt monoton, on_route
stabil trotz `noise_m: 10`; 2. State-Machine verweigert ungültige Übergänge;
3. Ankunftserkennung feuert genau einmal.
**Pflicht-Tests:** Map-Matching-Unit (Fixtures: auf Route, 25 m daneben, 35 m
daneben, Gegenrichtung, Haarnadel — Suchfenster darf nicht auf falschen Schenkel
matchen!); State-Machine-Tabelle; Integration mit Simulator.
**Plausibilität:** `distance_remaining_m` monoton fallend (Toleranz 15 m, docs/03 §5); CPU des Matchings < 5 ms/Fix (Benchmark-Test).

---

## E04-T2: ETA & Restwerte

- **Abhängigkeiten:** E04-T1 · **Kontext:** docs/03 §1/§5; Wargame W-22
- **Pfade:** `apps/core/src/navigation/eta.ts`

**Aufgabe:** ETA-Berechnung: Basis = Valhalla-Kantenzeiten der Restroute,
**kalibriert**: laufender Faktor aus (tatsächliche Zeit / geplante Zeit) der
letzten 10 min (EWMA, Clamp 0.7–1.5), zusätzlich global gedeckelt durch
`avg_speed_kmh` des Profils (ETA nie optimistischer als Restdistanz/avg_speed
über lange Distanzen… Achtung: nur als Untergrenze der Dauer). Alles in UTC,
`duration_remaining_s` führend, `eta` = ISO mit Offset (W-22). Publiziert in
`nav/state`; Stillstand (Pause an Ampel) lässt ETA nicht explodieren
(Kalibrierfaktor friert bei speed < 5 km/h ein).

**Akzeptanz:** 1. Simulator Faktor 1.0: ETA-Fehler < 5 % (docs/07 §3b);
2. Simulator fährt 20 % langsamer: ETA passt sich binnen 5 min an;
3. 3-min-Stopp: ETA wächst um ~Stoppzeit, Faktor unverändert.
**Pflicht-Tests:** EWMA-Unit (Zeitreihen); DST-/Zonen-Formatierungstests
(Client-Formatter in `packages/shared`); die drei Akzeptanz-Szenarien als
Integrationstests mit Fake-Timer.
**Plausibilität:** docs/03 §5: ETA nie in Vergangenheit; Dauer ∈ [Dist/130, Dist/15].

---

## E04-T3: Manöver-Logik, Ansage-Engine & Tempolimit

- **Abhängigkeiten:** E04-T1 · **Kontext:** docs/06 §5; docs/03 §3 `nav/instruction`; Wargame W-23
- **Pfade:** `apps/core/src/navigation/instructions.ts`, `apps/web/src/drive/`

**Aufgabe:** Core: aus Map-Matching-Fortschritt den aktiven Manöver-Index
bestimmen; `distance_to_maneuver_m`; Ansage-Trigger bei Schwellen (docs/06 §5,
geschwindigkeitsskaliert: Schwelle = max(Basis, 12 s × speed)), publiziert
`nav/instruction {maneuver, distance_m, say}` — `say` als natürlicher deutscher
Satz („In 300 Metern links abbiegen auf die Bundesstraße 27", Zahlwort-Rundung
50er-Schritte). Ansage-Queue: neue Ansage verdrängt wartende alte (W-23).
Tempolimit: aktiver `SpeedSegment` per Fortschritts-Index → `speed_limit_kmh`
in nav/state. Web (Drive-Grundelemente, volle UI in E07): Manöver-Panel
(Pfeil-Icon-Set für alle ManeuverTypes als SVG-Sprite, Distanz, Straße,
Folgemanöver < 300 m), Tempolimit-Schild, TTS via Web Speech (de-DE, an/aus,
Verfügbarkeits-Check + Gong-Fallback).

**Akzeptanz:** 1. Simulator-Fahrt: Panel wechselt korrekt durch alle Manöver,
Distanz zählt runter; 2. Ansagen feuern bei Schwellen genau einmal pro
Schwelle+Manöver; 3. Limit-Schild aktualisiert an Segmentgrenzen, verschwindet
bei null (nie „0"); 4. Folgemanöver-Anzeige bei dichten Abbiegungen.
**Pflicht-Tests:** Schwellen-Unit (Tempo-Skalierung, Doppelfeuer-Schutz);
Say-Text-Snapshots (alle Manövertypen de+en); Segment-Lookup-Unit;
Playwright-Fahrt (Flow 2 aus docs/07 §5).
**Plausibilität:** Pfeil-Icon stimmt mit ManeuverType überein (Mapping-Tabellentest);
keine Ansage nach Passieren des Manövers.

---

## E04-T4: Abweichungserkennung & automatisches Rerouting

- **Abhängigkeiten:** E04-T1 · **Kontext:** Wargame W-05; docs/01 §5
- **Pfade:** `apps/core/src/navigation/reroute.ts`

**Aufgabe:** Off-Route-Detektion (Querabstand > 30 m ODER Heading-Regel verletzt,
bestätigt über 5 s / 5 Fixes) → `route/deviation` → Reroute-Request (aktuelle
Position + verbleibende Wegpunkte + aktives Profil + aktive Vermeidungen aus
E03-T4) → bei Erfolg `route/updated {reason:'reroute'}`, Navigation läuft nahtlos
auf neuer Route weiter (Manöver-Index reset, Kalibrierfaktor behalten).
Debounce: max 1 Reroute/10 s. **Loop-Schutz (W-05):** 3 Reroutes in 5 min mit
Deviation im selben 200-m-Umkreis → `event/reroute_loop {suggestion:'avoid_segment'}`
(UI bietet „Abschnitt meiden" aus E03-T4 an). Valhalla down beim Reroute →
Navigation läuft auf alter Route weiter + `event/reroute_failed`, Retry alle 15 s.

**Akzeptanz:** 1. Simulator-detour: neue Route + neue Anweisung < 3 s nach
Bestätigungsfenster; 2. GPS-Rauschen 15 m löst KEIN Reroute aus; 3. Loop-Fixture
(Simulator ignoriert Reroute 3×) triggert Vorschlag; 4. Valhalla-down-Verhalten.
**Pflicht-Tests:** Detektions-Unit (Zeitreihen inkl. Parallelstraße-Fixture!);
Integration Flow 3; Loop-Test; Failure-Test.
**Plausibilität:** Nach Reroute zeigt die erste Anweisung nach VORNE
(kein „Bitte wenden" wenn Weiterfahrt möglich ist — Valhalla-Heading im
Reroute-Request mitgeben!).

---

## E04-T5: Navigations-Steuerung End-to-End + Ziel-Convenience

- **Abhängigkeiten:** E04-T1–T4, E03-T3 · **Kontext:** docs/03 §2 `navigation/destination`
- **Pfade:** `apps/core/src/navigation/`, `apps/web/src/drive/`

**Aufgabe:** `POST /api/v1/navigation/destination` (query ODER latlng; geocodet
via SearchService-Interface — bis E05: nur latlng, query → 501 mit klarer
Meldung; `autostart`). Web: „Navigation starten" aus E03-T3 aktivieren →
Drive-Modus an (Kamera 3d-course, Follow), Pause/Stop-Buttons, Stop →
Explore-Modus + Route bleibt zur Ansicht. Reload während Navigation (W-19):
App fragt Core-State und bietet „Navigation fortsetzen?" (Route aus Cache,
ein Klick → navigating).

**Akzeptanz:** 1. Voller E2E-Flow 2 grün; 2. Reload-Recovery < 3 s (Flow W-19);
3. destination-Endpoint mit autostart startet komplett ohne UI-Interaktion.
**Pflicht-Tests:** E2E-Flows 2, 5(vorbereitet), W-19-Reload; Endpoint-Integration.
**Plausibilität:** Nach Stop publiziert `nav/state` status `idle` und MQTT-
Vorbereitung (Bus-Event) enthält destination null.

---

## E04-T6: Dead-Reckoning auf Route (W-01 vollenden)

- **Abhängigkeiten:** E04-T1, E02-T5 · **Kontext:** Wargame W-01
- **Pfade:** `apps/core/src/navigation/deadreckoning.ts`

**Aufgabe:** `DeadReckoningProvider` aus E02-T5 implementieren: bei GPS-Verlust
während `navigating` Position entlang der Route mit letzter stabiler
Geschwindigkeit fortschreiben (max 30 s), Ansagen laufen weiter (Tunnel-Abfahrt!),
Felder `extrapolated:true`. Nach 30 s: Navigation `paused` +
`event/gps_lost_paused`; bei GPS-Wiederkehr: auto-resume + Re-Match (auch wenn
inzwischen 500 m weiter — Suchfenster einmalig weiten).

**Akzeptanz:** 1. Tunnel-Fixture (outage 20 s vor Abzweig): Ansage kommt trotz
Ausfall zur richtigen (extrapolierten) Distanz; 2. outage 45 s → paused → Resume
nahtlos; 3. extrapolierte Fixes tragen Flag.
**Pflicht-Tests:** Extrapolations-Unit (Kurvengeometrie: Position bleibt AUF der
Polyline); beide Outage-Szenarien als Integration.
**Plausibilität:** Extrapolation stoppt exakt am nächsten Manöverpunkt, wenn
Abbiegung unklar (nie um die Ecke raten).
