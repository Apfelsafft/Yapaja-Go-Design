# E07 – UI-Shell, Widget-System & Customizing

**Ziel:** Finales App-Layout beider Modi, Widget-Customizing, Tag/Nacht,
Fahrbetrieb-UX. **Gate-Beitrag G3.**

---

## E07-T1: Widget-Registry & Slot-Layout-Engine

- **Abhängigkeiten:** E04 (Datentopics vorhanden) · **Kontext:** docs/06 §1/§2; docs/05 §4 (Slots sind Add-on-Schnittstelle!)
- **Pfade:** `packages/ui/`, `apps/web/src/shell/`

**Aufgabe:** Widget-Vertrag als TS-Interface in `packages/ui`
(`{id, name, sizes:['S'|'M'|'L'], topics:string[], render, settings?}`).
Slot-Engine für die Slots aus docs/05 §4 (top-bar, bottom-bar, side-panel,
bottom-drawer, map-overlay-{tl,tr,bl,br}, settings) mit Layout-Persistenz
**pro Modus (explore/drive) und Gerät**: localStorage-Cache + Server-Sync
(`PATCH /api/v1/settings`, Key `layouts`). Core-Widgets implementieren:
Tempo (groß, tabellarische Ziffern), Tempolimit-Schild, ETA, Restdistanz,
Restzeit, Höhe (aus Position.alt), Uhr, Kompass, Nächste-Anweisung
(nutzt E04-T3-Panel), GPS-Status. Jedes Widget abonniert nur seine Topics
über einen gemeinsamen WS-Store (eine Verbindung!).

**Akzeptanz:** 1. Default-Layouts entsprechen den Skizzen docs/06 §1;
2. Widgets aktualisieren live bei Simulator-Fahrt; 3. Layout-Persistenz über
Reload UND über zweites Gerät (Server-Sync) nachweisbar; 4. unbekannte
Widget-IDs im gespeicherten Layout (z. B. deinstalliertes Add-on) werden
still übersprungen, nicht gecrasht.
**Pflicht-Tests:** Slot-Engine-Unit (Zuordnung, Persistenz-Merge lokal/Server:
neuester Zeitstempel gewinnt); Playwright: Live-Update-Check; Robustheits-Test
unbekannte ID.
**Plausibilität:** Genau EINE WS-Verbindung unabhängig von Widget-Anzahl
(Netzwerk-Assertion).

---

## E07-T2: Edit-Modus (Drag & Drop-Customizing)

- **Abhängigkeiten:** E07-T1 · **Kontext:** docs/06 §2
- **Pfade:** `apps/web/src/shell/edit/` · **Neue Deps:** @dnd-kit/core

**Aufgabe:** Long-Press (600 ms) auf freie UI-Fläche ODER Settings-Eintrag →
Edit-Modus: Slots bekommen sichtbares Raster, Widgets wackeln dezent,
Widget-Bibliothek als Drawer (alle registrierten inkl. inaktiver), Drag & Drop
zwischen Slots, Größenwahl (S/M/L-Zyklus per Tipp auf Badge), Entfernen
(Drag auf Papierkorb-Zone). „Zurücksetzen auf Standard" mit Bestätigung.
Edit-Modus nur im Stand (< 5 km/h) startbar. Speichern explizit
(Häkchen-Button) — Abbrechen verwirft.

**Akzeptanz:** 1. E2E-Flow 7 (verschieben→Reload→persistiert) grün; 2. Abbrechen
verwirft nachweislich; 3. Reset stellt exakt Default her; 4. Touch UND Maus.
**Pflicht-Tests:** Playwright Flow 7 + Abbrechen + Reset; Unit: Layout-Diff/Apply.
**Plausibilität:** Kein Widget kann in einen inkompatiblen Slot gelegt werden
(z. B. L-Widget in top-bar) — Engine verweigert sichtbar (Slot rot).

---

## E07-T3: Tag/Nacht-Automatik & Theme-Kopplung

- **Abhängigkeiten:** E01-T4, E07-T1 · **Kontext:** docs/06 §3
- **Pfade:** `apps/web/src/theme/`, `packages/shared` (Sonnenstand)

**Aufgabe:** Sonnenauf-/-untergangsberechnung offline (NOAA-Algorithmus als
reine Funktion in shared, Position+Datum → Zeiten). Theme-Modi: hell/dunkel/auto
(auto: Wechsel bei Sonnenstand ∓15 min, mit Position; ohne Position: 07/19 Uhr
lokal). Wechsel setzt UI-Theme (CSS-Custom-Properties aus docs/06 §3) UND
Karten-Style (light↔dark) atomar. Manueller Override hält bis nächstem
Auf-/Untergang. Später von HA übersteuerbar (Setting-Endpunkt reicht — E08 nutzt ihn).

**Akzeptanz:** 1. Auto-Wechsel bei simulierter Zeit/Position nachweisbar;
2. UI+Karte wechseln zusammen, ohne Flackern (ein Frame-Test); 3. Override-Logik.
**Pflicht-Tests:** Sonnenstand-Unit gegen 6 Referenzwerte (Stuttgart Sommer/
Winter, Tromsø Polarnacht-Edge → Fallback-Zeiten!); Playwright mit Clock-Mock.
**Plausibilität:** Polarnacht/-tag crasht nicht und wählt sinnvolle Defaults.

---

## E07-T4: Fahrbetrieb-Härtung (Speed-Lock, Touchziele, A11y)

- **Abhängigkeiten:** E07-T1/T2 · **Kontext:** docs/06 §4/§7; docs/00 Rechtliches
- **Pfade:** `apps/web/src/shell/`

**Aufgabe:** Speed-Lock: ab konfigurierbarem Tempo (Default 10 km/h) sperren
Settings/Editor/Store/Profil-Editor mit Overlay „Während der Fahrt gesperrt" +
„Ich bin Beifahrer"-Button (5-s-Countdown, Session-merken). Suche → nur
Favoriten-Schnellwahl (docs/06 §4). Drive-Modus-Audit: alle interaktiven
Elemente ≥ 64 px (automatisierter Test misst Bounding-Boxes), Abstände ≥ 8 px.
A11y-Pass: aria-Labels aller Widgets/FABs, Fokusreihenfolge, `prefers-reduced-motion`
respektiert (Animationen aus). LHD/RHD-Spiegelung der FAB-Seiten als Setting.

**Akzeptanz:** 1. Lock greift/löst bei Simulator-Tempo, Beifahrer-Override wie
spezifiziert; 2. Touchziel-Audit-Test grün; 3. axe-core ohne serious/critical
Violations; 4. Spiegelung wirkt.
**Pflicht-Tests:** Playwright: Lock-Szenarien; Touchziel-Mess-Test; axe-Scan
beider Modi/Themes.
**Plausibilität:** Stop-Navigation-Button ist NIE gesperrt (Sicherheit).

---

## E07-T5: PWA & Kiosk

- **Abhängigkeiten:** E07-T1 · **Kontext:** docs/01 ADR-001; Wargame W-19/W-20
- **Pfade:** `apps/web/` · **Neue Deps:** vite-plugin-pwa

**Aufgabe:** PWA-Manifest (Name, Icons, `display: fullscreen`, Orientation any),
Service Worker: App-Shell precache (Karten-Tiles NICHT — kommen vom lokalen
Core), Update-Strategie `autoUpdate` mit Reload-Prompt im Stand (nie während
Fahrt!). `navigator.storage.persist()` anfordern (W-20). Kiosk-Doku:
Chromium-Flags/Fully-Kiosk-Setup, Autostart nach Boot, Crash-Recovery
(W-19-Recovery aus E04-T5 verweisen + testen).

**Akzeptanz:** 1. Lighthouse-PWA-Kriterien erfüllt (installierbar); 2. App-Update
prompted nur im Stand; 3. Reload-Recovery-Test weiterhin grün mit SW aktiv
(SW-Cache-Falle ausschließen!).
**Pflicht-Tests:** Playwright mit SW: Kaltstart offline (Flow 1), Update-Prompt-
Logik (Unit), Recovery-Flow.
**Plausibilität:** SW cached niemals `/api/*` oder `/tiles/*` (Assertion auf
Cache-Inhalte) — sonst Geisterdaten nach Updates.
