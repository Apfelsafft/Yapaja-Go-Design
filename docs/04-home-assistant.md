# 04 – Home-Assistant-Integration

Yapaja Go und Home Assistant laufen auf demselben Mini-PC (Proxmox: HAOS-VM +
Yapaja-LXC/VM, **oder** Yapaja als HA-Add-on direkt in HAOS). Die Integration hat
drei Säulen: **MQTT** (primär, robust, entkoppelt), **REST beidseitig** (gezielte
Aktionen), **HA-Add-on-Packaging** (Installation & UI-Zugriff via Ingress).

## 1. MQTT (primärer Kanal)

- Broker: der in HA übliche **Mosquitto**. Yapaja-Core verbindet sich als Client
  (mqtt.js), Reconnect mit Exponential-Backoff, **LWT** auf `yapaja/status = offline`.
- Topics/Payloads: siehe `docs/03-api-spec.md` §4. Ein gemeinsames Schema mit WS —
  keine Sonderformate für HA.
- **Auto-Discovery:** Beim Start (und bei `homeassistant/status = online`, d. h.
  HA-Neustart) publiziert Yapaja Discovery-Configs (retained) unter
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

  Alle Entitäten hängen an einem HA-**Device** „Yapaja Go" (identifiers:
  `yapaja_go`, sw_version, configuration_url → App-URL).
- Damit sind in HA ohne YAML sofort Dashboards, Automationen („Wenn ETA < 30 min →
  Boiler an"), TTS-Ansagen über HA-Speaker etc. möglich.

## 2. REST beidseitig

- **HA → Yapaja:** die komplette Core-REST-API (docs/03 §2), nutzbar via
  `rest_command`. Wichtigster Endpunkt: `POST /api/v1/navigation/destination`
  (Ziel setzen + optional Autostart) – für Automationen wie „Klick auf Karte im
  HA-Dashboard ⇒ Ziel im Navi".
- **Yapaja → HA:** Core kann die HA-REST-API rufen (Long-Lived-Token in Settings,
  im Add-on automatisch via `SUPERVISOR_TOKEN`/`http://supervisor/core/api`).
  V1-Nutzung bewusst klein: HA-Notifications (`notify`) und TTS-Ansagen über
  HA-Mediaplayer als optionaler Ausgabekanal für Navigationsansagen.
  Alles Weitere bleibt Add-ons überlassen (z. B. Kamera-Add-on holt Streams aus HA).

## 3. Auslieferung als HA-Add-on

**Entscheidung:** Eigenes GitHub-Repo `yapaja-go-ha-addon` (Add-on-Repository-Format),
damit Nutzer es über *Einstellungen → Add-ons → Repositories* hinzufügen können.

Struktur:
```
yapaja-go-ha-addon/
└── yapaja_go/
    ├── config.yaml      # name, slug, arch: [amd64, aarch64], ingress: true,
    │                    # ports: {} (ingress-only) bzw. optional 8080 für Direktzugriff,
    │                    # map: [share:rw]  → Kartendaten unter /share/yapaja (überlebt Updates!),
    │                    # services: [mqtt:need], usb: true (GPS-Maus), udev: true
    ├── Dockerfile       # FROM yapaja/core-Basis; s6-overlay startet:
    │                    # core, valhalla, photon, gpsd (kein Compose in HA-Add-ons)
    ├── rootfs/etc/s6-overlay/...   # Service-Definitionen, Abhängigkeits-Reihenfolge
    └── DOCS.md / README.md / icon.png
```

Kernpunkte:
- **Ingress:** `ingress: true` ⇒ UI erscheint in der HA-Seitenleiste, HA übernimmt
  Auth & Remote-Zugriff (Nabu Casa). Frontend muss unter beliebigem Pfad-Prefix
  laufen (relative URLs, kein hartes `/`) – Anforderung an E01/E07!
  WebSocket über Ingress funktioniert, muss aber explizit getestet werden (E08-T4).
- **MQTT-Credentials automatisch:** `services: [mqtt:need]` ⇒ bashio liefert
  Host/User/Passwort, Core liest sie beim Start.
- **USB-GPS:** `usb: true` + udev; gpsd läuft im Add-on-Container.
- **Kartendaten nach `/share/yapaja/`** (PMTiles, Valhalla-Graph, Photon-Index),
  nicht ins Container-FS – Add-on-Updates dürfen keine Daten-Downloads erzwingen.
- **Ressourcen-Realität:** HAOS-VM braucht dann RAM für HA **und** Yapaja-Services.
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
  - alias: "Yapaja Go: Aufzeichnung beendet -> Benachrichtigung"
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
  - alias: "Yapaja Go: Recorder-Status-Helper setzen"
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
