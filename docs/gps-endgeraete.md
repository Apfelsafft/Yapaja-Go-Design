# GPS vom eigenen Endgerät (Telefon, iPad, Android-Autoradio)

**Stand:** 2026-09-02. Vorbereitung, damit die Umsetzung zusammen mit dem
Ergebnis des 0.1.6-Tests eingebaut werden kann.

Die Ausgangsfrage: Telefon, iPad und Android-Autoradio haben alle einen
GPS-Sensor. Yapaja wird ohnehin per Browser bedient. Wie kommen diese Daten
in die Navigation?

Die kurze Antwort vorweg: **es sind zwei Wege, und der naheliegende ist
derzeit auf diesem Gerät blockiert.** Beides steht unten mit Begründung.

---

## 1 Was schon gebaut ist

Die Browser-Geolocation ist eine vollwertige Positionsquelle, nicht ein
Notbehelf:

* `apps/web/src/position/browserSource.ts` liest
  `navigator.geolocation.watchPosition()` mit `enableHighAccuracy: true` und
  schickt jeden Fix an `POST /api/v1/position/browser`.
* `apps/core/src/position/routes.ts` prüft Schema und Plausibilität und
  reicht ihn an den `PositionService`.
* Die Prioritätskette ist `gpsd > browser > simulator` (ADR-007). Ohne
  angeschlossenes USB-GPS **gewinnt der Browser automatisch** — es muss
  nichts umgestellt werden.
* Die Add-on-Option `gps_source` (`usb|network|none`) schaltet nur den
  gpsd-Dienst im Container an oder aus. Sie hat **keinen** Einfluss darauf,
  ob Browser-Positionen angenommen werden. Auch mit `gps_source: none`
  funktioniert der Browser-Weg.
* Der Onboarding-Schritt „GPS" (`GpsStep.tsx`) listet „Browser-Standort" und
  kann ihn fest wählen.

Es fehlt also **nicht** die Anbindung. Es fehlen zwei Dinge davor.

---

## 2 Blocker A — der eigentliche Grund, warum es heute nicht geht

Der Browser gibt den GPS-Sensor nur in einem **secure context** frei. Das ist
eine Regel des Browsers, keine Einstellung von Yapaja und nichts, was das
Add-on umgehen kann.

Der Aufruf im Test lautet `http://camperassistant.local:8123/…` — also
einfaches HTTP. Damit gilt:

* `window.isSecureContext` ist `false`;
* `browserSource.start()` bricht sofort mit `insecure-context` ab;
* `navigator.geolocation` wird gar nicht erst aufgerufen.

Auf **allen drei** Geräten gleichermaßen: iPad-Safari, Telefon, Autoradio.

Drei verbreitete Irrtümer dazu, die hier ausdrücklich nicht gelten:

* **„Ingress ist doch HTTPS."** Nein. Ingress erbt das Protokoll von Home
  Assistant selbst. Wer HA über `http://…:8123` erreicht, bekommt Ingress
  ebenfalls über HTTP. Genau dieser falsche Hinweis stand bis heute im
  Fehlerbanner der App und ist entfernt.
* **„`.local` ist doch lokal, also sicher."** Nein. Die Ausnahme gilt nur für
  `localhost`, `127.0.0.0/8` und `::1` — nicht für einen mDNS-Namen und nicht
  für eine LAN-IP. Vom iPad aus ist der Mini-PC nie `localhost`.
* **„Dann eben ein zweiter Port."** Ändert nichts; entscheidend ist das
  Protokoll, nicht der Port.

### Was tatsächlich hilft

| Weg | Aufwand | Offline-tauglich | Bewertung |
|---|---|---|---|
| **(a) Nabu Casa Cloud** (`https://….ui.nabu.casa`) | Abo, keine Einrichtung | ❌ braucht Internet | Zum **Ausprobieren** gut. Zum Fahren ungeeignet: eine Offline-Navigation über einen Internet-Umweg zu betreiben, hebt ihren Zweck auf. |
| **(b) Eigenes Zertifikat für einen echten Namen** (Let's Encrypt per DNS-01, z. B. `ha.meinedomain.de` → LAN-IP) | einmalig mittel, per HA-Add-on aus der GUI machbar | ✅ nach Ausstellung; Internet nur zur Verlängerung alle 90 Tage | **Der empfohlene Weg.** Keine Zertifikatswarnung, funktioniert auf allen Geräten gleich, auch im Autoradio-Browser. |
| **(c) Selbstsigniertes Zertifikat** | gering | ✅ vollständig | Funktioniert (nach einmaliger Bestätigung ist der Origin ein secure context), aber jedes Gerät muss die Warnung einmal wegklicken, und manche Autoradio-Browser lassen das nicht zu. Rückfallebene, nicht erste Wahl. |
| **(d) USB-GPS am Mini-PC** | Hardware | ✅ | Umgeht die Frage vollständig — deshalb steht diese Empfehlung schon heute im Fehlerbanner. Hilft aber nicht, wenn ausdrücklich das Telefon liefern soll. |

Für (b) und (c) wird in Home Assistant `configuration.yaml` um
`http: ssl_certificate / ssl_key` ergänzt. Das ist der einzige Punkt der
ganzen Kette, der **nicht** aus der GUI kommt — mit dem Add-on „File editor"
allerdings ohne SSH.

---

## 3 Blocker B — ein Fehler in unserem eigenen Code (behoben)

Selbst mit HTTPS wäre Browser-GPS unbrauchbar gewesen. Der Client fragte den
Core alle 5 Sekunden, ob er senden darf, und wertete dabei das **falsche
Feld** aus: gelesen wurde `s.id`, geliefert wird `s.name`.

Die Folge war kein sauberer Ausfall, sondern ein Flattern, das man leicht dem
GPS-Empfang anlastet:

1. Kaltstart, keine Quelle aktiv → **ein** Fix wird gesendet.
2. Der Core führt `browser` daraufhin 5 s lang als aktiv. Der nächste Poll
   findet `s.id` nicht → der Client schaltet sich **selbst stumm**.
3. Nach 5 s ohne Fix meldet der Core `event/gps_lost`; ab 3 s zeigt die
   Oberfläche „GPS-Signal verloren".
4. Der nächste Poll sieht wieder „keine Quelle aktiv" → ein Fix → zurück zu 2.

Also: Position und Verlust-Banner im 5-Sekunden-Takt abwechselnd, dauerhaft.

**Warum das niemand gemerkt hat** — und das ist der wichtigere Teil:

* `browserSource.test.ts` prüfte ausschließlich, dass die exportierten
  Typ-Unions existieren (`expect(errorTypes.length).toBe(3)`). Ein Test, der
  nicht fehlschlagen kann.
* Die einzige E2E-Zusicherung dazu stand in
  `if (sentPositions.length > 0) { … }` — sie schwieg also genau dann, wenn
  nichts gesendet wurde.

Beides ist ersetzt: 10 echte Tests fahren jetzt den Weg
`watchPosition` → `POST /position/browser` durch, die Erlaubnis hängt an
`forced` statt an `active` (inhaltlich auch die richtige Frage: `active`
beschreibt, wer *gerade* liefert — und wurde durch unser eigenes Senden wahr,
der Client schaltete sich also an seinem eigenen Erfolg ab; `forced`
beschreibt, wer liefern *darf*), und die E2E-Zusicherung ist unbedingt.

---

## 4 Der zweite Weg: Home-Assistant-App statt Browser — Vorschlag B-05

Für die genannten Geräte gibt es einen Weg, der **beide** Blocker umgeht und
technisch klar besser zum Anwendungsfall passt.

Auf Telefon, iPad und dem Android-Autoradio läuft ohnehin (oder kann laufen)
die **Home Assistant Companion App**. Sie meldet die Position als
`device_tracker.<gerät>` an Home Assistant — mit Hintergrund-Ortung und
optional „high accuracy mode". Das Add-on hat mit `homeassistant_api: true`
bereits Zugriff auf `http://supervisor/core/api` (`SUPERVISOR_TOKEN`), also
auf genau diese Zustände.

### Warum das dem Browser-Weg überlegen ist

| | Browser (`watchPosition`) | Companion App (`device_tracker`) |
|---|---|---|
| HTTPS nötig | **ja** (Blocker A) | nein |
| Bildschirm aus / Tab im Hintergrund | Safari **friert den Tab ein**, Chrome-Android drosselt ihn — Positionen bleiben aus | läuft weiter, dafür ist die App gebaut |
| Genauigkeit | hoch, solange der Tab vorn ist | hoch im „high accuracy mode", sonst gröber und in Intervallen |
| Latenz | ~1 s | je nach Einstellung Sekunden bis Minuten |
| Zusätzliche Einrichtung | keine | App installieren, Ortung erlauben |

Der ehrliche Einwand: die Companion App ist **träger**. Für eine
Abbiegeanweisung in 200 m ist ein Intervall von 30 s zu wenig. Deshalb ist
das eine **zusätzliche Quelle unterhalb des Browsers**, kein Ersatz.

### Was dafür zu bauen wäre

1. `PositionSourceName` und `Position.source` um `'ha_tracker'` erweitern —
   betrifft `packages/shared/src/types.ts` und
   `packages/shared/src/schemas/position.ts` (`enum`), also den validierten
   Schematyp. Kleine, aber nicht rein additive Änderung.
2. Priorität: `gpsd > browser > ha_tracker > simulator`. Begründung: ein
   echter Empfänger schlägt einen Browser-Fix, ein Browser-Fix schlägt einen
   gepollten Zustand aus HA, und der Simulator bleibt letztes Mittel.
3. Ein GET-Helfer neben `callHaService` (`apps/core/src/ha/client.ts` kann
   heute nur POST): `GET {apiBase}/states/{entity_id}` liest
   `attributes.latitude/longitude/gps_accuracy`. Dieselben Regeln wie dort —
   hartes Zeitlimit, jeder Fehler wird geloggt und geschluckt, ein
   ausgefallenes HA darf die Navigation nie blockieren.
4. Eine neue Option `ha_device_tracker` (`str?`, leer = aus). Auswahl im
   Onboarding-GPS-Schritt, der die Trackerliste aus HA anbieten kann.
5. Der `PlausibilityGuard` **muss** hier davor (siehe §5) — ein Tracker, der
   nach einem Ausfall 300 km weiter wieder auftaucht, ist genau sein Fall.

Aufwand: überschaubar, aber ein eigener Bau, kein Nebenbei. Deshalb als
Backlog-Eintrag **B-05** notiert und nicht mit dieser Vorbereitung
mitgeliefert.

---

## 5 Was dabei ans Licht kam: B-03 ist beantwortet

Backlog **B-03** („Mehrere Browser-Clients: wer liefert die Position?")
endete mit der offenen Frage, ob der bestehende `PlausibilityGuard` das
Springen zwischen zwei Geräten an verschiedenen Orten vielleicht schon
abfängt — dann wäre es nur eine Doku-Frage gewesen.

**Er fängt es nicht ab, denn er ist auf diesem Weg gar nicht verdrahtet.**
`PlausibilityGuard` wird ausschließlich in
`apps/core/src/position/gpsd/index.ts` benutzt. `POST /position/browser` ruft
`service.pushFix('browser', …)` direkt auf. Die einzige Prüfung dort ist
`checkPosition()` (Wertebereiche), und die kennt keinen Vorgänger-Fix, sieht
also keinen Sprung.

Und selbst mit Verdrahtung bliebe ein Rest: nach drei abgelehnten Sprüngen
akzeptiert der Guard den vierten Fix bewusst als neue Grundwahrheit (W-02,
Fähre/Transport). Zwei dauerhaft sendende Geräte — Telefon zu Hause, Tablet
im Wohnmobil — würden also nicht still stehen, sondern langsamer hin- und
herspringen. Der Guard ist die halbe Antwort, nicht die ganze; die andere
Hälfte ist eine Client-Kennung beim Ingest.

Das ist in B-03 nachgetragen.

---

## 6 Konkret: was der Betreiber jetzt tun kann

**Sofort, ohne auf Code zu warten:**

* Zum **Ausprobieren** über Nabu Casa (`https://….ui.nabu.casa`) auf Yapaja
  gehen und Standortzugriff erlauben. Damit ist Blocker A weg, und mit der
  Korrektur aus §3 läuft die Position stabil. Zum tatsächlichen Fahren ist
  das aber der falsche Weg — dafür (b) aus §2.
* Prüfen, ob das Fehlerbanner „Standortzugriff nicht verfügbar (unsicherer
  Kontext)" erscheint. Wenn ja, ist Blocker A bestätigt und alles andere
  Folgefehler.

**Für den Dauerbetrieb:** Weg (b) aus §2 — eigenes Zertifikat. Danach
funktionieren Telefon, iPad und Autoradio ohne weitere Änderung an Yapaja.

**Falls die Companion App ohnehin schon läuft:** Rückmeldung, welche
`device_tracker`-Entität sie liefert und in welchem Intervall. Dann lässt
sich B-05 mit einem realistischen Wert statt einer Annahme bauen.

---

## 7 Was hier bewusst NICHT gebaut wurde

* **Kein Wake Lock.** Ein `navigator.wakeLock` hält den Bildschirm an, solange
  der Tab vorn ist — es hilft nicht gegen den eingefrorenen Hintergrund-Tab,
  und den Bildschirm einer Fahrzeugbedienung ungefragt dauerhaft anzuschalten
  ist eine Entscheidung des Betreibers, keine Voreinstellung.
* **Keine Änderung an `gps_source`.** Die Option um `browser` zu erweitern
  klänge stimmig, wäre aber irreführend: sie schaltet den gpsd-Dienst, nicht
  die Annahme von Browser-Fixes. Browser-GPS funktioniert bei **jedem** Wert.
  Statt einer neuen Auswahlmöglichkeit gehört das in die Beschreibung der
  Option.
* **Kein Backoff im Browser-Client.** Der Modul-Kopf behauptete
  „retry with backoff"; implementiert war nie einer. Er wird auch nicht
  gebraucht: `watchPosition` läuft nach einem Zeitlimit weiter, und der
  nächste erfolgreiche Fix setzt den Zustand von allein zurück. Die
  Behauptung ist entfernt statt nachgebaut.
