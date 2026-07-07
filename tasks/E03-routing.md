# E03 – Routing (Valhalla-Integration, Fahrzeugprofil-Costing)

**Ziel:** Offline-Routenberechnung mit Fahrzeugmaß-Beachtung, Routen-Anzeige,
Golden-Route-Testsuite. **Gate-Beitrag G2 (sicherheitskritischer Kern!).**

---

## E03-T1: Valhalla-Datenpipeline (Graph-Bau)

- **Abhängigkeiten:** E00-T3 · **Kontext:** docs/01 ADR-004; Wargame W-17/W-18
- **Pfade:** `services/valhalla/`

**Aufgabe:** Skripte + Doku für den Valhalla-Betrieb: `build-tiles.sh
<pbf-url|pfad>` (lädt OSM-PBF, baut Tiles in `data/valhalla/tiles`, valhalla.json-
Template mit `service_limits` passend für Mini-PC: max_matrix aus, isochrone klein),
Integration in Compose (valhalla startet nur mit vorhandenen Tiles, sonst
sauberer Exit mit Hinweis-Log). CI-taugliches Mini-Setup: Skript baut
Liechtenstein-Extrakt (~40 MB) in < 5 min; dieses Setup wird der E2E-Standard.
Graph-Neubau als dokumentierter Prozess ohne Downtime (Bau in `tiles.new`,
atomischer Swap, W-17).

**Akzeptanz:** 1. LI-Graph baut in CI und `GET valhalla:8002/status` ok;
2. Beispiel-Route Vaduz→Schaan via curl liefert Ergebnis; 3. Swap-Prozess
dokumentiert und per Skript ausführbar.
**Pflicht-Tests:** CI-Job „valhalla-li-build" + Status/Route-Smoke.
**Plausibilität:** Route Vaduz→Schaan: 3–6 km, 5–12 min (Assertion im Smoke).

---

## E03-T2: RoutingService im Core (Valhalla-Client + Profil-Mapping)

- **Abhängigkeiten:** E03-T1, E00-T2, E06-T1 (Profil-Schema) · **Kontext:** docs/03 §1/§2; docs/01 ADR-004
- **Pfade:** `apps/core/src/routing/`

**Aufgabe:** `POST /api/v1/routes` (RouteRequest → Route[]): baut Valhalla-
`/route`-Request mit costing `truck` und **exaktem Profil-Mapping**:
`height=height_m, width=width_m, length=length_m, weight=weight_t,
top_speed=avg_speed_kmh, hazmat`; avoid-Flags → `use_highways=0/…`, `use_tolls`,
`use_ferry`, `exclude_unpaved`. `origin:'current'` löst über PositionService auf
(409 wenn keine Position). Antwort-Mapping: polyline6-Geometrie, Manöver
(Valhalla-Typen → `ManeuverType`-Enum), Legs, `speed_limits` aus Valhalla-
Edge-Attributen (`/trace_attributes` entfällt — Limits direkt via
`directions_options` + edge.speed_limit wenn verfügbar, sonst null),
`warnings` (u. a. W-08: Kanten ohne Restriktionsdaten, wenn Valhalla das liefert;
sonst Feld leer lassen und TODO-Kommentar mit Issue-Referenz). Timeout 30 s,
Valhalla down → 503. Routen-Cache (Map, TTL 1 h, max 20) + `GET /routes/{id}`.
`alternatives` via Valhalla `alternates`.

**Akzeptanz:** 1. LI-Route mit Profil kommt schema-valide zurück; 2. Profil-
Parameter nachweislich im Valhalla-Request (Test fängt Request ab); 3. alle
Fehlerpfade (kein Weg, Punkt im Nirgendwo → 400 `NO_ROUTE`/`POINT_UNREACHABLE`,
Valhalla down → 503) mit sauberem Fehlerformat.
**Pflicht-Tests:** Profil-Mapping-Unit-Test (alle Felder!); Manöver-Typ-Mapping-
Tabelle; Integration gegen echtes LI-Valhalla; Fehlerpfade mit Mock.
**Plausibilität:** docs/03 §5 Route-Invarianten laufen als `checkRoute` über
jede Antwort; Verstoß → 500 + Log (niemals unplausible Route ausliefern).

---

## E03-T3: Routen-Anzeige & Zielauswahl im Frontend

- **Abhängigkeiten:** E03-T2, E01-T3 · **Kontext:** docs/06 §1 Explore-Modus
- **Pfade:** `apps/web/src/routing/`

**Aufgabe:** Long-Press/Klick auf Karte → Pin + Bottom-Sheet („Route hierhin",
Adresse via reverse-Geocode sobald E05 da, bis dahin Koordinaten). Routen-Request
mit aktivem Profil; Anzeige: Hauptroute (accent, mit Casing), Alternativen
(grau, antippbar → wird Hauptroute), Start/Ziel/Wegpunkt-Marker, Auto-Fit-Bounds.
Summary-Panel: Distanz, Dauer, ETA-Vorschau, Profilname + Maße-Hinweis,
Warnungen aus `Route.warnings` als gelbes Banner (W-08). Wegpunkte: per
„Zwischenziel hinzufügen" + Drag der Route (v1: Long-Press auf Route → Punkt).
Button „Navigation starten" (bis E04: disabled mit Tooltip „kommt mit E04" —
Feature-Flag).

**Akzeptanz:** 1. Kompletter Flow Klick→Route→Alternative wählen funktioniert
offline auf LI; 2. Warnungen sichtbar wenn vorhanden; 3. Route-Layer überlebt
Style-Wechsel (E01-T4-Mechanik).
**Pflicht-Tests:** Playwright: Flow inkl. Alternativen-Wechsel; Unit: polyline6-
Decoder (Fixture mit bekannten Koordinaten, ±1e-6).
**Plausibilität:** Angezeigte Distanz == API-Wert (ein Formatter, kein
Selbstrechnen im UI).

---

## E03-T4: Vermeidungen & temporäre Sperrungen

- **Abhängigkeiten:** E03-T2/T3 · **Kontext:** docs/00 Kernfunktion 3; Wargame W-05 (3-Reroute-Regel nutzt das später)
- **Pfade:** `apps/core/src/routing/`, `apps/web/src/routing/`

**Aufgabe:** (a) Profil-avoid-Flags in der Routen-UI als Chips togglebar
(überschreibt Profil je Route, ohne es zu speichern). (b) `exclude_locations`/
`exclude_polygons`-Support in RouteRequest (Schema erweitern in shared, minor
Version) + Core-Mapping auf Valhalla; UI: Kontextmenü auf Route „Diesen Abschnitt
meiden" → exclude_polygon um gewählte Kante (Radius 200 m) → Reroute. Temporäre
Vermeidungen gelten pro Session, Liste einsehbar/löschbar im Summary-Panel.

**Akzeptanz:** 1. Maut-Toggle ändert Route nachweislich (LI-Testfall mit
Autobahn-Toggle ersatzweise); 2. „Abschnitt meiden" erzeugt sichtbar andere Route;
3. Vermeidungsliste verwaltbar.
**Pflicht-Tests:** Schema-Tests; Integration: Route mit/ohne exclude
unterschiedlich; Playwright-Flow.
**Plausibilität:** Mit Vermeidung ist die Route nie kürzer (Dauer ≥) als ohne.

---

## E03-T5: Golden-Route-Testsuite (sicherheitskritisch, 🔴)

- **Abhängigkeiten:** E03-T2 · **Kontext:** docs/07 §3b — VOLLSTÄNDIG lesen
- **Pfade:** `e2e/golden-routes/`, `e2e/golden-routes.json`

**Aufgabe:** Test-Runner (Vitest, eigenes Projekt), der `golden-routes.json`
ausführt. Fall-Typen: `distance` (od-Paar, Profil, erwartete Distanz ±10 %),
`restriction` (od-Paar, zwei Profile, `forbidden_bbox` — kleines Profil DARF
durch die Box, großes DARF NICHT), `monotonic` (od-Paar, Profilliste aufsteigend
→ Dauer nicht-fallend), `no_route` (erwartet NO_ROUTE). Suite läuft gegen die
per Env konfigurierte Region (CI: LI; nightly: DE). **Initiale Fälle kuratieren:**
für LI mind. 3 distance + 1 monotonic; für DE 5 distance + 3 restriction
(reale Unterführungen mit OSM-maxheight recherchieren, z. B. bekannte
3,x-m-Bahnunterführungen; Koordinaten + OSM-way-id + Quelle im JSON dokumentieren)
+ 1 Gewichtsfall. Fehlschlag eines restriction-Falls bricht CI hart ab
(kein retry, keine Toleranz).

**Akzeptanz:** 1. Runner läuft in CI gegen LI grün; 2. DE-Fälle nightly grün
(einmaliger manueller Nachweis im PR); 3. absichtlich kaputtes Profil-Mapping
(height weglassen) lässt restriction-Fälle nachweislich fehlschlagen
(im PR dokumentieren, dann reverten).
**Pflicht-Tests:** — (die Suite IST der Test); Unit für bbox-Intersection-Logik.
**Plausibilität:** Jeder restriction-Fall verifiziert BEIDE Richtungen
(klein: durch; groß: nicht durch) — sonst testet man nur Valhalla-Ausfall.

---

## E03-T6: Regions-Grenzen-Handling

- **Abhängigkeiten:** E03-T2, E01-T5 · **Kontext:** Wargame W-09
- **Pfade:** `apps/core/src/routing/`, `apps/web/src/routing/`

**Aufgabe:** Vor dem Routing: Ziel/Wegpunkte gegen die Bounds installierter
Regionen (aus PMTiles-Metadaten ∩ Valhalla-Abdeckung, gepflegt in Region-Manager-
Metadaten) prüfen. Außerhalb → 422 `OUT_OF_COVERAGE` mit `{missing_region_hint}`.
UI: Meldung nach W-09 („Ziel liegt außerhalb… ") mit Button zur Regionen-Seite.
Valhalla-`NO_ROUTE` (trotz Abdeckung) bekommt eigene, ehrliche Meldung
(„Keine für dein Fahrzeug befahrbare Route gefunden" — wichtig bei großen Profilen!).

**Akzeptanz:** 1. Ziel in Österreich bei LI-Installation → spezifizierte Meldung +
funktionierender Link; 2. NO_ROUTE-Meldung unterscheidet sich sichtbar von
OUT_OF_COVERAGE; 3. Wegpunkt außerhalb wird genauso behandelt.
**Pflicht-Tests:** Integration beide Fehlerfälle; Playwright: Meldungs-Flow.
**Plausibilität:** Coverage-Check nutzt echte Bounds, nicht hartkodierte.
