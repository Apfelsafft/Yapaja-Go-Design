# Yapaia Go auf dem ESP32-2424S012

`yapaja-nav-display.yaml` macht aus dem runden 1,28-Zoll-Modul ein
Navigationsinstrument fürs Armaturenbrett: nächstes Manöver mit Pfeil und
Entfernung, Tempo gegen Tempolimit, Ankunftszeit.

## Das Board — und warum das wichtig ist

Der **ESP32-2424S012** trägt einen **ESP32-C3**, keinen S3. Das ist kein
Namensdetail:

| | |
|---|---|
| Chip | ESP32-C3 (RISC-V, Einkern) |
| Arbeitsspeicher | 400 KB SRAM, **kein PSRAM** |
| Anzeige | 1,28″ **rund**, 240 × 240, GC9A01A an SPI |
| Touch | CST816 an I²C (hier nicht benutzt) |

Zwei Folgen davon stehen unten: `online_image` scheidet ohne PSRAM ohnehin
aus, und die Aufteilung muss im **Kreis** bleiben.

GC9A01A ist in ESPHome offiziell enthalten (`ili9xxx`, Modell `GC9A01A`).
Viele Forenbeiträge behaupten noch, man brauche eine externe Komponente — das
stimmt seit einigen Versionen nicht mehr.

**Der häufigste Stolperstein bei diesem Board:** kein `reset_pin` angeben. Der
Reset des Panels ist nicht auf einen GPIO geführt; wer einen einträgt, bekommt
ein schwarzes Display.

---

## Zuerst das Unangenehme: die Karte geht nicht

Gefragt war, **unsere Karte** auf dem Display anzuzeigen. Das geht nicht, und
zwar nicht „mit Aufwand", sondern gar nicht:

- Yapaias Karte ist **MapLibre**: Vektorkacheln (PMTiles), die ein Browser per
  **WebGL** zeichnet. Ein ESP32 hat keinen Browser.
- ESPHome hat **keinen Kartenrenderer** und keinen Weg, eine Lovelace-Karte
  oder irgendeine Webansicht auf ein Display zu spiegeln. Ein Lovelace-Dashboard
  ist eine Webseite; ESPHome zeichnet Grundformen, Text und Bilder.

**Bilder** kann ESPHome sehr wohl anzeigen — `online_image` holt PNG oder JPEG
über HTTP. Es fehlt nur die Quelle: der Yapaia-Core hat keinen Endpunkt, der
die Karte als Rasterbild ausliefert. Unten steht, was dafür nötig wäre.

Auf diesem Board scheitert es sogar zweimal: **`online_image` braucht PSRAM**,
und der ESP32-C3 hat keines.

Für ein Display dieser Größe ist das ohnehin die zweite Wahl. Eine Karte auf
240 runden Bildpunkten, aus zwei Metern Entfernung im fahrenden Fahrzeug
gesehen, sagt weniger als ein großer Pfeil und eine große Zahl. Genau die
zeigt diese Datei.

---

## Was auf dem Display steht

```
        ╭───────────────────╮
      ╱   Links abbiegen auf  ╲      ← Anweisung, gekürzt
     │          ┌─┐            │
     │       ┌──┘ │            │     ← Manöverpfeil
     │       └────┘            │
     │        1,2 km           │     ← Entfernung, groß
      ╲   87    ⬤80    16:32  ╱      ← Tempo · Limit · Ankunft
        ╰───────────────────╯
```

Die Aufteilung rechnet mit der **Halbbreite auf Höhe y**, nicht mit der
Bildbreite: auf einem runden Glas sind die Ecken nicht da, und was dort
gezeichnet wird, ist weg, ohne dass am Gerät etwas darauf hindeutet. Für ein
eckiges Panel `rund: "false"` setzen, dann wird die volle Breite genutzt.

**Die Reststrecke fehlt bewusst.** Auf 240 runden Bildpunkten ist kein Platz
für ein fünftes Feld, und von den fünf ist sie das entbehrlichste — sie steht
im Lovelace-Dashboard.

Im Einzelnen:

| Was | Woher | Besonderheit |
|---|---|---|
| Manöverpfeil | Attribut `type` von `sensor.yapaja_instruction` | gezeichnet, keine Symbolschrift |
| Entfernung zum Manöver | `sensor.yapaja_instruction_distance` | unter 1 km in Metern, auf 10 m gerundet |
| Anweisungstext | `sensor.yapaja_instruction` | bereits auf Deutsch, bei Überlänge gekürzt |
| Tempo | `sensor.yapaja_speed` | rot, wenn `binary_sensor.yapaja_speeding` an ist |
| Tempolimit | `sensor.yapaja_speed_limit` | als rundes Schild — **nur**, wenn die Karte eines kennt |
| Ankunftszeit | `sensor.yapaja_eta` | aus UTC in Ihre Zeitzone **gerechnet** |
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
   selben Ordner) gehören drei Zeilen:
   ```yaml
   wifi_ssid: "..."
   wifi_password: "..."
   navi__api_key: "..."      # 32 Byte base64, der API-Schlüssel des Geräts
   ```

   Den Wert für `navi__api_key` erzeugt der ESPHome Device Builder beim
   Anlegen des Geräts. Er steht dann in dessen Gerätedatei unter
   `api: → encryption: → key:` und lässt sich von dort in die `secrets.yaml`
   übernehmen.

   > **Warum nicht einfach eingetragen lassen?** Ein Geräteschlüssel gehört in
   > die Installation und nicht in den Quelltext — hier stünde er im
   > Repository, wäre auf jedem Gerät derselbe und läge offen.

   Heißt Ihr Gerät anders als `navi`, wählen Sie einen anderen Namen und
   tragen ihn in der `key:`-Zeile ein. Eine Prüfung hält fest, dass jeder
   `!secret`-Verweis der Konfiguration auch hier in der Anleitung steht —
   genau das ist bis 0.13.1 auseinandergelaufen:

   > Damals verwies die Datei auf `yapaja_display_api_key` und
   > `yapaja_display_ota_password`. Beide gab es nirgends; wer die Datei
   > übernahm, bekam Verweise ins Leere — bemerkt erst beim Übersetzen auf
   > dem eigenen Gerät.

   **`ota:` braucht nichts.** Der Device Builder vergibt kein OTA-Passwort,
   und OTA ist bereits durch den API-Schlüssel geschützt.
2. **Zeitzone und Pins** oben in `substitutions` eintragen.
2b. **Digitale Wasserwaage** (optional). Unter 2 km/h wechselt die Anzeige auf
   eine runde Libelle — beim Parken die einzige Frage, die zählt. Dafür
   braucht es zwei Neigungssensoren in Grad (etwa ein MPU6050). Alles dazu
   steht in `substitutions`:

   | Einstellung | Bedeutung |
   | --- | --- |
   | `entity_neigung_lr` | Entität für links/rechts |
   | `entity_neigung_vh` | Entität für vorne/hinten |
   | `wasserwaage_ab_kmh` | Ab welchem Tempo sie erscheint (Vorgabe 2) |
   | `wasserwaage_gerade_grad` | Ab wann „steht gerade" (Vorgabe 0,5°) |
   | `wasserwaage_bereich_grad` | Vollausschlag am Rand (Vorgabe 5°) |
   | `neigung_lr_vorzeichen` | `1` oder `-1` |
   | `neigung_vh_vorzeichen` | `1` oder `-1` |

   **Die Vorzeichen müssen Sie einmal prüfen.** Welches Vorzeichen welche
   Seite meint, hängt davon ab, wie der Sensor eingebaut ist — das kann diese
   Datei nicht wissen, und Raten wäre hier besonders ärgerlich: eine
   spiegelverkehrte Wasserwaage schickt den Auffahrkeil unter das falsche Rad.

   So geht es: eine Seite anheben (oder sich auf eine Seite stellen). Wandert
   die Blase zur **angehobenen** Seite, stimmt es — wie bei einer echten
   Libelle. Wandert sie zur anderen, das jeweilige Vorzeichen auf `-1` setzen.

   Fehlen die Neigungswerte, zeigt das Gerät **„Keine Neigungswerte"** statt
   einer Blase in der Mitte. Eine mittige Blase hieße „steht gerade" — und das
   wäre ausgerechnet die beruhigende Behauptung, bei der niemand nachsieht.
3. Für dieses Board ist nichts weiter zu tun. Für ein anderes den
   `display:`-Block und `rund` anpassen — siehe unten.
4. Übersetzen und flashen: in Home Assistant über das ESPHome-Add-on, oder
   `esphome run esphome/yapaja-nav-display.yaml`.

Yapaia muss seine Werte nach Home Assistant melden. Beide Wege funktionieren
und erzeugen **dieselben** Entity-IDs — in der Add-on-Konfiguration unter
**Home Assistant** entweder „Werte direkt melden" (`ha_internal`) oder „Werte
über MQTT melden". Diese Datei braucht keine Änderung, egal welchen Sie nutzen.

### Die Pins dieses Boards

| Zweck | GPIO |
|---|---|
| SPI CLK | 6 |
| SPI MOSI | 7 |
| Display CS | 10 |
| Display DC | 2 |
| Display RESET | **nicht verdrahtet** — keinen angeben |
| Hintergrundbeleuchtung | 3 |
| Touch I²C (SDA / SCL) | 4 / 5 — hier nicht benutzt |

### Für ein anderes Board

Nur der `display:`-Abschnitt, die Pins und `rund` ändern sich. Die
Zeichenroutine rechnet in Anteilen der Displaygröße.

| Board | Auflösung | `platform:` / `model:` | `rund` |
|---|---|---|---|
| Generisches ST7789 an SPI | 240 × 320 | `ili9xxx` / `ST7789V` | `false` |
| LilyGO T-Display-S3 | 170 × 320 | `ili9xxx` / `ST7789V`, 8-bit parallel | `false` |
| Guition JC3248W535 | 320 × 480 | `qspi_dbi` / `AXS15231` | `false` |
| Sunton ESP32-8048S043 | 800 × 480 | `rpi_dpi_rgb` | `false` |

### Der Arbeitsspeicher — und warum hier `8BIT` steht

An dieser Stelle stand bis 0.11.2 der Satz: *„Ein voller Bildpuffer ist
115 KB von 400 KB. Das geht, ist aber neben WLAN und API knapp."*

**Es ging nicht.** Beim ersten Flashen auf echter Hardware:

```
[E][display:016]: Could not allocate buffer for display!
[E][component:204]: display was marked as failed
```

Das Übrige lief weiter — WLAN, API, das ganze Programm. Nur der Bildschirm
blieb schwarz. Die Gefahr war hier beschrieben, und ausgeliefert wurde
trotzdem die riskante Voreinstellung. Ein dokumentierter Fallstrick, in den
man dann selbst hineinlaufen lässt, ist keine Dokumentation.

Nachgerechnet aus ESPHomes Quelltext (`ili9xxx_display.h/.cpp`, `display.py`):

| Einstellung | Bytes je Punkt | Puffer | Farben |
|---|---|---|---|
| ohne Angabe (`BITS_16`) | 2 | **115 200** | 65 536 |
| `color_palette: 8BIT` | 1 | **57 600** | 256 (RGB332) |
| `color_palette: GRAYSCALE` | 1 | 57 600 | 256 Graustufen |

Der C3 hat 400 KB SRAM und **kein PSRAM**. Nach dem Start von WLAN, TCP/IP
und der verschlüsselten API ist der freie Speicher zerstückelt — ein Puffer
braucht aber *einen zusammenhängenden* Block. 115 KB sind dort die Ausnahme.

Die Konfiguration nutzt deshalb **`8BIT`**. Der alte Rat hier lautete
`GRAYSCALE`; das ist bei gleicher Puffergröße die schlechtere Wahl, weil es
zusätzlich die Farbe kostet — und die Tempo-Warnung soll rot sein.

256 Farben genügen dieser Anzeige vollkommen: dunkler Grund, weißer und
gedämpfter Text, ein blauer Pfeil, rot und grün. Farbverläufe, an denen eine
Abstufung auffiele, gibt es nicht.

`esphome/test/puffer.test.ts` rechnet die Größe bei jedem Testlauf nach und
schlägt an, wenn sie über 64 KB steigt.

### Wenn „Kein Wert aus Home Assistant" auf dem Display steht

Das Gerät ist verbunden — es bekommt nur keinen Wert. In ESPHome steht es dann
als **Gerät online** mit IP-Adresse da, und trotzdem zeigt das Display diesen
Satz. Beides stimmt.

Der wahrscheinliche Grund: **Die Entität heißt in Home Assistant anders, als
diese Konfiguration sie sucht.**

Home Assistant vergibt die Entity-ID aus Geräte- *plus* Entitätsnamen, solange
die MQTT-Discovery kein `object_id` mitschickt. Seit Yapaia 0.6.9 schickt sie
eines mit, und dann heißt sie `sensor.yapaja_nav_state`. **Ältere
Installationen behalten ihre einmal vergebene ID** — dort heißt dieselbe
Entität `sensor.yapaia_go_nav_state`. Eine Registrierung benennt nichts um.

(Genau deshalb erzeugt Yapaia sein Lovelace-Dashboard zur Laufzeit, statt es
fertig auszuliefern: es *sieht nach*, wie die Entitäten heißen. Diese Datei
kann das nicht — ESPHome löst die Namen beim Übersetzen auf.)

**So finden Sie es heraus:**

1. Home Assistant → **Entwicklerwerkzeuge → Zustände**
2. Im Filter `yapa` eingeben
3. Dort steht die echte ID, etwa `sensor.yapaia_go_nav_state`

Weicht der Anfang ab, tragen Sie ihn oben in `navi.yaml` unter
`substitutions:` ein und flashen neu:

```yaml
substitutions:
  entity_praefix: sensor.yapaia_go
  entity_praefix_binaer: binary_sensor.yapaia_go
```

**Findet der Filter gar nichts**, liegt es nicht am Namen: dann veröffentlicht
Yapaia die Entitäten noch nicht. Prüfen Sie im Add-on, ob MQTT oder der
HA-interne Kanal eingeschaltet ist.

### Wenn das WLAN nicht zustande kommt

Das ist **kein Fehler dieser Konfiguration**, aber der zweite Stolperstein
beim ersten Einschalten. So sieht es aus:

```
[I][wifi:1486]: - 'MeinNetz' (9E:FA:43:DC:38:E6) ▂▄▆█
[W][wifi_esp32:860]: Disconnected ssid='MeinNetz' reason='Probe Request Unsuccessful'
[W][wifi_esp32:869]: Disconnected ssid='MeinNetz' reason='Unspecified'
```

Zu lesen ist daraus zweierlei, und beides ist eine Tatsache und keine
Vermutung:

* Der Name **stimmt** und das Netz ist auf 2,4 GHz — sonst stünde es nicht in
  der Liste, und der Balken zeigt guten Empfang.
* Es scheitert an der **Anmeldung**, nicht am Finden.

Häufige Ursachen, in der Reihenfolge, in der sich das prüfen lässt:

1. **Falsches Passwort** in `secrets.yaml` unter `wifi_password`. Der
   häufigste Fall, und der am schnellsten ausgeschlossene.
2. **WPA3 ausschließlich.** Der C3 kann WPA3, aber manche Router verlangen
   zusätzlich „Protected Management Frames" zwingend. Stellen Sie den Router
   testweise auf **WPA2/WPA3 gemischt**.
3. **Gastnetz oder Mesh-Knoten.** Beginnt die zweite Stelle der BSSID mit
   `2`, `6`, `A` oder `E` (im Beispiel oben `9E:…`), ist es eine *virtuelle*
   Zugangskennung — typisch für Gastnetze und Mesh. Dort ist oft die
   Client-Trennung aktiv, und das Gerät käme ohnehin nicht an Home Assistant
   heran. Nehmen Sie das normale Netz.
4. **MAC-Filter** im Router.

Hilft nichts davon, probieren Sie `fast_connect: true` im `wifi:`-Block: das
überspringt den Suchlauf und meldet sich direkt an, was bei manchen
Mesh-Aufbauten den Unterschied macht.

Solange kein WLAN da ist, öffnet das Gerät nach kurzer Zeit den eigenen
Zugangspunkt **„Yapaia Navi Fallback"** — darüber lässt es sich im Browser
neu einrichten, ohne es wieder anzustöpseln.

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
`GET /api/v1/map/preview.png?w=240&h=240`, den `online_image` alle paar
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

In allen drei Fällen gilt aber: `online_image` **braucht PSRAM**, und der
ESP32-C3 auf diesem Board hat keines. Für ein Kartenbild bräuchte es also
zusätzlich ein anderes Gerät — ein S3-Modul mit PSRAM. Und selbst dort wird
daraus keine Karte, die bei Tempo 100 flüssig mitläuft, sondern eine
Übersichtsanzeige, die sich alle paar Sekunden auffrischt.

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
