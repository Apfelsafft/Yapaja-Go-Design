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

Beide Wege enthalten einen eigenen Abschnitt zur
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
- Mindestens eine Kartenregion als PBF-Datei (z. B. von
  [download.geofabrik.de](https://download.geofabrik.de/)) — ohne
  Kartendaten startet die App zwar, aber Routing/Suche haben nichts zu
  routen/suchen.

---

## A. Home-Assistant-Add-on

Der vollständige, technische Referenztext für diesen Weg ist
[`ha-addon/yapaja_go/DOCS.md`](../ha-addon/yapaja_go/DOCS.md) (Englisch, das
ist der Text, den die Add-on-Store-Seite in HA tatsächlich anzeigt) — dieser
Abschnitt hier ist die deutschsprachige Schritt-für-Schritt-Fassung
zusätzlich zu jenem Dokument, nicht als Ersatz dafür.

1. In Home Assistant: **Einstellungen → Add-ons → Add-on Store → ⋮ (oben
   rechts) → Repositories**. Dort die URL des Add-on-Repositories eintragen
   und mit „Hinzufügen" bestätigen. (docs/04-home-assistant.md §3 beschreibt
   das Zielformat: ein eigenständiges `yapaja-go-ha-addon`-Repository im
   HA-Add-on-Repository-Format.)
2. Im Add-on-Store nach „Yapaja Go" suchen, öffnen, **Installieren** klicken.
   Erwartete Dauer: wenige Minuten (Image-Download).
3. **Vor dem ersten Start**: den Reiter **Konfiguration** des Add-ons öffnen
   und mindestens `region` setzen (siehe Optionstabelle in
   `ha-addon/yapaja_go/DOCS.md` §„Configuration options"). Ohne `region`
   startet das Add-on zwar (kein Absturz), aber ohne nutzbare Karte.
4. Empfohlen bei knappem RAM auf einer geteilten HAOS-VM: die
   RAM-Empfehlungstabelle in `ha-addon/yapaja_go/DOCS.md` §„RAM
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
`yapaja-photon`). Prüfen:

```bash
curl -s http://localhost:8080/api/v1/health | jq .
```

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

Details: `ha-addon/yapaja_go/DOCS.md` §„USB-GPS passthrough".

### Weg B (Docker Compose / Proxmox-LXC)

`gpsd` ist hier **kein** Bestandteil von `docker-compose.yml` — die
Empfehlung ist, es als natives Betriebssystem-Paket auf dem Host (bzw. in
der LXC) zu installieren, weil das der am längsten etablierte, am wenigsten
überraschungsanfällige Weg ist und keine zusätzliche Annahme über ein
bestimmtes Docker-Image für `gpsd` erfordert:

1. **`gpsd` installieren** (im selben Host bzw. derselben LXC, in der auch
   `docker compose` läuft):
   ```bash
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
   ergänzen (`docker-compose.override.yml`, wird von `docker compose`
   automatisch mitgeladen, ohne die getrackte `docker-compose.yml`
   anzufassen):
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
