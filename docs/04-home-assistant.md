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

## 5. Wargame-Bezüge (Details docs/08)

- W-06 MQTT-Broker down ⇒ Queue + Reconnect, App voll funktionsfähig ohne HA.
- W-07 HA-Neustart ⇒ Discovery-Replay via `homeassistant/status`.
- W-15 Ingress-Pfad bricht Assets ⇒ Pflichttest „App unter Sub-Pfad" in CI.
- W-16 Add-on-Update löscht Karten ⇒ Daten in `/share`, Migrationstest.
