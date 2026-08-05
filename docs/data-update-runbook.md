# Runbook: Kartendaten aktualisieren

**Zweck:** Eine neue OSM-PBF sicher in Betrieb nehmen — Valhalla-Graph, PMTiles,
Suchindex — **ohne** dass eine OSM-Regression unbemerkt in ein Fahrzeug gelangt.

**Zuständig:** wer das Update ausrollt. **Dauer:** DE ca. 4–6 h (überwiegend
Wartezeit), LI ca. 15 min. **Wargames:** W-08 (fehlende Höhen-/Gewichtsangaben),
W-17 (veraltete Kartendaten), W-18 (Platte voll).

> **Die eine Regel, die dieses Runbook durchsetzt:**
> **Ein Datenupdate, dessen Golden-Route-Suite nicht grün ist, wird nicht
> ausgerollt.** Nicht „mit Vorbehalt", nicht „der eine Fall ist bekannt rot" —
> gar nicht. Kartendaten sind die einzige Quelle, aus der das Navi weiß, dass
> eine 3,2-m-Unterführung existiert; verschwindet das Tag beim Update, fährt
> ein 3,5-m-Wohnmobil dagegen. Genau diesen Fall fängt Schritt 6.

---

## 0. Vorbedingungen

| Prüfung | Kommando | Schwelle |
|---|---|---|
| Freier Platz | `df -h .` | ≥ 2,5 × PBF-Größe (W-18; DE ≈ 4 GB PBF ⇒ ≥ 10 GB frei) |
| Docker läuft | `docker info` | rc = 0 |
| osmium vorhanden | `osmium --version` | für Schritt 2 + 5 |
| Ports frei | `ss -ltn` | 8002 (Valhalla), 8099 (Build-Container) |
| Aktueller Stand notiert | `curl -s localhost:8080/api/v1/system/info` | OSM-Datum festhalten — die Rückfallebene |

**Rollback-Plan vor dem Start festlegen.** Der Graph-Swap in Schritt 3 ist
atomar und rollt sich bei Fehlern selbst zurück; für PMTiles und den Suchindex
gilt: die alte Datei bleibt so lange liegen, bis die Abnahme grün ist.

---

## 1. Neue PBF beschaffen

```bash
mkdir -p data/pbf
curl -fL --retry 3 -C - \
  -o data/pbf/germany-latest.osm.pbf \
  https://download.geofabrik.de/europe/germany-latest.osm.pbf
```

`-C -` (Resume) ist kein Luxus: der Download läuft im Feld oft über LTE (W-17).
Bricht er ab, setzt derselbe Befehl fort.

Danach die Datei festnageln — sie ist ab hier die **Referenz für alles Weitere**,
auch für die Provenienz in Schritt 2:

```bash
sha256sum data/pbf/germany-latest.osm.pbf | tee data/pbf/germany-latest.sha256
```

---

## 2. Restriktions-Provenienz aus **dieser** PBF ziehen

**Vor** dem Graph-Bau, weil das Ergebnis darüber entscheidet, ob die
Golden-Routes überhaupt etwas messen können.

```bash
scripts/osm-restriction-provenance.sh verify data/pbf/germany-latest.osm.pbf
```

Das Skript filtert alle Wege mit `maxheight` / `maxweight` / `maxwidth`,
schneidet sie gegen die `forbidden_bbox` jedes Restriktionsfalls in
`e2e/golden-routes.json` und meldet je Fall einen von fünf Befunden:

| Befund | Bedeutung | Was zu tun ist |
|---|---|---|
| `CONFIRMED` | bindendes Tag gefunden, Wert passt zur Fixture | Block übernehmen (erst nach grüner Route-Assertion) |
| `VALUE_MISMATCH` | Tag gefunden, anderer Wert | **beobachteten** Wert übernehmen, Profile neu gegen ihn prüfen |
| `AMBIGUOUS` | mehrere gleich bindende Wege | `forbidden_bbox` auf das gemeinte Bauwerk verengen |
| `NO_PARSABLE_VALUE` | Tag da, aber `default`/`none` | Fall ist nicht belegbar → ersetzen |
| `NO_CANDIDATES` | kein Tag in der Box | Fall ist nicht belegbar → ersetzen |

Ersatz **nie raten**, sondern aus echten Kandidaten wählen:

```bash
scripts/osm-restriction-provenance.sh discover data/pbf/germany-latest.osm.pbf maxwidth 40
```

> **Warum nicht Overpass?** Weil das die falsche Frage beantwortet. Relevant ist
> nicht, ob das Tag *heute in der Live-OSM-Datenbank* steht, sondern ob es *in
> der PBF steht, aus der der Graph gebaut wird*. Nur das entscheidet, ob der
> Router die Beschränkung sehen kann. Nebeneffekt: es funktioniert auch ohne
> Overpass-Zugang (Air-Gap, Build-Sandbox).
>
> **Und niemals von Hand füllen.** Eine erfundene `osm_way_id` lässt einen
> unbelegten Sicherheitsfall *belegt aussehen* — das ist schlimmer als eine
> offen dokumentierte Lücke. Findet das Skript nichts, gibt es bewusst **keinen**
> Block aus.

---

## 3. Valhalla-Graph neu bauen und **atomar** einschwenken (W-17)

```bash
VALHALLA_BUILD_TIMEOUT_S=7200 \
  services/valhalla/build-tiles.sh data/pbf/germany-latest.osm.pbf
```

Was das Skript garantiert (E03-T1):

1. Es baut **nie** direkt in `data/valhalla/tiles`, sondern in
   `data/valhalla/tiles.new`.
2. Der Build-Container hört auf `$VALHALLA_BUILD_PORT` (Default 8099) — ein
   laufender Live-Valhalla auf 8002 **serviert währenddessen ungestört weiter**.
   Für das Fahrzeug gibt es keine Downtime während des Baus.
3. Erst nach vollständigem Erfolg: `mv tiles → tiles.old`, `mv tiles.new → tiles`.
   Ein `mv` im selben Dateisystem ist ein `rename(2)`-Syscall — atomar, kein
   halbfertiger Zwischenzustand für Leser.
4. Bei **jedem** Fehler vor dem Swap bleibt `tiles` unangetastet; bricht der
   Swap selbst ab, stellt der Exit-Handler `tiles.old` wieder her.

Dann den Dienst die neuen Tiles einlesen lassen (kurzer Blip):

```bash
docker compose restart valhalla
curl -sf localhost:8002/status | jq .
```

**Rollback:** Solange `data/valhalla/tiles.old` noch existiert, ist der alte
Stand ein `mv` entfernt. Nach einem erfolgreichen Lauf ist er entfernt — dann
ist der Rollback ein Neubau aus der vorigen PBF.

---

## 4. PMTiles aktualisieren

Die Kartendarstellung ist von Routing und Suche entkoppelt; sie darf getrennt
aktualisiert werden. Die Datei wird **daneben** gelegt und erst nach
erfolgreichem Download eingeschwenkt — dieselbe Disziplin wie in Schritt 3:

```bash
TILES_DIR="${TILES_DIR:-data/tiles}"
mkdir -p "$TILES_DIR"
curl -fL --retry 3 -C - -o "$TILES_DIR/germany.pmtiles.new" "<PMTiles-Quelle>"
# Kein halbes Kartenbild ausliefern: erst prüfen, dann umbenennen.
test -s "$TILES_DIR/germany.pmtiles.new"
mv "$TILES_DIR/germany.pmtiles.new" "$TILES_DIR/germany.pmtiles"
```

Danach prüfen, dass der Core die Region weiter sieht:

```bash
curl -s localhost:8080/api/v1/map/regions | jq .
```

> Der Regionsname muss dem Slug-Muster aus `apps/core/src/map/paths.ts` folgen
> (`^[a-zA-Z0-9_-]+$`); alles andere wird als Pfad-Traversal abgewiesen und die
> Region taucht schlicht nicht auf.

---

## 5. Suchindex neu bauen (Photon **oder** Lite)

Aus **derselben** PBF, sonst weichen Such- und Routing-Datenstand auseinander.

**Lite (SQLite FTS5, Standard auf dem Mini-PC, W-12):**

```bash
services/valhalla/build-lite-index.sh data/pbf/germany-latest.osm.pbf
```

Auch hier: das CLI schreibt in eine Temp-Datei und schwenkt per `rename(2)` ein —
ein laufender Core sieht nie eine halbfertige DB. Ein Core-Neustart macht die
neue DB sicher sichtbar.

**Photon (optional, JVM):** Index gemäß `services/photon/README.md` neu
importieren. Photon ist bewusst abschaltbar (W-12); ist er aus, übernimmt der
Lite-Index, und die Suche meldet `source: 'lite'`.

Rauchtest:

```bash
curl -s "localhost:8080/api/v1/search?q=Nürnberg" | jq '.data[0]'
```

---

## 6. Abnahme: Golden-Routes — **das Tor, nicht die Formalie**

Erst hier entscheidet sich, ob das Update ausgerollt wird.

```bash
pnpm build
DB_PATH=:memory: VALHALLA_URL=http://localhost:8002 PORT=8080 \
  node apps/core/dist/index.js &

GOLDEN_LIVE=1 GOLDEN_NIGHTLY=1 GOLDEN_REGION=de CORE_URL=http://localhost:8080 \
  pnpm exec vitest run --config vitest.golden.config.ts
```

Was dabei geprüft wird (docs/07 §3b):

- **Distanzen** bekannter Strecken innerhalb ±10 % — fängt großflächige
  Kostenmodell-/Netzregressionen.
- **Maßrestriktionen in beiden Richtungen** — das kleine Profil **muss** die
  Sperrbox befahren (sonst wäre der Fall gegenstandslos), das große **darf es
  nicht**. Genau das schlägt fehl, wenn die neue PBF ein `maxheight` verloren
  hat.
- **Profil-Monotonie** — ein größeres Fahrzeug darf nie *schneller* sein; fängt
  vertauschte Profil→Costing-Mappings.
- **`no_route`** — Ziele, die schlicht nicht erreichbar sind.
- **ETA-Plausibilität** — simulierte Fahrt mit Faktor 1.0, Abweichung der
  tatsächlichen Ankunft von der initialen ETA < 5 %.

`vitest.golden.config.ts` setzt `retry: 0, bail: 1`: **kein Retry, keine
Toleranz.** Ein roter Sicherheitsfall ist niemals „flaky", sondern Stopp.

### Entscheidungstabelle

| Ergebnis | Entscheidung |
|---|---|
| Alle Fälle grün | Ausrollen. OSM-Datum in `system/info` prüfen. |
| Ein `restriction`-Fall rot | **Nicht ausrollen.** Erst Schritt 2 wiederholen: ist das Tag in der neuen PBF verschwunden (echte OSM-Regression) oder liegt es woanders (Fall nachziehen)? |
| Ein `distance`-Fall knapp außerhalb ±10 % | Nicht sofort die Toleranz aufweichen. Prüfen, ob sich die Straße real geändert hat; dann Wert **mit Begründung** in `provenance` neu einfrieren. |
| `monotonic` rot | Kein Datenproblem — Profil→Costing-Mapping ist kaputt. Update stoppen, Code fixen. |
| ETA-Fall rot | Ausrollen des Kartenstands möglich, aber Ticket: die ETA-Kalibrierung passt nicht mehr zu den neuen Kantengeschwindigkeiten. |

### Rollback

1. `docker compose stop valhalla`
2. Alten Graphen wiederherstellen (`tiles.old` oder Neubau aus der vorigen PBF).
3. PMTiles/Suchindex zurücklegen — beide alten Dateien liegen noch daneben,
   solange die Abnahme nicht grün war.
4. `docker compose start valhalla`, Abnahme gegen den **alten** Stand
   wiederholen: sie muss wieder grün sein. Ist sie das nicht, lag der Fehler nie
   in den Daten.

---

## 7. Rauchtest des Runbooks selbst

Ein Runbook, das niemand ausführt, verrottet still. Deshalb läuft
`scripts/runbook-smoke.sh` nächtlich in CI (Job `runbook-smoke`) und geht die
Schritte oben in reduzierter Form ab:

```bash
scripts/runbook-smoke.sh                     # vollständig
RUNBOOK_SMOKE_SKIP_LIVE=1 scripts/runbook-smoke.sh   # ohne S5/S6 (kein pnpm build nötig)
```

| Schritt | Runbook-Bezug | Form |
|---|---|---|
| S1 | alle Schritte | **echt** — jede genannte Datei/jeder Workflow-Job existiert |
| S2 | §2 Provenienz | reduziert — synthetische Kandidaten, **echte** Auswertung |
| S3 | §3 Swap | reduziert — nur der Fehlerpfad, weist W-17 („`tiles` bleibt intakt") positiv nach |
| S4 | §5 Lite-Index | **echt** — echte SQLite-FTS5-DB inkl. atomarem `rename` |
| S5 | §6 Abnahme grün | **echt** — echter Core + echter Runner gegen einen Stub-Router |
| S6 | §6 Abnahme rot | **echt** — dasselbe mit „verlorener" Höhenbeschränkung: **muss** rot werden |

S6 ist der Kern: er beweist, dass die Zusage dieses Runbooks — „ein Update mit
OSM-Regression kommt nicht durch" — tatsächlich greift, und zwar mit der
richtigen Begründung (`🔴 SAFETY VIOLATION`).

**Nicht abgedeckt** (und im Skript als `[SKIP]` ausgewiesen): der echte
PBF-Download, der echte Valhalla-Graph-Bau und der echte PMTiles-Download.
Die brauchen mehrere GB Netzverkehr und einen Docker-Daemon — für einen
Rauchtest zu teuer. Nächtlich abgedeckt sind sie durch die Jobs
`golden-routes-de` (DE-Graph) und `golden-eta-li` (LI-Graph).

---

## 8. Durchlauf-Protokoll

> **Was hier steht und was nicht.** Dieses Protokoll hält fest, was in der
> Entwicklungsumgebung **tatsächlich ausgeführt** wurde. Schritte, die dort
> strukturell unmöglich sind (kein Docker-Daemon, keine Netz-Egress zu
> Geofabrik/Overpass), sind als **NICHT AUSGEFÜHRT** markiert — nicht als
> „durchgelaufen". Wer sie nachholt, ergänzt hier die CI-Run-URL.

**Datum:** 2026-08-05 · **Umgebung:** Build-Sandbox (Node 22, pnpm 10.33,
kein Docker-Daemon, `download.geofabrik.de` und `overpass-api.de` liefern
`CONNECT tunnel failed, response 403`) · **Kommando:** `scripts/runbook-smoke.sh`

| Schritt | Status | Beleg |
|---|---|---|
| §0 Vorbedingungen | teilweise | `docker info` → *Cannot connect to the Docker daemon*; `curl` auf Geofabrik → HTTP-Tunnel 403 |
| §1 PBF-Download | **NICHT AUSGEFÜHRT** | Egress blockiert (siehe oben) |
| §2 Provenienz | **ausgeführt (reduziert)** | `provenanceCli verify/discover` gegen synthetische Kandidaten: alle fünf Befunde erzeugt (`CONFIRMED`, `VALUE_MISMATCH`, `AMBIGUOUS`, `NO_PARSABLE_VALUE`, `NO_CANDIDATES`); ohne Fund wird nachweislich **kein** Block ausgegeben |
| §2 gegen echte DE-PBF | **NICHT AUSGEFÜHRT** | braucht die PBF aus §1 → nächtlicher Job `golden-routes-de` |
| §3 Graph-Bau | **NICHT AUSGEFÜHRT** | kein Docker-Daemon |
| §3 Swap-Zusage (W-17) | **ausgeführt (Fehlerpfad)** | `build-tiles.sh` mit fehlender PBF → rc=1, Live-Marker in `data/valhalla/tiles` unverändert, kein `tiles.new`-Rest |
| §4 PMTiles | **NICHT AUSGEFÜHRT** | Download-Quelle nicht erreichbar |
| §5 Lite-Index | **ausgeführt (echt)** | `lite_search.db` aus Fixture-GeoJSONSeq gebaut, 24 576 Bytes, atomar eingeschwenkt |
| §5 osmium-Hälfte | **NICHT AUSGEFÜHRT** | `osmium` nicht installiert, keine PBF |
| §6 Abnahme **grün** | **ausgeführt (echt)** | echter Core gegen Stub-Router: `distance=744m / erwartet 745m ±10%`; klein → Sperrbox `true`, groß → `false`; ETA-Fehler **1,82 %** bei Budget 5 % |
| §6 Abnahme **rot** | **ausgeführt (echt)** | Stub im Regressionsmodus (`maxheight` verschwunden) → rc=1, `🔴 SAFETY VIOLATION — large/heavy profile routed THROUGH the forbidden box` |
| §6 gegen echten DE-Graph | **NICHT AUSGEFÜHRT** | siehe §3 → nächtlicher Job `golden-routes-de` |
| §7 Rauchtest | **ausgeführt** | `scripts/runbook-smoke.sh` → „Runbook-Rauchtest bestanden" |

**Aussagekraft, ehrlich eingeordnet.** Was hier bewiesen ist, ist die *Mechanik*:
der Swap ist fehlerfest, der Lite-Index baut atomar, das Abnahme-Gate schlägt bei
einer verlorenen Höhenbeschränkung aus — und zwar mit der richtigen Begründung.
Was **nicht** bewiesen ist, sind die *Daten*: kein einziges deutsches OSM-Tag
wurde gelesen, keine DE-Distanz wurde geroutet. Deshalb sind alle DE-Fälle
weiterhin `unverified: true` und der Job `golden-routes-de` bleibt
`continue-on-error`. Die Bedingungen, unter denen das aufgehoben werden darf,
stehen als Checkliste im Kopf dieses Jobs in `.github/workflows/nightly.yml`.
