# Änderungen

Home Assistant zeigt diese Datei im Add-on-Store an, sobald ein Update
bereitsteht. Sie soll die eine Frage beantworten, die man vor dem Klick auf
„Aktualisieren" hat: **was ändert sich für mich?**

Deshalb steht hier, was ein Betreiber merkt — nicht die Liste der geänderten
Dateien. Wo eine Version einen Fehler behebt, den man selbst gesehen hat,
steht die Meldung dabei, damit man sie wiedererkennt.

---

## 0.3.4

**Die Adresssuche lässt sich jetzt auf dem Gerät einrichten.** Bis hierher
stand an drei Stellen — Installationsprüfung, Dokumentation, Dockerfile —
derselbe Satz: der Suchindex lasse sich hier nicht bauen, dafür brauche es
einen zweiten Rechner. Das war nie eine technische Grenze, sondern zwei
Auslassungen bei uns: das Filterwerkzeug `osmium` lag nicht im Image, und das
Index-Werkzeug wurde vom Bau des Add-ons schlicht nicht mitgenommen. Der
Quelltext dafür ist seit Monaten fertig.

Unter **„Kartenregionen verwalten"** (🗺️ rechts oben) steht bei jeder Region
jetzt ein dritter Knopf: **„Suche bauen"**. Liechtenstein braucht Minuten, ein
Bundesland länger; der Fortschritt steht im Panel, und der bereits
heruntergeladene Kartenextrakt wird wiederverwendet statt erneut geladen.

Danach findet das Suchfeld Orte und Straßennamen — offline, ohne Photon und
ohne mehrere GB Arbeitsspeicher. Ein Neustart ist nicht nötig.

Wie bei Kacheln und Routing gilt: es läuft **immer nur ein** schwerer Bau
gleichzeitig, damit sich zwei davon auf einem 8-GB-Gerät nicht gegenseitig
den Speicher wegnehmen.

**Was der Index nicht kann:** Hausnummern. Gesucht wird nach Orten und
Straßennamen; die genaue Hausnummer steht in diesem Index nicht.

## 0.3.3

**Angetippte Ziele bekommen jetzt wirklich einen Namen.** In 0.3.2 stand das
schon hier — es hat nur nie funktioniert. Die Abfrage nannte die Vektorquelle
`region`, sie heißt aber `yapaja-region`; der Fehler wurde stillschweigend
verschluckt, und jedes Ziel blieb bei seinen Koordinaten. Ein zugesagtes
Verhalten, das nie eintrat. Jetzt steht dort ein Straßen- oder Ortsname.

**Das Fahrzeugprofil ist wieder zu finden.** Auf schmaleren Fenstern — etwa
einem iPad neben der Home-Assistant-Seitenleiste — wuchs die Suchleiste über
den Profil-Chip und verdeckte ihn vollständig. Marke, Profil und Suche liegen
jetzt in **einer** Zeile, die den Platz aufteilt, statt in drei Elementen, die
sich unabhängig voneinander an dieselbe Stelle setzen. Die Suche schrumpft
jetzt, statt sich über die anderen zu legen.

Das war die dritte Überlagerung derselben Art (nach der GPS-Warnung in 0.3.2).
Deshalb wurde diesmal nicht das Symptom verschoben, sondern die Ursache
beseitigt — und eine Prüfung ergänzt, die bei mehreren Fensterbreiten
nachsieht, was an der Stelle jedes Bedienelements tatsächlich obenauf liegt.

**Der Knopf zurück zur eigenen Position ist jetzt immer da.** Bisher erschien
er nur nach einem Schwenk mit dem Finger. Eine Suche bewegt die Karte aber
programmatisch, und das zählte nicht als Schwenk — nach einer Suche gab es also
keinen Weg zurück außer selbst hinzuscrollen. Der Knopf sitzt unten rechts
(Fadenkreuz) und erscheint, sobald eine Position bekannt ist.

**Noch nicht behoben:** die Ortssuche. Was ins Suchfeld getippt wird, findet
weiterhin nichts — dafür fehlt der Suchindex, und der ist der nächste Schritt.
Navigieren zu einem angetippten Punkt und zu Favoriten funktioniert wie bisher.

## 0.3.2

**Die Karte zeigt jetzt die Region, in der du bist.** Wer mehr als eine Region
gebaut hatte, bekam immer dieselbe — die alphabetisch erste. Follow-Me zog die
Karte danach auf die eigene Position, und dort hatte der geladene Kachelsatz
keine Daten: **eine leere Fläche**, ohne Fehler, ohne Hinweis, ununterscheidbar
von einem fehlgeschlagenen Kachelbau. Wer Liechtenstein und Rheinland-Pfalz
gebaut hatte und in Rheinland-Pfalz saß, sah nichts.

Ab jetzt entscheidet die Position. Überlappen sich Regionen (Rheinland-Pfalz
und Deutschland über demselben Ort), gewinnt die kleinere — weniger Speicher,
mehr Detail. Im Kartenmenü (🗺️) steht bei mehr als einer Region zusätzlich
**„Angezeigte Region"**: „Automatisch" ist voreingestellt, eine feste Wahl ist
für die Planung gedacht und gilt absichtlich nur bis zum Neustart.

**Und wenn es für deine Position gar keine Karte gibt, steht das jetzt da.**
Bisher war dieser Zustand von einem kaputten Kachelbau nicht zu unterscheiden.

**Die GPS-Warnung ist wieder lesbar.** „GPS-Signal verloren" lag auf derselben
Zeile wie Titel, Profil-Auswahl und Suchleiste — und unter allen dreien. Die
Meldung war da, nur eben verdeckt. Sie hat jetzt eine eigene Zeile darunter.

**Und sie leuchtet nicht mehr dauerhaft.** Mit der Companion App als Quelle war
sie praktisch immer an: gemessen wurde gegen 3 Sekunden, aber die App meldet in
Intervallen von Sekunden bis Minuten. Für Quellen, die in Intervallen melden,
gelten jetzt fünf Minuten — dieselbe Grenze, ab der eine Position ohnehin
verworfen wird. Für USB-GPS und Browser-Standort bleibt es bei 3 Sekunden.

**Ziele haben jetzt Namen statt nur Koordinaten.** Tippst du einen Punkt auf
der Karte an, steht dort „Bergstrasse" statt `47.14103, 9.52104` — gelesen aus
den Kacheln, die ohnehin schon geladen sind. Kein Photon, kein Suchindex, kein
Netz. Die Koordinaten bleiben zusätzlich stehen: der Name sagt, wohin es geht,
die Zahlen sagen, welche Stelle genau gemeint ist.

Zwei Grenzen dabei: es sind Straßen- und Ortsnamen, **keine Hausnummern**, und
findet sich kein Name nah genug, bleibt es bei den Koordinaten. Ein Name aus
30 km Entfernung wäre schlimmer als eine Zahl — man würde ihm glauben. Die
Suche nach einer **getippten** Adresse braucht weiterhin einen Suchindex.

## 0.3.1

**Die Companion App lässt sich jetzt auch auswählen.** 0.3.0 hat die
Positionsquelle gebaut — in der Konfiguration stand unter „gps_source"
trotzdem nur `usb`, `network` und `none`. Einschalten ging allein über das
freie Textfeld `ha_device_tracker` darunter, und dafür musste man erst
wissen, dass es eine Entity-ID gibt, und sie dann in Home Assistant unter
Entwicklerwerkzeuge → Zustände abschreiben. Eine Funktion, die man an der
Stelle, an der man nachsieht, nicht findet, ist keine.

`gps_source` hat jetzt einen vierten Wert: **`ha_tracker`**. Er genügt für
sich allein — gibt es genau eine `device_tracker`-Entität mit Koordinaten
(der Normalfall), sucht Yapaja sie selbst. Das Textfeld darunter ist nur noch
nötig, wenn es mehrere gibt; dann wird bewusst **keiner geraten**, denn der
zweite könnte das Telefon einer anderen Person sein, und die Navigation würde
ihr stillschweigend folgen.

**Die Installationsprüfung (🩺) nennt die Tracker jetzt wirklich beim Namen.**
In der Add-on-Konfiguration stand seit 0.3.0 der Satz, sie liste alle
gefundenen `device_tracker.*` mit Koordinaten auf. Das tat sie nicht — der
Satz war eine Zusage ohne Deckung, und er stand ausgerechnet an der Stelle,
an der man die Entity-ID sonst raten muss. Jetzt fragt die Prüfung Home
Assistant und zeigt die gefundenen Namen an. Sie unterscheidet dabei drei
Fälle, die vorher alle gleich ausgesehen hätten: kein Tracker vorhanden,
Home Assistant nicht erreichbar, und eine eingetragene Entität, die es so
nicht gibt (der teuerste Fall — alles sieht eingerichtet aus, und es kommt
trotzdem nie eine Position).

**Voreinstellung ist jetzt `none` statt `usb`.** Ein USB-GPS-Empfänger ist
Zubehör, das die wenigsten haben. Mit `usb` meldete die Prüfung bei jeder
frischen Installation „gpsd ist eingeschaltet, antwortet aber nicht unter
127.0.0.1:2947" — eine Warnung über ein Gerät, das nie da war. **Bestehende
Installationen behalten ihre eigene Einstellung**; wer bisher `usb` stehen
hatte und keinen Empfänger besitzt, stellt hier am besten auf `ha_tracker`
oder `none` um.

## 0.3.0

**Start und Ziel sind jetzt beide wählbar.** Bisher konnte man nur ein Ziel
setzen — der Start war zwangsweise die aktuelle GPS-Position. Wer keine
Position hatte, konnte damit **keine einzige Route berechnen**, obwohl Karte
und Routinggraph fertig waren.

Im Routing-Fenster steht jetzt oben eine Zeile „Start". Voreingestellt bleibt
„Aktuelle Position (GPS)" — das ist der Normalfall im Fahrzeug. Mit „Start
wählen" tippst du stattdessen einen Punkt auf der Karte an; mit „GPS" geht es
zurück auf die Live-Position. Der gewählte Start gilt auch dann, wenn du
später über einen Favoriten losfährst.

**Neu: Position aus der Home-Assistant-Companion-App.**

Der Browser gibt seinen GPS-Sensor nur über HTTPS frei. Läuft Home Assistant
über `http://`, bekommt Yapaja vom Telefon, Tablet oder Autoradio also gar
keine Position — daran kann das Add-on nichts ändern. Die Companion App
umgeht das: sie meldet an Home Assistant, nicht an den Browser, und liefert
auch bei gesperrtem Bildschirm weiter.

Einrichten in der Add-on-Konfiguration unter **`ha_device_tracker`**, z. B.
`device_tracker.mein_telefon`. Welche Entität du hast, steht in Home
Assistant unter Entwicklerwerkzeuge → Zustände. Leer lassen = aus.

Die Reihenfolge der Quellen ist `USB-GPS > Browser > Companion App >
Simulator`: die App meldet in Intervallen und ist damit träger als ein
laufender Browser-Standort — sie ist die Quelle, die es **gibt**, wenn der
Browser keine liefert, nicht ihr Ersatz.

Zwei Dinge, die dabei bewusst so sind: ein Zustand, der älter als fünf
Minuten ist, wird **verworfen** statt als aktuelle Position ausgegeben (eine
alte Position, die aussieht wie eine Messung, ist die gefährlichste
Falschaussage in einer Navigation). Und der Zeitstempel kommt von Home
Assistant, nicht von der Uhr des Add-ons — nur so erkennt die
Sprungerkennung einen Tracker, der nach einer Funklücke 300 km weiter wieder
auftaucht.

## 0.2.2

**Nach einem Bau steht jetzt da, dass er geklappt hat.** Bisher verschwand
die Fortschrittsanzeige am Ende einfach, und übrig blieb eine Oberfläche wie
vor dem Klick — ob der Bau geglückt oder still gestorben war, ließ sich nur
im Add-on-Protokoll nachsehen. Also genau dort, wohin der Weg über die
Oberfläche nicht führen soll. Ein mehrminütiger Vorgang endet jetzt mit einer
Bestätigung.

**Zwei irreführende Fehlermeldungen weniger.** Nach einem erfolgreichen
Routingbau standen beim Start des Routing-Dienstes diese Zeilen im
Protokoll:

```
[ERROR] (stat): /custom_files/valhalla_tiles.tar No such file or directory
[WARN]  Tile extract could not be loaded
```

Sie waren folgenlos — der Dienst benutzt danach das Kachelverzeichnis und
läuft — aber „ERROR" direkt nach einem geglückten Bau ist genau die Sorte
Meldung, die auf eine falsche Fährte führt. Die Konfiguration verweist jetzt
nicht mehr auf Dateien, die gar nicht gebaut werden.

## 0.2.1

**„Routing bauen" ist jetzt auch bei einer bereits installierten Karte
erreichbar.**

In 0.2.0 stand der Knopf nur bei Regionen, die noch **nicht** installiert
waren. Sobald die Kacheln fertig waren, wanderte die Region in „Installierte
Regionen" — und der Knopf verschwand mit ihr. Wer die Karte gebaut hatte,
hatte damit keinen Weg mehr zum Routinggraphen, obwohl die
Installationsprüfung ihn weiterhin anmahnte.

Der naheliegende Ausweg — die Karte löschen, um den Knopf zurückzubekommen —
führt ebenfalls nicht weiter: die letzte installierte Region lässt sich nicht
löschen. Eine Sackgasse mit zwei Wänden.

Der Routinggraph ist ein **zweites, unabhängiges Erzeugnis**: wer die Karte
hat, hat noch lange kein Routing. Der Knopf steht deshalb jetzt in beiden
Abschnitten. Ein laufender Bau zeigt dort auch seinen Fortschritt — vorher
gab es die Anzeige nur im Katalog, also gerade nicht dort, wo der Routingbau
stattfindet.

## 0.2.0

**Der Routinggraph lässt sich jetzt auf dem Gerät bauen — neuer Knopf
„Routing bauen" im Regionen-Panel.**

Bisher stand in der Installationsprüfung, das ginge nicht: das Bauwerkzeug
brauche einen Docker-Socket, den ein Home-Assistant-Add-on nicht hat. Das
galt für unser *Skript*, nicht für die *Werkzeuge*. Dieses Add-on setzt auf
dem Valhalla-Image auf, und dessen Bau-Werkzeuge liegen längst im Container —
`valhalla_build_tiles` und Geschwister, samt komplettem Bau-Rezept. Der
Hinweis schickte also an einen zweiten Rechner, obwohl alles Nötige schon da
war.

Bei Liechtenstein dauert der Bau Minuten. Danach startet der Routing-Dienst
binnen 30 Sekunden von allein — **kein Neustart des Add-ons nötig.**

**Ein Graph, der woanders gebaut wurde, funktioniert jetzt auch.** Das ist
kein Nebeneffekt, sondern ein eigener Fehler: Valhalla schreibt absolute
Pfade in seine Konfiguration, die auf ein Verzeichnis zeigten, das es in
diesem Add-on gar nicht gab. Eine hereinkopierte Datei wäre also ebenso ins
Leere gelaufen. Behoben.

**Nur ein schwerer Bau gleichzeitig.** Kachelbau und Routingbau teilen sich
Platte und Arbeitsspeicher derselben Maschine, auf der auch Home Assistant
läuft. Wer den zweiten startet, während der erste läuft, bekommt jetzt eine
Meldung statt zweier Läufe, die sich gegenseitig aushungern.

## 0.1.9

**Zwei Kachelbauten gleichzeitig gehen nicht mehr — und das ist eine
Reparatur, keine Einschränkung.**

Bricht der Bau bei dir mit dieser Zeile ab, ist genau das hier gemeint:

```
java.util.zip.ZipException: zip END header not found
```

Das sieht nach einer kaputten Datei aus, war aber ein Wettlauf: wird
„Kacheln bauen" ein zweites Mal gedrückt, während der erste Lauf noch die
gemeinsamen Basisdaten lädt, liest der zweite Prozess eine Datei, die der
erste gerade erst schreibt. Beide teilen sich dasselbe Verzeichnis.

Ein zweiter Bau wird jetzt abgelehnt, solange einer läuft — auch für eine
**andere** Region, denn geteilt ist das Quellenverzeichnis, nicht die
Region. Die Meldung sagt, warum.

**Eine abgebrochene Basisdatei blockiert nicht mehr dauerhaft.** Wurde eine
der gemeinsamen Dateien nur halb geladen, wurde sie danach nie wieder
erneuert — sie existierte ja — und jeder weitere Bau scheiterte an derselben
Stelle. Da die Datei unter `/share` liegt und der vorgesehene Bedienweg nur
die Oberfläche ist, gab es kein Mittel, sie loszuwerden. Unvollständige
Dateien werden jetzt vor dem Bau erkannt, verworfen und neu geladen.

**Abbrechen wirkt sofort.** Ein abgebrochener Bau gibt den Knopf sofort
wieder frei, statt zu warten, bis der Hintergrundprozess tatsächlich endet.

## 0.1.8

**Der Kachelbau läuft jetzt tatsächlich durch.**

Bricht der Bau bei dir mit dieser Zeile ab, ist genau das hier gemeint:

```
java.lang.IllegalArgumentException: data/sources/lake_centerline.shp.zip
does not exist. Run with --download to fetch it
```

Die Karte entsteht nicht allein aus dem OSM-Extrakt der Region. Das benutzte
Kartenprofil braucht zusätzlich drei **nicht regionsspezifische** Datensätze:
Wasserflächen, Natural-Earth-Basisdaten und Seen-Mittellinien. Der Aufruf an
planetiler forderte sie nie an — er war damit von Anfang an unvollständig und
hätte in keiner Umgebung funktioniert.

Was das für dich heißt:

* Der **erste** Kachelbau lädt diese gemeinsamen Basisdaten einmalig nach
  `/share/yapaja/planetiler-sources/`. Das sind mehrere hundert MB und dauert
  entsprechend länger als der eigentliche Bau von Liechtenstein.
* Jede **weitere** Region benutzt dieselben Dateien und lädt nichts mehr nach.
* Die Ablage liegt unter `/share`, überlebt also Add-on-Updates.

Außerdem: dieser Changelog. Ab jetzt steht vor jedem Update hier, was sich
ändert.

## 0.1.7

**Der Knopf „Kacheln bauen" funktioniert.** Vorher brach er immer ab mit:

```
FEHLER: docker nicht im PATH gefunden.
```

und riet dazu, die Kacheln „auf einem anderen Rechner" zu bauen — aus der
Oberfläche heraus, die den Bau gerade erst möglich machen sollte. Der Grund
war nicht der fehlende Docker: das Add-on kann planetiler auch direkt als
Java-Programm starten, und dieser Weg war korrekt vorbereitet. Die
Docker-Prüfung lief nur unabhängig davon und stoppte vorher.

**Der Bau arbeitet jetzt unter `/share`** statt im Container. Vorher prüfte
das Add-on den freien Platz auf der einen Platte und arbeitete dann auf einer
anderen — bei einer kleinen Region unauffällig, bei Rheinland-Pfalz wäre der
Lauf nach Stunden am Platz gescheitert.

**Browser-Standort:** Wer Yapaja auf Telefon, Tablet oder Autoradio öffnet,
konnte den Gerätestandort bisher nicht dauerhaft nutzen — nach etwa fünf
Sekunden hörte die App auf, Positionen zu senden, und es erschien im Wechsel
„GPS-Signal verloren". Das ist behoben.

**Ein falscher Hinweis ist raus.** Fehlt der Standortzugriff, nannte die App
als Lösung „Home Assistant Ingress (immer HTTPS)". Das stimmt nicht: Ingress
benutzt dasselbe Protokoll wie Home Assistant selbst. Wer HA über `http://`
aufruft, bekommt auch über Ingress kein HTTPS — und der Browser gibt den
GPS-Sensor nur über HTTPS frei. Der Hinweis nennt jetzt die Wege, die
wirklich helfen (siehe `docs/gps-endgeraete.md`).

## 0.1.6

**Der Kachelbau sagt endlich, woran er scheitert.** Vorher stand im Fehlerfall
nur „Code 1" — die Ausgabe des Bauprozesses wurde gelesen und danach
weggeworfen, obwohl die Meldung auf das Add-on-Protokoll verwies. Jetzt steht
jede Zeile dort unter `[Kachelbau <region>]`, und die letzte Zeile zusätzlich
in der Fehlermeldung selbst.

**Das Protokoll ist wieder lesbar.** Es lief voll mit
`log.sh: line 107: info: unbound variable`, weil eine interne Einstellung
denselben Namen trug wie eine von Home Assistants Werkzeugen.

## 0.1.5

**Updates kamen tatsächlich an.** Vorher konnte man aktualisieren und bekam
dieselbe Oberfläche wie zuvor: der Bau griff auf eine zwischengespeicherte
Schicht zurück und holte den neuen Quelltext nie.

## 0.1.4

**Kacheln lassen sich aus der Oberfläche bauen** — Knopf „Kacheln bauen" im
Kartenmenü, mit Fortschritt und Abbruch. Vorher ging das nur über eine
Kommandozeile im Container, an die man mit dem Terminal-Add-on gar nicht
herankommt.

## 0.1.3

**Das Bau-Skript liegt im Add-on-Image.** Vorher verwiesen alle Anweisungen
auf Dateien aus dem Repository — wer über den Store installiert, hat das
nicht.

**Die Installationsprüfung nennt keine Knöpfe mehr, die es nicht gibt.**

## 0.1.2

**Das Add-on startet.** Vorher blieb es nach der Installation stehen mit:

```
s6-supervise core: warning: unable to spawn ./run
bashio::log.info: command not found
```

## 0.1.1

**Die Installation läuft durch.** Vorher brach der Bau ab mit:

```
Could not open lock file /var/lib/apt/lists/lock - Permission denied
```

## 0.1.0

Erste installierbare Fassung über den Home-Assistant-Add-on-Store.
