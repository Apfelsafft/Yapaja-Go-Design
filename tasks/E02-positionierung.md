# E02 – Positionierung (Browser-GPS, gpsd, Fusion, Simulator)

**Ziel:** Zuverlässige Position aus Browser-Geolocation ODER USB-GPS (gpsd),
vereinheitlicht im Core, live in der Karte. **Gate-Beitrag G1.**

---

## E02-T1: PositionService & Event-Bus im Core

- **Abhängigkeiten:** E00-T2 · **Kontext:** docs/01 ADR-007/ADR-010; docs/03 §1 `Position`, §3
- **Pfade:** `apps/core/src/bus/`, `apps/core/src/position/`

**Aufgabe:** Implementiere den internen typisierten Event-Bus (publish/subscribe
auf Topics mit Schema-Validierung via `@yapaja/shared` — invalide Payloads werfen
im Dev, loggen+droppen in Prod). Darauf: `PositionService`, der Quellen
(`gpsd|browser|simulator`) registriert, die aktive Quelle nach Priorität wählt
(konfigurierbar, Default gpsd > browser > simulator; Quelle „aktiv" = Fixes in
den letzten 5 s) und `pos/update` mit normalisiertem `Position`-Objekt publiziert
(Rate limit: max 5 Hz, Default 1 Hz). Dazu WebSocket-Endpoint `/ws/v1`
(subscribe/ping-Protokoll aus docs/03 §3) und REST `GET /position`,
`GET /position/sources`, `PUT /position/source`.

**Akzeptanz:** 1. Zwei Mock-Quellen: die prioritäre gewinnt; fällt sie 5 s aus,
übernimmt die andere und ein `event/gps_source_changed` wird publiziert;
2. WS-Client erhält `pos/update` nach subscribe, andere Topics nicht;
3. `PUT /position/source {source:'browser'}` erzwingt Quelle.
**Pflicht-Tests:** Bus (Schema-Reject, Wildcard-Subscribe `pos/*`); Quellen-
Failover-Zeitverhalten (Fake-Timer); WS-Subscribe-Filterung; Rate-Limit.
**Plausibilität:** `Position.ts` ist immer ISO-UTC; keine zwei `pos/update` < 200 ms.

---

## E02-T2: Browser-Geolocation-Quelle (Frontend)

- **Abhängigkeiten:** E02-T1, E01-T2 · **Kontext:** docs/01 ADR-007; Wargame W-03
- **Pfade:** `apps/web/src/position/`

**Aufgabe:** Modul, das `navigator.geolocation.watchPosition` (enableHighAccuracy,
maximumAge 1000) nutzt und Fixes an `POST /api/v1/position/browser` sendet
(nur wenn Quelle browser/auto). **Vorab-Prüfungen (W-03):** `isSecureContext`
false → gezielter Hinweis-Dialog (drei Optionen aus W-03, verlinkte Doku), API
nicht vorhanden → Hinweis. Permission-Denied → Banner mit Anleitung + gpsd-Empfehlung.
Positions-Puck auf der Karte (blauer Punkt, Accuracy-Ring, Heading-Keil wenn
heading vorhanden; grau bei Fix älter 5 s — W-01-Vorgriff).

**Akzeptanz:** 1. Mit gemockter Geolocation erscheint der Puck und folgt Updates;
2. Denied/insecure-Fälle zeigen die spezifizierten Hinweise (nicht generisch);
3. kein Senden, wenn gpsd aktive Quelle ist (Netzwerk-Assertion).
**Pflicht-Tests:** Playwright mit `context.setGeolocation` (Bewegung, Denied-Fall);
Unit: Payload-Mapping GeolocationPosition → `Position` (speed m/s! heading null bei NaN).
**Plausibilität:** accuracy>100 m färbt Ring + „ungenau"-Hinweis (docs/07 §3a).

---

## E02-T3: gpsd-Quelle + PlausibilityGuard

- **Abhängigkeiten:** E02-T1 · **Kontext:** docs/01 ADR-007; docs/07 §3a; Wargame W-01/W-02
- **Pfade:** `apps/core/src/position/gpsd/`, `apps/core/src/position/guard.ts` · **Neue Deps:** keine (gpsd-JSON-Protokoll über TCP-Socket selbst implementieren, `?WATCH={"enable":true,"json":true}`; TPV/SKY-Klassen parsen)

**Aufgabe:** gpsd-Client (Host/Port aus Env, Default `localhost:2947`):
verbinden, WATCH aktivieren, TPV → `Position` (mode→fix, speed m/s, alt, track→heading,
eph→accuracy), SKY → Satellitenanzahl für `GET /position/sources`. Reconnect mit
Backoff (1→30 s), Status-Events. **PlausibilityGuard** als Filter VOR dem Bus für
alle Quellen: Regeln aus docs/07 §3a (Sprung-Erkennung >300 m/s mit 3-Fix-Regel,
Wertebereiche, fix none ⇒ kein pos/update sondern `event/gps_lost` nach 3 s).

**Akzeptanz:** 1. Gegen gpsd-Mock (TCP-Fixture-Server im Test) fließen Positionen;
2. Verbindungsabriss → Reconnect + Quelle „inactive" → Failover (E02-T1 greift);
3. Guard verwirft Sprung-Fixture, akzeptiert Fähren-Fixture (4. Fix).
**Pflicht-Tests:** TPV-Parsing (Fixtures: 2D-Fix, 3D-Fix, mode 0/1, fehlende Felder);
Guard-Tabellentests; Reconnect-Timing (Fake-Timer).
**Plausibilität:** Bei `mode:1` (kein Fix) wird NIE eine Position publiziert.

---

## E02-T4: GPS-Simulator (Testwerkzeug, produktiv nutzbar)

- **Abhängigkeiten:** E02-T1 · **Kontext:** docs/07 §2
- **Pfade:** `apps/core/src/position/simulator/`, `e2e/fixtures/tracks/`

**Aufgabe:** Simulator-Quelle exakt nach docs/07 §2: GPX-Replay und
Polyline-Replay (polyline6-String + Zielgeschwindigkeitsprofil), Steuer-API
`POST /api/v1/simulator/play|pause|stop` (nur wenn Quelle simulator; im
Prod-Build hinter Env-Flag `ENABLE_SIMULATOR`). Mutationen als Optionen:
`noise_m`, `outage:{at_s,duration_s}`, `jump:{at_s,offset_m}`, `detour:{at_maneuver}`
(biegt falsch ab und fährt 300 m weiter — für Rerouting-Tests). Interpolation
zwischen Punkten (1 Hz, Heading aus Kurs). Drei GPX-Fixtures einchecken
(Stadt, Landstraße, mit Tunnel).

**Akzeptanz:** 1. Replay einer GPX erzeugt plausible 1-Hz-`pos/update` inkl.
heading/speed; 2. alle vier Mutationen nachweisbar wirksam; 3. `speed_factor: 10`
beschleunigt deterministisch (für schnelle E2E).
**Pflicht-Tests:** Interpolations-Unit-Tests (Distanz/Zeit-Korrektheit ±1 %);
Mutations-Tests; E2E: Puck fährt Fixture-Track auf der Karte ab.
**Plausibilität:** Simulierte Geschwindigkeit == Soll ±5 %; Heading zeigt in Fahrtrichtung (Differenz < 15° auf Geraden).

---

## E02-T5: GPS-Verlust-UX (Dead-Reckoning-Anzeige)

- **Abhängigkeiten:** E02-T2/T3, E01-T3 · **Kontext:** Wargame W-01; docs/06 §5
- **Pfade:** `apps/web/src/position/`, `apps/core/src/position/`

**Aufgabe:** Core: bei `event/gps_lost` und aktiver Route (Vorgriff auf E04 —
Interface `DeadReckoningProvider` definieren, bis E04 no-op): publiziere bis 30 s
extrapolierte Positionen (`source` bleibt, neues Feld intern markiert; ohne Route:
keine Extrapolation). Web: Puck grau + wachsender Ring, Banner „GPS-Signal
verloren" nach 3 s, Banner weg + Puck blau bei Wiederkehr. Kein Layout-Sprung.

**Akzeptanz:** Simulator-outage-Mutation: 1. Banner-Timing wie spezifiziert;
2. Wiederkehr nahtlos (kein Puck-Teleport-Flackern: Übergang animiert);
3. ohne Route friert der Puck ein (keine Extrapolation ins Blaue).
**Pflicht-Tests:** E2E-Flow 4 (docs/07 §5); Unit: Extrapolations-Stopp nach 30 s.
**Plausibilität:** Extrapolierte Positionen werden NICHT via MQTT als echte
Positionen publiziert, sobald E08 existiert → Feld `extrapolated: true` intern
vorsehen und im MQTT-Mapping später filtern (Kommentar + Test-Stub jetzt anlegen).
