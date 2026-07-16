# Photon Search Service (E05-T4)

Photon (Komoot) ist der primäre Offline-Geocoder für Yapaja Go
(`GeocoderBackend`-Kette in `apps/core/src/search/`, ADR-005: docs/01
§ADR-005). Der Service läuft als Teil des Docker-Compose-Stacks
(`docker compose --profile search up -d photon`), Endpoint
`http://photon:2322` (compose-intern) bzw. `http://localhost:2322`.

## Inhalt dieses Verzeichnisses

- `download-index.sh <country>` — lädt einen vorgebauten Photon-Suchindex für
  ein Land herunter und installiert ihn atomar nach
  `data/photon/photon_data` (Resume via `curl -C -`, Checksummen-Pflicht,
  atomarer Swap — Details/Kommentare im Skript).
- `download-index.test.sh` — Fixture-Test für `download-index.sh` gegen einen
  lokalen Loopback-HTTP-Server (Resume + Checksummen-Mismatch +
  Atomaritäts-Sicherheit). Läuft lokal **und** in CI identisch (kein echtes
  Netzwerk nötig): `services/photon/download-index.test.sh`.

## RAM-Deckel (`-Xmx`) — Wiring & Empfehlung

`docker-compose.yml`s `photon`-Service setzt
`JAVA_PARAMS=-Xmx${PHOTON_XMX:-1g}`. Das ist der Mechanismus, über den das
verwendete Image (`rtuszik/photon-docker`) Zusatz-Flags unverändert an den
`java`-Prozess durchreicht, der Photon startet. Override via `.env`
(`PHOTON_XMX=512m`, siehe `.env.example`) oder direkt beim Aufruf:

```bash
PHOTON_XMX=512m docker compose --profile search up -d photon
```

**Empfehlung (docs/01 §4 Ressourcen-Budget, ADR-005):**

| Ziel | `-Xmx` | Erwartetes RSS unter Last | Index-Disk |
|---|---|---|---|
| Mini-PC, DE-Extrakt (Default) | `1g` | ~600 MB – 1 GB (ADR-005-Messwert mit JVM-Tuning) | ~2 GB |
| Kleineres Land (z.B. Österreich, Schweiz) | `512m` | ~400–700 MB | deutlich kleiner |
| Sehr knappes Gerät / winzige Region | `256m` | ~250–450 MB | klein |
| Photon ganz aus (W-12) | – | 0 (Prozess läuft nicht) | 0 |

**Faustregel für das effektive RSS:** `RSS ≈ Xmx + 150–300 MB` JVM-Overhead
(Metaspace, Thread-Stacks, Direct-Buffers, Lucenes Off-Heap-mmap-Anteile für
den Index). Das ist auch die Plausibilitäts-Vorgabe aus der E05-T4-Spec:
*"Photon-RSS unter Last (20 parallele Suchen) < Xmx + 300 MB"* — gemessen
(informativ, `continue-on-error`) im Nightly-Job `photon-li-nightly`
(`.github/workflows/nightly.yml`) gegen den dort gebauten CH+LI-Index; siehe
den Abschnitt "CI-Nachweis" unten für die genaue Begründung, warum das nicht
per-PR gegen einen echten Index gemessen wird.

Das Gesamtbudget für den Server-seitigen Stack (docs/01 §4): Photon
(JVM, `-Xmx`) ≤ 1 GB, zusammen mit Core (≤ 300 MB) und Valhalla (≤ 1,5 GB)
für ≤ 2,9 GB Summe — passend in eine 4-GB-LXC.

## Abschalt-Option (W-12) — was dann passiert

Photon ist der RAM-hungrigste Baustein im Stack (ADR-005). Wargame-Szenario
**W-12** (docs/08) sieht genau dafür einen Ausweg vor: Setting/Env
`PHOTON_ENABLED=false` (siehe `apps/core/src/index.ts`, `SearchService`s
`photonEnabled`-Option) schaltet Photon in der Backend-Kette komplett ab. Die
Suche fällt dann automatisch auf den **Lite-Suchindex** zurück
(`apps/core/src/search/lite/`, E05-T5): eine SQLite-FTS5-Datenbank mit
Orten + Straßennamen (trigram-Tokenizer, Tippfehler-tolerant), ohne
Hausnummern und mit einfacherem Ranking. Ergebnisse tragen dann
`source: 'lite'`, die Web-UI zeigt einen dezenten Hinweis "vereinfachte
Suche aktiv". Baue den Lite-Index mit
`services/valhalla/build-lite-index.sh <pbf>` (Details:
`services/valhalla/README.md` § Lite-Suchindex). Der `docker compose`-Container
selbst kann parallel dazu einfach nicht gestartet werden (Profil `search`
weglassen) — spart die volle RAM-Fußabdruck von Photon, nicht nur den JVM-Heap.

## Betrieb: Index provisionieren

```bash
services/photon/download-index.sh germany
docker compose --profile search up -d photon   # oder: restart, falls schon laeuft
curl -f http://localhost:2322/status
```

Initial (frischer Checkout) ist `data/photon/photon_data` leer/nicht
vorhanden — Photon läuft dann ohne Index (degraded/keine Treffer), bis
`download-index.sh` einmal gelaufen ist. `data/` ist gitignored (siehe
`.gitignore`), der Index ist reines Laufzeit-/Provisionierungs-Artefakt, nie
committet — exakt wie `data/valhalla/tiles` und `data/lite-search/`.

## Warum kein LI-only-Index in CI (Recherche-Notiz, E05-T4)

Die Task-Spec erlaubt explizit, die Live-Photon-Integration nach nightly zu
verschieben, **falls und nur falls** ein kleiner LI-Index in CI tatsächlich
nicht zu bekommen ist ("investigate the country-extract availability
first" / "Prefer making the per-PR LI job work"). Diese Recherche wurde
gemacht, mit folgendem Ergebnis:

1. **komoot/photons eigene Dumps**
   (`https://download1.graphhopper.com/public`) bieten laut offizieller
   Doku nur "the world-wide dataset and for selected country datasets" —
   ohne dass die offizielle Doku die konkrete Länderliste, exakte
   Dateinamens-Konvention oder Checksummen-Sidecars nennt. Es gibt **keinen
   Hinweis auf Mikrostaaten-Granularität** (Liechtenstein, Andorra, Monaco
   einzeln) — nur "planet" und größere Länder/Kontinente.
2. **`rtuszik/photon-docker`** (das von `docker-compose.yml` verwendete
   Image) spiegelt/kuratiert einen eigenen Satz vorgebauter DB-Indizes
   (`BASE_URL=https://r2.koalasec.org/public`, Standard-Mirror des Images) —
   **exakt 16 Länder** (Andorra, Argentinien, Österreich, Kanada, Dänemark,
   Frankreich-Monaco, Deutschland, Indien, Japan, Luxemburg, Mexiko,
   Niederlande, Russland, Slowakei, Spanien, USA). **Liechtenstein ist NICHT
   darunter** — es taucht nur als Teil von `switzerland-liechtenstein` auf,
   und zwar ausschließlich als **experimentelles JSONL-Dump**
   (`IMPORT_MODE=jsonl`, Import läuft im Container aus einem OSM-JSONL-Dump,
   nicht als fertiger Such-Index).
3. Einen Photon-Index **selbst aus einer rohen OSM-PBF** zu bauen (wie
   `services/valhalla/build-tiles.sh` es für Valhalla tut, oder
   `build-lite-index.sh` für den Lite-Index) ist bei Photon laut eigener
   Doku (`docs/usage.md` im komoot/photon-Repo) **keine Option ohne eine
   volle Nominatim-PostgreSQL-Importpipeline**: Photons eigener
   `-import-file`-Weg erwartet bereits einen von Nominatim/Photon selbst
   exportierten JSON-Dump, nicht eine PBF direkt. Eine solche
   Postgres+Nominatim-Pipeline nur für einen schnellen per-PR-Gate
   aufzusetzen wäre unverhältnismäßig schwergewichtig (im Gegensatz zu
   Valhalla/Lite, die beide direkt aus einer PBF bauen) und war innerhalb
   dieses Tasks nicht verifizierbar (kein Docker-Daemon/kein
   Netzwerkzugriff auf Photon-Dumps in dieser Sandbox, siehe unten).

**Konsequenz:** ein Liechtenstein-ONLY-Index ist bei keiner bekannten Quelle
in vertretbarer per-PR-Geschwindigkeit zu bekommen. Der Job `photon-setup`
in `.github/workflows/ci.yml` prüft deshalb per PR alles, was **ohne** echte
Geodaten belegbar ist (Skript-Logik, Compose-Config, `-Xmx`-Wirkung direkt
gegen die im Image gebündelte JVM). Der echte "Vaduz"-Suchtest
(E05-T4-Akzeptanz #1, E05-T1-SearchService-Integration) läuft stattdessen
**nightly** (`photon-li-nightly` in `.github/workflows/nightly.yml`) gegen
die nächstkleinere ECHTE, tatsächlich herunterladbare Region
(`switzerland-liechtenstein`, JSONL-Modus) — als `continue-on-error: true`,
weil weder die Bauzeit/Größe dieses experimentellen Importpfads noch die
Zuverlässigkeit des Drittanbieter-Mirrors aus dieser Sandbox heraus
verifizierbar war. Das ist dieselbe Behandlung wie die (ebenfalls
"unverified") DE-Golden-Routes in `nightly.yml`.

## CI-Nachweis

- **`photon-setup`** (`.github/workflows/ci.yml`, per PR): `bash -n` auf
  beiden Skripten; `download-index.test.sh` (Resume + Checksummen-Mismatch +
  Atomaritäts-Sicherheit, komplett offline); `docker compose --profile
  search config` inkl. Assertion, dass `JAVA_PARAMS=-Xmx<wert>` korrekt
  interpoliert wird und der `/status`-Healthcheck verdrahtet ist;
  `-Xmx`-Wirkung direkt gegen die im Image gebündelte JVM (`java
  -XX:+PrintFlagsFinal -version`, `MaxHeapSize` gegen den erwarteten Wert
  ±10 % — Akzeptanz #2 "Xmx wirkt, Container-Limit-Test"); ein
  Compose-Bring-up-Smoke, der beweist, dass `JAVA_PARAMS` tatsächlich im
  laufenden Container ankommt (informativ toleriert dabei einen
  nicht-200-`/status`, da ohne echten Index unklar ist, ob/wann Photons
  Python-Entrypoint die JVM bis zum Ready-Zustand bringt).
- **`photon-li-nightly`** (`.github/workflows/nightly.yml`, nightly,
  `continue-on-error: true`): baut den `switzerland-liechtenstein`-Index via
  `IMPORT_MODE=jsonl`, wartet auf `/status`, führt die echte
  E05-T1-Integration aus (`apps/core/src/search/photonBackend.live.test.ts`,
  `PHOTON_LIVE=1`) — Suche nach "Vaduz" gegen ein LEBENDES Photon (Akzeptanz
  #1) — und misst (informativ) das RSS unter 20 parallelen Suchen gegen
  `Xmx + 300 MB` (Plausibilitäts-Vorgabe der Spec).

## Lokal verifiziert vs. CI-only (Ehrlichkeits-Hinweis)

Diese Sandbox hat **keinen laufenden Docker-Daemon** und **keinen
Netzwerkzugriff auf Photon-Dumps** (analog zu Valhalla/Lite-Suchindex, siehe
`services/valhalla/README.md`). Lokal/hier verifiziert:

- `download-index.sh` + `download-index.test.sh`: Syntax (`bash -n`) und die
  komplette Resume-/Checksummen-/Atomaritäts-Logik gegen einen echten
  (loopback-)HTTP-Server — 6 PASS, 0 FAIL, mehrfach reproduziert.
- `docker-compose.yml`: `docker compose --profile search config` lokal
  ausgeführt und geprüft, dass `JAVA_PARAMS: -Xmx777m` (Test-Override) und
  der `/status`-Healthcheck korrekt in der aufgelösten Config erscheinen.
- `apps/core/src/search/photonBackend.live.test.ts`: läuft lokal via
  `npx vitest run`, ist ohne `PHOTON_LIVE=1` korrekt **geskippt** (kein
  Netzwerkzugriff, kein falsches Grün).

**Nur in CI verifizierbar** (kann hier nicht ausgeführt werden): das
tatsächliche Herunterladen eines echten Länder-Index von den
Photon-Dump-Servern; das tatsächliche Hochfahren des
`rtuszik/photon-docker`-Containers (Docker-Daemon fehlt lokal); die
`-Xmx`-JVM-Messung gegen das echte Image; der `switzerland-liechtenstein`-
JSONL-Build im Nightly-Job. Das ist exakt dieselbe Grenze, die
`services/valhalla/README.md` für Valhalla dokumentiert.
