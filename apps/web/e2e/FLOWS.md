# E2E-Pflicht-Flows 1–11 (docs/07 §5)

Diese Datei ist die **verbindliche Zuordnung** der elf Pflicht-Flows aus
`docs/07-testing-qa.md` §5 zu den Tests, die sie beweisen (E10-T1).

## Konvention

Jeder Flow wird von genau einem **kanonischen Test** bewiesen, dessen Titel mit
`[Flow N]` beginnt. Damit ist der komplette Pflicht-Satz jederzeit auffindbar
und einzeln lauffähig:

```bash
cd apps/web

# alle 11 Flows (13 Tests, weil Flow 4 und Flow 5 je zwei Hälften haben)
npx playwright test --grep "\[Flow "

# ein einzelner Flow
npx playwright test --grep "\[Flow 3\]"

# der Nachweis-Lauf (Akzeptanzkriterium 3: retries 0)
npx playwright test --grep "\[Flow " --retries=0
```

Neue kanonische Flow-Specs liegen als `flow-NN-<kurzname>.spec.ts` direkt in
`apps/web/e2e/`. Flows, die schon vorher vollständig durch eine bestehende Spec
belegt waren, wurden **nicht** dupliziert — dort trägt der bestehende Test das
`[Flow N]`-Präfix (und wurde um die fehlenden API-Assertions ergänzt).

## Die Tabelle

Spalte „API" und „UI" erfüllen die Plausibilitätsanforderung des Tasks:
**jeder Flow prüft seinen Endzustand über API UND UI**, nie nur über die
Oberfläche.

| # | Flow (docs/07 §5) | Kanonischer Test | Endzustand via **API** | Endzustand via **UI** |
|---|---|---|---|---|
| 1 | Kaltstart offline ⇒ Karte interaktiv < 5 s | `flow-01-cold-start-offline.spec.ts` | `GET /api/v1/health` ok; `GET /api/v1/map/regions` liefert die installierte Region; die Kamera steht in deren `bounds`; die geladenen Tiles gehören zu genau dieser Region | Canvas sichtbar; OSM-Attribution gerendert; echte Maus-Drag-Geste bewegt die Kamera (⇒ wirklich *interaktiv*, nicht nur gemalt); Messung < 5 s |
| 2 | Suche „Vaduz" ⇒ Route mit „Camper 3,2 m" ⇒ Navigation ⇒ Manöver ⇒ Ankunft | `flow-02-search-route-navigate-arrive.spec.ts` | `GET /api/v1/profiles` (Camper aktiv, `height_m: 3.2`); abgefangener `POST /api/v1/routes`-Body trägt `profile_id` des Campers + Vaduz als Ziel; `GET /api/v1/navigation/state` ⇒ `navigating` → `arrived`, `route_id`/`destination.name` korrekt, `distance_remaining_m` fällt monoton | Profil-Chip zeigt „Camper 3,2 m"; Suchergebnis „Vaduz"; Ziel-Sheet mit echtem Namen; Routen-Summary; Manöver-Panel wechselt Landstraße → Äulestraße → Städtle; Panel verschwindet bei Ankunft |
| 3 | Falschabbiegung (Simulator-Mutation) ⇒ Rerouting < 3 s ⇒ neue Anweisung | `flow-03-wrong-turn-reroute.spec.ts` | `GET /api/v1/navigation/state` ⇒ neue `route_id`, zurück auf `navigating`, `next_maneuver.street_names` enthält die nur auf der neuen Route existierende Straße; Valhalla-Stub-Zähler beweist **genau einen** echten Reroute-Request | Manöver-Panel zeigt die **neue** Anweisung („Umleitungsweg") |
| 4 | GPS-Verlust 45 s ⇒ „Signal verloren" ⇒ nahtlose Wiederaufnahme | `gps-loss.spec.ts` (2 Tests) | `GET /api/v1/simulator/status` ⇒ weiterhin `playing`, `tickS` > Ende des Ausfallfensters (Playback lief durch, kein Neustart); `GET /api/v1/position` ⇒ 200 mit frischem `source: 'simulator'`-Fix | Kein verfrühter Banner (atomarer Store+DOM-Snapshot statt Sleep); „GPS-Signal verloren" während des Ausfalls; Banner verschwindet bei Wiederaufnahme; Puck-Paint-Transitions statt Hart-Snap |
| 5 | Profilwechsel während Navigation ⇒ Reroute + Warnbanner | `profile-reroute.spec.ts` (2 Tests) | `GET /api/v1/navigation/state` ⇒ neue `route_id`, `navigating`; `GET /api/v1/profiles` ⇒ `is_active` am neuen (bzw. bei „Abbrechen" am alten) Profil; Valhalla-Stub-Zähler beweist Reroute bzw. **kein** Reroute | Bestätigungs-Banner „Mit '…' neu berechnen?"; > 15 %-Warnbanner (25 %) und dessen Dismiss; bei „Abbrechen" unveränderte Anzeige |
| 6 | Favorit anlegen → Reload → vorhanden → Route via Favorit | `favorites.spec.ts` | `GET /api/v1/favorites` ⇒ Favorit persistiert mit Name + `category: 'campsite'` + Koordinaten; Routing-Store-Ziel stimmt in Name **und** Koordinaten mit genau diesem Datensatz überein | Favoriten-Chip nach Reload sichtbar (inkl. ⛺-Icon); Tap ⇒ Ziel-Sheet mit Favoritennamen + Routen-Summary |
| 7 | Widget verschieben → Reload → Layout persistiert | `shell-edit.spec.ts` | `GET /api/v1/settings` ⇒ `layouts.drive.slots`: `altitude` liegt in `side-panel`, **nicht mehr** in `bottom-bar` (serverseitig, nicht nur localStorage) | Widget nach Reload im neuen Slot, alter Slot leer |
| 8 | MQTT `cmd/destination` ⇒ `nav/state` = `navigating`; alle Status-Topics valide | `flow-08-mqtt-command.spec.ts` | Auf dem Broker: `yapaja/status` = `online`, `yapaja/nav/state` = `navigating`, `cmd/result` mit durchgereichter `request_id`; alle acht Status-Topics vorhanden und Payload-Form geprüft (`position`, `nav/eta`, `nav/speed`, `nav/altitude`, `nav/destination`, `route/summary`); zusätzlich `GET /api/v1/navigation/state` = `navigating` | Der am selben Core hängende Browser wechselt **von selbst** in den Drive-Modus (Manöver-Panel, Straße „Zielstraße") |
| 9 | Ingress-Sub-Pfad ⇒ Assets, WS und Tiles laden | `subpath.spec.ts` | `GET <prefix>/api/v1/health` ok; `<prefix>/api/v1/map/regions` liefert die Region, deren Tiles geladen wurden; Range-Request auf `<prefix>/tiles/…` ⇒ 206 | App lädt unter `/hassio_ingress/<token>/`; Canvas + Attribution; **WS verbindet** (`isConnected`) und alle WS-URLs liegen unter dem Prefix; jede einzelne Request-Pathname beginnt mit dem Prefix |
| 10 | Add-on aus Registry-Fixture ⇒ Layer ⇒ deinstallieren ⇒ rückstandsfrei | `flow-10-addon-install-uninstall.spec.ts` | `GET /api/v1/addons` ⇒ installiert+aktiviert, danach **nicht mehr gelistet**; Dateisystem: Code-Verzeichnis **und** `storage.own`-Verzeichnis nach Uninstall beide weg | Store-Panel-Install über die echte Registry; Add-on-iframe + MapLibre-Layer sichtbar (200 POIs); nach Uninstall iframe, Layer und Widget weg — auch nach Reload |
| 11 | Geolocation denied ⇒ verständlicher Hinweis + gpsd-Hinweis | `flow-11-permission-denied.spec.ts` | `GET /api/v1/position` ⇒ 204 (nie eine Position erhalten); `GET /api/v1/position/sources` ⇒ `active`/`forced` beide `null`; kein einziger `POST /api/v1/position/browser` | Hinweis-Banner mit `data-geolocation-error="permission-denied"`, Text „Standortzugriff verweigert" + Handlungsoptionen inkl. **gpsd**; App bleibt bedienbar |

## Abweichungen von der wörtlichen Spec (bewusst, begründet)

Diese Abweichungen folgen dem, was das Repo an anderer Stelle bereits
entschieden und dokumentiert hat — sie sind **nicht** neu erfunden:

1. **„Compose-Setup" → echte gebaute Core-Prozesse.**
   `support/globalSetup.ts` + `support/coreProcess.ts` bauen die echten
   Produktionsartefakte (`pnpm --filter @yapaja/{web,core} build`), stagen
   `apps/web/dist` genau wie `apps/core/Dockerfile` es tut, und starten pro
   Szenario einen eigenen Core-Prozess auf einem eigenen Port mit
   `DB_PATH=:memory:` (⇒ frische DB je Suite, kein geteilter Zustand).
   Getestet wird damit dasselbe Artefakt, das Compose ausliefert, ohne
   Docker-Abhängigkeit in CI.

2. **„mosquitto-Testcontainer" → echter In-Process-`aedes`-Broker.**
   Exakt dieselbe Entscheidung (und Begründung) wie im Header von
   `apps/core/src/mqtt/bridge.integration.test.ts`: CI hat keinen
   Broker-Service und keine Testcontainers-Infrastruktur. Der Broker in
   `support/mqttBroker.ts` ist ein **echter** MQTT-Broker auf einem echten
   Loopback-Port; Core und Test-Beobachter sprechen beide mit dem echten
   `mqtt.js`-Client. Nur der Container fehlt, nicht das Protokoll.

3. **„Reverse-Proxy im Compose-Testsetup" → `support/subpathServer.ts`.**
   Ein echter Reverse-Proxy im Testprozess: statisch unter dem Prefix,
   HTTP-Proxy für `/api` + `/tiles` inkl. Range-Requests, und (neu in E10-T1)
   echtes WebSocket-`Upgrade`-Forwarding.

4. **Flow 4: 45 Sekunden in SIMULIERTER Zeit.**
   Der Ausfall dauert die vollen 45 Sekunden des Flows, wird aber über
   `speed_factor: 5` auf 9 s Wanduhr komprimiert — immer noch 3× über der
   3-s-Schwelle des Produkts. Das ist genau die vom Task geforderte
   Determinismus-Regel „Simulator statt Echtzeit (speed_factor)".

5. **Flow 3: was die „< 3 s" messen.**
   Vor jedem Reroute liegt eine **absichtliche** Anti-Rausch-Bestätigung von
   ≥ 5 s / ≥ 5 Fixes (`CONFIRM_MIN_MS`/`CONFIRM_MIN_FIXES` in
   `navigation/reroute.ts`). Das Budget wird deshalb ab dem Moment gemessen,
   in dem der Core den Router tatsächlich fragt, bis die neue Route aktiv ist.
   Beide Werte werden geloggt (gemessen: ~20 ms Reroute, ~5,0 s inkl.
   Bestätigungsfenster).

## Determinismus-Regeln, die für die Flow-Specs gelten

- **Keine sleep-basierten Waits** in den kanonischen Flow-Specs: gewartet wird
  auf Events (`waitForResponse`), auf Zustand (`expect.poll`,
  `waitForFunction`) oder auf atomare Store+DOM-Snapshots.
- **Simulator statt Echtzeit**: Flows 2, 3 und 4 fahren über
  `POST /api/v1/simulator/play` mit `speed_factor`.
- **Netzwerk-Blocks**: `support/network.ts` bricht jede nicht-gleichnamige
  Origin hart ab; Flows 1, 2, 3, 9, 10, 11 asserten `getForeignUrls() === []`.
- **Testdaten-Isolation**: eigener Core-Prozess pro Szenario, jeweils mit
  `DB_PATH=:memory:`, eigenen Tiles-/Add-on-/Storage-Verzeichnissen.
- **Artefakte bei Fehlschlag**: `trace: 'retain-on-failure'` und
  `screenshot: 'only-on-failure'` (`playwright.config.ts`).

## Debug-Hilfe

Wenn eine Flow-Spec scheitert, weil der **Core** intern etwas entschieden hat
(z. B. einen Reroute abgelehnt), sind die Core-Logs sichtbar mit:

```bash
E2E_CORE_LOGS=1 npx playwright test e2e/flow-03-wrong-turn-reroute.spec.ts
```

Jede Zeile wird mit `[core:<port>]` präfixiert. Genau so wurde in E10-T1
gefunden, dass Flow 3 anfangs an `„origin liegt außerhalb der installierten
Kartenabdeckung"` scheiterte (Test-Fixture außerhalb der Fixture-Region).
