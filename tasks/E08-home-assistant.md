# E08 – Home-Assistant-Integration (MQTT, Add-on, Ingress)

**Ziel:** Alle Nav-Parameter in HA (MQTT + Discovery), Steuerung aus HA,
Auslieferung als HA-Add-on. **Gate-Beitrag G3.**

---

## E08-T1: MQTT-Bridge im Core

- **Abhängigkeiten:** E04 (Events existieren) · **Kontext:** docs/03 §4 KOMPLETT; docs/04 §1; Wargame W-06 · **Neue Deps:** mqtt (mqtt.js)
- **Pfade:** `apps/core/src/mqtt/`

**Aufgabe:** MQTT-Client (Broker/User/Pass/Prefix aus Settings bzw. Env):
verbindet mit **LWT** (`yapaja/status offline`, retained), published `online`.
Bus→MQTT-Mapping exakt nach docs/03 §4 (Topics, Payloads, Retain-Flags,
Raten: Position 1 Hz fahrend / 0,1 Hz stehend; `extrapolated:true`-Positionen
werden NICHT als `yapaja/position` publiziert — E02-T5-Stub einlösen).
Kommando-Subscriber für alle `yapaja/cmd/*`: validieren (shared-Schemata),
auf Core-Aktionen mappen, IMMER `yapaja/cmd/result` antworten (inkl.
request_id-Durchreichung). Offline-Verhalten (W-06): Reconnect-Backoff 1→60 s,
Zustands-Topics werden bei Reconnect frisch publiziert (kein Event-Replay),
Health-Service-Eintrag `mqtt`.

**Akzeptanz:** 1. Gegen mosquitto-Testcontainer erscheinen alle Status-Topics
mit schema-validen Payloads während einer Simulator-Fahrt; 2. jedes cmd wirkt +
result kommt (inkl. Fehlerfall: unbekannter Favorit → ok:false); 3. Broker-Stopp/
Start → LWT feuert, Reconnect published Zustände neu; 4. App bleibt ohne Broker
voll funktional.
**Pflicht-Tests:** Integration (Testcontainer) für alle Topics + alle cmds +
Reconnect; Unit: Raten-Drossel, extrapolated-Filter.
**Plausibilität:** Retained-Topics nach Reconnect == aktueller Zustand
(kein veralteter Rest); `speeding` in nav/speed stimmt mit speed vs limit überein.

---

## E08-T2: HA-Auto-Discovery

- **Abhängigkeiten:** E08-T1 · **Kontext:** docs/04 §1 Tabelle KOMPLETT; Wargame W-07
- **Pfade:** `apps/core/src/mqtt/discovery.ts`

**Aufgabe:** Discovery-Configs (retained) für ALLE Entitäten der Tabelle in
docs/04 §1 publizieren: korrekte `component`-Typen, `device`-Block (identifiers
yapaja_go, name, sw_version, configuration_url), `availability` via
yapaja/status, device_class/unit/state_class wo sinnvoll, `value_template`s
für JSON-Payloads. `select.yapaja_profile`-Options dynamisch aus Profilliste
(bei Profil-CRUD: Discovery-Update). Republish bei `homeassistant/status online`
(W-07). Prefix `homeassistant` konfigurierbar. Abschaltbar (Setting
`mqtt.discovery: false`).

**Akzeptanz:** 1. Gegen echtes HA (docker-compose-Testsetup mit HA-Container,
nightly) erscheinen alle Entitäten am Gerät „Yapaja Go" und zeigen Werte einer
Simulator-Fahrt; 2. HA-Neustart-Simulation → Entitäten wieder da; 3. Button/
Select in HA steuern die App nachweislich.
**Pflicht-Tests:** Unit: Config-Payloads gegen eingefrorene Snapshots (jede
Entität); Integration: status-online-Replay; nightly HA-E2E (Flow 8 erweitert).
**Plausibilität:** `sensor.yapaja_instruction`-Attribut `icon` ist für jeden
ManeuverType ein existierender mdi-Name (Tabellentest gegen mdi-Namensliste).

---

## E08-T3: REST-Steuerung & HA-Ausgabekanal

- **Abhängigkeiten:** E04-T5, E05 · **Kontext:** docs/04 §2; docs/03 §2
- **Pfade:** `apps/core/src/ha/`, `apps/core/src/auth/`

**Aufgabe:** (a) Token-Auth für die Core-API standalone: Bearer-Token, in
Settings-UI generierbar/rotierbar; `/api/v1/health` bleibt offen; WS
authentifiziert via Query-Token oder Cookie; im Ingress-Modus (Env
`INGRESS_MODE=1`) Auth deaktiviert + Bind nur auf Ingress-Interface.
(b) `navigation/destination` mit `query` fertigstellen (SearchService da).
(c) HA-Ausgabekanal: optionaler Ansage-Sink „HA-TTS" (Settings: HA-URL+Token
oder Supervisor-Proxy; Service-Call `tts.speak`/media_player target
konfigurierbar) als Alternative zu Browser-TTS (W-23: exklusiv wählbar);
HA-Notification bei `event/arrived` und `event/gps_lost_paused` (Toggle).

**Akzeptanz:** 1. Ohne Token: 401 auf alles außer health (Security-Test-Suite);
2. `rest_command`-Beispiel aus Doku funktioniert gegen Testinstanz (nightly);
3. Ansage-Kanal exklusiv umschaltbar, HA-Calls mit Timeout+Fehler-Log.
**Pflicht-Tests:** Auth-Matrix (REST+WS, mit/ohne/falsches Token, Ingress-Modus);
destination-query-Integration; HA-Call-Mocks inkl. Fehlerpfade.
**Plausibilität:** Token erscheint nie in Logs (Log-Scan-Test).

---

## E08-T4: HA-Add-on-Packaging

- **Abhängigkeiten:** E08-T1–T3, E00-T3 · **Kontext:** docs/04 §3 KOMPLETT; Wargame W-15/W-16
- **Pfade:** `ha-addon/`

**Aufgabe:** Add-on nach docs/04 §3 bauen: `config.yaml` (ingress, arch,
map share:rw, services mqtt:need, usb+udev, options/schema: region, mqtt-prefix,
photon on/off, gps_source, log_level, memory-Tuning), Dockerfile auf Basis des
Core-Images + s6-overlay-Services (core, valhalla, photon optional, gpsd) mit
Abhängigkeits-Reihenfolge und sauberem Shutdown. bashio: MQTT-Credentials
automatisch beziehen. Daten unter `/share/yapaja/` (W-16). Ingress: Core liest
`X-Ingress-Path` und setzt `<base href>` dynamisch beim Ausliefern von
index.html; WS-Pfad relativ. DOCS.md mit RAM-Empfehlung (docs/04 §3).

**Akzeptanz:** 1. Add-on installiert auf frischem HAOS (VM-Testprotokoll im PR,
manuell oder nightly-VM), UI über Seitenleiste voll funktional inkl. Karte, WS,
Tiles (W-15!); 2. MQTT auto-konfiguriert; 3. Add-on-Update von Vorversion:
Karten+DB bleiben (W-16-Test); 4. USB-GPS-Doku + gpsd-Start bei vorhandenem Gerät.
**Pflicht-Tests:** CI: Add-on-Build (Supervisor-Builder-Action) + Lint
(`frenck/action-addon-linter`); Ingress-Simulation bleibt in PR-CI (Flow 9).
**Plausibilität:** Ohne konfigurierte Region startet das Add-on in einen
Onboarding-Zustand (Region wählen) statt zu crashen.

---

## E08-T5: Onboarding-/Setup-Assistent

- **Abhängigkeiten:** E01-T5, E08-T1 · **Kontext:** docs/04; Wargame W-12/W-18
- **Pfade:** `apps/web/src/onboarding/`

**Aufgabe:** Erststart-Wizard: (1) Sprache/Einheiten, (2) Haftungs-Disclaimer
(docs/00, Pflicht-Zustimmung, versioniert), (3) Region wählen+laden (mit
RAM/Disk-Check-Anzeige, W-12/W-18: bei < 3 GB frei → Photon-off-Empfehlung),
(4) Fahrzeugprofil anlegen (E06-Editor eingebettet), (5) GPS-Quelle wählen+testen
(Live-Status), (6) optional MQTT (im Add-on: „automatisch konfiguriert"-Anzeige).
Wizard überspringbar ab Schritt 3, wieder aufrufbar aus Settings. Zustand
serverseitig (`settings.onboarding_state`).

**Akzeptanz:** 1. Frische Instanz führt bis zur fahrbereiten App ohne Doku-Blick;
2. Abbruch mitten im Region-Download → Wizard nimmt an gleicher Stelle wieder auf;
3. Disclaimer-Zustimmung persistiert mit Version+Datum.
**Pflicht-Tests:** Playwright: kompletter Wizard mit Fixture-Region; Resume-Test;
Disclaimer-Gate (ohne Zustimmung keine Navigation startbar).
**Plausibilität:** Empfehlungen (Photon off etc.) basieren auf echten Messwerten
des Systems, nicht Hardcodes.

---

## E08-T6: Update- & Migrations-Sicherheit

- **Abhängigkeiten:** E08-T4 · **Kontext:** Wargame W-16
- **Pfade:** `apps/core/src/db/migrations/`, `e2e/upgrade/`

**Aufgabe:** SQLite-Migrationsrunner (nummerierte Migrationen, Schema-Version-
Tabelle, **Backup-Kopie der DB vor jeder Migration**, Rollback-Doku).
Upgrade-E2E: Compose-Setup startet Version n−1 (letztes Release-Image), erzeugt
Daten (Profile, Favoriten, Layout), wechselt aufs neue Image → alles vorhanden,
Migrationslog sauber. Dieser Test läuft in der Release-Pipeline (docs/07 §6).

**Akzeptanz:** 1. Migrationsrunner deterministisch+idempotent (zweiter Lauf: no-op);
2. Upgrade-E2E grün; 3. fehlschlagende Migration lässt Backup intakt und Core
verweigert Start mit klarer Meldung (kein Betrieb auf halbem Schema).
**Pflicht-Tests:** Runner-Unit (inkl. Fehler-Migration-Fixture); Upgrade-E2E.
**Plausibilität:** Backup-Dateien werden rotiert (max 3) — kein Disk-Fressen.
