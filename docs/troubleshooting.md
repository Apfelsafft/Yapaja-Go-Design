# Troubleshooting

Dieses Dokument beantwortet die Frage „Was tue ich, wenn …?" für **alle**
sicherheitsrelevanten (🔴) und funktionskritischen (🟠) Szenarien aus der
Wargame-Analyse (`docs/08-wargame.md`). Für jeden Fall: **Symptom** (was du
siehst) → **Ursache** (warum das passiert) → **Lösung** (was du tust).

**Herkunft & Aktualität:** Diese Seite ist die nutzerorientierte Übersetzung
von `docs/08-wargame.md` — dort steht die technische Analyse (Auslöser,
Erkennung, vorbereitete Lösung, Testabdeckung) für Entwickler, hier steht
die Handlungsanweisung für Anwender. `scripts/wargame-coverage.mjs --check`
läuft in CI und stellt sicher, dass **jeder** 🔴/🟠-Fall aus der Wargame-Liste
hier einen eigenen Abschnitt hat — leitet die Pflichtliste bei jedem Lauf
frisch aus `docs/08-wargame.md` ab, keine hartkodierte Liste. Fällt ein
neuer Fall dort hinein oder wird ein 🟡 zu 🟠 hochgestuft, schlägt die
Prüfung an, bis hier ein Abschnitt ergänzt wurde.

**Nicht hier behandelt:** die 🟡-Komfortfälle (W-04, W-07, W-13, W-17, W-20,
W-21, W-23) sind unangenehm, aber nicht sicherheits- oder
funktionskritisch — Details dazu direkt in `docs/08-wargame.md`.

## Inhalt

| W-ID | Schweregrad | Kurztitel |
|---|---|---|
| [W-01](#w-01--gps-signal-verloren-tunnel-parkhaus-abschattung) | 🟠 | GPS-Signal verloren |
| [W-02](#w-02--positionsmarker-springt-kurz-unrealistisch) | 🟠 | GPS-Sprung / Drift |
| [W-03](#w-03--standortzugriff-nicht-möglich) | 🟠 | Geolocation blockiert |
| [W-05](#w-05--app-berechnet-nach-einer-abzweigung-automatisch-neu) | 🟠 | Falschabbiegung / Umleitung |
| [W-06](#w-06--ha-entitäten-werden-nicht-verfügbar) | 🟠 | MQTT-Broker nicht erreichbar |
| [W-08](#w-08--route-führt-an-einer-zu-engenniedrigen-stelle-vorbei) | 🔴 | OSM-Maßdaten unvollständig |
| [W-09](#w-09--meldung-ziel-liegt-außerhalb-der-installierten-karte) | 🟠 | Ziel außerhalb Kartenregion |
| [W-10](#w-10--add-on-verhält-sich-verdächtig) | 🔴 | Bösartiges Add-on |
| [W-11](#w-11--add-on-ist-nach-einem-update-deaktiviert) | 🟠 | Core-Update bricht Add-on-API |
| [W-12](#w-12--suche-reagiert-nicht-mehrvereinfachte-suche) | 🟠 | Photon sprengt RAM-Budget |
| [W-14](#w-14--app-ruckelt-während-ein-add-on-aktiv-ist) | 🟠 | Add-on überlastet den Mini-PC |
| [W-15](#w-15--app-funktioniert-direkt-aber-nicht-über-ha-ingress) | 🟠 | Ingress-Sub-Pfad bricht Frontend |
| [W-16](#w-16--nach-einem-update-fehlen-kartendaten-oder-einstellungen) | 🔴 | Update zerstört Daten |
| [W-18](#w-18--region-download-wird-sofort-mit-speicherplatz-fehler-abgelehnt) | 🟠 | Disk voll |
| [W-19](#w-19--navigation-scheint-nach-tab-crashneustart-weg-zu-sein) | 🟠 | Tab-Crash / Kiosk-Neustart |
| [W-22](#w-22--anzeige-der-ankunftszeit-wirkt-falsch) | 🟠 | ETA falsch (Zeitzone/DST) |

---

## W-01 — GPS-Signal verloren (Tunnel, Parkhaus, Abschattung)

**Symptom:** Der Positionspunkt wird grau, ein Banner „GPS-Signal verloren"
erscheint; nach ca. 30 s pausiert die Navigation.

**Ursache:** Der GPS-Empfänger liefert länger als 3 Sekunden keinen gültigen
Fix mehr (`gpsd`-Modus < 2 bzw. Browser-Timeout) — typisch in Tunneln,
Parkhäusern oder unter Brücken.

**Lösung:**
1. Kurzzeitig (< 30 s) musst du nichts tun: Die App fährt per
   Koppelnavigation (Dead-Reckoning) mit der letzten bekannten Geschwindigkeit
   weiter, **Ansagen laufen normal weiter** — genau für Tunnelabfahrten gebaut.
2. Hält der Verlust länger an: freie Sicht zum Himmel herstellen, sobald
   möglich (aus Tunnel/Parkhaus heraus).
3. Prüfe, ob eine **externe** USB-GPS-Antenne mit Fensterhalterung verbaut
   ist statt einer im Gehäuse verbauten Antenne — die häufigste Ursache für
   dauerhaft schlechten Empfang im Fahrzeug.
4. In den Einstellungen → Position → Quelle prüfen, ob wirklich `gpsd`
   (die USB-Antenne) aktiv ist und nicht versehentlich `browser`.
5. Sobald wieder ein Fix vorliegt, läuft die Navigation automatisch weiter —
   kein manueller Neustart nötig.

---

## W-02 — Positionsmarker springt kurz unrealistisch

**Symptom:** Der Positionspunkt „springt" für einen Moment an eine
unplausible Stelle (z. B. in einer Häuserschlucht), ohne dass die App neu
routet.

**Ursache:** Mehrwegeausbreitung (Multipath) an Gebäudefassaden erzeugt
einzelne GPS-Ausreißer (rechnerisch > 300 m/s Geschwindigkeit oder
Genauigkeit > 100 m).

**Lösung:** In der Regel ist kein Eingriff nötig — die App verwirft bis zu
drei aufeinanderfolgende Ausreißer automatisch und löst wegen eines
einzelnen Sprungs **kein** Rerouting aus (das braucht 5 s bestätigte
Abweichung). Hält der „Sprung" länger an (mehr als 3 Fixes in Folge, z. B.
nach einer Fährüberfahrt), übernimmt die App ihn bewusst als neue,
plausible Position — das ist Absicht, kein Fehler. Bei dauerhaft
schwankender Genauigkeit: Antennenposition/-sicht zum Himmel prüfen.

---

## W-03 — „Standortzugriff nicht möglich"

**Symptom:** Dialog/Hinweis, dass der Standortzugriff nicht möglich ist,
obwohl ein GPS-Empfänger vorhanden ist; keine Positionsanzeige.

**Ursache:** Browser verlangen für die Geolocation-API einen „Secure
Context" (HTTPS oder `localhost`). Ein Zugriff über eine reine
HTTP-LAN-Adresse (z. B. `http://192.168.1.50:8080`) wird deshalb blockiert.

**Lösung:** Die App erkennt diesen Fall **bevor** sie überhaupt fragt, und
schlägt in genau dieser Reihenfolge vor:
1. **Empfohlen im Fahrzeug:** Positionsquelle in den Einstellungen auf
   `gpsd` (die USB-GPS-Antenne) umstellen — funktioniert unabhängig vom
   Browser-Sicherheitskontext.
2. Über den **HA-Ingress-Link** zugreifen (Home Assistant → Add-ons →
   Yapaja Go → „Weboberfläche öffnen") — der ist immer HTTPS-abgesichert.
3. Zugriff über `http://localhost:8080` (nicht die LAN-IP) funktioniert
   ausnahmsweise auch ohne HTTPS, weil Browser `localhost` als sicher
   einstufen.

---

## W-05 — App berechnet nach einer Abzweigung automatisch neu

**Symptom:** Nach einer falschen/bewussten Abweichung von der Route (z. B.
wegen einer Umleitung) berechnet die App ohne Rückfrage eine neue Route.

**Ursache:** Erkannte dauerhafte Abweichung von der geplanten Route
(Map-Matching-Distanz > 30 m über mindestens 5 s **und** passende
Fahrtrichtung) — genau das Verhalten, das bei einer Umleitung oder Sperrung
erwartet wird.

**Lösung:** Kein Eingriff nötig — das Rerouting läuft automatisch und ist
in der Regel in unter 3 Sekunden abgeschlossen, mit sofort neuen
Anweisungen. Wird derselbe Punkt **dreimal in 5 Minuten** umfahren (z. B.
weil eine Baustelle den einzigen erlaubten Weg blockiert), bietet die App
„Abschnitt dauerhaft meiden?" an — bestätigen, um die Stelle künftig
vorsorglich zu umfahren.

---

## W-06 — HA-Entitäten werden „nicht verfügbar"

**Symptom:** Home-Assistant-Entitäten von Yapaja Go zeigen „nicht
verfügbar"; die App zeigt einen MQTT-Health-Badge als „down"/„degraded" an.

**Ursache:** Der MQTT-Broker (meist das Mosquitto-Add-on) ist gerade nicht
erreichbar — häufig während eines HA-Updates/-Neustarts.

**Lösung:** **Die App selbst bleibt voll funktionsfähig** — MQTT ist
bewusst nie im Kernpfad der Navigation. Broker neu starten (Home Assistant
→ Add-ons → Mosquitto → Neu starten); Yapaja Go verbindet sich automatisch
mit exponentiellem Backoff neu und veröffentlicht alle Zustände (Discovery
+ aktuelle Werte) erneut, sobald der Broker wieder da ist. Kein
Datenverlust, kein manuelles Eingreifen an der App nötig.

---

## W-08 — Route führt an einer zu engen/niedrigen Stelle vorbei 🔴

**Symptom:** Die berechnete Route führt an einer Stelle vorbei, die dem
eingestellten Fahrzeugprofil eigentlich physisch nicht erlaubt sein sollte
(z. B. eine niedrige Unterführung bei einem hohen Fahrzeug) — **oder** die
App zeigt das Banner „Maßangaben auf Teilstrecke unvollständig".

**Ursache:** Nicht jede reale Höhen-, Gewichts- oder Breitenbeschränkung ist
in den zugrunde liegenden OpenStreetMap-Daten erfasst. Yapaja Go kann nur
meiden, was in den Kartendaten steht — das ist eine physische Grenze der
Datenquelle, kein Software-Fehler, und wird bewusst offen kommuniziert statt
verschwiegen.

**Lösung:**
1. **Das Banner „Maßangaben unvollständig" immer ernst nehmen** — an
   solchen Streckenabschnitten selbst auf Beschilderung, Schranken und
   Höhenwarner achten. Verlasse dich dort nicht blind auf die Route.
2. Den Disclaimer bei der Ersteinrichtung und den dezenten Warnhinweis bei
   Profilen über 2,7 m Höhe lesen — er beschreibt genau diesen Fall.
3. Bekannte, fehlende Beschränkungen kannst du selbst in OpenStreetMap
   nachtragen (`maxheight`, `maxweight`, `maxwidth`-Tags auf
   openstreetmap.org) — das kommt allen Nutzern der Karte zugute, nicht nur
   dir.
4. Ein kuratiertes Community-Gefahrstellen-Add-on (bekannte
   Problemstellen als Layer) ist als Erweiterung vorgesehen.
5. **Grundsatz:** Eigene Ortskenntnis und tatsächlich vorhandene
   Beschilderung haben immer Vorrang vor der Routenempfehlung.

---

## W-09 — Meldung „Ziel liegt außerhalb der installierten Karte"

**Symptom:** Statt einer Route erscheint die Meldung, dass das Ziel
außerhalb der installierten Kartenregion liegt.

**Ursache:** Die Zielkoordinate liegt außerhalb der heruntergeladenen
Kartenregion(en), oder es fehlt ein zusammenhängender Extrakt für eine
grenzüberschreitende Route.

**Lösung:** Der Meldung folgen — sie verlinkt direkt zur Regionsverwaltung
(Einstellungen → Kartenregionen). Dort die fehlende Region herunterladen.
Bei Routen über mehrere Länder/Regionen: sicherstellen, dass **alle**
benötigten Regionen installiert sind und lückenlos aneinander angrenzen
(die Regionsverwaltung zeigt die Abdeckung auf der Karte an).

---

## W-10 — Add-on verhält sich verdächtig 🔴

**Symptom:** Ein installiertes Add-on versucht scheinbar, auf die Route
zuzugreifen, Daten abzugreifen, oder verhält sich anders als erwartet
(unerwarteter Netzwerkzugriff, ungewöhnliche Berechtigungsanfragen).

**Ursache:** Auch geprüfte Add-ons laufen technisch als nicht
vertrauenswürdiger Fremdcode — deshalb läuft jedes Add-on standardmäßig in
einer Sandbox mit ausschließlich den beim Installieren sichtbar bestätigten
Berechtigungen (Scoped Tokens, iframe-Sandbox, Default-Deny für alle
API-Aufrufe).

**Lösung:**
1. **Sofortmaßnahme:** Add-on deaktivieren — Store → betroffenes Add-on →
   „Deaktivieren". Der Kill-Switch wirkt sofort.
2. Unter Einstellungen → Sicherheit → Ereignisse nachsehen, welche
   Zugriffsversuche protokolliert und blockiert wurden — jeder verbotene
   Versuch (fremde API-Aufrufe, DOM-Zugriff, undeklarierte Hosts) wird
   automatisch geblockt **und** geloggt, nichts kommt unbemerkt durch.
3. Für die Zukunft: bevorzugt Add-ons aus der offiziellen Registry
   installieren (durchlaufen eine Review-Checkliste) und beim Installieren
   die angezeigten Berechtigungen tatsächlich lesen, bevor du bestätigst.

---

## W-11 — Add-on ist nach einem Update deaktiviert

**Symptom:** Nach einem App-/Core-Update erscheint ein Add-on im Store als
„deaktiviert" mit einem Kompatibilitätshinweis, statt normal zu laden.

**Ursache:** Das Add-on deklariert in seinem Manifest eine `core_api`-
Versionsspanne, die mit der neuen Core-Version nicht mehr übereinstimmt
(die Add-on-API hat sich in einer Weise geändert, die dieses Add-on nicht
mehr unterstützt).

**Lösung:** Das ist ein bewusst sicherer Fehlerpfad — kein Absturz, kein
Datenverlust, das Add-on wird einfach nicht geladen. Im Store prüfen, ob
eine aktualisierte Version des Add-ons verfügbar ist (der Add-on-Autor muss
`core_api` an die neue Version anpassen). Bis dahin bleibt das Add-on
deaktiviert; der Rest der App funktioniert unverändert weiter.

---

## W-12 — Suche reagiert nicht mehr/„vereinfachte Suche"

**Symptom:** Die Ortssuche reagiert nicht mehr oder wird sehr langsam; die
App zeigt einen Hinweis „vereinfachte Suche"; im Systemprotokoll finden
sich OOM-Kills (Out-of-Memory).

**Ursache:** Photon (der Java-basierte Volltextsuchindex) braucht auf sehr
kleinen Geräten (z. B. einer 4-GB-Proxmox-LXC) mehr Arbeitsspeicher, als
verfügbar ist.

**Lösung:**
- **HA-Add-on:** Option `photon: false` setzen (Add-on-Konfiguration) oder
  den JVM-Speicher über die Add-on-Optionen reduzieren.
- **Compose/Proxmox:** in der `.env`-Datei `PHOTON_XMX` verkleinern, z. B.
  auf `512m` oder `256m`, und `docker compose up -d photon` neu starten.

In beiden Fällen wechselt die App automatisch auf den deutlich schlankeren
SQLite-FTS5-Suchindex (Anzeige „vereinfachte Suche") — Orte und Straßen
bleiben durchsuchbar, nur mit etwas geringerer Toleranz bei Tippfehlern.

---

## W-14 — App ruckelt, während ein Add-on aktiv ist

**Symptom:** Die App reagiert spürbar langsamer, während ein bestimmtes
Add-on aktiv ist; ein Hinweis „Add-on gedrosselt" erscheint.

**Ursache:** Ein Add-on (z. B. eine rechenintensive Bilderkennung) nutzt
dauerhaft zu viel CPU (mehr als 25 % über 60 Sekunden) auf demselben
Mini-PC, auf dem auch die Navigation läuft.

**Lösung:** Die App drosselt ein solches Add-on bereits automatisch und
warnt sichtbar; nach wiederholten Abstürzen (mehr als 5) wird es sogar
automatisch dauerhaft deaktiviert — Navigation und Kartendarstellung bleiben
davon unberührt. Zusätzlich kannst du das betroffene Add-on manuell
deaktivieren (Store → Add-on → „Deaktivieren") oder, falls angeboten, die
`runtime: external`-Variante wählen (läuft dann auf einem eigenen
Gerät/Container statt auf dem Navi-Mini-PC).

---

## W-15 — App funktioniert direkt, aber nicht über HA-Ingress

**Symptom:** Yapaja Go funktioniert unter der direkten Adresse
(`http://<Geräte-IP>:8080`), aber nicht über den Ingress-Link in Home
Assistant (weiße Seite, fehlende Kartenkacheln, hängender Ladebalken).

**Ursache:** Ein klassischer HA-Add-on-Fehler: Ressourcen (Skripte, Karten-
Kacheln, WebSocket-Verbindung) werden mit absoluten statt relativen Pfaden
angefragt und landen dadurch am falschen Ingress-Sub-Pfad
(`/hassio_ingress/<token>/…`).

**Lösung:**
1. Add-on einmal neu starten: Home Assistant → Add-ons → Yapaja Go → Neu
   starten.
2. Danach den Ingress-Link erneut öffnen; bei Bedarf den Browser-Cache der
   Seite leeren (`Strg`+`Shift`+`R` bzw. `Cmd`+`Shift`+`R`).
3. Bleibt das Problem bestehen: Add-on-Version prüfen. Dieser Fehlerfall
   ist über einen eigenen End-to-End-Pflichttest (Flow 9) seit dem ersten
   Kartenrelease abgesichert — ein Wiederauftreten ist ein Regressions-Bug
   und sollte gemeldet werden, nicht als „normal" hingenommen werden.

---

## W-16 — Nach einem Update fehlen Kartendaten oder Einstellungen 🔴

**Symptom:** Nach einem App- oder Add-on-Update sind Kartendaten,
Favoriten oder Einstellungen verschwunden, oder die App startet mit einer
leeren Konfiguration.

**Ursache:** Dieser Fall sollte durch die Architektur ausgeschlossen sein —
alle Nutzdaten liegen bewusst **außerhalb** des Containers (HA-Add-on:
`/share/yapaja`; Compose: eigenständiges Docker-Volume), und jede
SQLite-Migration legt vorher automatisch eine Sicherungsdatei an. Tritt der
Fall dennoch auf, deutet das auf einen Fehler in der Update-/Migrationslogik
hin.

**Lösung:**
1. **Vorbeugend, vor jedem größeren Update:** Backup des Datenverzeichnisses
   anlegen (siehe `docs/installation.md` → Abschnitt „Backup vor einem
   Update").
2. Im Datenverzeichnis nach automatisch angelegten Sicherungsdateien
   suchen (Muster `*.bak` / `*.sqlite.bak`, angelegt unmittelbar vor jeder
   Schema-Migration) und bei Bedarf zurückspielen.
3. Kartendaten (Tiles/Valhalla-Graph) liegen in einem separaten
   Unterverzeichnis und werden von App-Updates nie verändert — dort ist ein
   Verlust besonders unerwartet und sollte gesondert gemeldet werden.
4. **Nicht** einfach neu installieren, ohne vorher das bestehende
   Datenverzeichnis zu sichern. Diesen Fall bitte als Fehler melden — er
   ist eines der Release-Gate-Kriterien vor jedem Versions-Tag
   (`docs/07-testing-qa.md` §7).

---

## W-18 — Region-Download wird sofort mit „Speicherplatz"-Fehler abgelehnt

**Symptom:** Der Download einer Kartenregion startet gar nicht erst,
sondern wird sofort mit einer Meldung „Nicht genug Speicherplatz"
abgelehnt.

**Ursache:** Der anschließende Kartengraph-Bau (Valhalla) braucht
vorübergehend etwa das 2,5-Fache der reinen PBF-Downloadgröße an freiem
Speicherplatz. Die App prüft das **vorab** und lehnt lieber sofort ab, als
eine „halb" installierte, kaputte Region zu hinterlassen.

**Lösung:** Die Fehlermeldung nennt exakt „benötigt vs. frei" — daran
lässt sich ablesen, wie viel zusätzlicher Platz fehlt.
- Nicht mehr benötigte Regionen löschen (Regionsverwaltung).
- Oder das Datenverzeichnis auf einen größeren Datenträger verlegen:
  Compose → Volume-Pfad in `.env` anpassen; Proxmox-LXC → Datenträger
  (`pct resize` bzw. über die Proxmox-Oberfläche) vergrößern.

Danach den Download erneut starten.

---

## W-19 — Navigation scheint nach Tab-Crash/Neustart weg zu sein

**Symptom:** Der Browser-Tab stürzt ab oder das Kiosk-Gerät startet mitten
in einer laufenden Navigation neu; nach dem Neuladen scheint die Route
zunächst verschwunden.

**Ursache:** Das sollte sich von selbst beheben — der eigentliche
Navigationszustand lebt bewusst im Core-Server, **nicht** im Browser-Tab.

**Lösung:** Kein Eingriff nötig — kurz warten (in der Regel wenige
Sekunden) oder die Seite neu laden. Die App verbindet sich neu mit dem
Core und stellt die laufende Navigation automatisch wieder her (Route,
nächstes Manöver, ETA, Fahrmodus). Für den Kiosk-Dauerbetrieb: die
Autostart-Konfiguration prüfen (siehe `docs/kiosk-setup.md`) — nach einem
Geräte-Neustart sollte der Browser automatisch wieder auf die App-URL
zeigen, ohne dass jemand manuell eingreifen muss.

---

## W-22 — Anzeige der Ankunftszeit wirkt falsch

**Symptom:** Die angezeigte Ankunftszeit (ETA) springt beim Überqueren
einer Zeitzonengrenze oder rund um die Zeitumstellung (Sommer-/Winterzeit)
um eine Stunde, oder wirkt offensichtlich falsch.

**Ursache:** In aller Regel ein Anzeigeproblem, nicht die eigentliche
Berechnung — der Core rechnet grundsätzlich in UTC, dein Gerät (Browser
bzw. Home-Assistant-Instanz) formatiert die Uhrzeit lokal.

**Lösung:** Zuerst prüfen, ob die Zeitzoneneinstellung des anzeigenden
Geräts korrekt ist — das ist die mit Abstand häufigste Ursache. Die
verbleibende Fahrzeit (die Minuten- bzw. Stundenangabe „noch X Min.")
bleibt davon unabhängig **immer** korrekt, auch wenn die absolute Uhrzeit
kurzzeitig irritierend wirkt. Bleibt die Anzeige trotz korrekt eingestellter
Geräte-Zeitzone dauerhaft falsch: bitte als Fehler melden.

---

## I-01 — Die Add-on-Installation bricht ab

Kein Wargame-Fall, sondern zwei konkrete Fehlermeldungen aus dem
Supervisor-Protokoll, die beim Einrichten auftreten können. Beide sind am
2026-09-02 auf einer echten HAOS-Instanz aufgetreten.

### „403 denied" beim Herunterladen des Images

```
Failed to fetch manifest for ghcr.io/yapaja/yapaja-go-amd64:0.1.0 - 401
Can't install ghcr.io/yapaja/yapaja-go-amd64:0.1.0:
[403] Head "https://ghcr.io/v2/yapaja/yapaja-go-amd64/manifests/0.1.0": denied
```

**Ursache (behoben):** `yapaja_go/config.yaml` deklarierte einen
`image:`-Schlüssel. Steht dort ein `image:`, **zieht** der Supervisor dieses
Image aus einer Registry und baut nichts selbst. Das genannte Image hat aber
nie existiert — `yapaja` ist nicht einmal der Namensraum dieses Repositories,
und kein Workflow hat das Add-on-Image je gebaut oder veröffentlicht.

**Lösung:** Der Schlüssel ist entfernt. Der Supervisor baut das Add-on jetzt
**auf dem Gerät** aus dem `Dockerfile` — was `DOCS.md` und
[Installations-Guide §A](installation.md#a-home-assistant-add-on) Schritt 2
ohnehin immer beschrieben haben. Rechne mit **10–30 Minuten**; auf einem
Raspberry Pi länger. Das ist normal und kein Hänger.

Tritt der Fehler weiterhin auf: **⋮ → Nach Updates suchen** im Add-on-Store,
damit der Supervisor die aktuelle `config.yaml` liest. Ein zuvor
fehlgeschlagenes Add-on muss unter Umständen einmal entfernt und neu
hinzugefügt werden.

### „base name (${BUILD_FROM}) should not be blank"

```
ERROR: failed to build: failed to solve:
base name (${BUILD_FROM}) should not be blank
```

**Ursache (behoben):** Docker kennt **zwei getrennte ARG-Gültigkeitsbereiche**.
Alles vor dem ersten `FROM` ist *global* und steht jeder `FROM`-Zeile zur
Verfügung; alles danach gehört zu genau der Stufe, in der es steht. Ein `ARG`,
das in einer `FROM`-Zeile verwendet wird, muss also **global** deklariert sein.

`ARG BUILD_FROM` stand unmittelbar vor der letzten `FROM`-Zeile — aber nach
zwei vorherigen Build-Stufen, damit im Gültigkeitsbereich von niemandem. Der
Supervisor übergab `--build-arg BUILD_FROM=…` völlig korrekt; der Wert kam nur
nie an, und `FROM ${BUILD_FROM}` expandierte zu nichts.

**Lösung:** `ARG BUILD_FROM` steht jetzt vor dem ersten `FROM`, mit dem
Valhalla-Basisimage als Default. Der Default macht den Dockerfile zusätzlich
eigenständig baubar und überlebt die vom Supervisor angekündigte Abkündigung
von `build.yaml` (die Warnung *„uses build.yaml which is deprecated"* im Log
ist genau das — eine Warnung, kein Fehler; solange `build.yaml` gelesen wird,
gewinnt dessen `build_from`).

**Reihenfolge der Befunde:** Dieser Fehler steckte seit E08-T4 im Dockerfile
und wurde erst sichtbar, nachdem die beiden Fehler davor behoben waren — vorher
kam der Supervisor gar nicht bis zum Bauen. Drei Schichten, jede von der
darüberliegenden verdeckt.

### „Could not open lock file /var/lib/apt/lists/lock — Permission denied"

```
#15 [stage-2 2/17] RUN apt-get update && apt-get install ...
E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)
E: Unable to lock directory /var/lib/apt/lists/
```

**Ursache (behoben):** Docker führt jedes `RUN` als den zuletzt gesetzten
`USER` aus, und dieser wird von `FROM` mit übernommen. Das
Valhalla-Basisimage setzt einen **nicht-privilegierten** Benutzer — der Bau
durfte deshalb nicht in `/var/lib` schreiben. Kein Netz-, kein Paketproblem.

**Lösung:** `USER root` direkt nach dem `FROM` der letzten Stufe. Das gilt
auch zur Laufzeit, und zwar beabsichtigt: das Add-on bringt sein eigenes
s6-overlay als PID 1 mit (`ENTRYPOINT ["/init"]`), und das braucht root.
Abgesichert wird der Container über AppArmor und den Verzicht auf
`full_access` (siehe `config.yaml`, Abschnitt „SECURITY POSTURE"), nicht über
einen unprivilegierten Benutzer.

### Installiert, startet aber nicht: „unable to spawn ./run"

```
s6-supervise valhalla: warning: unable to spawn ./run
                       (waiting 60 seconds): No such file or directory
/etc/yapaja/init-yapaja-config.sh: line 44: bashio::log.info: command not found
```

**Ursache (behoben):** „No such file or directory" beim Starten einer
vorhandenen, ausführbaren Datei heißt fast immer: der **Interpreter aus dem
Shebang** fehlt — nicht die Datei selbst.

Die Dienstskripte begannen mit `#!/usr/bin/with-contenv bash`. Diesen Pfad
legen nur die **offiziellen HA-Basisimages** an. Dieses Add-on baut auf dem
Valhalla-Image und installiert s6-overlay v3 selbst — und das bringt das
Werkzeug unter `/command/with-contenv` mit. Im Release-Archiv v3.1.6.2 ist
`./command/with-contenv` enthalten; ein `usr/bin/with-contenv` kommt darin
überhaupt nicht vor.

Die zweite Meldung ist dieselbe Wurzel an anderer Stelle: das `up`-Skript des
Oneshots rief `bash /etc/yapaja/init-yapaja-config.sh` auf und umging damit
den Shebang des Skripts. Unter nacktem `bash` sind bashio-Funktionen nicht
definiert.

**Lösung:** alle Shebangs auf `/command/with-contenv`; Skripte, die
`bashio::`-Funktionen benutzen, bekommen `bashio` statt `bash` als
Interpreter; das `up`-Skript ruft das init-Skript ohne expliziten Interpreter
auf, sodass dessen Shebang gilt. Zusätzlich prüft der Bau jetzt selbst, dass
`/command/with-contenv` und `/usr/bin/bashio` wirklich existieren — vorher
legte `ln -sf` auch einen ins Leere zeigenden Symlink an, der Bau blieb grün
und der Fehler kam erst beim Start.

### Update installiert, aber die Oberfläche ist die alte

Der Supervisor zeigt die neue Version, das Add-on startet — und trotzdem
fehlen Knöpfe oder Texte aus dem Release. Im Build-Log steht:

```
#10 [core-build 5/8] RUN set -eux; curl ... tar.gz/main
#10 CACHED
```

**Ursache (behoben):** Docker bildet den Cache-Schlüssel einer `RUN`-Zeile
aus ihrem **Befehlstext**, nicht aus dem, was der Befehl herunterlädt. Der
Quelltext wird von `tar.gz/main` geholt — einem beweglichen Zeiger, dessen
Text sich nie ändert. Der Schritt lief deshalb genau einmal und wurde danach
bei jedem Bau aus dem Cache genommen.

Das sah nicht wie ein Fehler aus, sondern wie ein erfolgreiches Update: der
Supervisor liest `version:` aus dem **Git-Klon**, nicht aus dem Image, und
zeigte brav die neue Nummer an, während das Image den Quelltext von Stunden
zuvor enthielt.

**Lösung:** Der Fetch-Schritt liest jetzt `BUILD_VERSION` (übergibt der
Supervisor aus `config.yaml`). Der Cache-Schlüssel ändert sich damit bei
jedem Versions-Bump, und der Quelltext wird neu geholt.

**Folge für die Entwicklung:** jede Änderung braucht einen Versions-Bump in
`config.yaml`. Ohne ihn behält der Bau den alten Quelltext. `config.test.ts`
prüft die Verdrahtung, nicht den Bump — den muss man selbst machen.

**Wenn du in dieser Lage steckst:** auf die nächste Version aktualisieren.
Ein „Rebuild" allein hilft nicht, weil er denselben Cache trifft.

### „could not read Username for 'https://github.com'"

```
Can't clone https://github.com/Apfelsafft/Yapaja-Go-Design repository:
fatal: could not read Username for 'https://github.com': No such device or address
```

**Ursache:** Der Supervisor klont **anonym**, ohne Zugangsdaten. Diese Meldung
heißt fast immer, dass das Repository zu diesem Zeitpunkt **privat** war (oder
die URL einen Tippfehler hatte). Git fragt dann nach einem Benutzernamen, und
im Supervisor-Container gibt es kein Terminal, das antworten könnte — daher
„No such device or address".

**Lösung:** Das Repository muss öffentlich sein. Prüfen lässt sich das ohne
Home Assistant, in einem privaten Browserfenster: die Repository-Seite muss
sich ohne Anmeldung öffnen lassen.

---

## Weitere Hilfe

Keine passende Lösung gefunden? Prüfe zusätzlich die
[FAQ](faq.md) und den
[Installations-Guide](installation.md). Scheitert schon die **Installation**
des Add-ons, siehe [I-01](#i-01--die-add-on-installation-bricht-ab). Für Entwickler-/
Add-on-spezifische Fragen siehe den
[Add-on-Entwicklungsleitfaden](addon-dev-guide.md).
