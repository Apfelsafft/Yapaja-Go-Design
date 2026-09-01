# Installations-Guide

Diese Anleitung ist für Leser geschrieben, die dieses Repository **noch nie
gesehen haben**. Jeder Schritt nennt den genauen Befehl und was du danach auf
dem Bildschirm erwarten kannst. Es gibt zwei unabhängige
Installationswege — wähle **einen**:

- **[A. Home-Assistant-Add-on](#a-home-assistant-add-on)** — wenn du bereits
  Home Assistant (HAOS oder Supervised) betreibst.
- **[B. Docker Compose / Proxmox-LXC](#b-docker-compose--proxmox-lxc)** —
  eigenständig, ohne Home Assistant, auf einem beliebigen Linux-Host oder
  einer Proxmox-LXC-Instanz.

Danach gilt für **beide** Wege:
**[C. Kartenkacheln bauen](#c-kartenkacheln-bauen-pmtiles)** — ohne diesen
Schritt gibt es keine Karte. Es gibt **keine** fertigen Kacheln zum
Herunterladen; §C.1 erklärt, warum.

Beide Wege enthalten außerdem einen eigenen Abschnitt zur
**[USB-GPS-Durchreichung](#usb-gps-durchreichung)**.

> **Hinweis zur Prüfbarkeit dieser Anleitung:** Dieses Dokument wurde in einer
> Umgebung ohne Docker-Daemon, ohne freie VM und ohne Zugriff auf
> `download.geofabrik.de`/GitHub-Releases/Overpass verfasst (die
> Netzwerk-Sperren dort sind Teil dieser Entwicklungsumgebung, nicht des
> Produkts). Jeder Befehl unten ist so geschrieben, wie er in einer normalen
> Umgebung tatsächlich auszuführen wäre — er wurde hier aber **nicht selbst
> gegen ein frisches System durchgespielt**. Ein zweiter, unabhängiger Leser
> sollte diese Anleitung Schritt für Schritt gegen eine echte frische
> Umgebung nachvollziehen und Abweichungen zurückmelden — genau dafür ist das
> Testprotokoll am Ende dieses Dokuments gedacht.

---

## Voraussetzungen (beide Wege)

- Ein x86_64- oder aarch64-Linux-Host ("Mini-PC", Referenz: N100-Klasse, 4+
  GB RAM, siehe `docs/01-architecture.md` §4 für das Ressourcen-Budget).
- Für Weg A: eine laufende Home-Assistant-Installation (HAOS oder
  Supervised — **nicht** Home Assistant Core/Container, dem fehlt der
  Supervisor, der Add-ons überhaupt erst installieren kann).
- Für Weg B: Docker Engine + das `docker compose`-Plugin (`docker compose
  version` muss funktionieren, nicht das alte `docker-compose` mit
  Bindestrich).
- Optional, für echtes GPS statt Simulator: ein USB-GPS-Empfänger
  ("GPS-Maus", meist ein `u-blox`-Chipsatz, erscheint unter Linux als
  `/dev/ttyACM0` oder `/dev/ttyUSB0`).
- **Kommandozeilen-Werkzeuge**, die weiter unten vorausgesetzt werden:
  `curl` (Downloads und Health-Abfragen) und `jq` (formatiert die
  JSON-Antworten lesbar). Auf einem minimalen System sind beide oft nicht
  vorinstalliert:

  ```bash
  # Debian/Ubuntu (auch der Proxmox-LXC-Standard)
  apt-get update && apt-get install -y curl jq
  ```

  Auf anderen Distributionen entsprechend `dnf install curl jq` (Fedora/RHEL)
  bzw. `apk add curl jq` (Alpine). `jq` ist reiner Komfort — ohne es
  funktioniert jeder `curl`-Aufruf ebenfalls, die Ausgabe ist nur einzeilig.
- Mindestens eine Kartenregion als PBF-Datei (z. B. von
  [download.geofabrik.de](https://download.geofabrik.de/)) — ohne
  Kartendaten startet die App zwar, aber Routing/Suche haben nichts zu
  routen/suchen.

---

## A. Home-Assistant-Add-on

Der vollständige, technische Referenztext für diesen Weg ist
[`yapaja_go/DOCS.md`](../yapaja_go/DOCS.md) (Englisch, das
ist der Text, den die Add-on-Store-Seite in HA tatsächlich anzeigt) — dieser
Abschnitt hier ist die deutschsprachige Schritt-für-Schritt-Fassung
zusätzlich zu jenem Dokument, nicht als Ersatz dafür.

> **Dieses Repository ist selbst das Add-on-Repository.** In der Wurzel liegt
> `repository.yaml`, das Add-on-Paket eine Ebene darunter als `yapaja_go/` —
> genau das Layout, das der HA-Supervisor beim Eintragen einer
> Repository-URL erwartet (Hintergrund: `yapaja_go/PACKAGING.md`,
> `docs/04-home-assistant.md` §3). Schritt 1 unten ist deshalb der
> GUI-Weg; der frühere „lokales Add-on nach `/addons/` kopieren"-Umweg steht
> nur noch als Alternative dabei.

1. **Repository in Home Assistant eintragen** (GUI, ohne SSH).
   **Einstellungen → Add-ons → Add-on Store → ⋮ (oben rechts) →
   Repositories**, dort diese URL hinzufügen:

   ```
   https://github.com/Apfelsafft/Yapaja-Go-Design
   ```

   Danach den Dialog schließen und die Store-Seite neu laden (bzw. **⋮ → Nach
   Updates suchen**).
   *Erwartetes Ergebnis:* ein neuer Store-Abschnitt „Yapaja Go" mit der
   Kachel **Yapaja Go**.
   *Erscheint nichts:* HA meldet ungültige Repositories mit einer eigenen
   Fehlermeldung im selben Dialog. Bleibt der Abschnitt leer ohne Fehler, hat
   der Supervisor das Repository zwar geladen, aber kein Add-on darin
   gefunden — dann fehlt entweder `repository.yaml` in der Wurzel oder
   `yapaja_go/config.yaml`. Beides prüft der CI-Job `addon-config-check`
   (`yapaja_go/config.test.ts`) bei jedem PR mit.

   *Alternative ohne Store (falls das Repository nicht erreichbar ist):* das
   Verzeichnis `yapaja_go/` aus diesem Repository in den `addons`-Ordner der
   Home-Assistant-Installation kopieren — erreichbar z. B. über das
   offizielle „Samba share"- oder „Advanced SSH & Web Terminal"-Add-on:

   ```bash
   # auf dem HA-Host, im Ordner /addons/
   git clone https://github.com/Apfelsafft/Yapaja-Go-Design.git /tmp/yapaja
   cp -r /tmp/yapaja/yapaja_go /addons/yapaja_go
   rm -rf /tmp/yapaja
   ```

   „Yapaja Go" erscheint dann im Abschnitt **„Lokale Add-ons"**. Im Ordner
   `/addons/yapaja_go/` müssen `config.yaml` und `Dockerfile` unmittelbar
   liegen (keine weitere Zwischenebene).

2. Add-on öffnen, **Installieren** klicken. Der Container wird dabei **auf dem
   Gerät gebaut** — je nach Hardware **10–30 Minuten**, auf einem Raspberry Pi
   auch länger. Das ist normal und kein Hänger.
3. **Vor dem ersten Start**: den Reiter **Konfiguration** des Add-ons öffnen
   und mindestens `region` setzen (siehe Optionstabelle in
   `yapaja_go/DOCS.md` §„Configuration options"). Ohne `region`
   startet das Add-on zwar (kein Absturz), aber ohne nutzbare Karte.
4. Empfohlen bei knappem RAM auf einer geteilten HAOS-VM: die
   RAM-Empfehlungstabelle in `yapaja_go/DOCS.md` §„RAM
   recommendation" **vor** dem ersten Start lesen — Home Assistant selbst,
   Mosquitto und alle anderen Add-ons teilen sich dieselbe VM.
5. Add-on **starten** (Toggle „Start on boot" zusätzlich aktivieren, wenn das
   Add-on dauerhaft laufen soll). Im Log-Reiter sollte in dieser Reihenfolge
   erscheinen: Valhalla bereit → Core lauscht → (falls konfiguriert)
   MQTT verbunden.
6. Add-on aus der HA-Seitenleiste öffnen (Ingress — **kein** separates
   Login, die HA-eigene Sitzung deckt das ab, auch über Nabu-Casa-Remote-
   Zugriff). Erwartung: die Karte rendert, ein Positionspunkt (Simulator
   oder echtes GPS) ist sichtbar.

MQTT-Discovery erfolgt automatisch, sobald ein MQTT-Broker (z. B. das
Mosquitto-Add-on) installiert und gestartet ist — kein manueller Eintrag
nötig (`docs/04-home-assistant.md` §1 listet die vollständige
Entitätentabelle, die danach unter HA → Einstellungen → Geräte & Dienste →
MQTT erscheint).

Weiter mit [Erste Schritte](erste-schritte.md).

---

## B. Docker Compose / Proxmox-LXC

Dieser Weg nutzt exakt dasselbe `docker-compose.yml`, das auch als
Entwicklungs-/CI-Referenzumgebung dieses Repositories dient — kein
Sonderpfad, sondern der am häufigsten durchgespielte.

### B.1 Repository holen

```bash
git clone <URL-dieses-Repositories> yapaja-go
cd yapaja-go
cp .env.example .env
```

Erwartung: `.env` existiert jetzt mit sinnvollen Defaults (Port 8080,
`PHOTON_XMX=1g` usw. — siehe `.env.example` für jede Option mit Kommentar).

### B.2 Proxmox-LXC anlegen (nur wenn du in einer Proxmox-LXC statt direkt
auf einem Host installierst — bei einem normalen Linux-Host diesen
Unterabschnitt überspringen)

1. Proxmox-Weboberfläche → **Create CT**.
2. Template: eine aktuelle Debian- oder Ubuntu-LTS-Vorlage.
3. Ressourcen: mindestens 4 GB RAM, 2 vCPU, ≥ 20 GB Disk (ein
   Deutschland-Extrakt mit Valhalla-Graph + Photon-Index braucht deutlich
   mehr — siehe `docs/01-architecture.md` §4 für die konkreten Zahlen je
   Kartengröße).
4. **Unprivileged container**: für USB-GPS-Durchreichung ist ein
   **privilegierter** Container (Häkchen bei „Unprivileged container"
   **entfernen**) der unkomplizierteste Weg — siehe
   [USB-GPS-Durchreichung](#usb-gps-durchreichung) unten für die genaue
   Begründung und die unprivilegierte Alternative.
5. Container starten, per `pct enter <VMID>` betreten, Docker installieren
   (`curl -fsSL https://get.docker.com | sh` bzw. die distributionseigene
   Docker-CE-Installationsanleitung), dann ab Schritt B.1 wie oben.

### B.3 Kartendaten bereitstellen

```bash
mkdir -p data/pbf
curl -fL --retry 3 -o data/pbf/li.osm.pbf \
  https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf

# Schlaegt der Download auch nach den drei Versuchen fehl, liegt es fast immer
# an der Netzverbindung, einem Proxy oder einer Firewall -- nicht an Yapaja.
# Pruefen: `curl -I https://download.geofabrik.de/` muss "200" liefern.
# Geofabrik-Extrakte lassen sich auch vorab woanders herunterladen und
# einfach nach data/pbf/ kopieren; der Dateiname ist das Einzige, worauf die
# naechsten Schritte sich stuetzen.

services/valhalla/build-tiles.sh data/pbf/li.osm.pbf
```

Erwartung: `build-tiles.sh` baut den Routing-Graphen in einem temporären
Verzeichnis und tauscht ihn danach **atomar** ein (kein Downtime, W-17 in
`docs/08-wargame.md`); bei einem Liechtenstein-Extrakt dauert das insgesamt
etwa 15 Minuten (siehe `docs/data-update-runbook.md` für die Zeitangaben
größerer Extrakte, z. B. Deutschland: 4–6 h, überwiegend Wartezeit). Details,
Env-Overrides und der genaue Ablauf stehen im Skript-Header von
`services/valhalla/build-tiles.sh` und in `services/valhalla/README.md`.

Für die Suche (Photon) analog:

```bash
services/photon/download-index.sh liechtenstein
```

(`services/photon/README.md` beschreibt Land-Codes, RAM-Tuning per
`PHOTON_XMX`, und die `PHOTON_ENABLED=false`-Option für RAM-knappe Geräte,
W-12.)

### B.4 Stack starten

```bash
docker compose --profile routing --profile search up -d
```

Erwartung: drei Container starten (`yapaja-core`, `yapaja-valhalla`,
`yapaja-photon`).

> **`yapaja-valhalla` zeigt „Restarting"? Das ist erwartbar, kein Fehler.**
> Valhalla läuft mit `restart: on-failure:3` und beendet sich, solange unter
> `data/valhalla/tiles/` noch kein fertiger Graph liegt — es versucht es
> dreimal und bleibt dann gestoppt. Wer Schritt B.3 (Graph bauen) noch nicht
> ausgeführt hat, sieht genau das. Der Health-Check unten meldet dann
> `"valhalla": "down"`; sobald der Graph existiert und der Container gestartet
> ist, springt er auf `"ok"`. Dasselbe gilt für `yapaja-photon` ohne Index.

Prüfen:

```bash
curl -s http://localhost:8080/api/v1/health | jq .
```

*(Ohne `jq`: `curl -s http://localhost:8080/api/v1/health` — dieselbe Antwort,
nur unformatiert.)*

Erwartete Antwort (Auszug, `docs/03-api-spec.md` §2 „System"):

```json
{
  "status": "ok",
  "version": "0.0.1",
  "services": { "valhalla": "ok", "photon": "ok", "gpsd": "down", "mqtt": "down" }
}
```

`gpsd: "down"` und `mqtt: "down"` sind an dieser Stelle **normal** — beide
sind optional und werden erst durch die folgenden Abschnitte aktiv. Öffne
danach `http://<Host-IP>:8080/` im Browser — die Karte sollte rendern.

### B.5 Backup vor einem Update

Alle Nutzdaten (Kartenregionen, Valhalla-Graph, Such-Index, Fahrzeugprofile/
Favoriten-Datenbank) liegen unter `./data/` **außerhalb** der Container
(siehe `docker-compose.yml`'s Volume-Mounts) — ein Image-Update rührt das
nicht an. Trotzdem vor jedem größeren Update ein Backup anlegen:

```bash
tar czf "yapaja-backup-$(date +%Y%m%d).tar.gz" data/ .env
```

(Siehe auch W-16 in [Troubleshooting](troubleshooting.md), falls nach einem
Update dennoch Daten fehlen sollten.)

Weiter mit [Erste Schritte](erste-schritte.md).

---

## C. Kartenkacheln bauen (PMTiles)

Dieser Abschnitt gilt für **beide** Installationswege. Er ist der Schritt, der
am ehesten überrascht — deshalb steht zuerst, warum es ihn überhaupt gibt.

### C.1 Warum es keinen Download gibt

`docs/01-architecture.md`, ADR-003 legt fest: **„Offline-Karten = PMTiles
(Protomaps-Builds von OSM)"**. Die Kacheln sind also ein **Erzeugnis** aus
OpenStreetMap-Rohdaten, kein Fremd-Download.

Der Regionen-Katalog verwies trotzdem lange auf
`https://download.geofabrik.de/europe/<region>-latest.pmtiles`. Diese Adressen
existieren nicht — sie waren offenbar entstanden, indem an der
funktionierenden `.osm.pbf`-Adresse die Endung getauscht wurde. Geofabrik
verteilt ausschließlich Rohdaten (`.osm.pbf`, `.shp.zip`). Wer den
„Herunterladen"-Knopf drückte, bekam einen 404 und suchte den Fehler in seiner
eigenen Installation.

Deshalb gilt jetzt: Regionen ohne fertige Datei zeigen in der Oberfläche
**„Wird gebaut"** statt eines Knopfes, der nicht funktionieren kann. Der Weg
zu Kacheln ist dieser Abschnitt.

Dieselbe `.osm.pbf` erzeugt **drei** Dinge — die drei Skripte sind
austauschbar in der Reihenfolge, brauchen aber alle dieselbe Eingabedatei:

| Erzeugnis | Skript | Wofür |
|---|---|---|
| Kartenkacheln (`.pmtiles`) | `services/tiles/build-pmtiles.sh` | die Karte, die man sieht |
| Routing-Graph | `services/valhalla/build-tiles.sh` | Routen berechnen |
| Lite-Suchindex | `services/valhalla/build-lite-index.sh` | Ortssuche ohne Photon (W-12) |

### C.2 Was fehlt mir gerade? — die Prüfung in der App

Bevor du irgendetwas baust: öffne Yapaja und klicke rechts oben auf **🩺
Installation prüfen**. Die Seite listet Kacheln, Routing, Suche, Position,
RAM, Plattenplatz und MQTT — je mit dem, was tatsächlich vorgefunden wurde,
und dem, was dagegen zu tun ist. Sie funktioniert auch dann, wenn noch gar
keine Karte da ist; genau dafür ist sie gedacht.

Dasselbe ohne Oberfläche:

```bash
curl -s http://localhost:8080/api/v1/system/preflight | jq .
```

### C.3 Kleine Region — direkt auf dem Gerät

Für Liechtenstein, ein deutsches Bundesland oder einen US-Bundesstaat reicht
das Gerät selbst, auch eine HAOS-VM mit 8 GB.

```bash
# Beispiel Rheinland-Pfalz (~300 MB PBF)
services/tiles/build-pmtiles.sh \
  https://download.geofabrik.de/europe/germany/rheinland-pfalz-latest.osm.pbf

# Beispiel Liechtenstein (~3,5 MB PBF, Minuten)
services/tiles/build-pmtiles.sh \
  https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
```

Das Skript lädt die PBF, baut in ein **temporäres** Verzeichnis, prüft die
PMTiles-Signatur der erzeugten Datei und tauscht sie erst dann atomar nach
`<TILES_DIR>/<region>.pmtiles` (W-17). Schlägt irgendetwas davor fehl, bleibt
die bisherige Kartendatei unangetastet. Ein Neustart ist danach **nicht**
nötig — der Core liest das Verzeichnis bei jeder Anfrage frisch; in der App
genügt ein Reload.

Danach denselben Extrakt für Routing und Suche verwenden:

```bash
services/valhalla/build-tiles.sh data/pbf/rheinland-pfalz-latest.osm.pbf
services/valhalla/build-lite-index.sh data/pbf/rheinland-pfalz-latest.osm.pbf
```

### C.4 Im Add-on-Container gibt es kein Docker

Standardmäßig ruft `build-pmtiles.sh` planetiler per `docker run` auf. **Innerhalb
eines Home-Assistant-Add-ons gibt es keinen Docker-Socket** — dieser Weg
funktioniert dort also nicht. Dafür gibt es den JAR-Modus:

```bash
# einmalig: planetiler holen (~100 MB)
curl -fL -o /share/yapaja/planetiler.jar \
  https://github.com/onthegomap/planetiler/releases/download/v0.10.2/planetiler.jar

# bauen, ohne Docker
PLANETILER_JAR=/share/yapaja/planetiler.jar \
PLANETILER_XMX=2g \
TILES_DIR=/share/yapaja/tiles \
  services/tiles/build-pmtiles.sh https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf
```

Die Version ist **fest auf `v0.10.2` gepinnt**, nicht auf `latest`: ein Schritt,
der Stunden läuft und dessen Ergebnis ausgeliefert wird, soll nicht davon
abhängen, was gerade veröffentlicht wurde.

### C.5 Ganzes Land (Deutschland) — nicht auf der HAOS-VM

Das RAM-Budget einer 8-GB-HAOS-VM ist weitgehend vergeben:

| Posten | Bedarf |
|---|---|
| Yapaja Core | ~300 MB |
| Valhalla | ~1,5 GB |
| Photon | ~1 GB |
| Home Assistant + Mosquitto | ~1–1,5 GB |
| **frei für alles Weitere** | **~3,5 GB** |

Der Kachelbau ist der speicherhungrigste Schritt der ganzen Kette und
konkurriert genau mit diesen Posten. Ein Deutschland-Extrakt (~4 GB PBF,
~4,5 GB fertige Kacheln) sprengt das. Drei Auswege, **alle ohne SSH auf der
HAOS-VM**:

1. Die Proxmox-VM temporär auf 16 GB vergrößern, bauen, wieder verkleinern.
2. Einen separaten LXC nur für den Build anlegen und die fertige Datei
   herüberkopieren.
3. Die `.pmtiles` auf einem Desktop/Server bauen und per **„Samba share"**-
   oder **„File editor"**-Add-on nach `/share/yapaja/tiles/<region>.pmtiles`
   legen. Das ist der einzige Weg, der gar keinen zweiten *eigenen* Rechner
   voraussetzt, falls jemand die Datei bereitstellt.

### C.6 Empfehlung bei 8 GB: Photon abschalten

Photon will allein mehrere GB Heap. Auf einer geteilten 8-GB-VM ist der
**Lite-Suchindex** die verlässlichere Wahl — er deckt dieselbe Ortssuche ab
und braucht ein Vielfaches weniger Speicher (W-12,
`docs/08-wargame.md`). In der Add-on-Konfiguration:

```yaml
photon_enabled: false
```

Die Installationsprüfung aus §C.2 meldet genau diese Empfehlung selbst,
sobald sie wenig RAM **und** eingeschaltetes Photon vorfindet — und sie meldet
die Suche als **in Ordnung**, sobald *einer* der beiden Wege da ist. Ein Gerät
ohne Photon ist nicht suchunfähig.

> **Was hier nicht nachgewiesen ist:** die Laufzeit- und RAM-Angaben in diesem
> Abschnitt sind Größenordnungen aus planetilers eigener Dokumentation und den
> Extraktgrößen. Der eigentliche planetiler-Lauf wurde in der
> Entwicklungsumgebung **nie ausgeführt** (kein Docker-Daemon, kein Zugriff
> auf ghcr.io/Geofabrik). Getestet ist alles darum herum — Argumentbehandlung,
> Regionsableitung, Ausgabepfad, PMTiles-Signaturprüfung, atomarer Swap und
> jeder Fehlerpfad (`services/tiles/build-pmtiles.test.ts`, das `docker` bzw.
> `java` durch ein Stub-Programm ersetzt und die komplette Swap-/Fehlerlogik
> real durchspielt). Wer diesen Abschnitt gegen echte Hardware fährt, sollte
> Abweichungen über das Testprotokoll am Ende melden.

Weiter mit [Erste Schritte](erste-schritte.md).

---

## USB-GPS-Durchreichung

Der Core spricht mit `gpsd` über TCP (`GPSD_HOST`/`GPSD_PORT`, Default
`localhost:2947`, JSON-Protokoll) — **nicht** direkt mit dem USB-Gerät. Wie
`gpsd` selbst an das USB-Gerät kommt, unterscheidet sich zwischen den beiden
Installationswegen:

### Weg A (HA-Add-on)

Nichts weiter zu tun — `gpsd` ist **im Add-on-Container eingebaut** und
`config.yaml` deklariert bereits `usb: true` + `udev: true`, wodurch der HA-
Supervisor USB-Geräte automatisch durchreicht. Ablauf:

1. USB-GPS-Empfänger einstecken.
2. Add-on neu starten (Geräte-Durchreichung wird beim Container-Start
   ausgewertet, nicht live nachgeladen).
3. Im Add-on-Log nachsehen: entweder „found GPS device at /dev/ttyACMx"
   oder eine Warnung, dass noch gewartet wird (alle 15 s erneuter Versuch,
   kein Absturz).
4. In der App: Einstellungen → Position sollte einen Live-Fix zeigen,
   sobald `gpsd` einen hat (freie Sicht zum Himmel nötig, siehe
   [Troubleshooting W-01](troubleshooting.md#w-01--gps-signal-verloren-tunnel-parkhaus-abschattung)).

Details: `yapaja_go/DOCS.md` §„USB-GPS passthrough".

### Weg B (Docker Compose / Proxmox-LXC)

`gpsd` ist hier **kein** Bestandteil von `docker-compose.yml` — die
Empfehlung ist, es als natives Betriebssystem-Paket auf dem Host (bzw. in
der LXC) zu installieren, weil das der am längsten etablierte, am wenigsten
überraschungsanfällige Weg ist und keine zusätzliche Annahme über ein
bestimmtes Docker-Image für `gpsd` erfordert:

1. **`gpsd` installieren** (im selben Host bzw. derselben LXC, in der auch
   `docker compose` läuft):
   ```bash
   # Debian/Ubuntu; auf Fedora/RHEL `dnf install gpsd gpsd-clients`,
   # auf Alpine `apk add gpsd gpsd-clients`.
   apt-get update && apt-get install -y gpsd gpsd-clients
   ```
2. **Proxmox-LXC-Device-Passthrough** (nur relevant, wenn Docker in einer
   LXC läuft, nicht direkt auf dem Proxmox-Host oder einem Bare-Metal-Mini-
   PC): am Proxmox-**Host** (nicht in der LXC):
   ```bash
   pct set <VMID> -dev0 /dev/ttyACM0
   ```
   (Proxmox ≥ 7.1: `pct set -devN` reicht ein Host-Gerät direkt in eine LXC
   durch. Gerätepfad ggf. anpassen — `ls /dev/tty*` auf dem Proxmox-Host
   **vor** dem Einstecken und danach vergleichen, um den richtigen Knoten zu
   finden.) Danach die LXC neu starten (`pct reboot <VMID>`).
3. **`gpsd` auf das Gerät zeigen lassen** — `/etc/default/gpsd`:
   ```
   DEVICES="/dev/ttyACM0"
   GPSD_OPTIONS="-n"
   ```
   dann `systemctl restart gpsd`. Test: `gpspipe -w -n 5` sollte JSON-Zeilen
   mit `"class":"TPV"` ausgeben (ggf. draußen mit Sicht zum Himmel testen).
4. **Core auf dieses `gpsd` zeigen lassen.** Weil `core` im
   `docker-compose.yml` per Default im isolierten Bridge-Netzwerk läuft
   (eigenes `localhost`, das NICHT das `localhost` des Hosts ist), lokal
   ergänzen. Dazu **neben** der `docker-compose.yml` eine zweite Datei namens
   `docker-compose.override.yml` anlegen (exakt dieser Name): `docker compose`
   lädt sie automatisch zusätzlich, wenn sie im selben Verzeichnis liegt — ein
   Standardmechanismus von Compose, kein Yapaja-Sonderweg. So bleibt die
   getrackte `docker-compose.yml` unangetastet und lokale Anpassungen
   überstehen jedes `git pull`. Inhalt:
   ```yaml
   services:
     core:
       network_mode: host
       environment:
         - GPSD_ENABLED=true
   ```
   `network_mode: host` ist hier der unkomplizierteste Weg, weil er
   `localhost:2947` innerhalb des Containers direkt auf das `gpsd` des Hosts
   zeigen lässt, ohne eine feste IP erraten zu müssen. (Alternative ohne
   Host-Networking: `GPSD_HOST=<Host-Gateway-IP>` setzen und `2947/tcp` am
   Host für das Compose-Netzwerk freigeben — mehr Aufwand für denselben
   Effekt, nur nötig, wenn `network_mode: host` aus anderen Gründen nicht in
   Frage kommt, z. B. Portkonflikte mit anderen Host-Diensten.)
5. Stack neu starten: `docker compose --profile routing --profile search up
   -d --force-recreate core`. Danach `curl -s
   http://localhost:8080/api/v1/health | jq .services.gpsd` sollte `"ok"`
   zeigen (statt `"down"`).

Ohne angeschlossenes GPS funktioniert die App trotzdem vollständig über den
eingebauten GPS-Simulator (`POST /api/v1/simulator/play`, siehe
`docs/03-api-spec.md` §„Position") — die USB-Durchreichung ist nur für
Live-Betrieb im Fahrzeug nötig.

---

## Testprotokoll (Vorlage für einen Testleser)

Dieser Abschnitt ist bewusst als ausfüllbares Protokoll gehalten — die
Aufgabenstellung dieses Guides verlangt einen Nachweis, dass ein Leser ohne
Repo-Vorwissen erfolgreich installiert. Bitte beim Durchspielen jeden Schritt
mit Ergebnis (✅/❌ + Beobachtung) festhalten und zurückmelden:

| # | Schritt | Erwartung | Ergebnis |
|---|---|---|---|
| 1 | `git clone` + `.env` kopieren | Repo liegt lokal, `.env` existiert | |
| 2 | Kartenregion bauen (B.3) bzw. Add-on-`region` setzen (A.3) | Baubefehl endet ohne Fehler | |
| 3 | Stack/Add-on starten | `docker compose ps` zeigt alle Container „Up" bzw. Add-on-Log zeigt „Core lauscht" | |
| 4 | `GET /api/v1/health` | `status: "ok"`, `valhalla`/`photon`: `"ok"` | |
| 5 | App im Browser öffnen | Karte rendert, Positionspunkt sichtbar (Simulator reicht) | |
| 6 | (falls GPS vorhanden) USB-GPS-Abschnitt durchspielen | `services.gpsd` wird `"ok"` | |
| 7 | Eine Route berechnen ([Erste Schritte](erste-schritte.md)) | Route wird angezeigt | |

**Ehrlicher Stand dieses Dokuments:** Diese Tabelle wurde in der
Autorenumgebung **nicht** gegen eine echte frische VM ausgefüllt — es gab dort
weder einen Docker-Daemon noch Netzwerkzugriff auf Geofabrik/GitHub-Releases,
um das zu tun (Details siehe Kopf dieses Dokuments und der
Orchestrator-Bericht dieser Aufgabe). Das Ausfüllen dieser Tabelle gegen eine
echte, frische Umgebung ist der eigentliche Nachweis für Akzeptanzkriterium 1
aus `tasks/E10-qualitaet-release.md` §E10-T5 und sollte von einem separaten
Testleser nachgeholt werden, bevor dieses Dokument als „geprüft" gilt.
