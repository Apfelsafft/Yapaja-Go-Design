# E10-T2 — Performance-Budgets in CI

Automatisierte Messungen im gedrosselten „N100-Profil", Auswertung gegen die
Budget-Tabellen aus `docs/00` (Erfolgskriterien) und `docs/01 §4`
(Ressourcen-Budget), Ergebnisse als JSON-Artefakt plus Trend-Kommentar,
zusätzlich ein parametrisierter Dauerlauf (Soak).

```
pnpm perf                    # volle Messsuite (~3,5 min)
pnpm perf:soak               # Dauerlauf, Default 120 s (PERF_SOAK_DURATION_S)
pnpm perf:degradation-proof  # ausführbarer Nachweis, dass die Pipeline rot wird
npx vitest run e2e/perf      # Unit-Tests der Auswertungs-/Schwellenlogik
```

---

## 1. Was gemessen wird

| Metrik | Budget | Quelle | Spec |
|---|---|---|---|
| Kaltstart bis interaktive Karte | < 5 s | docs/00 | `00-cold-start.spec.ts` |
| fps beim scripted Pan/Zoom | ≥ 30 | docs/00, W-04 | `10-fps.spec.ts` |
| fps während simulierter Fahrt | ≥ 30 | docs/00, W-04 | `10-fps.spec.ts` |
| Reroute-Latenz nach Abweichung | < 3 s | docs/00, W-05 | `20-reroute.spec.ts` |
| WS-Latenz Position → UI | < 500 ms | docs/00 | `30-ws-latency.spec.ts` |
| RSS `yapaja-core` | ≤ 300 MB | docs/01 §4 | `90-rss.spec.ts` |
| RSS Valhalla / Photon / gpsd / Summe | 1,5 GB / 1 GB / 10 MB / 2,9 GB | docs/01 §4 | **nicht messbar**, s. §4 |

Die Tabelle steht als Daten in `budgets.ts`; jede Zeile trägt ihre
Doku-Fundstelle mit.

### Messprofil („N100-Profil")

* Playwright-CPU-Drosselung **4×** (CDP `Emulation.setCPUThrottlingRate`,
  gesetzt **vor** der Navigation — sonst liefe genau der gemessene Teil
  ungedrosselt).
* Viewport **1280×800** — die in `docs/00` genannte Referenzanzeige. Bewusst
  nicht kleiner: eine kleinere Fläche würde die fps-Messung günstiger machen,
  ohne dass sich am Produkt etwas ändert.
* Service-Worker blockiert (ein Kaltstart ist der erste Aufruf ohne warmen
  Cache).
* Ein einziger, echter, gebauter Core auf Port 4350 — gestartet über dieselben
  Helfer wie die Haupt-Harness (`apps/web/e2e/support/coreProcess.ts`).
* Die Container-Limits **2 vCPU / 4 GB** setzt die Ausführungsumgebung
  (Compose/CI-Runner), nicht der Browser; sie sind Teil des Profils, aber
  nichts, was diese Suite selbst durchsetzen kann.

---

## 2. Die zwei Tore

**Budget-Gate** (`evaluate.ts`) — absolut gegen die Tabelle:

| Verstoß | Status |
|---|---|
| ≤ 0 % | 🟢 grün |
| > 0 % und ≤ 10 % | 🟡 gelb (laut berichtet, blockiert nicht) |
| > 10 % | 🔴 **rot** (blockiert) |

Das ist die Regel aus der Aufgabenstellung, wörtlich: „Budget-Verstoß > 10 %
= rot".

**Regressions-Gate** (`trend.ts`) — relativ gegen eine Referenzmessung
(`PERF_BASELINE=<pfad zu perf-results.json>`): Verschlechterung > 10 % = rot.

Warum es das zweite Tor gibt: die absoluten Budgets haben auf diesem Stand
sehr viel Luft (Kaltstart ~2,3 s gegen 5 s, WS-Latenz ~5 ms gegen 500 ms).
Eine Pipeline mit nur einem absoluten Gate würde die in E10-T2 geforderte
200-ms-Verschlechterung **verschlafen** — real gemessen verschiebt sie den
Kaltstart von 2,3 s auf 3,2 s und die WS-Latenz von 5 ms auf 212 ms und bleibt
dabei unter beiden Budgets. Der Nachweis dazu ist ausführbar, siehe §5.

Das Regressions-Gate greift nur, wenn die Referenz aus **derselben
Messumgebung** stammt (CPU-Drosselung, Viewport, GL-Renderer, vCPU-Zahl werden
in jedes Artefakt geschrieben und verglichen). Sonst wird der Trend informativ
berichtet und gatet nicht — ein Vergleich über Maschinengrenzen hinweg wäre
Rauschen mit Nachkommastellen.

Rauschgrenze: Änderungen unterhalb von **5 % des Budgets** lösen kein
Regressions-Gate aus. Nötig, weil mehrere Metriken um Größenordnungen unter
ihrem Budget liegen (Reroute ~2 ms gegen 3000 ms); dort ist prozentual
gerechnet jede Millisekunde eine „+50-%-Regression". Genau dieser Fehlalarm
ist in einem echten Lauf aufgetreten (10,0 → 12,0 ms) und hat zu dieser Regel
geführt.

Die Grenze lag zunächst bei 1 % und wurde auf **5 % nachkalibriert**, nachdem
der Erholungsschritt des Nachweisskripts an einem zweiten Fehlalarm
gescheitert war: die fixture-freie Messung kam mit 17,2 ms gegen eine
Referenz von 6,5 ms zurück (+164 %), obwohl nichts verschlechtert war — die
Referenz war Minuten zuvor unter anderer Maschinenlast entstanden. Isoliert
auf ruhiger Maschine nachgemessen liefert die Metrik 7,0 ms und 7,5 ms (7 %
Streuung); instabil ist also nicht die Messung, sondern ein relatives
10-%-Tor auf einer ~7-ms-Größe (± 0,7 ms). Geändert wurde damit eine Größe
des **Messaufbaus**, kein Produkt-Budget — die 500 ms aus docs/00 stehen
unverändert. Mit 5 % liegt die Grenze weiterhin um eine Größenordnung unter
der 200-ms-Verschlechterung, die das Gate fangen muss (Unit-Test
„fängt die 200-ms-Verschlechterung trotz angehobener Rauschgrenze").

### ⚠️ Wo das Regressions-Gate heute NICHT scharf ist

Klartext, damit niemand mehr Schutz annimmt als da ist: **im per-PR-CI-Job
gatet derzeit nur das absolute Budget-Tor.** Der Job (`.github/workflows/ci.yml`,
„Performance-Budgets") lädt das Ergebnis als Artefakt **hoch**, holt aber
keines herunter — es wird also kein `PERF_BASELINE` gesetzt, und ohne Referenz
meldet `trend.ts` „keine Referenzmessung" statt zu gaten.

Das ist kein Versehen in der Verdrahtung, sondern die Folge der
Umgebungs-Gleichheitsprüfung eine Ebene darüber: eine Referenz, die auf einer
anderen Maschine entstanden ist (Entwickler-Laptop, anderer Runner-Typ), wird
bewusst als nicht vergleichbar verworfen. Eine hier eingecheckte Baseline
würde auf dem GitHub-Runner also ohnehin nicht greifen — sie täuschte nur
Schutz vor.

Scharf ist das Regressions-Gate damit heute:

* im Nachweis-Skript (`scripts/perf-degradation-proof.sh`), das seine eigene
  Referenz im selben Lauf und derselben Umgebung erzeugt, und
* bei lokalen/manuellen Läufen mit explizitem `PERF_BASELINE`.

Um es auch per PR scharf zu bekommen, müsste der Job das
`perf-budgets`-Artefakt des letzten grünen `main`-Laufs **desselben
Runner-Typs** herunterladen und als `PERF_BASELINE` setzen. Das braucht einen
zusätzlichen Artefakt-Download-Schritt und ist bewusst **nicht** Teil von
E10-T2 — es ist als Folgearbeit notiert, statt es hier halb zu bauen.

---

## 3. Zustände, die es geben muss, damit der Report ehrlich bleibt

* **⚪ `not_measured`** — der Wert ist in dieser Umgebung gar nicht erhebbar.
  Zählt **nie** als grün, verlangt zwingend eine Begründung (die
  Auswertungslogik wirft sonst).
* **🟡 „nur Hinweis" (`advisory`)** — der Wert **wurde** gemessen, die Umgebung
  kann ihn aber nicht zertifizieren. Betrifft die beiden fps-Metriken: der
  Messcontainer hat keine GPU, WebGL läuft über SwiftShader in
  Software-Rasterung (`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …))`).
  Der Messwert wird vollständig berichtet und normal bewertet — er blockiert
  nur nicht, weil er eine Aussage über den Messstand wäre und nicht über das
  Produkt.

  **Die Schwelle bleibt bei 30 fps.** Sie wird nicht aufgeweicht. Zertifizieren
  lässt sie sich nur auf Hardware mit echter GPU (self-hosted Runner oder das
  N100-Zielgerät); sobald der GL-Renderer keine Software-Rasterung mehr meldet,
  gatet die Metrik automatisch hart — die Einstufung wird zur Laufzeit aus dem
  Renderer-String abgeleitet, nicht fest verdrahtet.

---

## 4. Welche RSS-Zahlen hier ehrlich messbar sind

**Messbar: `yapaja-core`.** Ein echter Node-Prozess auf diesem Host; RSS über
`/proc/<pid>/stat`, gelesen mit dem Parser aus `apps/core/src/addons/watchdog.ts`
(E09-T3) — es gibt weiterhin genau eine Stelle im Repo, die `/proc` zerlegt.
Gemessen **nach** der Last der übrigen Specs (`90-rss.spec.ts` läuft zuletzt).

**Nicht messbar: Valhalla, Photon, gpsd, und damit auch die Summe.** In der
per-PR-Pipeline läuft keiner dieser Dienste als langlebiger Container:
`.github/workflows/ci.yml` startet in `valhalla-li-build`/`golden-routes-li`
kurzzeitig einen Valhalla auf dem winzigen Liechtenstein-Graphen für einen
Routing-Smoke-Test, `photon-setup` startet Photon ohne echten Index, gpsd kommt
überhaupt nicht vor. Selbst dort, wo ein Container läuft, wäre sein RSS auf
einem LI-Extrakt keine Aussage über ein Budget, das `docs/01 §4` für den
**Deutschland**-Extrakt formuliert.

Diese vier Zeilen erscheinen deshalb als ⚪ `not_measured` **mit Begründung** im
Artefakt und im Trend-Kommentar. Sie werden nicht geschätzt und nicht
hochgerechnet. Wo sie hingehören: der nightly-Job `photon-li-nightly` gibt
bereits `docker stats` unter Last aus; die DE-Zahlen gehören an den nightly
DE-Job bzw. auf die manuelle Hardware-Checkliste (`docs/07 §7`).

---

## 5. Nachweis der künstlichen Verschlechterung (Akzeptanzkriterium 2)

```
pnpm perf:degradation-proof
```

Vier Läufe, nach dem Vorbild von `scripts/security-mutation-proof.sh`:

| Schritt | Fixture | Erwartung |
|---|---|---|
| 0 | — | grün, liefert die Referenz |
| 1 | **200 ms** | **rot** über das Regressions-Gate; belegt zugleich, dass die absoluten Budgets dabei halten |
| 2 | 1200 ms | rot **auch** über das absolute Budget-Gate |
| 3 | — | wieder grün |

Das Fixture (`PERF_DEGRADE_DELAY_MS`) ist reiner Testcode: es verzögert in
`support/page.ts` jede Core-Antwort an die Seite und im Stub-Valhalla jede
Routing-Antwort. Es wird **kein Produktionscode angefasst** und **kein
Feature-Flag** in die App eingebaut; Schritt 4 des Skripts prüft, dass der
Arbeitsbaum unverändert ist.

---

## 6. Soak / Dauerlauf

```
PERF_SOAK=1 PERF_SOAK_DURATION_S=86400 npx playwright test -c e2e/perf/playwright.config.ts -g Soak
```

* GPS-Simulator fährt durchgehend im Rundkurs (~90 s je Runde), Neustart bei
  Track-Ende wird gezählt.
* Eine Browser-Sitzung hängt dauerhaft am WS; zusätzlich werden regelmäßig
  weitere Kontexte geöffnet und geschlossen — ohne diesen Verbindungswechsel
  könnte ein Verbindungsleck gar nicht entstehen und damit auch nicht gefunden
  werden.
* Abtastung von RSS, offenen FDs und offenen Sockets über `/proc`; Zielgröße
  ~40 Stichproben, bei 24 h alle 5 min.
* Kriterien: **RSS-Drift < 5 %** (erstes Viertel gegen letztes Viertel, nicht
  Anfangs- gegen Endwert — ein Einzelwert läge in der Aufwärmphase bzw. direkt
  vor/nach einer GC) und **kein FD-/Socket-Wachstum > 8**.
* Ausgabe: `.tmp/soak-results.json` (inkl. aller Stichproben) und
  `.tmp/soak-report.md`.

Der Lauf ist **parametrisiert**: der Kurzlauf beweist den Mechanismus, der
24-h-Lauf beweist die Aussage. Im Repository ist bisher nur der Kurzlauf
ausgeführt worden; der 24-h-Lauf hängt am Wochen-Cron
(`.github/workflows/nightly.yml`, Job `perf-soak-24h`, sonntags).

---

## 7. Plausibilität: < 15 % Streuung zwischen zwei Läufen

Die Vorgabe ist hart formuliert — „sonst Messaufbau fixen, nicht Schwellen
aufweichen!". Genau das ist hier mehrfach passiert. Zwei vollständige Läufe
hintereinander, identischer Aufbau:

| Metrik | Lauf 1 | Lauf 2 | Streuung |
|---|---:|---:|---:|
| Kaltstart | 2283,5 ms | 2314,4 ms | **1,3 %** |
| fps Pan/Zoom | 9,04 | 9,53 | **5,3 %** |
| fps Fahrt | 9,46 | 9,04 | **4,5 %** |
| Reroute | 2,12 ms | 2,39 ms | **11,6 %** |
| WS-Latenz | 5,06 ms | 5,58 ms | **9,8 %** |
| RSS Core | 102,3 MB | 99,4 MB | **2,8 %** |

Was dafür am **Messaufbau** repariert werden musste (jeweils mit den echten
Zahlen, die dazu geführt haben):

1. **Kennzahl je Lauf = interquartiles Mittel** statt Median oder Mittelwert.
   Der Median quantisiert bei kleinen Absolutwerten auf ganze Millisekunden
   (WS-Latenz: 6 ms gegen 5 ms = 18 % Streuung), der Mittelwert kippt bei
   einem einzelnen Ausreißer. Interquartil: 6,2 ms gegen 6,1 ms = 1,6 %.
2. **Reroute-Messpunkt.** Erst REST-Polling alle 75 ms — die Abtastung war
   größer als die Messgröße (~2 ms), zwei Läufe meldeten 77 ms und 31 ms
   (85 % Streuung). Dann `nav/state` über den Browser-Store — noch schlechter
   ([242, 125, 216, 10, 251] ms), weil der Messcontainer in Software rastert
   und eine WS-Nachricht bis zu einer Frame-Zeit (~110 ms) auf die Verarbeitung
   wartet. Dann REST-Polling alle 5 ms — 18 % Streuung, die HTTP-Umlaufzeit
   liegt selbst in der Größenordnung der Messgröße. **Endfassung:** derselbe
   Event-Bus, an dem auch das UI hängt, direkt aus dem Node-Prozess abgehört
   (`support/wsObserver.ts`), Zeitstempel auf der monotonen
   `performance.now()`-Uhr beider Enden im selben Prozess.
3. **WS-Latenz: Fixe nur Millimeter auseinander.** Bei ~145 m je Fix zentriert
   Follow-Me die Karte neu, MapLibre lädt und rastert neue Kacheln — und weil
   in Software gerastert wird, dauert ein Frame ~110 ms. Diese ~110 ms tauchten
   in 5 von 20 Stichproben als Ausreißer auf (p95 sprang von 8 ms auf 113 ms,
   Laufstreuung 35 %). Gemessen wurde damit die Rasterzeit des Containers, nicht
   der Datenweg, den `docs/00` meint. Plus drei nicht gewertete Anlauf-Fixe.
4. **fps: keine Bearing-Änderung, kein `setTimeout` als Taktgeber, Follow-Me
   per echter Nutzergeste pausieren.** Alle drei Fassungen davor haben die
   Kamerafahrt abgebrochen (28 Starts/Stopps statt 10; eine Etappe endete nach
   574 statt 2000 ms) und damit Abbruchlogik statt Bild-Rate gemessen. Die
   Specs asserten deshalb ausdrücklich, dass jede Etappe wirklich durchgelaufen
   ist — bricht sie ab, scheitert die Spec, statt eine bedeutungslose Zahl zu
   melden.

`retries: 0` in der Config gehört zur selben Regel: eine wiederholte Messung
ist keine Messung.

---

## 8. Artefakte

| Datei | Inhalt |
|---|---|
| `.tmp/perf-results.json` | vollständiges Ergebnis inkl. Rohstichproben, Umgebungssignatur, Trend |
| `.tmp/perf-trend.md` | Trend-Kommentar (Markdown, für den PR) |
| `.tmp/soak-results.json` | Soak-Stichproben + Auswertung |
| `.tmp/soak-report.md` | lesbarer Soak-Report |

`perf-results.json` eines grünen `main`-Laufs ist zugleich die Referenz für das
Regressions-Gate des nächsten Laufs (`PERF_BASELINE`).

---

## 9. Was hier NICHT behauptet wird

* Die fps-Budgets sind auf diesem Messstand **nicht zertifiziert** — sie werden
  gemessen (~9 fps) und ausdrücklich als „in dieser Umgebung nicht
  zertifizierbar" ausgewiesen, weil ohne GPU in Software gerastert wird.
* Valhalla-, Photon- und gpsd-RSS sowie die Server-Summe sind **nicht gemessen**.
* Der 24-h-Soak ist **nicht gelaufen**; ausgeführt wurden Kurzläufe von
  Minuten, die den Mechanismus belegen.
