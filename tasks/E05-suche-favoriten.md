# E05 – Suche, Favoriten & Verlauf

**Ziel:** Offline-Geocoding (Photon + Lite-Fallback), Favoriten-Verwaltung,
Verlauf. **Gate-Beitrag G2.**

---

## E05-T1: SearchService im Core (Photon + Nominatim-Fallback)

- **Abhängigkeiten:** E00 · **Kontext:** docs/01 ADR-005; docs/03 §2 Suche; Wargame W-12
- **Pfade:** `apps/core/src/search/`

**Aufgabe:** `GET /api/v1/search?q&limit&lat&lon` und `/search/reverse`.
Backend-Kette hinter Interface `GeocoderBackend`: (1) Photon (localhost:2322,
`location_bias` aus lat/lon, lang aus Settings), (2) optional Nominatim-Online
(nur wenn Setting `online_fallback: true` UND Photon 0 Treffer; korrekter
User-Agent, max 1 req/s Rate-Limit!), (3) Koordinaten-Parser (Eingaben wie
„47.14, 9.52", „47°08'24"N 9°31'12"E" → direktes Ergebnis, kein Backend).
Einheitliches Ergebnis-Schema (`SearchResult {name, label, latlng, type, source}`,
in shared ergänzen, minor). Photon down → nächstes Backend + health degraded.
Timeout je Backend 3 s.

**Akzeptanz:** 1. Suche gegen Photon-Testcontainer (LI-Index) liefert „Vaduz";
2. Koordinaten-Parser deckt beide Formate + Vertauschungs-Erkennung (lat > 90 →
swap-Vorschlag im Ergebnis-Label); 3. Fallback-Kette nachweislich (Photon
gestoppt → Nominatim-Mock antwortet); 4. Rate-Limit für Nominatim eingehalten.
**Pflicht-Tests:** Koordinaten-Parser-Tabelle (≥ 12 Fälle inkl. invalid);
Backend-Ketten-Logik mit Mocks; Integration mit Photon-Container.
**Plausibilität:** Ergebnisse außerhalb installierter Regionen werden markiert
(`out_of_coverage: true`) — Vorgriff auf W-09-UX.

---

## E05-T2: Such-UI (Suchfeld, Ergebnisse, „search as you type")

- **Abhängigkeiten:** E05-T1, E01-T2 · **Kontext:** docs/06 §1/§4
- **Pfade:** `apps/web/src/search/`

**Aufgabe:** Suchfeld in der top-bar (Explore): Debounce 300 ms ab 3 Zeichen,
Ergebnisliste (Icon nach type, Name, Ort, Distanz von aktueller Position),
Tastatur- und Touch-Navigation, Auswahl → Karte fliegt hin + Pin + Bottom-Sheet
(wie E03-T3, jetzt mit echtem Namen; reverse-Geocode dort anschließen).
Leere Treffer → hilfreicher Zustand („Nichts gefunden in <Region> — online
suchen?" wenn Fallback aus). `out_of_coverage`-Treffer mit Hinweis-Badge.
Speed-Lock-Vorgriff: Suchfeld disabled > 10 km/h mit Hinweis (Setting kommt E07).

**Akzeptanz:** 1. Tippen „Vad" → Vorschläge < 500 ms (lokal); 2. Auswahl-Flow bis
Bottom-Sheet; 3. Fehler-/Leer-Zustände wie spezifiziert; 4. voll offline.
**Pflicht-Tests:** Playwright: Suchen→Wählen→Route (Teil von Flow 2); Debounce-
Unit; A11y-Check (Fokus-Reihenfolge, aria-live für Ergebnisse).
**Plausibilität:** Distanzangaben in Liste stimmen mit Haversine ±1 % (Formatter aus shared).

---

## E05-T3: Favoriten & Verlauf (Backend + UI)

- **Abhängigkeiten:** E05-T2 · **Kontext:** docs/03 §2 Favoriten; docs/06 §1 bottom-drawer
- **Pfade:** `apps/core/src/favorites/`, `apps/web/src/favorites/`

**Aufgabe:** SQLite-Tabellen `favorites` (Schema aus docs/03: name, latlng, icon,
category home|campsite|poi|custom, sort_order) und `history` (query/ziel, ts,
max 100, FIFO). CRUD-Endpoints wie spezifiziert. UI: bottom-drawer mit
Favoriten-Chips (Icon+Name, Tipp → Route sofort mit aktivem Profil,
Long-Press → Bearbeiten/Löschen/Sortieren per Drag). „Als Favorit speichern" im
Ziel-Bottom-Sheet. Verlauf als zweiter Drawer-Tab, Eintrag antippbar, einzeln
und komplett löschbar. Kategorie „home" max 1× (ersetzen mit Bestätigung).

**Akzeptanz:** 1. E2E-Flow 6 (anlegen→Reload→Route via Favorit) grün;
2. Sortierung per Drag persistiert; 3. Verlauf zeichnet Suchen+Ziele auf und
respektiert Limit; 4. home-Eindeutigkeit.
**Pflicht-Tests:** CRUD-Integration inkl. Validierung; FIFO-Unit; Playwright-Flow 6.
**Plausibilität:** Favoriten-Route nutzt IMMER aktuelles aktives Profil
(nicht das bei Anlage aktive) — expliziter Test.

---

## E05-T4: Photon-Setup & Daten-Pipeline

- **Abhängigkeiten:** E00-T3 · **Kontext:** docs/01 ADR-005/§4; docs/04 §3 (RAM)
- **Pfade:** `services/photon/`

**Aufgabe:** Dockerfile/Compose-Verfeinerung: Photon mit `-Xmx`-Deckel aus Env
(Default 1g), Index-Download-Skript (`download-index.sh <country>` von den
offiziellen Photon-Dumps, Resume-fähig, Checksumme), Healthcheck (`/status`).
LI-Index für CI (klein). Doku: RAM-Empfehlungen, Abschalt-Option (W-12) und was
dann passiert (Lite-Suche E05-T5).

**Akzeptanz:** 1. CI startet Photon-LI und E05-T1-Integration läuft dagegen;
2. Xmx wirkt (Container-Limit-Test); 3. Download-Resume nachgewiesen.
**Pflicht-Tests:** CI-Job; Skript-Test mit Abbruch-Fixture.
**Plausibilität:** Photon-RSS unter Last (20 parallele Suchen) < Xmx + 300 MB.

---

## E05-T5: Lite-Suchindex (Fallback ohne Photon, W-12)

- **Abhängigkeiten:** E05-T1 · **Kontext:** Wargame W-12
- **Pfade:** `apps/core/src/search/lite/`, `services/valhalla/` (Datenquelle)

**Aufgabe:** Build-Schritt `build-lite-index.sh <pbf>`: extrahiert aus dem
OSM-PBF Orte (place=city/town/village) und Straßennamen mit Zentroid in eine
SQLite-FTS5-Tabelle (`lite_search.db`, trigram-Tokenizer für Tippfehler-Toleranz).
`GeocoderBackend`-Implementierung `lite`: aktiv wenn Photon down/deaktiviert;
Ergebnisse `source:'lite'`. UI zeigt bei lite-Quelle dezenten Hinweis
„vereinfachte Suche aktiv". Erwartung dokumentieren: keine Hausnummern, Ranking
simpel (Prefix-Treffer > FTS-Rang, Städte > Straßen, Distanz-Bias).

**Akzeptanz:** 1. LI-Lite-Index baut in CI (< 1 min) und findet „Vaduz" und eine
Straße; 2. Photon-Stopp → Suche funktioniert weiter mit lite-Badge; 3. Index
DE < 400 MB (nightly-Nachweis, Wert dokumentieren).
**Pflicht-Tests:** Extraktions-Unit gegen Mini-PBF-Fixture; Ranking-Tests
(„Vadu" findet Vaduz vor „Vaduzer Straße"); Failover-Integration.
**Plausibilität:** Suchsuite aus docs/07 §3b läuft gegen BEIDE Backends
(lite darf schwächer ranken, muss aber Top-3-Kriterium für Städte erfüllen).
