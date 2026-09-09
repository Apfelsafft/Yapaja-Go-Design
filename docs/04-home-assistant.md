# 04 – Home-Assistant-Integration

Yapaia Go und Home Assistant laufen auf demselben Mini-PC (Proxmox: HAOS-VM +
Yapaia-LXC/VM, **oder** Yapaia als HA-Add-on direkt in HAOS). Die Integration hat
drei Säulen: **MQTT** (primär, robust, entkoppelt), **REST beidseitig** (gezielte
Aktionen), **HA-Add-on-Packaging** (Installation & UI-Zugriff via Ingress).

## 1. MQTT (primärer Kanal)

- Broker: der in HA übliche **Mosquitto**. Yapaia-Core verbindet sich als Client
  (mqtt.js), Reconnect mit Exponential-Backoff, **LWT** auf `yapaja/status = offline`.
- Topics/Payloads: siehe `docs/03-api-spec.md` §4. Ein gemeinsames Schema mit WS —
  keine Sonderformate für HA.
- **Auto-Discovery:** Beim Start (und bei `homeassistant/status = online`, d. h.
  HA-Neustart) publiziert Yapaia Discovery-Configs (retained) unter
  `homeassistant/<component>/yapaja_<objekt>/config`:

| HA-Entität | Typ | Quelle |
|---|---|---|
| `sensor.yapaja_speed` | sensor (km/h, device_class speed) | nav/speed |
| `sensor.yapaja_speed_limit` | sensor (km/h) | nav/speed |
| `binary_sensor.yapaja_speeding` | binary_sensor | nav/speed |
| `sensor.yapaja_eta` | sensor (timestamp) | nav/eta |
| `sensor.yapaja_distance_remaining` | sensor (km) | nav/eta |
| `sensor.yapaja_instruction` | sensor (Text) + Attribut `icon` (Richtungspfeil) | nav/instruction |
| `sensor.yapaja_instruction_distance` | sensor (m) | nav/instruction |
| `sensor.yapaja_altitude` | sensor (m, device_class distance) | nav/altitude |
| `sensor.yapaja_nav_state` | sensor (idle/navigating/…) | nav/state |
| `device_tracker.yapaja_vehicle` | device_tracker (json_attributes lat/lon) | position |
| `sensor.yapaja_destination` | sensor (Name) + Attribute lat/lon | nav/destination |
| `button.yapaja_stop` / `pause` / `resume` | button → cmd/navigation | – |
| `select.yapaja_profile` | select (Profilnamen) → cmd/profile | profiles |

  Alle Entitäten hängen an einem HA-**Device** „Yapaia Go" (identifiers:
  `yapaja_go`, sw_version, configuration_url → App-URL).

  **Die Entity-IDs oben gelten seit 0.6.9 wörtlich** — jede Discovery-Config
  schickt ein `object_id` mit (`mqtt/discovery.ts`). Davor waren sie eine
  Absichtserklärung: ohne `object_id` bildet Home Assistant die ID aus
  Geräte- **plus** Entitätsnamen, also `sensor.yapaia_go_speed`, und der
  Gerätename hat sich in 0.6.7 auch noch geändert. Bestehende Installationen
  behalten ihre einmal vergebenen IDs (die Registrierung benennt nichts um) —
  deshalb sucht `apps/core/src/ha/dashboard.ts` die IDs zur Laufzeit, statt
  sie vorauszusetzen.
- Damit sind in HA ohne YAML sofort Dashboards, Automationen („Wenn ETA < 30 min →
  Boiler an"), TTS-Ansagen über HA-Speaker etc. möglich.
- **Eigenes Dashboard (0.6.9).** Das Add-on legt beim Start zwei Dateien unter
  `<ha-config>/www/yapaja/` ab — also unter `/local/yapaja/`:
  `yapaja-map-card.js` (die Karte MIT Route und eigener Position; sie rahmt
  die Anzeigeseite `embed.html` des Add-ons, damit es nicht zwei Karten zu
  pflegen gibt) und `dashboard.yaml`/`.txt` (ein fertiges Dashboard für den
  Rohkonfigurationseditor, mit den zur Laufzeit gefundenen Entity-IDs). Die
  Karte holt sich Slug und Ingress-Sitzung über
  `hass.callWS({type: 'supervisor/api'})` — die drei genutzten Endpunkte sind
  dort auch ohne Administratorrechte erlaubt (`hassio/websocket_api.py`).

## 1b. Der HA-interne Kanal (0.7.0) — dieselben Entitäten ohne Broker

`apps/core/src/ha/statesBridge.ts` schreibt dieselben Entity-IDs direkt über
`POST /api/states/<entity_id>` (Supervisor-Proxy). Zwei Schalter in
`config.yaml`: `mqtt_enabled` und `ha_internal`, beide standardmäßig an.

- **Sie streiten sich nicht.** Solange die MQTT-Bruecke verbunden ist
  (`getHealthStatus() === 'ok'`), schreibt der interne Kanal nichts — zwei
  Schreiber auf einer Entität ergäben ein Flackern. Fällt der Broker aus,
  übernimmt er; das ist zugleich ein Ausfallschutz.
- **Nur lesbare Entitäten.** Ein so geschriebener Zustand nimmt keine Befehle
  entgegen: `button.yapaja_stop/pause/resume` und `select.yapaja_profile` gibt
  es ausschließlich über MQTT. **Bedienen geht trotzdem** — über einen zweiten
  Satz Entitäten, siehe §1c. In 0.7.0 stand hier noch, es gehe gar nicht; das
  war zu früh aufgegeben.
- **Kein Geräte-/Registrierungseintrag**, und die Zustände überleben keinen
  HA-Neustart. Dagegen schreibt die Brücke alle 5 Minuten auch Unverändertes
  noch einmal (`AUFFRISCH_INTERVALL_MS`).
- Geschrieben wird im Sekundentakt und nur, was sich geändert hat; ein
  fehlgeschlagener Schreibvorgang gilt NICHT als erledigt (sonst fehlte der
  Wert bis zur nächsten Änderung).

## 1c. Bedienen ohne MQTT (0.7.1) — Helfer, die Yapaia selbst anlegt

Vorgabe war: *„sofern technisch überhaupt möglich soll alles funktionieren.
Der User wählt ja seinen Kanal aus."* Der Weg über `POST /api/states` kann das
nicht — ein so geschriebener Zustand ist eine Anzeige. Also nimmt Yapaia einen
anderen: es legt in Home Assistant **Helfer** an und hört auf sie.

| Helfer | Was er auslöst |
|---|---|
| `input_button.yapaia_pause` | `navigationService.pause()` |
| `input_button.yapaia_weiter` | `…resume()` |
| `input_button.yapaia_beenden` | `…stop()` |
| `input_select.yapaia_profil` | `profileService.activate()` — gewählt über den **Namen**, aktiviert über die ID |

- **Angelegt wird über die WebSocket-Schnittstelle** (`input_button/create`),
  nicht über REST: die REST-API hat dafür keinen Endpunkt, `input_button`
  registriert nur `DictStorageCollectionWebsocket`. Node 22 bringt `WebSocket`
  mit, es kommt keine Abhängigkeit dazu (`ha/commandHelpers.ts`).
- **Genau EIN Anlegeversuch pro Lauf.** Scheitert er (keine Rechte, WebSocket
  blockiert), wäre ein Versuch pro Sekunde eine Dauerlast ohne Aussicht auf ein
  anderes Ergebnis. Fehlende Bedienknöpfe sind ärgerlich; ein Add-on, das
  deshalb nicht startet, wäre schlimmer — `legeHelferAn` wirft nie.
- **Gedrückt wird ganz normal**, gelesen per REST im Sekundentakt
  (`ha/commandWatcher.ts`). Kein Ereignis-Abonnement: vier Zustände zu fragen
  kostet HA nichts Messbares und hat keinen der Fälle, die an einer
  Dauerverbindung hängen (Wiederverbinden, halboffene Leitungen, verlorene
  Ereignisse).
- **Der ERSTE gelesene Wert löst nie etwas aus.** Der Zustand eines
  `input_button` ist der *Zeitpunkt* des letzten Drucks — auch wenn der von
  gestern ist. Ohne diese Regel beendete jeder Neustart des Add-ons die
  laufende Fahrt, bevor jemand etwas angefasst hat.
- **Mit MQTT hält sich der Weg zurück.** Zwei Sätze Knöpfe für dieselbe Sache
  wären nur Verwirrung. Das erzeugte Dashboard nimmt dann die MQTT-Entitäten
  und schreibt in den Dateikopf, dass die Helfer da sind und **ruhen** — sonst
  suchte jemand den Fehler bei sich, wenn ein Helfer nicht reagiert.
- **`yapaia_`, nicht `yapaja_`:** was neu entsteht, bekommt die richtige
  Schreibweise (der alte Name stammt aus der Zeit vor 0.6.7 und lässt sich für
  bestehende Entitäten nicht mehr ändern). Verwechseln kann man sie nicht,
  `button.*` und `input_button.*` sind verschiedene Bereiche.

## 1d. Position aus der Companion-App (0.7.1)

`GET`/`POST /api/v1/system/ha/trackers` listet die `device_tracker`, die Home
Assistant kennt und die Koordinaten haben, und wählt einen aus. Die Auswahl
steht in der Installationsprüfung (🩺) im Add-on selbst und **gilt sofort** —
`HaTrackerSource` liest die Entity-ID bei jeder Abfrage neu, kein Neustart.

Warum nicht in der Add-on-Konfiguration: dort steht ein Freitextfeld, in das
eine Entity-ID gehört — eine Angabe, die man nicht weiß, sondern unter
*Entwicklerwerkzeuge → Zustände* nachschlagen muss. Eine Einrichtung aus
Textfeld und Ratespiel ist keine. Das Feld bleibt als Vorgabe erhalten; die
Auswahl in der Oberfläche gewinnt (`ha/config.ts#resolveTrackerEntityId`, das
auch die Zeichenkette `"null"` abfängt).

## 2. REST beidseitig

- **HA → Yapaia:** die komplette Core-REST-API (docs/03 §2), nutzbar via
  `rest_command`. Wichtigster Endpunkt: `POST /api/v1/navigation/destination`
  (Ziel setzen + optional Autostart) – für Automationen wie „Klick auf Karte im
  HA-Dashboard ⇒ Ziel im Navi".
- **Yapaia → HA:** Core kann die HA-REST-API rufen (Long-Lived-Token in Settings,
  im Add-on automatisch via `SUPERVISOR_TOKEN`/`http://supervisor/core/api`).
  V1-Nutzung bewusst klein: HA-Notifications (`notify`) und TTS-Ansagen über
  HA-Mediaplayer als optionaler Ausgabekanal für Navigationsansagen.
  Alles Weitere bleibt Add-ons überlassen (z. B. Kamera-Add-on holt Streams aus HA).

## 3. Auslieferung als HA-Add-on

**Entscheidung (aktualisiert in `feat/gui-install-path`):** **dieses Monorepo
ist selbst das Add-on-Repository.** Nutzer tragen unter *Einstellungen →
Add-ons → Add-on Store → ⋮ → Repositories* die URL
`https://github.com/Apfelsafft/Yapaja-Go-Design` ein und bekommen „Yapaia Go"
als installierbares Add-on angezeigt.

**Warum die Struktur so und nicht anders ist:** Der Supervisor erkennt ein
Git-Repository nur dann als Add-on-Repository, wenn im **Wurzelverzeichnis**
eine `repository.yaml` liegt; die installierbaren Add-ons sucht er danach als
Verzeichnisse **eine Ebene darunter**, die je eine `config.yaml` enthalten.
Die ursprüngliche Ablage `ha-addon/yapaja_go/` lag eine Ebene zu tief und war
für den Supervisor damit unsichtbar — der Store-Weg funktionierte schlicht
nicht (`docs/installation.md` §A trug dazu eine ausdrückliche Warnung).

Struktur (Repo-Wurzel):
```
Yapaja-Go-Design/
├── repository.yaml      # name, url, maintainer  ← macht das Repo zum Add-on-Repo
└── yapaja_go/
    ├── config.yaml      # name, slug, arch: [amd64, aarch64], ingress: true,
    │                    # ports: {} (ingress-only) bzw. optional 8080 für Direktzugriff,
    │                    # map: [share:rw]  → Kartendaten unter /share/yapaja (überlebt Updates!),
    │                    # services: [mqtt:want], usb: true (GPS-Maus), udev: true
    ├── Dockerfile       # FROM yapaja/core-Basis; s6-overlay startet:
    │                    # core, valhalla, photon, gpsd (kein Compose in HA-Add-ons)
    ├── rootfs/etc/s6-overlay/...   # Service-Definitionen, Abhängigkeits-Reihenfolge
    └── DOCS.md / README.md / PACKAGING.md / icon.png
```

Alles Übrige im Monorepo (`apps/`, `packages/`, `services/`, `docs/` …)
ignoriert der Supervisor — er sieht nur Verzeichnisse mit `config.yaml`. Eine
spätere Auslagerung in ein eigenständiges `yapaja-go-ha-addon`-Repo bleibt
als Spiegel-Schritt möglich, ist für den GUI-Weg aber nicht mehr nötig
(`yapaja_go/PACKAGING.md`).

Kernpunkte:
- **Ingress:** `ingress: true` ⇒ UI erscheint in der HA-Seitenleiste, HA übernimmt
  Auth & Remote-Zugriff (Nabu Casa). Frontend muss unter beliebigem Pfad-Prefix
  laufen (relative URLs, kein hartes `/`) – Anforderung an E01/E07!
  WebSocket über Ingress funktioniert, muss aber explizit getestet werden (E08-T4).
- **MQTT-Credentials automatisch:** `services: [mqtt:want]` ⇒ bashio liefert
  Host/User/Passwort, Core liest sie beim Start.
- **USB-GPS:** `usb: true` + udev; gpsd läuft im Add-on-Container.
- **Kartendaten nach `/share/yapaja/`** (PMTiles, Valhalla-Graph, Photon-Index),
  nicht ins Container-FS – Add-on-Updates dürfen keine Daten-Downloads erzwingen.
- **Ressourcen-Realität:** HAOS-VM braucht dann RAM für HA **und** Yapaia-Services.
  Empfehlung in DOCS.md: HAOS-VM ≥ 6 GB bei DE-Karten; wer knapp ist, nimmt die
  Standalone-Compose-Variante im eigenen LXC. Beide Wege dokumentieren.
- Add-on-Optionen (config.yaml `options/schema`): Kartenregion, MQTT-Prefix,
  Photon an/aus (RAM-Sparmodus mit reduzierter Suche), GPS-Quelle, Log-Level.

## 4. Standalone-Variante (Proxmox LXC/VM, ohne HAOS-Add-on)

`docker-compose.yml` im Hauptrepo: `core` + `valhalla` + `photon` + optional `gpsd`
(oder gpsd auf dem Host, USB-Durchreichung an LXC dokumentieren).
MQTT-Zugang manuell in Settings. Reverse-Proxy-Hinweise (optional TLS via Caddy).
Diese Variante ist die **Referenz für Entwicklung und CI**.

## 6. Add-on-Events (E09-T8)

Jedes Add-on mit dem Scope `events.publish` (docs/05 §2) landet automatisch
auch in MQTT: ein Bus-Event `addon/{id}/*` wird 1:1 unter
`yapaja/addon/{id}/*` republiziert -- **kein YAML, keine Auto-Discovery
nötig**, einfach das Topic in einer Automation abonnieren. Rate-Limit
5 msg/s pro Add-on (unabhängig je Add-on -- ein "lautes" Add-on kann keinem
anderen das Budget wegnehmen), Payload ≤ 16 KB, nicht retained (jedes Event
ist ein Zeitpunkt-Ereignis, keine dauerhafte Zustandsgröße) und pro Add-on
über die Store-Detailseite ("In Home Assistant verfügbar") ab-/anschaltbar --
wirkt sofort, ohne Core-Neustart.

### Worked Example: Track-Recorder Start/Stop

Das Referenz-Add-on **Track-Recorder** (`com.yapaja.track-recorder`, docs/05
§6.2) publiziert beim Start/Ende einer Aufzeichnung:

| MQTT-Topic | Payload |
|---|---|
| `yapaja/addon/com.yapaja.track-recorder/started` | `{"trackId": "track-1738500000000", "startedAt": "2026-08-02T09:00:00.000Z"}` |
| `yapaja/addon/com.yapaja.track-recorder/stopped` | `{"id": "track-1738500000000", "name": "track-1738500000000", "startedAt": "…", "endedAt": "…", "distanceMeters": 12345.6, "pointCount": 812, "segmentCount": 2}` |

Eine HA-Automation, die bei Aufnahme-Ende eine Notification mit der
gefahrenen Distanz sendet (`configuration.yaml` / UI-Automation-YAML):

```yaml
automation:
  - alias: "Yapaia Go: Aufzeichnung beendet -> Benachrichtigung"
    trigger:
      - platform: mqtt
        topic: "yapaja/addon/com.yapaja.track-recorder/stopped"
    action:
      - service: notify.mobile_app_dein_handy
        data:
          title: "Track aufgezeichnet"
          message: >
            {{ (trigger.payload_json.distanceMeters / 1000) | round(1) }} km
            aufgezeichnet ({{ trigger.payload_json.pointCount }} Punkte,
            {{ trigger.payload_json.segmentCount }} Segment(e)).
```

Und ein `input_boolean`/Statuslicht, das anzeigt, ob gerade aufgezeichnet wird:

```yaml
automation:
  - alias: "Yapaia Go: Recorder-Status-Helper setzen"
    trigger:
      - platform: mqtt
        topic: "yapaja/addon/com.yapaja.track-recorder/started"
        id: "start"
      - platform: mqtt
        topic: "yapaja/addon/com.yapaja.track-recorder/stopped"
        id: "stop"
    action:
      - service: >
          {{ 'input_boolean.turn_on' if trigger.id == 'start' else 'input_boolean.turn_off' }}
        target:
          entity_id: input_boolean.yapaja_recording
```

Jedes Add-on mit `events.publish` funktioniert nach demselben Muster --
Topic-Name und Payload-Schema legt das jeweilige Add-on selbst fest (siehe
dessen README/Doku); der Namensraum `yapaja/addon/{id}/*` und die
Rate-/Größenlimits oben gelten für alle gleich.

## 7. Wargame-Bezüge (Details docs/08)

- W-06 MQTT-Broker down ⇒ Queue + Reconnect, App voll funktionsfähig ohne HA.
- W-07 HA-Neustart ⇒ Discovery-Replay via `homeassistant/status`.
- W-15 Ingress-Pfad bricht Assets ⇒ Pflichttest „App unter Sub-Pfad" in CI.
- W-16 Add-on-Update löscht Karten ⇒ Daten in `/share`, Migrationstest.
