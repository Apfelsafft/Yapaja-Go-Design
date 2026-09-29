# Ideen: KI im Camper-Navi

Stand: 2026-09-29. Ideensammlung, noch **nichts davon ist gebaut**. Sie hält
fest, was besprochen wurde, damit es nicht verloren geht, und ist die Vorlage
für die Umsetzung.

Reihenfolge laut Absprache: zuerst **Idee 3 (Reise-Erzähler)**, dann
**Idee 1 (Sprach-Copilot)**. Die übrigen stehen kürzer am Ende.

---

## Grundsätze für alle Ideen

Diese Regeln gelten für jede KI-Funktion in Yapaia und stehen nicht zur
Abwägung:

1. **Offline bleibt die Basis.** Karte, Route, Ansagen, Warnungen funktionieren
   ohne KI und ohne Netz. KI ist ein Zusatz, der sich bei fehlendem Netz
   ehrlich abmeldet („Erzähler gerade offline"), statt still zu fehlen.
2. **Die KI schlägt vor, sie entscheidet nicht.** Routen rechnet weiterhin
   Valhalla mit den Fahrzeugmaßen. Keine KI-Antwort darf eine Beschränkung
   (Höhe, Gewicht, Breite) aufheben oder eine Route ohne Bestätigung ändern.
3. **Die Navigation hat immer Vorrang.** Eine Abbiegeansage unterbricht alles.
   In der Nähe eines Manövers (unter 500 m, im Kreisel, bei Spurempfehlung)
   spricht die KI nicht.
4. **Ablenkungsarm.** Während der Fahrt: Sprache und höchstens ein Tipp. Längere
   Texte und Listen nur im Stand.
5. **Keine erfundenen Fakten.** Die KI formuliert aus Quellen, die Yapaia ihr
   gibt (OSM, Wikipedia, eigene Sensoren). Gibt es keine Quelle, sagt sie
   nichts, statt zu raten. Die Quelle ist in der App einsehbar.
6. **Datensparsam und abschaltbar.** Jede Funktion ist einzeln abschaltbar. Was
   an einen KI-Dienst geht (Ortsnamen, Koordinaten, Sensorwerte), steht in der
   Dokumentation. Der API-Schlüssel steht in der Add-on-Konfiguration, nicht im
   Browser.

**Modellwahl (Vorschlag):** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) für
kurze, häufige Aufgaben mit wenig Wartezeit (Erzähltexte verdichten). Claude
Sonnet 5 (`claude-sonnet-5`) für den Sprach-Copiloten, wo zuverlässiges Arbeiten
mit Werkzeugen wichtiger ist als die letzte Zehntelsekunde.

---

## Idee 3: Der Reise-Erzähler

> „Links seht ihr gleich den Kaiserstuhl — ein erloschener Vulkan, und das
> wärmste Weinbaugebiet Deutschlands."

### Was man erlebt

Ein zuschaltbarer Modus im Fahrtmenü (**🎙 Erzähler an/aus**). An passenden
Stellen der Strecke erzählt Yapaia zwei, drei Sätze: zur Ortschaft, durch die
man fährt, zum Berg am Horizont, zur Grenze, zum Fluss unter der Brücke. Am
Ziel auf Wunsch ein Tipp für den Abend.

Einstellbar:

- **Häufigkeit:** selten (nur Besonderes) · normal · gesprächig
- **Stil:** kurz & sachlich · Familie (kindgerecht) · Geschichte
- **Stumm bis:** z. B. „die nächste Stunde nicht"

### Wann gesprochen wird: das Ruhefenster

Das Herzstück ist nicht der Text, sondern der **Zeitpunkt**. Gesprochen wird
nur, wenn alle Bedingungen erfüllt sind:

| Bedingung | Warum |
|---|---|
| nächstes Manöver > 500 m **und** > 30 s entfernt | die Ansage hat Vorrang |
| keine Navigationsansage in den letzten 10 s | keine Ansage direkt nach der Ansage |
| kein Kreisel, keine Spurempfehlung aktiv | genau dann braucht man die Aufmerksamkeit |
| Geschwindigkeit stabil (kein Stop-and-go) | Stau und Stadtverkehr sind Stress |
| seit der letzten Erzählung ≥ Mindestabstand (je nach Häufigkeit, z. B. 10 min) | keine Dauerbeschallung |
| Erzählpunkt liegt **voraus** und ist in 0–60 s erreicht | man soll es sehen, nicht verpasst haben |

Eine Navigationsansage, die während einer Erzählung fällig wird, **bricht die
Erzählung sofort ab**. Die Erzählung wird nicht wiederholt.

Das ist eine reine Funktion (`ruhefenster(navState, letzteAnsage, …) → boolean`)
und damit vollständig ohne Browser und ohne KI testbar.

### Woher die Geschichten kommen

**Schritt 1: Erzählpunkte finden (ohne KI, offline).** Beim Start der Fahrt und
bei jeder Neuberechnung sucht der Kern entlang der Route (Korridor von einigen
Kilometern) Kandidaten:

- Ortschaften, durch die die Route führt (`place=*`, Lite-Suchindex)
- OSM-Objekte mit `wikidata`/`wikipedia`-Tag: Berge, Burgen, Seen, Flüsse,
  Aussichtspunkte, Sehenswürdigkeiten
- Landes- und Bundeslandgrenzen
- das Ziel selbst

Bewertet werden sie nach Sichtbarkeit (Berg in der Nähe > Kirche 3 km abseits),
Bekanntheit (hat einen Wikipedia-Artikel) und Abstand zueinander.

**Schritt 2: Text erzeugen (mit KI, einmal pro Route).** Solange Netz da ist,
holt der Kern für die ausgewählten Punkte die Einleitung des Wikipedia-Artikels
und lässt die KI daraus einen Sprechtext machen:

- Eingabe: Quelltext, Stil, Fahrtrichtung („kommt von links"), Länge
  (≤ 45 Wörter).
- Anweisung: **nur** aus dem Quelltext formulieren, nichts ergänzen. Steht im
  Quelltext nichts Erzählenswertes, lautet die Antwort „nichts" und der Punkt
  entfällt.

**Schritt 3: Zwischenspeichern.** Die fertigen Texte liegen mit der Route im
Kern. Unterwegs in einem Funkloch wird trotzdem erzählt, weil die Arbeit
vorher erledigt wurde. Das passt zu einem Navi, das offline gedacht ist.

**Ohne Netz beim Start:** Es gibt nur Punkte mit einem vorab gecachten Text
(z. B. von einer früheren Fahrt auf derselben Strecke). Sonst schweigt der
Erzähler und sagt es einmal.

### Aufbau im Code (Skizze)

```
apps/core/src/erzaehler/
  kandidaten.ts      Erzählpunkte entlang der Route (rein, testbar)
  ruhefenster.ts     wann gesprochen werden darf (rein, testbar)
  quellen.ts         Wikipedia-Einleitungen holen (mit Cache)
  texte.ts           KI-Aufruf, Prompt, Längen- und „nichts"-Regel
  dienst.ts          verbindet alles, hängt an navState-Takt
packages/shared      ErzaehlPunkt-Typ, Einstellungen
apps/web/src/drive   Schalter im Fahrtmenü, Anzeige der Quelle
```

Gesprochen wird über den vorhandenen Weg (Browser-TTS oder Home-Assistant-
Mediaplayer), mit eigener Priorität unterhalb der Navigationsansagen.

### Kosten und Daten

- Pro Route etwa 10–40 Erzählpunkte, je ein kurzer KI-Aufruf. Mit Haiku sind
  das Kleinstbeträge pro Tag; die genaue Zahl wird beim Bau gemessen und in
  der Doku angegeben, nicht geschätzt.
- An den KI-Dienst gehen: Name und Wikipedia-Text des Ortes, Stil, Richtung.
  **Keine** Positionsspur, kein Fahrzeugprofil.
- Wikipedia-Texte stehen unter CC BY-SA. Die Quelle wird in der App angezeigt.

### Ausbaustufen

1. **MVP ohne KI:** Ruhefenster + Kandidaten + die ersten zwei Sätze des
   Wikipedia-Artikels, unverändert vorgelesen. Beweist, dass Zeitpunkt und
   Auswahl stimmen, und zwar auf der nächsten Probefahrt.
2. **Mit KI:** Texte verdichten, Stil wählbar, Fahrtrichtung einbauen.
3. **Tipp am Ziel:** zum Stellplatz/Ort ein Abendtipp aus OSM-Daten in der Nähe
   (Restaurant, Aussichtspunkt, Bäcker für morgen früh).

### Offene Fragen

- Sollen Erzählungen auch auf dem ESP-Display erscheinen (z. B. nur der Name
  „Kaiserstuhl")? Vermutlich nein. Das Display ist für Fahrinformationen da.
- Mehrsprachig (für Mitfahrende)? Technisch einfach, erst bei Bedarf.

---

## Idee 1: Der Sprach-Copilot

> „Such mir in etwa 90 Minuten einen Stellplatz mit Strom, nicht direkt an der
> Autobahn."

### Was man erlebt

Ein **Mikrofon-Knopf** (im Fahrtmenü und später per Aktivierungswort über Home
Assistant). Man spricht frei; der Copilot antwortet kurz und legt Vorschläge
als Karten ins Fahrtmenü. **Nichts ändert sich an der Route, bevor man
bestätigt:** ein Tipp oder ein gesprochenes „Ja, den ersten".

Beispiele, die funktionieren sollen:

| Gesagt | Was passiert |
|---|---|
| „Wo können wir in etwa anderthalb Stunden übernachten?" | Suche entlang der Route im Zeitfenster 75–105 min, Stellplätze/Campingplätze, 2–3 Vorschläge mit Umweg in Minuten |
| „Wir brauchen Diesel und Gas." | ein Halt, der beides hat, oder zwei nahe beieinander |
| „Schaffen wir es vor 18 Uhr?" | Antwort aus der ETA, ehrlich mit Unsicherheit |
| „Nimm die nächste Entsorgungsstation mit." | Vorschlag, nach „Ja" als nächster Halt eingeschoben |
| „Vermeide Mautstraßen für den Rest der Fahrt." | Umschalten der Vermeidung, neue Route, Rückfrage vorher |
| „Wie hoch ist die Brücke da vorne?" | Antwort aus den Kartendaten, sonst „weiß ich nicht" |

### Wie es technisch funktioniert

Die KI bekommt keine freie Hand, sondern einen festen Satz **Werkzeuge**, die
Yapaia schon kann oder bekommt. Sie entscheidet, welches sie aufruft. Yapaia
führt es aus und liefert das Ergebnis zurück.

| Werkzeug | Gibt es schon? |
|---|---|
| `fahrtzustand()` Position, ETA, Reststrecke, nächste Manöver | ja (`navState`) |
| `fahrzeug()` Profil, Maße, Vermeidungen | ja |
| `suche_entlang_route(kategorie, zeitfenster, umweg_max)` | **neu**, siehe unten |
| `suche_nahe(kategorie, punkt)` | teilweise (Sonderziele, Suche) |
| `zwischenstopp_vorschlagen(ort)` | neu, aber klein: legt einen Vorschlag ins Fahrtmenü |
| `vermeidung_vorschlagen(art)` | neu, klein |
| `bordsensoren()` Wasser, Batterie … (Idee 4) | später, über Home Assistant |

**Wichtigste Vorarbeit:** `suche_entlang_route`. Sie lohnt sich auch ohne KI,
etwa als Knopf „Tankstelle auf der Strecke". Sie sucht im Korridor um die
verbleibende Route, rechnet für jeden Treffer den Umweg (über Valhalla) und
die Ankunftszeit dort, filtert nach Fahrzeugmaßen, soweit OSM sie kennt
(`maxheight` an der Zufahrt, `motorhome=yes`).

### Spracheingabe und -ausgabe

Zwei Wege, einer davon zuerst:

- **A. Im Browser (schnellster Start):** Web Speech API für die Erkennung,
  vorhandene Sprachausgabe. Braucht Netz und funktioniert nicht in jedem
  Browser. Für den Anfang ausreichend.
- **B. Über Home Assistant Assist (das Ziel):** HA hat bereits
  Sprachpipelines mit Aktivierungswort, lokaler Spracherkennung (Whisper) und
  Sprachsatelliten. Yapaia stellt seine Werkzeuge dort bereit, und man spricht
  mit dem Camper, nicht mit dem Tablet: „Okay Camper, wo übernachten wir?"

Empfehlung: mit A beginnen, weil man damit die Werkzeuge und Antworten schnell
ausprobieren kann. B folgt, sobald die Werkzeuge stehen. Die Werkzeuge sind in
beiden Fällen dieselben.

### Regeln für die Antworten

- Während der Fahrt höchstens **zwei Sätze** gesprochen, Details als Karte im
  Fahrtmenü.
- Zahlen, die Sicherheit betreffen (Durchfahrtshöhe, Gewicht), **nur aus den
  Kartendaten**, nie geschätzt. Fehlt der Wert: „Dazu habe ich keine Angabe."
- Jede Routenänderung braucht eine Bestätigung.
- Nicht verstanden → einmal nachfragen, dann aufgeben, statt zu raten.

### Ohne Netz

Ein kleiner, regelbasierter Rest ohne KI: „nächste Tankstelle", „nächster
Parkplatz", „Pause", „Stopp", „Ansagen aus". Das deckt die häufigsten Fälle
ab und bleibt verlässlich.

### Aufbau im Code (Skizze)

```
apps/core/src/copilot/
  werkzeuge.ts       Werkzeugdefinitionen + Ausführung (gegen vorhandene Dienste)
  gespraech.ts       Schleife: Anfrage → KI → Werkzeugaufrufe → Antwort
  regeln.ts          Offline-Befehle ohne KI
apps/core/src/search/korridor.ts   Suche entlang der Route (neu, auch ohne KI nützlich)
apps/web/src/drive                 Mikrofon-Knopf, Vorschlagskarten im Fahrtmenü
```

### Ausbaustufen

1. **Suche entlang der Route** als normale Funktion (Knopf im Fahrtmenü).
2. **Copilot per Text** (Eingabefeld, nur im Stand) zum Ausprobieren der
   Werkzeuge und Antworten.
3. **Copilot per Sprache im Browser** (Weg A).
4. **Über Home Assistant Assist** mit Aktivierungswort (Weg B).

---

## Die übrigen Ideen (kurz)

### Idee 2: Aufmerksam auf Maße und Gewicht

Die Route umgeht Beschränkungen schon. Zusätzlich deutet die KI, was die Daten
nur halb sagen: Freitext an Baustellenmeldungen („Engstelle 2,50 m"),
Bewertungen und Beschreibungen von Stellplätzen („Zufahrt eng, nicht über
7 m"), steile Rampen. Daraus entsteht **ein** kurzer Hinweis, nur wenn es für
dieses Fahrzeug relevant ist, mit Quelle. Nie als Ersatz für die harten
Beschränkungen im Routing, immer zusätzlich.

### Idee 4: Das Wohnmobil als Mitdenker (Home Assistant + KI)

Home Assistant kennt Frischwasser, Grauwasser, Batterie, Gas, Solar,
Temperatur. Die KI verknüpft das mit Route und Planung:

- „Grauwasser bei 85 % — in 25 km liegt eine Entsorgungsstation an der Strecke,
  Umweg 3 Minuten."
- „Die Batterie reicht nicht für zwei Nächte autark — morgen lieber mit Strom."
- „Nachts unter 0 °C: Frostwächter prüfen."

Vieles davon geht **regelbasiert ohne KI** (Schwellwerte + Suche entlang der
Route). Die KI kommt dazu, wenn mehrere Werte zusammen eine Empfehlung
ergeben. Braucht dieselbe `suche_entlang_route` wie Idee 1.

### Idee 5: Tagesplanung und Reisetagebuch

- **Morgens:** „Plan mir morgen, entspannt, höchstens 4 Stunden." Tagesetappe
  mit Pausen alle ~2 h, Mittagsstopp mit Platz für lange Fahrzeuge, Einkauf,
  Übernachtung. Berücksichtigt Wochentag, Feiertage, Wetter. Ergebnis ist eine
  fertige Route mit Zwischenstopps.
- **Abends:** ein Reisetagebuch mit Strecke, Höhenmetern, besuchten Orten,
  Verbrauch und Fotos aus Home Assistant, als Seite zum Teilen.

---

## Reihenfolge und Abhängigkeiten

```
Idee 3 MVP (Ruhefenster, Kandidaten, Wikipedia vorlesen)
  └─ Idee 3 mit KI-Texten
Suche entlang der Route  ← gemeinsame Vorarbeit für 1, 4, 5
  ├─ Idee 1 Copilot (Text → Browser-Sprache → HA Assist)
  ├─ Idee 4 Bordsensoren
  └─ Idee 5 Tagesplanung
```

Benötigt vor dem ersten KI-Aufruf: eine Add-on-Option für den API-Schlüssel
(`anthropic_api_key`, als Passwortfeld), ein Schalter „KI-Funktionen" und ein
Budget pro Tag, bei dessen Erreichen die KI-Funktionen pausieren und es sagen.
