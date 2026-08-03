# Track-Recorder (`com.yapaja.track-recorder`)

Referenz-Add-on Typ B + Mini-UI (E09-T5, [docs/05 §6.2](../../docs/05-addon-system.md#6-referenz-add-ons-teil-von-e09-dienen-als-lebende-doku)).
Der Service abonniert `pos/update` und schreibt die Fahrt als GPX (mit
Segment-Split bei GPS-Verlust) in den eigenen Storage; die Mini-UI bietet
Start/Stop, Laufzeit/Distanz-Anzeige und eine Liste aufgezeichneter Tracks
mit GPX-Export.

Folgt [docs/addon-dev-guide.md](../../docs/addon-dev-guide.md) §2 (Service-Add-on
in 10 Minuten). Dieses README beschreibt nur das Add-on-spezifische.

## Scopes (minimal -- Begründung pro Eintrag)

| Scope | Warum genau dieser (und kein anderer) |
|---|---|
| `pos.read` | Der Service abonniert `pos/update` (`addon.position.subscribe`), um jede Fixe der aktuellen Aufnahme hinzuzufügen. |
| `storage.own` | Die EINZIGE Persistenz UND der EINZIGE Kanal zwischen Service- und UI-Hälfte (siehe unten) -- Track-GPX-Text, der Track-Index, der Live-Status und die Start/Stop-Kommandos leben alle unter `storage.own`. |
| `widget.register` | Die UI aktualisiert ein kompaktes Side-Panel-Widget mit "Aufnahme läuft · Laufzeit · Distanz". |
| `events.publish` | **Seit E09-T8.** Zwei schlanke, „fire-and-forget"-Benachrichtigungen (`started`/`stopped`) für externe (MQTT/HA-)Konsumenten -- **nicht** der UI<->Service-Kanal, siehe "`events.publish` (E09-T8)" unten für die Abgrenzung. |

**Bewusst NICHT angefordert:** `nav.control`/`route.*` -- der Recorder liest
nur mit, greift nie in Navigation/Route ein; `net.fetch:*` -- keine
Online-Abhängigkeit.

## Warum `storage.own` der UI<->Service-Kanal ist (nicht `events.publish`)

Die zwei Hälften dieses Add-ons laufen auf VERSCHIEDENEN Transports
(`packages/addon-sdk/src/types.ts`): die UI spricht postMessage mit dem
Host-Bridge, der Service spricht REST/WS mit dem Core. Es gibt keinen
direkten Kanal zwischen beiden. Die SDK-Oberfläche bietet:

- `events.publish` -- aber **kein** `events.subscribe` auf der UI-Seite (nur
  `publish`, siehe `YapajaAddon.events` in `types.ts`) -- die UI könnte also
  ein vom Service publiziertes `addon/{id}/*`-Event gar nicht empfangen.
- `storage.get`/`storage.set` -- **auf BEIDEN Transports vorhanden** (siehe
  `types.ts`'s Doku pro Methode) und daher der einzige tatsächlich
  funktionierende Zwei-Wege-Kanal. Dieses Add-on nutzt ihn für vier Schlüssel:
  `command` (UI -> Service: `{action:'start'|'stop', seq}`, `seq` ist
  `Date.now()`, damit ein UI-Reload nie ein bereits verarbeitetes Kommando
  erneut auslöst), `state` (Service -> UI: `{recording, distanceMeters,
  pointCount, …}`, per Polling gelesen), `index` (Service -> UI: Liste
  abgeschlossener Tracks) und `track:<id>` (Service -> UI: der fertige
  GPX-Text). Der Service pollt `command` alle 500 ms; die UI pollt `state`
  jede Sekunde und `index` alle 1,5 s -- kein Push-Kanal existiert für UI-Add-ons
  (siehe `docs/addon-dev-guide.md` §9, "`nav.subscribe()` … existiert nur auf
  dem Service-Transport").

Diese Begründung gilt weiterhin unverändert -- `events.publish` ist auch nach
E09-T8 KEIN UI<->Service-Kanal (die UI empfängt es nach wie vor nicht, siehe
oben). Was sich geändert hat: der Service nutzt `events.publish` seit E09-T8
für einen **anderen, unabhängigen** Zweck, siehe unten.

## `events.publish` (E09-T8): externe Statusmeldungen, kein UI-Kanal

Seit E09-T8 (MQTT-Erweiterung für Add-ons) publiziert der Service ZWEI
schlanke Events -- `started` beim Aufnahme-Start, `stopped` beim Ende (inkl.
`TrackSummary`: Distanz, Punktzahl, Segmentzahl) -- unter `addon/{id}/*`
(Scope `events.publish`). Der Core republiziert sie automatisch als
`yapaja/addon/com.yapaja.track-recorder/started`/`.../stopped` (Rate-Limit
5 msg/s, Payload ≤ 16 KB, siehe `apps/core/src/mqtt/bridge.ts`) -- damit kann
z. B. eine Home-Assistant-Automation auf "Aufzeichnung gestartet/beendet"
reagieren (Worked Example: [`docs/04-home-assistant.md`
§6](../../docs/04-home-assistant.md#6-add-on-events-e09-t8)).

Das ist bewusst NICHT dasselbe wie der UI<->Service-Kanal oben: die UI dieses
Add-ons liest ihren Status weiterhin ausschließlich über `storage.own`
(Polling, siehe oben) -- die `events.publish`-Aufrufe hier sind fire-and-forget
Benachrichtigungen für EXTERNE (MQTT/HA-)Konsumenten, die die UI selbst nie
verarbeitet. Ein fehlgeschlagener `events.publish`-Call (z. B. Scope entzogen)
darf daher nie die eigentliche Aufnahme/GPX-Erstellung stören -- siehe
`publishAddonEvent()` in `src/service.ts` (try/catch, nur geloggt).

## Segment-Split bei GPS-Verlust (das Kernstück)

`src/recorder.ts#applyFix` ist eine reine Zustandsmaschine (keine SDK-, keine
Zeit-Abhängigkeit -- vollständig unit-testbar, siehe `recorder.test.ts`):
Trifft eine Fixe ein, deren Abstand zur VORHERIGEN akzeptierten Fixe (nach
`ts`, dem echten Positions-Zeitstempel, nicht "wann kam die Nachricht an")
`GAP_THRESHOLD_MS` (3000 ms) überschreitet, beginnt ein NEUES `<trkseg>` statt
den Punkt an das laufende Segment anzuhängen. `src/gpx.ts#buildGpx` serialisiert
jedes Segment als eigenes `<trkseg>` innerhalb EINES `<trk>` -- ein
GPS-Ausfall wird dadurch nie als gerade Linie über die Lücke gezeichnet.
`src/distance.ts#totalDistanceMeters` summiert Distanzen ausschließlich
INNERHALB eines Segments -- die "verlorene" Distanz während eines Ausfalls
wird nie mitgezählt (genau das, was ein echter GPS-Tracker auch tut: er weiß
nicht, was während des Ausfalls passiert ist).

Der Schwellwert (3000 ms) liegt deutlich über der normalen `pos/update`-Publish-Kadenz
(Default 1 Hz, `apps/core/src/position/service.ts#DEFAULT_RATE_HZ` --
d.h. ~1000 ms zwischen Fixes im Normalbetrieb), damit gewöhnlicher
Publish-Jitter nie fälschlich einen Split auslöst.

## Bekannte Plattform-Lücke: kein echter Datei-Download aus dem Sandbox-Iframe

Das Add-on-Iframe ist `sandbox="allow-scripts"` OHNE `allow-downloads`
(`apps/web/src/addons/AddonHost.tsx`) -- ein `<a download>`-Klick aus dem
Inneren des Sandkastens löst in den meisten aktuellen Browsern KEINEN
Speichern-Dialog aus (Chromium blockiert Downloads aus einem
`allow-scripts`-only-Sandbox-Kontext seit mehreren Jahren standardmäßig).

Diese Beispiel-Implementierung löst das nicht durch eine Sandbox-Änderung
(außerhalb des Scopes dieser Aufgabe, siehe Task-Vorgabe), sondern zeigt den
vollständigen GPX-Text in einem `<pre>` (`data-testid="track-gpx-view"`) an --
copy-paste-fähig, funktioniert garantiert überall. Zusätzlich wird ein
Best-Effort-`<a download>`-Blob-Link angeboten (`data-testid="track-download-link"`),
der in manchen Browsern/Konfigurationen tatsächlich einen Download auslöst,
aber nicht die primäre, verlässliche Export-Methode ist.

## Hinweis: `core_api` als `"*"`

Siehe [`../poi-campsites/README.md`](../poi-campsites/README.md#hinweis-core_api-als-) --
derselbe Grund (lokal gebauter Core meldet `"0.0.0"` statt der echten Version).

## Bauen

```sh
node build.mjs   # -> dist/track-recorder.tgz
```

## Installieren (siehe Dev-Guide §8)

```sh
BASE64=$(base64 -w0 dist/track-recorder.tgz)
PENDING=$(curl -s -X POST http://localhost:8080/api/v1/addons/install \
  -H 'content-type: application/json' \
  -d "{\"source\":\"upload\",\"data\":\"$BASE64\"}" | jq -r '.data.pending_id')
curl -s -X POST "http://localhost:8080/api/v1/addons/install/$PENDING/confirm"
curl -s -X POST http://localhost:8080/api/v1/addons/com.yapaja.track-recorder/enable
```

## Testen

```sh
npx vitest run addons-examples/track-recorder   # Unit: GPX/Distanz/Segment-Split
cd ../../apps/web && npx playwright test e2e/addon-examples-recorder.spec.ts
```
