# Entwurf: Oberfläche im Stil von Google Maps (Paket B)

Stand: umgesetzt bis Schritt 4 (siehe unten). Paket A (Chips,
Zwischenziel-Pins, Übersicht-Knopf, Vorschau, Spritsorte) ist mit 0.22.0
ausgeliefert.

## Was gewünscht wurde

> Im linken Drittel befinden sich die Menüs und Suchen usw. Die rechten
> beiden Drittel sind frei für die Karte. Je nach LHD oder RHD.
> Es gibt im „Ruhemodus" nicht viele Menüs oder Buttons.
> Das meiste passiert, wenn man auf Suche klickt oder einen Pin auf der Karte.
> Dann sieht man auch erst die Favoriten. Oder Routenoptionen.
> Wir können unser Camper-Profil in den Einstellungen konfigurieren und dann
> für die Navigation aus der Liste der Profile auswählbar machen.
> Wenn man ein Ziel ausgewählt hat, kann man die Route suchen bzw. dann die
> Navigation starten. Oder auch nur die Infos (Internet vorausgesetzt) zu dem
> markierten Punkt lesen.

## Die Idee in einem Satz

Ein **Seitenpanel** (linkes Drittel bei LHD, rechtes bei RHD) ist der einzige
Ort für Inhalte. Die Karte bekommt den Rest. Im Ruhezustand ist das Panel nur
eine schmale Suchzeile mit Chips.

## Die vier Zustände

### 1. Ruhe (nichts gewählt)

```
┌──────────────────────┬─────────────────────────────────────────────┐
│ [🔍 Ziel suchen… ]    │                                        [+]  │
│ ⛽ 🚐 ⛺ 💧 🚽 …       │                                        [−]  │
│                      │                                             │
│                      │                 Karte                       │
│                      │                                             │
│                      │                    ●  (eigene Position)     │
│                      │                                        [⌖]  │  ← nur wenn weg
│ ⚙                    │                                       [🧭]  │
└──────────────────────┴─────────────────────────────────────────────┘
```

- Oben: Suchzeile, darunter die Chips (wie jetzt).
- Kein „Favoriten & Verlauf"-Balken, keine Knopfsäule (🗺️ 🧩 🩺 🧪).
  Diese wandern ins ⚙-Menü unten im Panel.
- Fahrzeugprofil-Chip verschwindet aus der Kopfzeile (siehe unten).
- Auf schmalen Schirmen (Telefon): kein Seitenpanel, sondern ein
  Bottom-Sheet von unten, wie bei Google Maps auf dem Telefon.

### 2. Suche aktiv (Tipp in die Suchzeile)

```
┌──────────────────────┬──────────────────────────
│ [← Ziel suchen…  🎤] │
│ 🏠 Zuhause  ⭐ Arbeit │
│ ── Zuletzt ───────── │       Karte
│ 🕘 Stellplatz Rhein  │
│ 🕘 Aral Germersheim  │
│ ── Favoriten ─────── │
│ ⭐ …                  │
└──────────────────────┴──────────────────────────
```

Erst hier erscheinen Favoriten und Verlauf. Tippen auf einen Eintrag führt zu
Zustand 3.

### 3. Ort gewählt (aus Suche, Favorit, Chip-Treffer oder Tipp auf einen Pin)

```
┌──────────────────────┬──────────────────────────
│ ← Stellplatz am Rhein│
│ Wohnmobilstellplatz  │          📍
│ 12 km · 18 min       │       Karte
│ [Route] [Favorit ☆]  │
│ ── Infos (online) ── │
│ Öffnungszeiten, Web, │
│ Telefon, Bewertung … │
└──────────────────────┴──────────────────────────
```

- **Route** berechnet und wechselt zu Zustand 4.
- **Infos** zeigen, was online verfügbar ist (Website, Telefon, Öffnungszeiten
  aus OSM-Tags; optional Wikipedia). Offline steht dort, was die Kachel
  hergibt (Name, Kategorie).
- Pins auf der Karte werden antippbar: heute zeigen sie nur ein Symbol.

### 4. Route geplant

```
┌──────────────────────┬──────────────────────────
│ ← Route              │
│ 🚐 Camper ▾  (Profil)│      ━━━━━━━━ Route
│ ◉ schnell ○ kurz     │          ①       ②
│ 1  Stellplatz Rhein  │                     🏁
│ 2  Aral …            │                       [🗺️/📍]
│ ＋ Zwischenziel      │
│ [▶ Navigation starten]│
└──────────────────────┴──────────────────────────
```

- **Profilwahl hier**: ein Ausklappmenü mit der Liste der Profile. Angelegt
  und bearbeitet werden Profile nur noch im ⚙-Menü (Einstellungen →
  Fahrzeuge). Dort steht auch die Spritsorte.
- Routenoptionen und Zwischenziele wie heute im RoutingPanel, nur im Panel.

Während der **Fahrt** bleibt es wie in 0.18: Panel weg, Abbiegeanzeige oben,
Fahrtleiste unten, Fahrtmenü über die Leiste.

## LHD / RHD

Das Panel liegt auf der Fahrerseite, damit es vom Fahrersitz erreichbar ist:
LHD → links, RHD → rechts. Die Kartenknöpfe (Zoom, Zentrieren, Übersicht)
gehen auf die andere Seite. Der blaue Punkt sitzt im freien Kartenbereich
(heute: unteres linkes bzw. rechtes Viertel).

## Was dafür umgebaut wird

| Heute | Danach |
| --- | --- |
| Kopfzeile mit Marke, Profil-Chip, Suche | Suchzeile + Chips im Panel |
| Favoriten-Balken unten | im Such-Zustand des Panels |
| Knopfsäule rechts oben (🗺️ 🧩 🩺 🧪) | im ⚙-Menü |
| RoutingPanel unten in der Mitte | Zustand 4 im Panel |
| Profilverwaltung in der Kopfzeile | ⚙ → Fahrzeuge; Auswahl in Zustand 4 |
| Pins auf der Karte nicht antippbar | Tipp → Zustand 3 |

## Vorschlag zur Reihenfolge

1. **Panel-Gerüst + Ruhezustand** (Suche + Chips im Panel, ⚙-Menü sammelt
   die Knopfsäule, Favoritenbalken weg). Danach ansehen und entscheiden.
2. **Such-Zustand** mit Favoriten/Verlauf.
3. **Pins antippbar + Orts-Zustand** mit Route-Knopf; Infos zuerst offline,
   online danach.
4. **Routen-Zustand** mit Profilwahl; Profile in die Einstellungen.

Jeder Schritt ist für sich nutzbar und wird einzeln ausgeliefert.

## Entscheidungen (beantwortet)

1. „Yapaia Go" steht im ⚙-Menü.
2. Auf großen Schirmen feste Breite (380 px).
3. Infos online: OSM-Angaben und zusätzlich Wikipedia und Bilder.

## Stand

- Schritt 1 (Panel + ⚙-Menü) und 2 (Such-Zustand) — 0.23.0.
- Schritt 3 (Pins antippbar, Ortskarte mit Online-Infos) — 0.24.0.
- Schritt 4 (Routen-Zustand im Panel, Fahrzeugwahl, Profile in ⚙ → Fahrzeuge) — 0.25.0.
  Auf Bildschirmen unter 960 Punkten bleibt das Routenfenster unten.
- Offen aus dem Entwurf: Bottom-Sheet statt Seitenpanel auf dem Telefon.
