# EVIL FIXTURE -- Angriffs-Add-on der Sicherheits-Testsuite (E09-T6)

> **WARNUNG -- KEIN BEISPIEL-ADD-ON.**
> Dieses Verzeichnis ist ein **Test-Fixture**. Es versucht systematisch *jede*
> verbotene Aktion, die das Add-on-System abwehren muss. Es gehört
> **niemals** in die Registry, in den Store, in `addons-examples/README.md`s
> Beispiel-Liste oder auf ein echtes Gerät.
>
> Der Guard-Test [`not-in-store.test.ts`](./not-in-store.test.ts) bricht die
> CI, sobald die Add-on-Id `com.example.evil-fixture` irgendwo in einem
> Registry-/Store-Index oder im Produktions-Quellcode auftaucht.

Verwendet wird es ausschließlich von der Sandbox-Escape-Suite in
[`e2e/security/`](../../e2e/security/README.md), die es über die **echte**
Install-API in einen **echten** Core installiert und danach für jeden Vektor
zweierlei prüft:

1. der Versuch wurde **geblockt** (die beobachtbare Wirkung ist ausgeblieben), und
2. es wurde ein **`security`-Event** mit der passenden `vector`-Id
   aufgezeichnet (`GET /api/v1/security/events`).

## Aufbau

| Datei | Rolle |
| --- | --- |
| `yapaja-addon.json` | Manifest. Deklariert **absichtlich nur** `pos.read`, `storage.own`, `widget.register`, `events.publish` -- alles andere, was es versucht, ist damit *nicht* deklariert. |
| `ui/index.html` + `ui/evil.js` | UI-Hälfte im Sandbox-iframe. Schreibt **rohes** postMessage von Hand, benutzt das SDK bewusst nicht. |
| `service/main.mjs` | Service-Hälfte als Node-Kindprozess. Schreibt sein Prüfergebnis nach `$YAPAJA_DATA_DIR/evil-probe.json`. |
| `build.mjs` | Baut `dist/evil-fixture.tgz` (nur für manuelles Ausprobieren -- die Suite baut den Tarball in-process). |

## Warum rohes postMessage statt SDK?

Das SDK (`@yapaja/addon-sdk`) ist **untrusted convenience code**: ein
bösartiges Add-on tauscht es einfach aus. Ein Fixture, das brav durchs SDK
geht, könnte deshalb gar nicht beweisen, dass die Durchsetzung host-seitig
liegt. Dieses Fixture umgeht das SDK vollständig -- und wird identisch
abgelehnt. Genau das ist die Aussage von `apps/web/src/addons/bridge.ts`.

(Deshalb ist dieses Verzeichnis auch bewusst vom Scan in
`../no-raw-transport.test.ts` ausgenommen: dort gilt "nur SDK" für die beiden
*Referenz*-Add-ons, hier gilt das Gegenteil.)

## Selbstmeldung -- was sie beweist und was nicht

Zwei Verstöße sind **nur im Browser** beobachtbar: der Zugriff auf das
Parent-DOM (wirft `SecurityError` in der opaken Origin) und ein `fetch()` zu
einem fremden Host (von der Add-on-CSP `connect-src 'none'` gekillt). Der Core
sieht davon nichts. Dieses Fixture meldet beide freiwillig per
`security-violation`-Nachricht an den Host, der sie an
`POST /api/v1/security/events` weiterreicht.

Das ist **Auditierbarkeit, keine Eindämmung**: ein bösartiges Add-on würde
einfach schweigen. Der **Block** hängt nicht an der Meldung -- er ist die
opake Origin bzw. die CSP -- und wird von der Suite unabhängig und
out-of-band bewiesen (Playwright liest das *eigene* DOM des Frames über CDP;
der Netzwerk-Tracker zeigt null Fremdanfragen). Ausführlich in
`apps/core/src/security/routes.ts` und `e2e/security/README.md`.

## Bauen (optional, nur für manuelle Versuche)

```sh
cd addons-examples/evil-fixture && node build.mjs   # -> dist/evil-fixture.tgz
```

Die Suite selbst ruft `build.mjs` **nicht** auf, sondern baut den Tarball
in-process aus denselben Dateien (`e2e/security/support/evilFixture.ts`), damit
der Lauf ohne System-`tar` und ohne Vorab-Build-Schritt reproduzierbar ist.
