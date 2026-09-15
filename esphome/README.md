# Yapaia Go auf einem ESP32-S3-Display

`yapaja-nav-display.yaml` macht aus einem kleinen ESP32-S3-Display ein
Navigationsinstrument fürs Armaturenbrett: nächstes Manöver mit Pfeil und
Entfernung, Tempo gegen Tempolimit, Ankunftszeit und Reststrecke.

---

## Zuerst das Unangenehme: die Karte geht nicht

Gefragt war, **unsere Karte** auf dem Display anzuzeigen. Das geht nicht, und
zwar nicht „mit Aufwand", sondern gar nicht:

- Yapaias Karte ist **MapLibre**: Vektorkacheln (PMTiles), die ein Browser per
  **WebGL** zeichnet. Ein ESP32-S3 hat keinen Browser.
- ESPHome hat **keinen Kartenrenderer** und keinen Weg, eine Lovelace-Karte
  oder irgendeine Webansicht auf ein Display zu spiegeln. Ein Lovelace-Dashboard
  ist eine Webseite; ESPHome zeichnet Grundformen, Text und Bilder.

**Bilder** kann ESPHome sehr wohl anzeigen — `online_image` holt PNG oder JPEG
über HTTP. Es fehlt nur die Quelle: der Yapaia-Core hat keinen Endpunkt, der
die Karte als Rasterbild ausliefert. Unten steht, was dafür nötig wäre.

Für ein Display dieser Größe ist das ohnehin die zweite Wahl. Eine Karte auf
320 × 240 Bildpunkten, aus zwei Metern Entfernung im fahrenden Fahrzeug
gesehen, sagt weniger als ein großer Pfeil und eine große Zahl. Genau die
zeigt diese Datei.

---

## Was auf dem Display steht

```
┌──────────────────────────────────────┐
│       ┌─┐                            │
│    ┌──┘ │      1,2 km                │   ← Manöver: Pfeil + Entfernung
│    └────┤                            │
│         │      Links abbiegen auf B27│   ← der Anweisungstext aus Yapaia
├──────────────────────────────────────┤
│   87            ⬤80          16:32   │   ← Tempo · Tempolimit · Ankunft
│   km/h                  noch 42,5 km │
└──────────────────────────────────────┘
```

Im Einzelnen:

| Was | Woher | Besonderheit |
|---|---|---|
| Manöverpfeil | Attribut `type` von `sensor.yapaja_instruction` | gezeichnet, keine Symbolschrift |
| Entfernung zum Manöver | `sensor.yapaja_instruction_distance` | unter 1 km in Metern, auf 10 m gerundet |
| Anweisungstext | `sensor.yapaja_instruction` | bereits auf Deutsch, bei Überlänge gekürzt |
| Tempo | `sensor.yapaja_speed` | rot, wenn `binary_sensor.yapaja_speeding` an ist |
| Tempolimit | `sensor.yapaja_speed_limit` | als rundes Schild — **nur**, wenn die Karte eines kennt |
| Ankunftszeit | `sensor.yapaja_eta` | aus UTC in Ihre Zeitzone **gerechnet** |
| Reststrecke | `sensor.yapaja_distance_remaining` | |
| Fahrzustand | `sensor.yapaja_nav_state` | ohne Route steht da, warum, statt eines Pfeils ins Nichts |

Zwei Entscheidungen, die man beim Lesen sonst für Zufall hält:

**Die Ankunftszeit wird gerechnet, nicht abgeschnitten.** Yapaia liefert sie
als ISO 8601 in UTC (`…Z`; der Core rechnet durchgängig in UTC, W-22). Die
Zeichen 12–16 herauszuschneiden wäre kürzer und im Sommer **zwei Stunden
falsch** — ohne jede Fehlermeldung. Deshalb steht die Zeitzone oben in den
`substitutions` und muss stimmen.

**Ein unbekannter Wert wird nicht angezeigt.** Home Assistant schickt für
„weiß ich nicht" `NaN`. Ungeprüft gedruckt stünde da `nan` oder
`-2147483648`, und beim Tempolimit ein rundes Schild mit einer erfundenen
`0` — also die Behauptung, hier gelte Tempo 0. Fehlt ein Wert, bleibt der
Platz leer.

---

## Einrichten

1. **Secrets.** In `secrets.yaml` (bei der ESPHome-Add-on-Installation im
   selben Ordner) gehören:
   ```yaml
   wifi_ssid: "..."
   wifi_password: "..."
   yapaja_display_api_key: "..."       # 32 Byte base64, vom ESPHome-Assistenten
   yapaja_display_ota_password: "..."
   ```
2. **Zeitzone und Pins** oben in `substitutions` eintragen.
3. **Den `display:`-Block** auf das eigene Panel anpassen — siehe Tabelle unten.
   Das ist der einzige boardabhängige Abschnitt.
4. Übersetzen und flashen: in Home Assistant über das ESPHome-Add-on, oder
   `esphome run esphome/yapaja-nav-display.yaml`.

Yapaia muss seine Werte nach Home Assistant melden. Beide Wege funktionieren
und erzeugen **dieselben** Entity-IDs — in der Add-on-Konfiguration unter
**Home Assistant** entweder „Werte direkt melden" (`ha_internal`) oder „Werte
über MQTT melden". Diese Datei braucht keine Änderung, egal welchen Sie nutzen.

### Panel-Blöcke für gängige Boards

Nur der `display:`-Abschnitt (und die Pins) ändert sich. Die Zeichenroutine
rechnet in Anteilen der Displaygröße und kommt mit allen unten zurecht.

| Board | Auflösung | `platform:` / `model:` | Anmerkung |
|---|---|---|---|
| Generisches ST7789 an SPI | 240 × 320 | `ili9xxx` / `ST7789V` | so ausgeliefert |
| Waveshare ESP32-S3 Touch LCD 1.28 | 240 × 240 | `ili9xxx` / `GC9A01A` | rund — der Pfeil sitzt links, planen Sie den Rand ein |
| LilyGO T-Display-S3 | 170 × 320 | `ili9xxx` / `ST7789V`, 8-bit parallel | `rotation: 90` gibt 320 × 170 |
| Guition JC3248W535 | 320 × 480 | `qspi_dbi` / `AXS15231` | braucht den QSPI-Bus statt `spi:` |
| Sunton ESP32-8048S043 | 800 × 480 | `rpi_dpi_rgb` | RGB-Panel, eigener Pin-Block |

Die genauen Pins stehen beim Hersteller; ESPHome hat für die meisten dieser
Boards fertige Beispiele. Sagen Sie mir, welches es geworden ist, dann trage
ich den Block passend ein.

### Helligkeit bei Nacht

Die Hintergrundbeleuchtung ist als Licht ausgeführt (`light.helligkeit`), also
von Home Assistant dimmbar. Im Fahrerhaus ist ein Display auf voller
Helligkeit nachts blendend.

Naheliegend ist, sie an Yapaias Hell/Dunkel-Umschaltung zu hängen — eine
Automation auf `sun.sun` oder auf die Add-on-Option **Erscheinungsbild →
Design** (seit 0.8.6). Sagen Sie Bescheid, wenn ich die Automation dazulegen
soll.

---

## Und wenn es doch ein Kartenbild sein soll

Es gibt drei Wege. Der erste ist der einzige, der zur Offline-Idee dieses
Projekts passt.

**1. Der Core zeichnet ein schlichtes Kartenbild selbst.** Er kennt die
Routengeometrie und die Position; daraus ein PNG mit Streckenlinie,
Fahrzeugpunkt und Ziel zu rastern ist überschaubar — keine Kachel, kein
Browser, kein Chromium. Ein neuer Endpunkt, etwa
`GET /api/v1/map/preview.png?w=320&h=240`, den `online_image` alle paar
Sekunden holt. Das bliebe vollständig offline. **Das ist der Weg, den ich
empfehlen würde**, wenn Sie das Kartenbild wirklich wollen — es ist
überschaubare Arbeit im Core, und ich würde es auf Zuruf bauen.

**2. Ein Kopfloser Browser macht Bildschirmfotos.** Technisch möglich
(Playwright und Chromium laufen in der CI dieses Projekts), aber Chromium
wiegt einige hundert Megabyte im Add-on-Image und belegt dauerhaft
Arbeitsspeicher auf der HAOS-VM — für ein Bild von 320 × 240 Bildpunkten ein
schlechtes Geschäft.

**3. Ein Kartendienst aus dem Netz** (statische Karten von Mapbox, Geoapify
und ähnlichen). Am schnellsten gemacht — und der einzige Weg, der im Funkloch
nicht mehr funktioniert. In einem Wohnmobil ist das genau dort, wo Navigation
am wichtigsten ist.

Zu bedenken bleibt in allen drei Fällen: `online_image` **braucht PSRAM** und
holt das Bild in einem Rutsch. Eine Karte, die bei Tempo 100 flüssig mitläuft,
wird daraus nicht — eher eine Übersichtsanzeige, die sich alle paar Sekunden
auffrischt.

---

## Prüfen

```bash
node esphome/test/run.mjs
```

Die Zeichenroutine ist gewöhnliches C++. `test/zeichenpruefung.cpp` bildet die
ESPHome-Zeichen-API mit denselben Signaturen nach, führt die Routine gegen
erfundene Fahrsituationen aus und prüft, was dabei herauskommt: **welcher**
Pfeil, **wohin** er zeigt, welche Texte erscheinen — und vor allem, welche
nicht erscheinen, wenn ein Wert unbekannt ist. Gebraucht wird nur `g++`,
ESPHome nicht. Der Lauf hängt in der CI an den Quality Checks.

Der Grund für den Aufwand: eine ESPHome-Konfiguration wird sonst erst auf dem
Gerät übersetzt. Beim Schreiben dieser Datei hat der Prüflauf zwei echte
Fehler gefunden — `id(...)` liefert das Objekt und keinen Zeiger (hätte gar
nicht übersetzt), und der Manöverpfeil lief auf schmalen Hochformat-Panels aus
dem Bild.

### Was er nicht prüft

Er misst **Ankerpunkte**, nicht die tatsächliche Breite gesetzter Glyphen — er
kann also nicht sehen, ob ein langer Straßenname rechts aus dem Bild läuft.
Unter etwa 240 Bildpunkten Breite ist die Aufteilung ohnehin eng; dort lohnt
ein Blick aufs echte Gerät. Und er ersetzt **`esphome config`** nicht: dass die
Konfiguration als Ganzes gültig ist und das Panel richtig angesprochen wird,
zeigt erst der echte Übersetzungslauf.
