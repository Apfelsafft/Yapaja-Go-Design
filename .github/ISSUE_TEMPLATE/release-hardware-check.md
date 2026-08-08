---
name: "Release: Manuelle Hardware-Checkliste"
about: "Manuelle Hardware-Abnahme vor einem v1.x-Release (docs/07-testing-qa.md §7) -- kann nicht automatisiert werden, braucht echtes GPS/echten Mini-PC/echte Fahrt."
title: "Hardware-Checkliste für Release vX.Y.Z"
labels: ["release", "manual-check", "hardware"]
assignees: []
---

## Kontext

Diese Checkliste ist der **menschliche** Teil des Release-Gates
(`docs/07-testing-qa.md` §7, letzter Punkt: "Manuelle Hardware-Checkliste
durch Menschen"). Alles, was hier steht, kann **strukturell nicht** durch
CI abgedeckt werden — es braucht echtes GPS, echte Hardware (Referenz:
N100-Mini-PC, `docs/00-vision-scope.md`/`docs/01-architecture.md` §4) und
eine echte Fahrt. Kein Checklisten-Punkt gilt "per Aussage" als erledigt —
jeder Punkt braucht einen konkreten Beleg (Zeitstempel, Foto/Video, kurze
Beobachtungsnotiz), siehe `tasks/E10-qualitaet-release.md` §E10-T6
Plausibilität.

**Release-Version:** vX.Y.Z (bitte im Titel + unten ausfüllen)
**Getestete Hardware:** _(Modell, RAM, Betriebssystem/HAOS-Version)_
**GPS-Empfänger:** _(Modell)_
**Durchgeführt von:** _(Name)_
**Datum:** _(Datum)_

---

## Checkliste

### 1. USB-GPS-Kaltstart-Fix < 60 s

- [ ] Gerät vollständig ausgeschaltet, GPS-Empfänger ohne vorherigen
      Almanach-Cache (mind. mehrere Stunden ohne Stromversorgung, "kalter
      Start").
- [ ] Stoppuhr ab Systemstart / ab Add-on-Start.
- [ ] Zeit bis zum ersten stabilen 3D-Fix in der App notiert: `____ s`
- [ ] **Bestanden, wenn < 60 s.**

Beleg (Screenshot/Video-Zeitstempel bzw. Log-Auszug mit Zeitstempeln):

```
<hier einfügen>
```

### 2. Echte Fahrt ≥ 30 min ohne manuellen Eingriff

- [ ] Route mit realem Ziel geplant (nicht Simulator), Navigation gestartet.
- [ ] Fahrt ≥ 30 Minuten am Stück, **ohne** manuelles Eingreifen (kein
      Neustart der App, kein manuelles Reconnect, kein Eingriff bei
      GPS-Aussetzern — die App muss das selbst handhaben, siehe
      [Troubleshooting W-01/W-02](../../docs/troubleshooting.md)).
- [ ] Turn-by-Turn-Ansagen kamen rechtzeitig und korrekt.
- [ ] Rerouting (falls ausgelöst, z. B. durch eine bewusste Abweichung)
      funktionierte ohne Eingriff (< 3 s, siehe
      [Troubleshooting W-05](../../docs/troubleshooting.md#w-05--app-berechnet-nach-einer-abzweigung-automatisch-neu)).
- [ ] Tatsächliche Fahrtdauer: `____ min`
- [ ] Auffälligkeiten (Ruckler, GPS-Aussetzer, falsche Ansagen, Abstürze):

```
<hier einfügen, "keine" wenn zutreffend>
```

### 3. Touch-Bedienung im Fahrbetrieb

- [ ] Touch-Ziele (Zoom, Follow-Me, Manöver-Panel, Pause/Stopp) mit
      Handschuhen bzw. unter realistischen Fahrzeugbedingungen bedienbar
      getestet (Erschütterung, Sonneneinstrahlung auf das Display).
- [ ] Keine versehentlichen Fehleingaben während der Fahrt (docs/06 §4
      "Touch & Fahrbetrieb" — Mindestgrößen/Abstände der Bedienelemente).
- [ ] Auffälligkeiten:

```
<hier einfügen, "keine" wenn zutreffend>
```

### 4. Nachtmodus-Lesbarkeit

- [ ] Nachtmodus bei Dunkelheit im Fahrzeug getestet (nicht nur im Büro mit
      gedimmtem Monitor).
- [ ] Karte, Manöver-Panel, Tempolimit-Anzeige und Bottom-Bar-Widgets bei
      Dunkelheit gut lesbar, ohne zu blenden.
- [ ] Automatischer Tag-/Nachtmodus-Wechsel (falls konfiguriert) hat zum
      richtigen Zeitpunkt ausgelöst.
- [ ] Auffälligkeiten:

```
<hier einfügen, "keine" wenn zutreffend>
```

### 5. Zugriff vom Telefon inkl. Browser-GPS

Der Bedienweg, für den Yapaja eigentlich gebaut ist: das Gerät läuft im
Fahrzeug, bedient wird es über den Browser eines Telefons, Tablets oder
Android-Autoradios. Diese Kette ist bislang **nur im E2E-Setup** geprüft
(simulierte Geolocation, Ingress-Sub-Pfad als Flow 9) — nie auf echter
Hardware. Genau hier steckte in E10-T1 ein echter Fehler: unter Ingress
verband sich **kein einziger** WebSocket, die Live-Position wäre also tot
gewesen. Behoben und mit Regressionstests abgesichert, aber die Kombination
ist erwiesenermaßen fehleranfällig.

- [ ] App vom **Telefon** geöffnet — über Home-Assistant-Ingress (HAOS-
      Add-on) **oder** über einen HTTPS-Reverse-Proxy (Compose/VPS).
      Verwendeter Weg: `________________`
- [ ] Karte rendert, Bedienung reagiert.
- [ ] **Live-Position kommt an** (das ist der WebSocket-Pfad — bei einem
      Sub-Pfad-Problem bleibt die Karte stehen, ohne Fehlermeldung).
- [ ] Turn-by-Turn-Ansagen und Manöver-Panel aktualisieren sich während der
      Fahrt auf dem Telefon.
- [ ] **Browser-GPS als Positionsquelle geprüft**: ohne USB-Empfänger am
      Gerät muss die Position des Telefons übernommen werden
      (Prioritätskette `gpsd > browser > simulator`, ADR-007).
      Hinweis: die Geolocation-API des Browsers verlangt **HTTPS** — über
      nacktes `http://<LAN-IP>` blockiert der Browser den Standortzugriff,
      nicht Yapaja.
- [ ] Auffälligkeiten (Verbindungsabbrüche beim Displaysperren, Position
      friert ein, Reconnect nach Tunnel):

```
<hier einfügen, "keine" wenn zutreffend>
```

- [ ] **Falls mehrere Geräte gleichzeitig verbunden waren** (z. B. Telefon
      und Tablet): sprang die angezeigte Position zwischen Orten? Siehe
      [Backlog B-03](../../docs/backlog.md) — bekanntes offenes Verhalten,
      hier bitte nur beobachten und notieren, nicht als Fehlschlag werten.

```
<hier einfügen, "nicht getestet" wenn nur ein Gerät verbunden war>
```

---

## Ergebnis

- [ ] **Alle fünf Punkte oben bestanden** — Hardware-Gate für dieses
      Release ist erfüllt.
- [ ] Nicht bestanden — Details unter "Auffälligkeiten", Release blockiert
      bis behoben.

Bei Fehlschlag bitte zusätzlich verlinken:
- Zugehöriger Bug-Issue: #____
- Betroffener Release-Tag/-Branch: `____`

---

_Dieses Template wird im Release-Issue verlinkt (`tasks/E10-qualitaet-
release.md` §E10-T6: "Menschliche Punkte als Sub-Issues an den Menschen"),
nicht automatisch ausgefüllt — jeder Haken hier braucht einen echten Beleg,
keine Software kann das für euch bestätigen._
