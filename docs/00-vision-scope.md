# 00 – Vision & Scope

## Produktvision

Yapaja Go ist die Navigations-Zentrale für das vernetzte Wohnmobil:
eine browserbasierte Turn-by-Turn-Navigation, die **komplett offline** funktioniert,
**Fahrzeugmaße und -gewicht** bei der Routenberechnung respektiert und sich nahtlos in
**Home Assistant** integriert – auf Hardware, die ohnehin im Fahrzeug verbaut ist
(Low-/Mid-End-Mini-PC unter Proxmox).

**Leitbild:** Bedienkomfort und Optik von Google Maps, Fahrzeugprofil-Routing von
Sygic Truck, Offline-Fähigkeit von iGO/OsmAnd – als offene, erweiterbare Plattform.

## Zielgruppe

- Wohnmobil-/Camper-Fahrer mit Bordelektronik auf Home-Assistant-Basis
- Technikaffine Selbstausbauer (DIY-Camper)
- Sekundär: LKW-/Transporter-Fahrer mit ähnlichen Maßrestriktionen

## Ziel-Hardware (Referenzumgebung)

| Komponente | Annahme |
|---|---|
| Mini-PC | Intel N100 / N5105-Klasse, 4 Kerne, 8–16 GB RAM |
| Virtualisierung | Proxmox VE; Yapaja Go in VM/LXC **oder** als HA-Add-on in der HAOS-VM |
| Verfügbar für Yapaja Go | ~2 Kerne, 2–4 GB RAM, 20–60 GB Disk (je nach Kartenregion) |
| Anzeige | Tablet/Monitor im Fahrzeug, Browser (Chromium/Firefox), Touch, 1280×800 aufwärts |
| GPS | Browser-Geolocation ODER USB-GPS-Maus (u-blox-Klasse, NMEA) am Host |
| Netz | Meist offline; sporadisch LTE/WLAN für Updates & Add-on-Store |

## Kernfunktionen (In Scope)

1. **Kartenanzeige**: Vektorkarten (OSM), offline, Styles anpassbar, 2D/3D,
   Nordausrichtung oder Fahrtrichtung, Tag-/Nachtmodus.
2. **Fahrzeugprofile**: Höhe, Breite, Länge, Gewicht, Ø-Reisegeschwindigkeit;
   mehrere Profile speicher- und umschaltbar.
3. **Routing**: offline Routenberechnung unter Beachtung des Fahrzeugprofils
   (Brückenhöhen, Gewichtsbeschränkungen, Durchfahrtsbreiten), Alternativrouten,
   Zwischenziele, Vermeidungen (Autobahn, Maut, Fähren, unbefestigte Straßen).
4. **Turn-by-Turn-Navigation**: Richtungspfeile, Spurhinweise, Distanzen, ETA,
   aktuelle + erlaubte Geschwindigkeit, automatisches Rerouting, Sprachansagen.
5. **Positionierung**: Browser-Geolocation oder USB-GPS (gpsd), inkl. Höhe (Altitude).
6. **Suche & Favoriten**: Offline-Geocoding, Favoriten (Home, Stellplätze, POIs),
   Suchverlauf, Koordinaten-Eingabe.
7. **Home-Assistant-Integration**: alle Navigationsparameter via MQTT und REST;
   Steuerung (Ziel setzen, Start/Pause/Stopp) aus HA heraus; Auslieferung als HA-Add-on.
8. **Add-on-System**: Erweiterungen (Stauwarner, POI-Overlays, Track-Recording,
   Track-Planung, Kamera-Einbindung, Schilder-/Ampelerkennung u. a.) ohne Änderungen
   am Core; Marketplace/Store zum Installieren; öffentliche Add-on-API.
9. **UI-Customizing**: Nutzer bestimmt, welche Widgets wo auf dem Screen sichtbar sind.

## Nicht-Ziele (Out of Scope, Version 1)

- Native Mobile-Apps (iOS/Android) – nur Browser/PWA
- Eigene Karten-Datenerhebung; wir nutzen ausschließlich OSM + optionale Community-Daten
- Live-Verkehrsdaten im Core (kommt als Add-on „Stauwarner", benötigt online)
- Multi-Fahrzeug-Flottenmanagement
- Bezahlfunktionen im Store (v1: nur freie Add-ons)
- Offline-Sprachein-/-ausgabe über TTS hinaus (keine Spracherkennung im Core)

## Erfolgs-/Abnahmekriterien (Produkt-Ebene)

| Kriterium | Zielwert |
|---|---|
| Kaltstart App (Browser, Mini-PC) | < 5 s bis interaktive Karte |
| Karten-Rendering | ≥ 30 fps beim Schwenken/Zoomen auf N100 |
| Routenberechnung (500 km, DE-Extrakt) | < 5 s |
| Rerouting nach Abweichung | < 3 s bis neue Anweisung |
| GPS-Update → UI | < 500 ms Latenz |
| MQTT-Publikationsrate Navigation | 1 Hz (Position), sofort bei Anweisungswechsel |
| RAM-Bedarf Gesamtsystem (Core + Valhalla + Photon, DE) | ≤ 4 GB |
| Offline-Betrieb | 100 % aller Kernfunktionen ohne Internet |
| Fahrzeugprofil-Sicherheit | 0 Routen durch bekannte Unterführungen < Fahrzeughöhe (Testsuite) |

## Rechtliches / Sicherheit (Rahmenbedingungen)

- OSM-Daten: ODbL-Attribution in der UI ("© OpenStreetMap contributors").
- Deutliche Haftungs-Hinweise: Kartendaten können falsch/veraltet sein; Beschilderung
  vor Ort hat immer Vorrang (Pflicht-Dialog bei Erstnutzung, Hinweis bei Profilrouting).
- Bedienung während der Fahrt: große Touchziele, Eingabesperren für komplexe Dialoge
  ab konfigurierbarer Geschwindigkeit (Beifahrer-Override).
- Keine Telemetrie ohne Opt-in; alle Daten bleiben lokal.
