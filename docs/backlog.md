# Backlog — bewusst zurückgestellte Arbeit

Was hier steht, ist **nicht vergessen und nicht erledigt**, sondern bewusst
verschoben. Jeder Eintrag nennt: was fehlt, warum es zurückgestellt wurde, was
stattdessen gilt, und **woran man erkennt, dass es wieder aufgegriffen werden
kann**.

Der Zweck dieser Datei ist, dass „später" nachweisbar bleibt. Ein
zurückgestellter Punkt, der nur in einem Kommentar in einer YAML-Datei steht,
ist nach drei Monaten verschwunden.

---

## B-01 🔴 Golden-Routes DE verifizieren (Maßrestriktionen Deutschland)

**Status:** zurückgestellt am 2026-08-05 durch Entscheidung des Betreibers.
**Betrifft:** `e2e/golden-routes.json`, Job `golden-routes-de` in `nightly.yml`.

### Was fehlt

16 der 20 Golden-Route-Fälle sind `unverified: true`. Alle DE-Fälle:

* die erwarteten Distanzen sind **Schätzwerte**, nie gegen einen echten
  Deutschland-Graphen gefahren;
* **jede** `restriction.osm_way_id` ist `null` — es wurde nie ein deutsches
  OSM-Tag gelesen;
* das betrifft ausdrücklich auch die sechs Restriktionsfälle
  (Höhe ×3, Gewicht ×2, Breite ×1), also genau die Fälle, die ein
  3,2-m-Wohnmobil vor einer zu niedrigen Brücke bewahren sollen.

### Warum zurückgestellt

Der Nachweis braucht einen echten Deutschland-Valhalla-Graphen. Auf einem
Standard-GitHub-Runner ist der nicht baubar: der Schritt lief in **jedem**
Lauf seit Wochen exakt 2 Stunden und wurde dann abgebrochen (z. B. Lauf
`30980175183`, 06:05:37 → 08:05:55). In der Entwicklungs-Sandbox ebenfalls
nicht: kein Docker-Daemon, und geofabrik/Overpass sind über den Proxy
gesperrt (403).

Ein Job, der strukturell nie grün werden kann, erzeugt jede Nacht eine rote
Mail und stumpft die Aufmerksamkeit für **echte** Fehlschläge ab. Deshalb
läuft er jetzt nur noch auf ausdrückliche Anforderung
(`workflow_dispatch`) statt im Zeitplan.

### Was stattdessen gilt — die Einschränkung für v1.0

**Das per-PR-Safety-Gate deckt nur Liechtenstein ab.** Das ist eine echte
inhaltliche Einschränkung und keine Formalie:

* Der Merge-Blocker `Golden-Routes LI` prüft weiterhin bei jedem PR, dass die
  Routing-Logik, die Profilzuordnung und die Restriktions-Auswertung als
  **Mechanik** funktionieren.
* Was er **nicht** prüft, ist, ob die deutschen Maßrestriktionen in den
  ausgelieferten Kartendaten korrekt ausgewertet werden.
* Diese Einschränkung gehört in die Release-Notes von v1.0 (siehe
  `docs/07-testing-qa.md` §7, Ausnahme zu Punkt 2).

Nicht betroffen und weiterhin scharf: die Struktur-Gates. `runner.test.ts`
erzwingt bei jedem Lauf DE ≥ 15 Fälle und die Zusammensetzung
Höhe ×3 / Gewicht ×2 / Breite ×1; `provenance.test.ts` fängt stille Vakuität
(Profile, die den Grenzwert nicht umschließen) und den Widerspruch
„`osm_way_id` gesetzt, aber `unverified`". Die Fälle können also nicht
unbemerkt verwässern, solange sie unverifiziert sind.

### Wie es wieder aufgegriffen wird

Alles Werkzeug dafür liegt bereit:

1. Auf einer Maschine mit genug Zeit/RAM `golden-routes-de` von Hand starten
   (`workflow_dispatch`) — oder den Graphen lokal bauen.
2. `scripts/osm-restriction-provenance.sh` liest die
   `maxheight`/`maxweight`/`maxwidth`-Tags **offline aus derselben PBF**, auf
   der auch geroutet wird, und gibt einen einfügefertigen
   `restriction`-Block aus — nur bei echtem Fund. Nicht bestätigbare Fälle
   ersetzt der `discover`-Modus, statt sie zu raten.
3. Die 6-Punkte-Checkliste im Kopf des Jobs `golden-routes-de` abarbeiten;
   sie endet mit **zwei grünen Nightlies in Folge**, weil ein einzelner Lauf
   „richtig" und „zufällig" nicht unterscheiden kann.
4. Erst dann `continue-on-error` entfernen und den Job wieder in den
   Zeitplan nehmen.

---

## B-02 🟡 Photon-Live-Suche im Nightly

**Status:** zurückgestellt am 2026-08-05.
**Betrifft:** Job `photon-li-nightly` in `nightly.yml`.

### Was fehlt

Der Live-Suchlauf gegen einen **echten Photon-Index** (CH+LI) samt der
RSS-unter-Last-Messung aus E05-T4.

### Warum zurückgestellt

Der Schritt „Wait for Photon /status" lief in jedem Lauf ins Timeout (25 min,
z. B. Lauf `30980175183`): der JSONL-Import baut den Index **im Container**
auf, und das läuft auf einem Standard-Runner nicht durch. Der Job war seit
Wochen dauerhaft rot und damit als Signal wertlos.

### Was stattdessen gilt

Nicht betroffen, läuft weiter bei jedem PR:

* `lite-search-li` baut und raucht den **Lite-Suchindex** — das ist der
  dokumentierte W-12-Fallback für RAM-knappe Geräte und der Pfad, auf dem ein
  Gerät ohne Photon trotzdem suchen kann.
* `photon-setup` prüft die Skript-Fixtures und die `-Xmx`-Verdrahtung.

Es fehlt also die Live-Suche gegen einen echten Index, nicht die Suche als
solche.

### Wie es wieder aufgegriffen wird

Index **vorab** bauen und als Artefakt/Cache bereitstellen, statt ihn im Job
zu importieren — oder den Job auf einen self-hosted Runner legen. Dann
`workflow_dispatch` wieder auf den Zeitplan umstellen.

---

## B-03 🟠 Mehrere Browser-Clients: wer liefert die Position?

**Status:** offen, aufgenommen am 2026-08-07.
**Betrifft:** `apps/core/src/position/service.ts`, `POST /api/v1/position/browser`.

### Was unklar ist

Yapaja unterstützt die **Browser-Geolocation** als vollwertige Positionsquelle
(`browserSource.ts` → `POST /position/browser`, Prioritätskette
`gpsd > browser > simulator`, ADR-007). Das ist der Bedienweg, der real
genutzt wird: Telefon, Tablet oder Android-Autoradio greifen per Browser auf
das Gerät zu.

Sind aber **mehrere Clients gleichzeitig** verbunden, schicken alle ihre
Fixes an denselben Endpunkt, und die Quelle heißt für alle gleich
(`browser`). Es gibt derzeit keine Unterscheidung nach Client. Wer „gewinnt",
ist damit nicht definiert — faktisch der zuletzt eingetroffene Fix.

### Warum das im Alltag auffallen kann

Im selben Fahrzeug ist es folgenlos: zwei Geräte melden dieselbe Position.
Unangenehm wird es, sobald ein Gerät **woanders** ist — das Telefon zu Hause,
das Tablet im Wohnmobil, oder ein zweiter Browser-Tab auf einem Rechner in
der Wohnung. Dann springt die angezeigte Position zwischen zwei Orten, und
die Navigation kann eine Abweichung erkennen, die es nicht gibt.

Das ist **kein** Sicherheitsproblem und kein Datenverlust, aber ein
Verhalten, das ein Nutzer nicht erklären kann.

### Denkbare Auflösungen (noch nicht entschieden)

* Client-Kennung beim Ingest, und nur der *zuletzt aktive* bzw. ein
  ausdrücklich gewählter Client zählt.
* Plausibilitätsprüfung: ein Fix, der räumlich unmöglich weit vom vorherigen
  entfernt ist, wird verworfen (der `PlausibilityGuard` aus E02-T3 macht
  genau das bereits für Sprünge — die Frage ist, ob er hier greift).
* Bewusst dokumentieren, dass gleichzeitige Clients an verschiedenen Orten
  nicht unterstützt sind.

Vor einer Entscheidung sollte geprüft werden, wie sich der bestehende
`PlausibilityGuard` in diesem Fall tatsächlich verhält — möglicherweise
fängt er den Sprung schon ab, und es bleibt nur eine Doku-Frage.

---

## Wie diese Datei gepflegt wird

* Ein Eintrag verschwindet erst, wenn die Arbeit **getan** ist — nicht, wenn
  sie unangenehm wird.
* Jeder zurückgestellte CI-Job verweist im Workflow-Kommentar auf seine
  B-Nummer, damit man vom roten (bzw. abwesenden) Job zur Begründung findet.
* Was hier als Einschränkung für ein Release steht, gehört in die
  Release-Notes dieses Releases.
