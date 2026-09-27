# Eigene Karten, Routen und Suche

Diese Seite beantwortet eine Frage: **Wir haben selbst gebaute Kartendaten
(oder Bekannte haben welche) — was muss vorliegen, damit Yapaia Go sie für
Karte, Routing und Suche nutzen kann, und wie kommen sie aufs Gerät?**

Alles hier geht **ohne SSH**, nur mit der Home-Assistant-Oberfläche und einem
Datei-Add-on (Samba oder File editor).

---

## 1. Die Kurzfassung

Yapaia braucht **drei getrennte Dinge**. Jedes hat ein festes Format, und
keines ersetzt ein anderes:

| Wofür | Was genau | Liegt auf dem Gerät unter |
|---|---|---|
| **Karte** (das Bild) | Vektorkacheln als **PMTiles**, **OpenMapTiles-Schema** | `/share/yapaja/tiles/<name>.pmtiles` |
| **Routing** (Route berechnen, Abbiegehinweise) | **Valhalla-Routinggraph** samt `valhalla.json` | `/share/yapaja/valhalla/tiles/` |
| **Suche** (Orte, Straßen, Sonderziele) | Yapaias **Lite-Suchindex** (SQLite) — oder ein **Photon-Index** | `/share/yapaja/lite-search/` bzw. `/share/yapaja/photon/photon_data/` |

**Alle drei werden aus derselben Quelle gebaut: einem OpenStreetMap-Extrakt
(`.osm.pbf`).** Das ist die wichtigste Erkenntnis für den Austausch mit
Bekannten: Das Nützlichste, was sie euch geben können, ist entweder

- genau diese **`.osm.pbf`** (dann baut Yapaia alles selbst), oder
- fertige Dateien **in genau den Formaten aus der Tabelle**.

Karten aus anderen Navi-Apps (OsmAnd, Organic Maps, Garmin, Navit …) haben
**eigene, nicht austauschbare Formate** und lassen sich nicht einlesen — siehe
§3.

---

## 2. Was bei euch schon vorliegt

Das Add-on bringt die Werkzeuge für alle drei Erzeugnisse bereits mit. Auf
eurer Installation ist dafür nichts nachzurüsten:

| Voraussetzung | Stand bei euch |
|---|---|
| Datenablage, die Updates überlebt | `/share/yapaja/` — das Add-on legt die Ordner beim Start selbst an |
| Kachelbau (planetiler) | im Add-on; beim ersten Bau lädt es einmalig `planetiler.jar` (~100 MB) nach `/share/yapaja/tools/` |
| Routinggraph-Bau (Valhalla) | im Add-on — es setzt auf dem Valhalla-Image auf, das die Bauwerkzeuge enthält |
| Suchindex-Bau (osmium + SQLite) | im Add-on |
| Dateien von außen ablegen | über das Add-on **„Samba share"** (Netzlaufwerk `\\homeassistant\share`) oder **„File editor"** |

**Grenzen setzt die Hardware, nicht die Software.** Auf einer HAOS-VM mit
8 GB RAM lassen sich kleine und mittlere Regionen (Bundesland, kleines Land)
direkt bauen. Ein ganzes großes Land wie Deutschland sprengt beim
**Kachelbau** den Speicher — das baut man auf einem stärkeren Rechner und
legt nur die fertige Datei ab (§5). Details und Zahlen:
[installation.md §C.5](installation.md#c5-ganzes-land-deutschland--nicht-auf-der-haos-vm).

---

## 3. Passen die Dateien eurer Bekannten?

| Was sie haben | Nutzbar? | Was zu tun ist |
|---|---|---|
| `.osm.pbf` (Geofabrik-Extrakt oder selbst zugeschnitten) | **ja, am besten** | §4 oder §5 — daraus entsteht alles |
| `.pmtiles`, gebaut mit **planetiler** (Standardprofil) | **ja** | als Karte ablegen, §5.1 |
| `.pmtiles` aus einem **Protomaps-Basemap**-Build | **nein** | anderes Kachelschema (Ebenen heißen dort `roads`, `places` …); die Karte bliebe leer. Aus der `.osm.pbf` neu bauen |
| `.mbtiles` (Vektor, OpenMapTiles-Schema) | **nach Umwandlung** | mit dem Werkzeug `pmtiles` umwandeln: `pmtiles convert karte.mbtiles karte.pmtiles` |
| Rasterkacheln (Bilder, z. B. `.png` in MBTiles) | **nein** | Yapaias Kartenstile zeichnen Vektordaten |
| Valhalla-Graph (`valhalla_tiles/` bzw. `valhalla_tiles.tar` + `valhalla.json`) | **ja, mit Vorbehalt** | §5.2 — die Valhalla-Version muss passen |
| OSRM- oder GraphHopper-Daten | **nein** | anderer Router. Aus der `.osm.pbf` einen Valhalla-Graphen bauen |
| Photon-Index (Ordner `photon_data/`) | **ja, mit Vorbehalt** | §5.3 — die Photon-Version muss passen |
| Nominatim-Datenbank | **nein** | aus der `.osm.pbf` den Lite-Suchindex bauen |
| OsmAnd (`.obf`), Organic Maps / MAPS.ME (`.mwm`), Garmin (`.img`), Navit (`.bin`) | **nein** | geschlossene App-Formate. Nach der `.osm.pbf` fragen, aus der sie entstanden sind |

**Warum das Kachelschema so wichtig ist:** Die Kartenstile von Yapaia
(`apps/core/src/map/styles/`) lesen die Ebenen `transportation`,
`transportation_name`, `place`, `poi`, `building`, `water_name`, `waterway`,
`boundary`, `mountain_peak` — das sind die Namen des OpenMapTiles-Schemas, das
planetiler standardmäßig erzeugt. Eine technisch einwandfreie PMTiles-Datei mit
anderem Schema lädt ohne Fehler und zeigt trotzdem nichts.

---

## 4. Der einfache Weg: in Yapaia bauen lassen

Für jede Region aus der Kartenliste — ohne eine einzige Datei anzufassen:

1. In Yapaia **„Karten verwalten"** (🗺️ rechts oben) öffnen.
2. Bei der Region **„Installieren"** drücken — das baut die Karte.
3. Danach einmal **„Alles bauen"** — das baut Routinggraph und Suchindex für
   alle installierten Karten.
4. Mit **„Installation prüfen"** (🩺) kontrollieren: Karte, Routing und Suche
   sollten grün sein.

Mehr dazu: [installation.md §C.3 und §C.3a](installation.md#c3-kleine-region--direkt-auf-dem-gerät).

---

## 5. Der Weg mit fertigen Dateien

Für alles, was **nicht** in der Kartenliste steht, oder was auf einem
stärkeren Rechner gebaut wurde.

### 5.1 Karte (PMTiles)

**Bauen** (auf einem Rechner mit Docker, aus einem Checkout dieses
Repositorys):

```bash
services/tiles/build-pmtiles.sh https://download.geofabrik.de/europe/germany/bayern-latest.osm.pbf
# oder aus einer lokalen Datei:
services/tiles/build-pmtiles.sh /pfad/zu/meine-region.osm.pbf
```

Ohne Docker, nur mit Java: `PLANETILER_JAR=/pfad/zu/planetiler.jar` davor
setzen — siehe [installation.md §C.4](installation.md#c4-im-add-on-container-gibt-es-kein-docker).

**Ablegen:**

1. Datei nach `/share/yapaja/tiles/` kopieren (Samba: `\\homeassistant\share\yapaja\tiles\`).
2. Der Dateiname ist der Regionsname. Erlaubt sind **nur Buchstaben, Ziffern,
   `-` und `_`** — `bayern.pmtiles` geht, `Bayern Süd.pmtiles` wird
   übersprungen (mit Warnung im Add-on-Protokoll).
3. In Yapaia neu laden. Ein Add-on-Neustart ist nicht nötig; die Karte
   erscheint in „Karten verwalten".

> **Wichtig:** Eine selbst abgelegte Karte steht in keinem Katalog. Yapaia weiß
> deshalb nicht, aus welcher `.osm.pbf` sie stammt, und **„Alles bauen"
> überspringt sie** (und sagt es). Routing und Suche für diese Region braucht
> ihr dann ebenfalls als fertige Dateien — §5.2 und §5.3.

### 5.2 Routing (Valhalla-Graph)

**Bauen** (Rechner mit Docker, Repository-Checkout):

```bash
services/valhalla/build-tiles.sh /pfad/zu/meine-region.osm.pbf
```

Das Ergebnis liegt danach in `data/valhalla/tiles/`: ein Ordner
`valhalla_tiles/`, eine `valhalla.json` und ein paar Hilfsdateien.

**Ablegen:**

1. Den **gesamten Inhalt** von `data/valhalla/tiles/` nach
   `/share/yapaja/valhalla/tiles/` kopieren — `valhalla.json` gehört dazu.
2. Das Add-on **neu starten** (Einstellungen → Add-ons → Yapaia Go →
   Neu starten). Valhalla liest den Graphen nur beim Start.

**Worauf es ankommt:**

- **Ein Graph für alles.** Es gibt genau einen Routinggraphen. Wer mehrere
  Regionen befahren will, baut ihn aus einer Datei, die alle enthält
  (`osmium merge a.osm.pbf b.osm.pbf -o alles.osm.pbf`).
- **Die Pfade in `valhalla.json` müssen mit `/custom_files/` beginnen.**
  `build-tiles.sh` schreibt sie genau so. Ein Graph, den jemand anders mit
  einem eigenen Aufbau gebaut hat, trägt oft andere Pfade — dann startet
  Valhalla nicht. Die Pfade lassen sich mit dem File editor anpassen.
- **Die Valhalla-Version muss zusammenpassen.** Das Add-on nutzt das Image
  `ghcr.io/gis-ops/docker-valhalla/valhalla:latest`. Ein Graph aus einer
  deutlich älteren oder neueren Valhalla-Version wird unter Umständen nicht
  gelesen. Mit `build-tiles.sh` gebaut, passt es.
- **„Alles bauen" ersetzt den Graphen.** Er wird dann aus den installierten
  Katalog-Regionen neu gebaut, und ein von Hand abgelegter Graph ist weg.
  Wer seinen eigenen behalten will, drückt „Alles bauen" nicht.

### 5.3 Suche

Es gibt zwei Wege; einer genügt.

**Lite-Suchindex (empfohlen, braucht wenig Speicher):**

```bash
LITE_SEARCH_DB_PATH=./lite_search-meine-region.db \
  services/valhalla/build-lite-index.sh /pfad/zu/meine-region.osm.pbf
```

Die Datei nach `/share/yapaja/lite-search/` kopieren. Der Name muss
`lite_search-<region>.db` lauten, **je Region eine Datei** — gesucht wird in
allen gleichzeitig. Braucht auf dem Bau-Rechner `osmium-tool`, Node.js und
`pnpm` samt einmal `pnpm install` im Repository.
Dieses Format erzeugt **nur** dieses Skript; einen fremden Suchindex gibt es
dafür nicht.

**Photon (braucht mehrere GB Arbeitsspeicher):**

```bash
services/photon/download-index.sh de   # vorgebauter Index für ein Land
```

Das Ergebnis landet in `data/photon/photon_data/`. Dessen Inhalt nach
`/share/yapaja/photon/photon_data/` legen (dort muss danach ein Ordner
`elasticsearch/` liegen), in der Add-on-Konfiguration
`photon_enabled: true` setzen und das Add-on neu starten. Auf einer 8-GB-VM
lieber beim Lite-Index bleiben —
[installation.md §C.6](installation.md#c6-empfehlung-bei-8-gb-photon-abschalten).

---

## 6. Kontrolle

1. **„Installation prüfen"** (🩺) in Yapaia: meldet getrennt, ob Karte,
   Routing und Suche bereit sind, und bei einem Fehler, was fehlt.
2. **Add-on-Protokoll** (Einstellungen → Add-ons → Yapaia Go → Protokoll):
   - `Skipping .pmtiles file with an invalid region name` → Dateiname prüfen (§5.1).
   - `Skipping unreadable or invalid .pmtiles file` → Datei beschädigt oder kein PMTiles.
   - `valhalla: no …/valhalla.json yet` → `valhalla.json` fehlt im Graph-Ordner (§5.2).
3. Eine kurze Probe: ein Ziel in der neuen Region per langem Druck auf die
   Karte setzen und „Route hierhin" wählen.

---

## 7. Was diese Anleitung nicht belegt

- Dass ein **fremd gebauter** Valhalla-Graph oder Photon-Index läuft, hängt an
  der Version, mit der er gebaut wurde. Geprüft ist hier nur der Weg über die
  Skripte in diesem Repository.
- Die Speicher- und Zeitangaben sind Größenordnungen (siehe
  [installation.md §C.5](installation.md#c5-ganzes-land-deutschland--nicht-auf-der-haos-vm)),
  keine Messungen auf eurer Hardware.
- Eine fertige `.pmtiles`-Datei per **Download-Adresse** eintragen, statt sie
  per Samba abzulegen, ist im Kern vorbereitet (`custom-sources.json`), aber
  noch nicht in der Oberfläche erreichbar.

Verwandt: [Runbook: Kartendaten aktualisieren](data-update-runbook.md) — der
Ablauf mit Abnahmeprüfung für ein Update auf neue OSM-Daten.
