# FAQ

Kurze Antworten auf wiederkehrende Fragen. Für konkrete Fehlerbilder siehe
[Troubleshooting](troubleshooting.md) — dort steht Symptom → Ursache →
Lösung für jeden kritischen Fall.

**Braucht Yapaja Go eine Internetverbindung?**
Nein, im laufenden Betrieb nicht. Karten, Routing (Valhalla) und Suche
(Photon bzw. die eingebaute Lite-Suche) laufen vollständig offline, sobald
eine Kartenregion einmal heruntergeladen und der Routing-Graph gebaut wurde.
Internet wird nur für den **einmaligen** Kartenregion-Download/-Update
gebraucht (siehe [Installations-Guide](installation.md) und
`docs/data-update-runbook.md`) sowie optional für den Add-on-Store-Katalog
(fällt bei fehlendem Internet auf einen zwischengespeicherten Katalogstand
zurück, siehe W-13 in `docs/08-wargame.md`).

**Welches GPS-Gerät wird empfohlen?**
Ein externer USB-GPS-Empfänger mit Fensterhalterung/Außenantenne
(u-blox-Chipsatz-basierte „GPS-Mäuse" sind verbreitet und günstig) statt
eines im Gehäuse verbauten Empfängers — deutlich zuverlässigerer Empfang im
Fahrzeug. Siehe [Installations-Guide → USB-GPS-Durchreichung](installation.md#usb-gps-durchreichung)
für die Einrichtung.

**Kann ich Yapaja Go ohne echtes GPS ausprobieren?**
Ja — der eingebaute GPS-Simulator kann jede berechnete Route (oder eine
GPX-Datei) mit einstellbarer Geschwindigkeit „abfahren". Siehe
[Erste Schritte → Abschnitt 6](erste-schritte.md#6-ohne-echtes-gps-testen-simulator).

**Warum weicht die Route manchmal von der „offensichtlich kürzesten" ab?**
Das aktive Fahrzeugprofil (Höhe/Breite/Länge/Gewicht, ggf. Autobahn-/Maut-/
Fähre-Vermeidung) schränkt die Routenwahl bewusst ein — eine für ein
3,5-t-Wohnmobil zulässige Straße kann für ein 7,5-t-Fahrzeug gesperrt sein.
Prüfe zuerst das aktive Profil (Profil-Symbol oben rechts), bevor du eine
Route als „falsch" einordnest.

**Kann sich die App auf fehlende Kartendaten (z. B. eine fehlende
Höhenbeschränkung) verlassen?**
Nein — das ist eine bewusst offen kommunizierte Grenze, kein Software-Bug.
Nicht jede reale Unterführung/Brücke ist in OpenStreetMap mit einer
Maßangabe getaggt. Details und was zu tun ist:
[Troubleshooting W-08](troubleshooting.md#w-08--route-führt-an-einer-zu-engenniedrigen-stelle-vorbei-).

**Was passiert, wenn während der Fahrt das GPS-Signal kurz weg ist (Tunnel,
Parkhaus)?**
Die App fährt bis zu 30 Sekunden per Koppelnavigation mit der letzten
bekannten Geschwindigkeit entlang der Route weiter, Sprachansagen laufen
normal weiter (wichtig für Tunnelabfahrten). Details:
[Troubleshooting W-01](troubleshooting.md#w-01--gps-signal-verloren-tunnel-parkhaus-abschattung).

**Was passiert, wenn der Browser-Tab abstürzt oder das Kiosk-Gerät während
der Fahrt neu startet?**
Nichts Schlimmes — der eigentliche Navigationszustand lebt im Core-Server,
nicht im Browser. Nach dem Neuladen ist die laufende Navigation innerhalb
weniger Sekunden automatisch wieder da. Details:
[Troubleshooting W-19](troubleshooting.md#w-19--navigation-scheint-nach-tab-crashneustart-weg-zu-sein).

**Kann ich mehrere Geräte gleichzeitig nutzen (z. B. Tablet im Cockpit +
Handy zum Planen)?**
Ja, alle verbundenen Clients sehen denselben Navigationszustand (WebSocket-
Broadcast) — der Core ist die alleinige Quelle der Wahrheit. Bei
gleichzeitigen widersprüchlichen Aktionen gewinnt die zuletzt ausgeführte,
mit sichtbarem Hinweis, welcher Client sie ausgelöst hat (siehe W-21 in
`docs/08-wargame.md`; kein Locking in v1, bewusst einfach gehalten).

**Wie installiere/entferne ich ein Add-on sicher?**
Nur aus dem Store (dort durchlaufen Add-ons eine Review-Checkliste) und nur
mit den beim Installieren angezeigten, tatsächlich benötigten
Berechtigungen. Jedes Add-on läuft in einer Sandbox mit Default-Deny für
alles Nicht-Deklarierte; ein Kill-Switch (sofortiges Deaktivieren) ist
jederzeit verfügbar. Details:
[Troubleshooting W-10](troubleshooting.md#w-10--add-on-verhält-sich-verdächtig-)
und der [Add-on-Entwicklungsleitfaden](addon-dev-guide.md) für Add-on-Autoren.

**Überlebt ein Update meine Kartendaten und Einstellungen?**
Ja — alle Nutzdaten liegen bewusst außerhalb des jeweiligen Containers
(HA-Add-on: `/share/yapaja`; Compose: eigenes Docker-Volume unter `./data`)
und werden von einem Image-Update nicht angefasst; SQLite-Migrationen legen
zusätzlich automatisch eine Sicherungsdatei an. Vor größeren Updates trotzdem
ein Backup anlegen (siehe [Installations-Guide → B.5](installation.md#b5-backup-vor-einem-update)).
Sollte trotzdem etwas fehlen: [Troubleshooting W-16](troubleshooting.md#w-16--nach-einem-update-fehlen-kartendaten-oder-einstellungen-).

**Wo finde ich die REST-API-Referenz für eigene Skripte/Add-ons?**
`docs/03-api-spec.md` für den erzählenden Überblick, und
[`docs/openapi.json`](openapi.json) für die maschinenlesbare, aus dem
tatsächlich laufenden Code generierte OpenAPI-3.1-Spezifikation (Details zur
Generierung: `apps/core/src/openapi/`). Für Add-on-Entwicklung speziell:
der [Add-on-Entwicklungsleitfaden](addon-dev-guide.md).

**Wie viel RAM brauche ich mindestens?**
Kommt stark auf Kartengröße und ob Photon-Suche aktiv ist an — die konkrete
Tabelle steht in `docs/01-architecture.md` §4 und, für den HA-Add-on-Fall
speziell (geteilte VM mit HA selbst), in
`yapaja_go/DOCS.md` §„RAM recommendation". Bei knappem RAM: Photon
deaktivieren (`photon_enabled: false` bzw. `PHOTON_ENABLED=false`) —
Suche fällt automatisch auf einen deutlich schlankeren Offline-Index zurück
([Troubleshooting W-12](troubleshooting.md#w-12--suche-reagiert-nicht-mehrvereinfachte-suche)).
