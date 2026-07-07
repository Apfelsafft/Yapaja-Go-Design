# E01 – Kartenanzeige (MapLibre, Offline-Tiles, 2D/3D, Styles)

**Ziel:** Offline-Vektorkarte im Browser: PMTiles vom Core, anpassbare Styles,
2D/3D, Nord-/Kursausrichtung, Tag/Nacht. **Gate-Beitrag G1.**

---

## E01-T1: PMTiles-Auslieferung im Core

- **Abhängigkeiten:** E00 · **Kontext:** docs/01 ADR-003; docs/03 §2 „Karten & Tiles"
- **Pfade:** `apps/core/src/map/` · **Neue Deps:** pmtiles

**Aufgabe:** Endpunkt `GET /tiles/{region}.pmtiles` mit korrektem HTTP-Range-
Support (206, `Accept-Ranges`, `Content-Range`, ETag aus Datei-mtime+size,
Cache-Headers `immutable`). Regionen liegen in `data/tiles/*.pmtiles`.
`GET /api/v1/map/regions` listet installierte Dateien mit Metadaten aus dem
PMTiles-Header (bounds, minzoom, maxzoom, Größe). Unbekannte Region → 404 im
Fehlerformat. Range-Anfragen dürfen nie die ganze Datei laden (Streaming, offene
FDs begrenzen).

**Akzeptanz:** 1. `curl -r 0-16383` liefert 206 mit exakt 16384 Bytes; 2. Regions-
Endpoint zeigt Testdatei mit korrekten Bounds; 3. paralleler Zugriff (50 gleichzeitige
Range-Requests) ohne Fehler/FD-Leak.
**Pflicht-Tests:** Range-Parsing (Anfang/Mitte/Ende/ungültig→416); Metadaten-Parse
gegen Mini-PMTiles-Fixture (Fixture aus einem winzigen Extrakt ins Repo legen, < 5 MB).
**Plausibilität:** Bounds der Fixture liegen im gültigen WGS84-Bereich.

---

## E01-T2: MapLibre-Grundkarte im Frontend

- **Abhängigkeiten:** E01-T1 · **Kontext:** docs/01 ADR-002/003; docs/06 §6
- **Pfade:** `apps/web/src/map/` · **Neue Deps:** maplibre-gl, pmtiles

**Aufgabe:** Map-Komponente mit MapLibre GL + PMTiles-Protokoll (`pmtiles://`
auf den Core-Endpunkt, **relative URL**, W-15). Lade Style von
`/api/v1/map/styles/{id}` (bis E01-T4 eine statische `yapaja-light.json` im Core,
abgeleitet vom Protomaps-Light-Style, Quellen auf lokale Tiles zeigend).
Grundgesten aktiv (Pan, Pinch, Rotate, Tilt, Doppeltipp — docs/06 §4).
Zoom-Buttons + OSM-Attribution. Map-Instanz über einen `MapController`
(Zustand-Store) für andere Module zugreifbar (setCamera, addLayer, on(event)).

**Akzeptanz:** 1. Karte rendert offline (Netzwerk-Block außer eigener Origin) mit
der Fixture-Region; 2. alle Gesten funktionieren (Touch-Emulation); 3. kein
einziger Request an fremde Hosts (Playwright-Assertion); 4. funktioniert unter Sub-Pfad.
**Pflicht-Tests:** Playwright: Karte sichtbar (canvas), Zoom ändert Zoomlevel,
Offline-Assertion, Sub-Pfad-Smoke.
**Plausibilität:** Attribution sichtbar; Start-Viewport = Bounds der installierten Region.

---

## E01-T3: Ansichtsmodi 2D/3D & Nord/Kurs

- **Abhängigkeiten:** E01-T2 · **Kontext:** docs/06 §5 „Follow-Me", §6
- **Pfade:** `apps/web/src/map/`, `apps/web/src/state/`

**Aufgabe:** `ViewModeController` mit Modi `2d-north`, `2d-course`, `3d-course`
(Tilt 55°). Umschalt-FAB + Kompass-FAB (erscheint bei bearing ≠ 0, Klick → Nord,
wie Google Maps). Kursmodus rotiert Karte nach `heading` aus dem Positions-Store
(bis E02 existiert: Mock-Hook mit einstellbarem Heading). Sanfte Übergänge
(`easeTo`, 300 ms), Modus persistiert (localStorage + später Settings-Sync).
Follow-Me-Grundlogik: Kamera folgt Position; manuelles Pan pausiert Follow 10 s,
Button „Re-Center" erscheint.

**Akzeptanz:** 1. drei Modi umschaltbar, Zustand überlebt Reload; 2. Kompass-Verhalten
wie beschrieben; 3. Follow-Pause + Re-Center funktioniert (mit Mock-Positionen).
**Pflicht-Tests:** Playwright für Umschalten/Persistenz/Kompass; Unit-Test für
Follow-Pause-Timerlogik.
**Plausibilität:** Im `2d-north` bleibt bearing exakt 0 auch bei heading-Updates.

---

## E01-T4: Style-System (Light/Dark/Contrast, Anpassbarkeit)

- **Abhängigkeiten:** E01-T2 · **Kontext:** docs/06 §3, §6; docs/03 §2
- **Pfade:** `apps/core/src/map/styles/`, `apps/web/src/map/`

**Aufgabe:** Core: `GET /api/v1/map/styles` + `/{id}` liefert Styles
`yapaja-light`, `yapaja-dark`, `yapaja-contrast` (JSON im Repo; Dark = echte
Nacht-Palette, nicht invertiert; Contrast = reduzierte POI, dicke Straßen).
Quellen-URLs werden beim Ausliefern auf die lokale Tile-URL umgeschrieben.
Web: Style-Umschalter in einem (vorläufigen) Settings-Panel; Style-Wechsel ohne
Karten-Reload (`setStyle` mit Layer-Erhalt für spätere Overlay-Layer —
MapLibre-Pattern „style switch keep custom layers" implementieren).
Nutzer-Optionen: Label-Sprache (name / name:de / name:en), Label-Größe (100/120 %),
POI-Dichte (voll/reduziert/aus) — als Style-Transformationen.

**Akzeptanz:** 1. drei Styles umschaltbar, Custom-Layer überleben den Wechsel;
2. Optionen wirken sichtbar und persistieren; 3. Styles validieren gegen
MapLibre-Style-Spec (CI-Check mit `@maplibre/maplibre-gl-style-spec`).
**Pflicht-Tests:** Style-Spec-Validierung aller drei Styles; Playwright:
Wechsel + Layer-Erhalt (Dummy-Layer vor Wechsel einfügen).
**Plausibilität:** Dark-Style-Hintergrund ist dunkel (#0x-Bereich), Light hell —
per Pixel-Sample im Test prüfen (fängt vertauschte Styles).

---

## E01-T5: Region-Manager (Download, Update, Speicherprüfung)

- **Abhängigkeiten:** E01-T1 · **Kontext:** docs/03 §2 (regions, jobs); Wargame W-09, W-17, W-18
- **Pfade:** `apps/core/src/map/regions/`, `apps/web/src/settings/regions/`

**Aufgabe:** Core: `POST /api/v1/map/regions {region_id}` startet Download-Job
(Quelle: konfigurierbare URL-Liste `regions-catalog.json` im Repo mit Name, URL,
Größe, bounds). Job-System generisch (`/api/v1/jobs/{id}`): Status, Progress,
Fehler; **Resume via Range-Request bei Abbruch** (W-17); **Speicherplatz-Vorabcheck**
`benötigt ≤ frei − 1 GB` sonst 409 mit Rechnung (W-18); Download in `.part`-Datei,
atomisches Rename nach sha256-Check. DELETE entfernt Region (nicht wenn einzige).
Web: Regionen-Seite in Settings: installierte Regionen + Katalog, Abdeckung als
Rechtecke auf Mini-Karte (W-09), Fortschrittsanzeige.

**Akzeptanz:** 1. Download mit künstlichem Abbruch (Server-Fixture) wird fortgesetzt
und endet mit korrektem Hash; 2. Speicherprüfung verweigert mit klarer Meldung;
3. UI zeigt Progress live (WS `system/*` oder Polling).
**Pflicht-Tests:** Integration: Mock-HTTP-Server mit Abbruch nach 50 %;
Hash-Mismatch → Job failed + `.part` gelöscht; Disk-Check-Unit-Test.
**Plausibilität:** Nach jedem Fehlerpfad existieren keine `.part`-Leichen.

---

## E01-T6: Performance-Wächter & Auto-Degradation

- **Abhängigkeiten:** E01-T3, E01-T4 · **Kontext:** docs/00 Budgets; Wargame W-04
- **Pfade:** `apps/web/src/perf/`, Styles

**Aufgabe:** fps-Messung (requestAnimationFrame, rollierendes 5-s-Fenster,
nur bei bewegter Kamera werten). Bei < 25 fps über 10 s: Degradationsstufe hoch
(Stufe 1: 3D-Gebäude aus; Stufe 2: POI/Labels reduziert; Stufe 3: 2D erzwingen).
Bei > 45 fps über 60 s: Stufe wieder runter. Dezenter Toast bei Stufenwechsel,
Override in Settings („Qualität fest: hoch/auto/niedrig"). Debug-Overlay
(fps, Stufe) hinter Query-Flag `?perf=1`.

**Akzeptanz:** 1. künstliche Last (Test-Hook, der Frames drosselt) triggert Stufen
nachweislich; 2. Override respektiert; 3. Hysterese: kein Stufen-Flattern.
**Pflicht-Tests:** Unit-Tests der Hysterese-Logik (Zeitreihen-Fixtures);
Playwright mit gedrosseltem CPU-Profil (`page.emulateCPUThrottling`).
**Plausibilität:** Stufe ändert sich nie öfter als 1×/30 s.
