# 06 – UI/UX-Guidelines & Styleguide

**Leitbild:** Google-Maps-Klarheit im Stand, Sygic-artige Fahransicht während der
Navigation. Alles Relevante sichtbar, nichts überfrachtet, flüssig auf Touch.

## 1. Grundlayout (zwei Modi)

### Explore-Modus (Stand / Planung)
```
┌──────────────────────────────────────────────┐
│ [☰]  [ Suchfeld ............... ] [Profil🚐] │ ← top-bar
│                                              │
│                 KARTE                        │
│   [Zoom +/-]                    [⌖ Follow]   │
│   [2D/3D]                       [🧭 N/Kurs]  │
│                                              │
│ ┌─ bottom-drawer (einziehbar) ─────────────┐ │
│ │ Favoriten ▸ 🏠 Home  ⛺ Stellplatz  ...   │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### Drive-Modus (aktive Navigation)
```
┌──────────────────────────────────────────────┐
│ ┌────────────┐                               │
│ │  ↰ 350 m   │   KARTE (Kurs-oben, 3D-Tilt,  │ ← Manöver-Panel (groß,
│ │  B27 →Ulm  │   Route hervorgehoben,        │   Slot map-overlay-tl)
│ │  danach ↱  │   Auto-Zoom nach Tempo)       │
│ └────────────┘                               │
│                    [Tempolimit ⭕80]          │ ← overlay-tr
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │  87 km/h   |  ETA 17:42  |  213 km  | ⛰613m │ ← bottom-bar (Widgets)
│ └───────────────[ ⏸ ] [ ✕ ]────────────────┘ │
└──────────────────────────────────────────────┘
```

## 2. Widget-System & Customizing (Kernanforderung)

- Alle Anzeigen (Tempo, Limit, ETA, Restdistanz, Höhe, Uhrzeit, nächste Anweisung,
  Kompass, Add-on-Widgets …) sind **Widgets** mit einheitlichem Vertrag
  (id, name, Größen S/M/L, benötigte Datentopics).
- **Slots:** `top-bar`, `bottom-bar`, `side-panel`, `bottom-drawer`,
  `map-overlay-{tl,tr,bl,br}`. Nutzer ordnet Widgets im **Edit-Modus**
  (lange drücken → Raster erscheint, Drag & Drop, Größenwahl) den Slots zu.
- Layout wird **pro Modus** (Explore/Drive) und **pro Gerät** (localStorage-Key +
  Server-Backup in Settings) gespeichert. „Zurücksetzen auf Standard" prominent.
- Add-on-Widgets erscheinen automatisch in der Widget-Bibliothek (docs/05 §4).

## 3. Design-Tokens

| Token | Tag (Light) | Nacht (Dark) |
|---|---|---|
| `--bg-surface` | #FFFFFF | #111417 |
| `--bg-map-ui` (Overlays) | rgba(255,255,255,.92) | rgba(20,24,28,.92) |
| `--text-primary` | #1A1C1E | #E7EAED |
| `--accent` (Route, Aktiv) | #1A73E8 | #8AB4F8 |
| `--route-casing` | #0B57D0 | #4C8DF6 |
| `--success` / `--warn` / `--danger` | #188038 / #F29900 / #D93025 | angepasst, AA-konform |
| Radius | 12 px (Panels), 999 px (FABs) | |
| Schrift | Inter (UI), tabellarische Ziffern für Tempo/ETA | |

- **Nachtmodus:** automatisch nach Sonnenstand (Position + Datum, offline berechnet)
  oder manuell/HA-gesteuert; wechselt UI-Theme **und** Karten-Style zusammen.
- Kontrast: WCAG AA überall; Drive-Modus-Widgets AAA (Sonnenlicht im Cockpit!).

## 4. Touch & Fahrbetrieb

- Touchziele ≥ 48 px, im Drive-Modus ≥ 64 px; Abstände ≥ 8 px (Rüttelpiste!).
- Primäraktionen in Daumenreichweite (unten/rechts, spiegelbar für LHD/RHD-Montage).
- **Speed-Lock:** ab konfigurierbarer Geschwindigkeit (Default 10 km/h) werden
  komplexe Dialoge (Profil-Editor, Settings, Store) gesperrt – Overlay mit
  „Beifahrer-Modus"-Override. Suche nur via Favoriten-Schnellwahl.
- Karten-Gesten wie Google Maps: 1-Finger-Pan, Pinch-Zoom, 2-Finger-Rotate,
  2-Finger-Tilt (3D), Doppeltipp-Zoom, Doppeltipp+Halten-Zoomslide.
- Jede Interaktion < 100 ms visuelles Feedback; Animationen 150–250 ms,
  `prefers-reduced-motion` respektieren.

## 5. Navigations-UX-Regeln

- **Ansage-/Anzeige-Schwellen** (bei Ø-Tempo skaliert): 2000 m (Autobahn), 500 m,
  200 m, „Jetzt". Manöver-Panel zeigt immer: Pfeil-Icon, Distanz, Straßenname,
  Folgemanöver wenn < 300 m dahinter („danach rechts").
- **Spurassistent:** Lane-Infos aus Valhalla als Piktogramm-Leiste unter dem
  Manöver-Panel, aktive Spur(en) hervorgehoben.
- **Tempolimit:** rundes Schild (EU-Optik); bei Überschreitung > 5 km/h pulsiert
  Rahmen + optional Ton (abschaltbar). Unbekanntes Limit ⇒ Schild ausgeblendet,
  niemals „0" (Plausibilitäts-Invariante).
- **Rerouting:** stiller Neuaufbau; dezenter Hinweis „Route neu berechnet".
  Kein modaler Dialog während der Fahrt. Alternativ-Vorschläge (auch von Add-ons,
  `route.propose`) als Banner mit Countdown, Ignorieren = Ablehnen.
- **Follow-Me-Kamera:** Positions-Puck mittig-unten (Drive) bzw. zentriert
  (Explore); Auto-Zoom: Tempo ↑ ⇒ Zoom raus + Tilt runter; manuelles Verschieben
  pausiert Follow für 10 s, dann Button „Zurück zur Route".
- **GPS-Verlust:** Puck wird grau + Genauigkeitsring wächst; Dead-Reckoning auf
  Route bis 30 s (Anzeige „GPS-Signal verloren"), dann Pause-Zustand.
- **Ankunft:** Zielbanner + Distanz Luftlinie zum POI; Navigation beendet sich
  nach Bestätigung oder 60 s im Stand.

## 6. Karten-Darstellungsregeln

- 2D-Nord, 2D-Kurs, 3D-Kurs (Tilt 45–60°) – Umschalt-FAB, Zustand persistiert.
- Kompass-FAB erscheint bei Rotation ≠ Nord; Tipp = zurück zu Nord (wie GMaps).
- 3D-Gebäude erst ab Zoom 15 und nur wenn fps-Budget hält (Auto-Degradation W-04).
- Styles: `Yapaja Light`, `Yapaja Dark`, `Yapaja Contrast` (+ Add-on-Styles).
  POI-Dichte, Labelgröße (Fahrmodus: +20 %), Sprache der Labels einstellbar.
- OSM-Attribution dauerhaft dezent sichtbar (ODbL-Pflicht).

## 7. Barrierefreiheit & i18n

- Vollständige Tastaturbedienung (Kiosk mit Dreh-Drück-Steller denkbar),
  Fokus-Ringe, ARIA-Labels auf allen Widgets.
- i18n via i18next; v1: Deutsch + Englisch; Ansage-Texte (TTS via Web Speech API,
  offline-fähige Stimmen des OS) aus denselben Sprachdateien.
- Einheiten metrisch/imperial umschaltbar (ein zentraler Formatter, keine
  Inline-Umrechnungen — Testpflicht).
