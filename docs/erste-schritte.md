# Erste Schritte

Diese Anleitung setzt eine erfolgreich abgeschlossene Installation voraus
(siehe [Installations-Guide](installation.md)) und führt einmal komplett
durch: Fahrzeugprofil anlegen → Ziel suchen → Route berechnen → Navigation
starten. Die Screenshots/UI-Beschreibungen orientieren sich am
Grundlayout aus `docs/06-ui-ux-guidelines.md` §1.

## 1. App öffnen

- **HA-Add-on:** über die Home-Assistant-Seitenleiste (Ingress).
- **Compose/Proxmox-LXC:** `http://<Host-IP>:8080/` im Browser.

Du landest im **Explore-Modus**: eine Karte, oben eine Suchleiste, unten ein
einziehbares Favoriten-Panel. Läuft noch kein GPS, zeigt der Positionspunkt
entweder gar nichts oder eine „ungenau"-Kennzeichnung — das ist normal ohne
angeschlossenen Empfänger (siehe unten, „Ohne echtes GPS testen").

## 2. Fahrzeugprofil anlegen

Ohne Profil nutzt die App ein generisches PKW-Profil — für ein Wohnmobil
solltest du zuerst ein eigenes Profil mit den echten Maßen anlegen, **bevor**
du die erste Route berechnest, damit Höhen-/Gewichts-/Breitenbeschränkungen
von Anfang an greifen.

1. Oben rechts auf das Profil-Symbol (🚐) tippen.
2. „Neues Profil" wählen, Werte eintragen:
   - **Höhe** (1,0–4,5 m), **Breite** (1,5–3,0 m), **Länge** (3,0–20,0 m),
     **Gewicht** (1,0–40,0 t) — jeweils inklusive Dachlast/Antenne/Beladung,
     nicht nur die Herstellerangabe.
   - **Durchschnittsgeschwindigkeit** (40–130 km/h) — beeinflusst nur die
     ETA-Berechnung, nicht das Routing selbst.
   - **Vermeiden**: Autobahn / Maut / Fähre / unbefestigte Wege — je nach
     Vorliebe an- oder abwählen.
3. Speichern, dann das neue Profil **aktivieren** (falls es nicht automatisch
   das aktive wird — nur ein Profil ist gleichzeitig aktiv).

**Wichtig:** Lies bei einer Profil-Höhe über 2,7 m den eingeblendeten
Warnhinweis zu unvollständigen Kartendaten (siehe
[Troubleshooting W-08](troubleshooting.md#w-08--route-führt-an-einer-zu-engenniedrigen-stelle-vorbei-)) —
er erklärt eine echte, physische Grenze der Kartendaten, keine
Software-Unsicherheit.

## 3. Ziel suchen

1. In die Suchleiste tippen, z. B. `Vaduz` eingeben.
2. Aus der Trefferliste den gewünschten Ort wählen (Tippfehler-Toleranz ist
   eingebaut — auch `Müchen` findet in der Regel `München`).
3. Die App zeigt eine Vorschau: Ziel-Pin, Entfernung, grobe Fahrzeit.

## 4. Route berechnen

1. Auf „Route berechnen" (bzw. direkt auf das gewählte Suchergebnis) tippen.
2. Die App berechnet die Route **mit dem aktiven Fahrzeugprofil** — die
   Route respektiert die eingetragenen Maße (getestet u. a. gegen bekannte
   Unterführungen, siehe `docs/07-testing-qa.md` §3b „Maßrestriktionen").
3. Bei mehreren Alternativen: die erste vorgeschlagene ist die empfohlene.
4. Prüfe die Routenübersicht (Distanz, Dauer, ggf. Warnhinweise zu
   unvollständigen Kartendaten) **bevor** du losfährst.

## 5. Navigation starten

1. „Navigation starten" tippen — die App wechselt in den **Drive-Modus**
   (Kurs-oben-Karte, großes Manöver-Panel, Tempolimit-Anzeige, Bottom-Bar mit
   Tempo/ETA/Restdistanz/Höhe).
2. Sprachansagen beginnen automatisch (Browser-TTS bzw. HA-Media-Player, je
   nach Einstellung).
3. Während der Fahrt: die App reroutet automatisch bei Abweichungen
   (< 3 s, siehe [Troubleshooting W-05](troubleshooting.md#w-05--app-berechnet-nach-einer-abzweigung-automatisch-neu)),
   pausiert bei GPS-Verlust automatisch per Koppelnavigation
   ([W-01](troubleshooting.md#w-01--gps-signal-verloren-tunnel-parkhaus-abschattung))
   und meldet sich mit „Angekommen", sobald das Ziel erreicht ist.
4. Navigation jederzeit pausierbar/abbrechbar über die Schaltflächen unten
   rechts im Drive-Modus (⏸/✕).

## 6. Ohne echtes GPS testen (Simulator)

Für einen ersten Eindruck ohne angeschlossenes GPS-Gerät und ohne echte
Fahrt kann eine Route per eingebautem GPS-Simulator „abgefahren" werden:

```bash
curl -X PUT http://localhost:8080/api/v1/position/source \
  -H 'Content-Type: application/json' -d '{"source":"simulator"}'

curl -X POST http://localhost:8080/api/v1/simulator/play \
  -H 'Content-Type: application/json' \
  -d '{"track":{"type":"route","route_id":"<ID der zuvor berechneten Route>"},"speed_factor":4}'
```

(`speed_factor: 4` spielt die Route 4× so schnell ab wie in Echtzeit — für
einen schnellen ersten Eindruck. `docs/03-api-spec.md` §„Position"/§2
beschreibt weitere Track-Typen, u. a. GPX-Dateien und absichtliche
Falschabbiegungen für einen Rerouting-Test.)

## 7. Favoriten & Widgets anpassen

- **Favorit anlegen:** auf der Routenübersicht bzw. im Ziel-Kontextmenü
  „Als Favorit speichern" wählen (Kategorien: Home/Stellplatz/POI/eigene) —
  erscheint danach im Bottom-Drawer des Explore-Modus.
- **Widgets verschieben:** im Drive- oder Explore-Modus lange auf eine freie
  Fläche drücken → Bearbeitungsmodus mit Raster erscheint → Widgets per
  Drag & Drop in andere Slots ziehen, Größe wählen (S/M/L). „Zurücksetzen
  auf Standard" ist im selben Menü verfügbar, falls etwas schiefgeht.

## Weiter

- Etwas funktioniert nicht wie erwartet? → [Troubleshooting](troubleshooting.md)
- Allgemeine Fragen? → [FAQ](faq.md)
- Add-ons installieren/entwickeln? → [Add-on-Entwicklungsleitfaden](addon-dev-guide.md)
