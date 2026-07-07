# 08 – Wargame-Analyse: Szenarien, Erkennung, vorbereitete Lösungen

**Methode:** Für jedes Szenario ist definiert: *Auslöser* (wie es passiert),
*Erkennung* (wie das System es merkt), *Sofortverhalten* (was der Nutzer erlebt),
*Vorbereitete Lösung* (was bereits im Design/Task eingeplant ist) und *Testabdeckung*.
Jedes Szenario ist einem Epic/Task zugeordnet — nichts davon ist „später mal".

Schweregrade: 🔴 sicherheitsrelevant · 🟠 funktionskritisch · 🟡 Komfort.

---

## A. Fahrbetrieb & Sensorik

### W-01 🟠 GPS-Verlust (Tunnel, Parkhaus, Abschattung)
- **Erkennung:** gpsd `mode < 2` bzw. keine Fixes > 3 s; Browser-Timeout.
- **Verhalten:** Dead-Reckoning entlang der Route mit letzter Geschwindigkeit
  (max. 30 s), Puck grau, Banner „GPS-Signal verloren"; danach Navigations-Pause.
  Ansagen laufen aus Dead-Reckoning weiter (Tunnel-Abfahrten!).
- **Vorbereitet in:** E02-T5 (Fusion/Fallback), E04-T6; UI docs/06 §5.
- **Test:** E2E-Flow 4; Simulator-Mutation „outage".

### W-02 🟠 GPS-Sprung / Drift (Multipath in Häuserschlucht)
- **Erkennung:** PlausibilityGuard: implizite Geschwindigkeit > 300 m/s oder
  Accuracy > 100 m.
- **Verhalten:** Fix verwerfen (max. 3 in Folge, dann akzeptieren — Fähre/Transport-Fall);
  kein Rerouting durch einzelne Ausreißer (Deviation braucht 5 s Bestätigung).
- **Vorbereitet in:** E02-T3; docs/07 §3a.
- **Test:** Unit-Tests mit Ausreißer-Fixtures; Simulator „jump".

### W-03 🟠 Browser verweigert Geolocation / kein HTTPS-Kontext
- **Auslöser:** Geolocation-API braucht Secure Context; LAN-IP via HTTP ⇒ blockiert.
- **Verhalten:** klarer Dialog: (1) gpsd als Quelle wählen, (2) HTTPS/Ingress
  nutzen, (3) `localhost`-Ausnahme erklären.
- **Vorbereitet in:** E02-T2 erkennt `!window.isSecureContext` **vor** dem Request;
  Doku empfiehlt gpsd als Primärquelle im Fahrzeug; HA-Ingress ist immer secure.
- **Test:** E2E-Flow 11.

### W-04 🟡 Rendering bricht ein (< 30 fps auf iGPU, 3D + viele Layer)
- **Erkennung:** fps-Probe im Frontend (rollierender Mittelwert).
- **Verhalten:** **Auto-Degradation** in Stufen: 3D-Gebäude aus → Label-Dichte
  runter → Tilt auf 2D — mit dezentem Hinweis, manuell übersteuerbar.
- **Vorbereitet in:** E01-T6 (Degradationsstufen als Style-Varianten), E07.
- **Test:** Performance-Probe in CI (QEMU-N100-Profil), Budget-Gate.

### W-05 🟠 Falschabbiegung / bewusste Abweichung (Umleitung, Sperrung)
- **Erkennung:** Map-Matching-Distanz > 30 m über 5 s + Heading passt nicht.
- **Verhalten:** stilles Rerouting < 3 s ab aktueller Position mit verbleibenden
  Wegpunkten; kein modaler Dialog; nach 3 Reroutes in 5 min zum selben Punkt ⇒
  Vorschlag „Abschnitt dauerhaft meiden?" (temporäre Vermeidung).
- **Vorbereitet in:** E04-T4/T5.
- **Test:** E2E-Flow 3; Golden-Route „loop trap".

## B. Integration Home Assistant

### W-06 🟠 MQTT-Broker nicht erreichbar (Mosquitto down, HA-Update)
- **Erkennung:** mqtt.js-Verbindungsstatus.
- **Verhalten:** App voll funktionsfähig (MQTT ist nie Kernpfad!); Outbox-Queue
  (letzte Zustände retained beim Reconnect), Exponential-Backoff, Health-Badge.
- **Vorbereitet in:** E08-T1; LWT sorgt HA-seitig für „unavailable"-Entitäten.
- **Test:** Integrationstest: Broker-Container stoppen/starten.

### W-07 🟡 HA-Neustart „vergisst" Discovery-Entitäten
- **Erkennung:** `homeassistant/status = online` abonniert.
- **Verhalten:** Discovery-Configs + retained States sofort erneut publizieren.
- **Vorbereitet in:** E08-T2. **Test:** Integrationstest mit simuliertem HA-Status.

### W-15 🟠 Ingress-Sub-Pfad bricht Frontend (Assets/WS mit absoluten Pfaden)
- **Auslöser:** klassischer HA-Add-on-Fehler: App geht direkt, aber nicht über
  `/hassio_ingress/<token>/`.
- **Vorbereitet in:** Architektur-Regel „nur relative URLs + `<base href>`",
  E01/E07-Akzeptanzkriterium, eigener Reverse-Proxy-E2E-Test (Flow 9) **ab G1 in CI**,
  nicht erst beim Add-on-Bau.

### W-16 🔴 Add-on-/App-Update zerstört Kartendaten oder Einstellungen
- **Vorbereitet in:** Daten strikt außerhalb des Containers (`/share/yapaja`,
  Volume bei Compose); SQLite-Migrationen mit Schema-Version + Backup-Datei vor
  Migration; E2E „Update von v(n−1)" in Release-Pipeline.
- **Test:** E08-T6 Update-/Migrationstest.

## C. Karten-, Routing- & Datenqualität

### W-08 🔴 OSM-Daten unvollständig: Höhen-/Gewichtslimit fehlt an Kante
- **Realität:** Nicht jede 3,2-m-Unterführung ist in OSM getaggt. Das Navi kann
  physisch nicht garantieren, was die Daten nicht hergeben ⇒ Risiko ehrlich managen.
- **Vorbereitet:**
  1. Pflicht-Disclaimer (Erstnutzung + dezent bei Profil > 2,7 m Höhe).
  2. Valhalla-Antwort-Warnung, wenn Route Kanten ohne Restriktionsdaten nutzt
     (`RouteWarning` in API, Banner „Maßangaben unvollständig auf Teilstrecke").
  3. Community-Layer als geplantes Add-on (kuratierte Gefahrstellen-POIs).
  4. Golden-Route-Suite pflegt **bekannte** Problemstellen als Regressionstests.
- **Test:** docs/07 §3b (Merge-Blocker).

### W-09 🟠 Kartenextrakt-Grenze: Ziel außerhalb der installierten Region
- **Erkennung:** Geocoding-Treffer/Zielkoordinate außerhalb Region-Bounds;
  Valhalla „no route found".
- **Verhalten:** präzise Meldung „Ziel liegt außerhalb der installierten Karte
  (Deutschland)" + Direktlink zum Region-Download (statt kryptischem Fehler).
  Grenzüberschreitende Routen brauchen zusammenhängende Extrakte — Region-Manager
  zeigt Abdeckung auf Karte.
- **Vorbereitet in:** E03-T6, Region-Manager E01-T5.
- **Test:** Integrationstest mit Ziel außerhalb des LI-Extrakts.

### W-12 🟠 Photon sprengt RAM-Budget (JVM auf 4-GB-LXC)
- **Erkennung:** Setup-Assistent misst verfügbaren RAM; Health zeigt OOM-Kills.
- **Vorbereitet:** Photon optional (Add-on-Option `photon: false`);
  Fallback-Suchindex SQLite FTS5 (Orte + Straßen aus OSM, in E05-T5 spezifiziert) —
  gleiche `/search`-API, Feld `source: 'photon'|'lite'`; UI zeigt „vereinfachte Suche".
- **Test:** Suite läuft gegen beide Such-Backends.

### W-17 🟡 Kartendaten veraltet (neue Straße, geänderte Limits)
- **Vorbereitet:** `system/info` zeigt OSM-Datum; UI-Hinweis ab 12 Monaten Alter;
  Update-Job (Download bei Internet) mit Resume bei Abbruch (LTE!); Valhalla-Graph-
  Neubau als Hintergrund-Job mit Fortschritt, alte Daten bleiben bis Abschluss aktiv.
- **Test:** Job-Abbruch/Resume-Integrationstest (E01-T5).

### W-18 🟠 Disk voll (Region-Download auf 20-GB-LXC)
- **Erkennung:** Vorab-Check: benötigt vs. frei (Faktor 2,5 für Graph-Bau).
- **Verhalten:** Download verweigern mit klarer Rechnung; nie „halb installieren";
  temporäre Bau-Artefakte nach Erfolg/Fehler löschen.
- **Test:** Integrationstest mit künstlich kleinem Volume.

## D. Add-on-Ökosystem

### W-10 🔴 Bösartiges/fehlerhaftes Add-on will Route manipulieren oder Daten abgreifen
- **Vorbereitet (Design, docs/05):** iframe-Sandbox + eigene Origin; Scoped Tokens
  (nur deklarierte Permissions); `route.propose` erfordert **immer** sichtbare
  Nutzerbestätigung; `net.fetch` nur zu deklarierten Hosts über Core-Proxy;
  Service-Plugins ohne FS-Zugriff außerhalb ihres Datenverzeichnisses;
  Registry-Review-Checkliste; Kill-Switch (Add-on deaktivieren wirkt sofort).
- **Test:** E09-T6 „Sandbox-Escape-Suite": Add-on-Fixture versucht verbotene
  API-Calls, DOM-Zugriff aufs Parent, fremde Topics, undeklarierte Hosts — alles
  muss geblockt und geloggt werden.

### W-11 🟠 Core-Update bricht Add-on-API
- **Vorbereitet:** semver `core_api` im Manifest; beim Core-Start Kompatibilitäts-
  Check ⇒ inkompatible Add-ons werden **deaktiviert mit Hinweis**, nie geladen-und-
  gecrasht; CI-Job „Referenz-Add-ons gegen neuen Core" in jeder Release-Pipeline;
  deprecation policy: v1-API lebt mindestens bis v2+1.
- **Test:** E09-T7.

### W-13 🟡 Store ohne Internet / Registry nicht erreichbar
- **Vorbereitet:** Katalog-Cache mit Zeitstempel („Stand: vor 3 Wochen");
  Offline-Installation per Tarball-Upload; installierte Add-ons laufen immer
  unabhängig vom Registry-Status.
- **Test:** E2E mit geblocktem Registry-Host.

### W-14 🟠 Rechenintensives Add-on (Schildererkennung) legt den Mini-PC lahm
- **Vorbereitet:** solche Add-ons laufen `runtime: external` (eigener Container/
  eigenes Gerät), nur Ergebnisse via API; für Core-gestartete Node-Add-ons:
  CPU-/RAM-Limits (cgroup bei Compose, `resource`-Optionen), Watchdog: Add-on
  > 25 % CPU über 60 s ⇒ Drosselung + Warnung, > 5 Crashes ⇒ Auto-Disable.
- **Test:** E09-T8 mit „Amok-Add-on"-Fixture.

## E. Betrieb & Nutzer

### W-19 🟠 Browser-Tab crasht / Kiosk-Gerät bootet während der Fahrt
- **Vorbereitet:** **Navigationszustand lebt im Core, nicht im Browser.** Neuer
  Tab verbindet sich und ist in < 3 s wieder in der laufenden Navigation
  (NavState + Route via REST, dann WS). PWA-Autostart/Kiosk-Doku (Fully-Kiosk/
  Chromium-Kiosk-Flag).
- **Test:** E2E: Seite mitten in Navigation neu laden ⇒ Drive-Modus restauriert.

### W-20 🟡 Browser-Storage wird evakuiert (Eviction bei Speicherdruck)
- **Vorbereitet:** localStorage ist nur Cache; Quelle der Wahrheit für Layouts/
  Settings/Favoriten ist SQLite im Core; `navigator.storage.persist()` anfordern.
- **Test:** E2E: Storage löschen ⇒ Reload ⇒ alles wieder da.

### W-21 🟡 Mehrere Clients gleichzeitig (Tablet fährt, Handy plant)
- **Vorbereitet:** Core ist Single Source of Truth; alle Clients sehen denselben
  NavState (WS-Broadcast). Steuerkonflikte: letzte Aktion gewinnt, Ereignis-Banner
  („Ziel geändert von Client ‚Handy'"). Kein Locking in v1 (bewusst einfach).
- **Test:** E2E mit zwei Browser-Kontexten.

### W-22 🟠 Zeitzonen/DST: ETA falsch bei Grenzübertritt/Zeitumstellung
- **Vorbereitet:** Core rechnet ausschließlich UTC (`duration_remaining_s` ist
  führend); ETA-Anzeige formatiert der **Client** in lokaler Zone; MQTT liefert
  ISO-8601 mit Offset. Testfälle: Fahrt über DST-Umstellung, Zone-Wechsel.
- **Test:** Unit-Tests ETA-Formatter mit fixierten Zonen.

### W-23 🟡 Sprachansagen kollidieren mit HA-TTS oder fehlen (keine Stimme installiert)
- **Vorbereitet:** Ausgabekanäle exklusiv wählbar (Browser-TTS **oder** HA-Media-
  Player); Web-Speech-Verfügbarkeit wird geprüft, Fallback: Gong + große visuelle
  Anweisung; Ansage-Queue verwirft veraltete Ansagen (nie zwei überlappend).
- **Test:** Unit-Test Ansage-Queue; manueller Hardware-Check.

---

## Wargame-Pflege

Neue erkannte Risiken werden hier als W-nn ergänzt **bevor** ein Fix-Task erstellt
wird (erst denken, dann bauen). Jeder Post-Mortem eines echten Vorfalls endet mit
einem neuen W-Eintrag + Testfall.
