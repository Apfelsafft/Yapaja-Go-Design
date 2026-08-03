# Add-on-Entwicklungsleitfaden (`@yapaja/addon-sdk`)

Dieser Leitfaden ist die praktische Ergänzung zu [docs/05-addon-system.md](05-addon-system.md)
(Architektur, Sandbox-Modell, Marketplace) – er zeigt, wie man als Add-on-Autor
tatsächlich loslegt: Manifest schreiben, Entry-Datei gegen `@yapaja/addon-sdk`
programmieren, Tarball bauen, gegen einen lokalen Core installieren und testen.

**Alles hier ist an den echten Code gebunden** (`packages/addon-sdk/src/`,
`apps/core/src/addons/`, `apps/web/src/addons/`) – bei Abweichungen gewinnt der
Code, nicht dieses Dokument.

## 0. Das Sicherheitsmodell in einem Absatz

`@yapaja/addon-sdk` läuft **innerhalb** des Add-ons (im Sandbox-`<iframe>` bzw. im
Service-Prozess) und ist damit **nicht vertrauenswürdiger Code**: ein Add-on kann
das SDK umgehen und die Wire-Protokolle selbst sprechen – das ändert nichts an
dem, was es darf. Jede Berechtigungsentscheidung trifft ausschließlich die
Gegenseite:

- UI-Add-ons: `apps/web/src/addons/bridge.ts` (der Host, prüft jeden Aufruf gegen
  die beim Handshake gepinnten Scopes, per Source-Pinning statt Origin-Trust).
- Service-Add-ons: `apps/core/src/addons/scopeMatrix.ts` (Default-Deny-Tabelle für
  REST-Routen und WS-Topics, geprüft gegen den scoped Bearer-Token).

Das SDK bietet lediglich **Komfort**: typisierte Methoden, automatische
Transport-Erkennung, verständliche Fehlerklassen (u. a. `ScopeDeniedError` mit dem
fehlenden Scope im Klartext). Es *ersetzt* die serverseitige Prüfung nicht.

## 1. Add-on in 10 Minuten – UI-Add-on (Typ A)

Ein UI-Add-on läuft in einem `sandbox="allow-scripts"`-`<iframe>` mit strikter CSP
(`connect-src 'none'` – kein `fetch`/`XHR`/WebSocket möglich, siehe
`apps/core/src/addons/ui-host.ts`). Die **einzige** Verbindung nach außen ist das
postMessage-SDK.

### 1.1 Verzeichnisstruktur

```
poi-overlay/
├── yapaja-addon.json
└── ui/
    └── index.html
```

### 1.2 Manifest

```json
{
  "id": "com.example.poi-overlay",
  "name": "Stellplätze-Overlay",
  "version": "1.0.0",
  "core_api": "^0.1",
  "author": "Beispiel GmbH",
  "license": "MIT",
  "description": "Zeigt gebündelte Stellplatz-POIs als Kartenlayer.",
  "ui": {
    "entry": "ui/index.html",
    "widgets": [{ "id": "poi-detail", "name": "Stellplatz-Detail", "slots": ["side-panel"] }]
  },
  "permissions": ["pos.read", "map.layer.write", "widget.register", "storage.own"]
}
```

`core_api` ist eine Semver-**Range**, die bei der Installation gegen die laufende
Core-Version geprüft wird (Wargame W-11, `apps/core/src/addons/installService.ts`).
Das SDK macht **zusätzlich** einen eigenen, engeren Check zur Verbindungszeit –
siehe [§7 Fehlerklassen](#7-fehlerklassen).

### 1.3 `ui/index.html`

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <script type="module">
      import { connectAddon } from 'https://esm.sh/@yapaja/addon-sdk'; // oder: gebündelt via Vite/esbuild

      const addon = await connectAddon(); // erkennt "postMessage" automatisch (läuft im iframe)

      addon.map.addLayer({
        id: 'poi-overlay',
        data: { type: 'FeatureCollection', features: [] }, // echtes GeoJSON hier
        render: 'circle',
      });

      addon.position.subscribe(
        (pos) => console.log('Position', pos.lat, pos.lng),
        (err) => console.error('Subscription abgelehnt:', err.message), // z. B. ScopeDeniedError
      );
    </script>
  </body>
</html>
```

In der Praxis wird `ui/index.html` von einem Bundler (Vite/esbuild) erzeugt, der
`@yapaja/addon-sdk` aus `node_modules` bündelt – der Import oben ist nur zur
Illustration ohne Build-Schritt.

> ⚠️ **Bundle-Format: IIFE, nicht ESM** (entdeckt beim Bau von
> `addons-examples/poi-campsites`/`track-recorder`, E09-T5). Der Bundle darf
> **nicht** als `<script type="module" src="...">` eingebunden werden: das
> Add-on-Iframe ist `sandbox="allow-scripts"` **ohne** `allow-same-origin` und
> läuft damit mit einer OPAQUEN Origin (`"null"`). Ein Modul-Script-Load
> unterliegt IMMER einer CORS-Prüfung (anders als ein klassisches Script) –
> eine opaque Origin kann diese Prüfung nie bestehen, selbst bei einer
> Same-Path-Ressource. Ergebnis: `Access to script at '...' from origin
> 'null' has been blocked by CORS policy`, das Add-on lädt nie. Bündelt den
> Bundler-Output stattdessen als **IIFE** (esbuild: `format: 'iife'`) und
> bindet ihn als klassisches Script ein: `<script src="./bundle.js"></script>`
> (kein `type="module"`). Ein IIFE-Bundle hat ohnehin keine offenen
> `import`/`export`-Statements mehr (alles ist bereits zusammengebündelt),
> unterliegt also keiner Modul-Auflösung, die ein `type="module"` bräuchte.

> ⚠️ **`@yapaja/shared` NICHT zur Laufzeit importieren.** Ein direkter
> `import { ... } from '@yapaja/shared'`-Aufruf zieht dessen gesamten
> Paket-Entry-Point (`src/index.ts`) mit hinein – inklusive
> `validators.ts`, das beim Modul-Laden `ajv.compile(...)` aufruft (AJVs
> Standard-Strategie generiert Validator-Funktionen per `new Function(...)`).
> Das Add-on-Iframe hat **kein** `'unsafe-eval'` in seiner CSP
> (`apps/core/src/addons/ui-host.ts#buildAddonCsp`), also schlägt das mit
> genau derselben `blocked by CSP`-Fehlermeldung fehl, unabhängig davon, ob der
> eigene Code die AJV-Validatoren je aufruft. `@yapaja/addon-sdk` selbst hatte
> dieses Problem bis E09-T5 (`version.ts` importierte `isValidSemver` von
> dort) – seitdem hält es, wie `protocol.ts`s `AddonScope` es schon vormacht,
> keine Laufzeit-Abhängigkeit zu `@yapaja/shared` mehr. Braucht ein Add-on
> `@yapaja/shared`-Typen, sind `import type { ... }`-Importe (typ-only, kein
> Laufzeit-Code) unproblematisch – nur ein WERT-Import ist die Falle.

### 1.4 Paketieren

```sh
tar czf poi-overlay.tar.gz yapaja-addon.json ui/
```

`yapaja-addon.json` **muss** auf oberster Ebene im Tarball liegen (kein
Unterverzeichnis) – siehe `apps/core/src/addons/extract.ts#MANIFEST_FILENAME`.
**Wichtig für Build-Skripte:** listet die Top-Level-Einträge explizit auf (wie
oben), statt `tar czf out.tgz -C stage/ .` zu verwenden – GNU tars `-C dir .`
erzeugt einen führenden `./`-Verzeichniseintrag, den die Tarball-Sicherheitsprüfung
als leeren/`"."`-Namen ablehnt (`TARBALL_REJECTED`, `extract.ts`).

### 1.5 Installieren + aktivieren (siehe [§8 Testrezept](#8-testrezept))

```sh
BASE64=$(base64 -w0 poi-overlay.tar.gz)
PENDING=$(curl -s -X POST http://localhost:8080/api/v1/addons/install \
  -H 'content-type: application/json' \
  -d "{\"source\":\"upload\",\"data\":\"$BASE64\"}" | jq -r '.data.pending_id')

curl -s -X POST "http://localhost:8080/api/v1/addons/install/$PENDING/confirm" | jq

curl -s -X POST http://localhost:8080/api/v1/addons/com.example.poi-overlay/enable | jq
```

Danach ist das Add-on im Web-Frontend als sandboxed Iframe unter
`/addons/com.example.poi-overlay/ui/index.html` sichtbar.

## 2. Add-on in 10 Minuten – Service-Add-on (Typ B)

Ein Service-Add-on läuft als eigener Node-Prozess (vom Core gestartet,
`runtime: node18`/`node20`) oder als externer Container (`runtime: external`).
Es spricht die **öffentliche** Core-REST/WS-API mit einem scoped Bearer-Token –
keine internen Importe (`apps/core/src/addons/service-host.ts`).

### 2.1 Verzeichnisstruktur

```
traffic-warner/
├── yapaja-addon.json
└── service/
    └── main.js
```

### 2.2 Manifest

```json
{
  "id": "com.example.traffic-warner",
  "name": "Stauwarner",
  "version": "1.0.0",
  "core_api": "^0.1",
  "author": "Beispiel GmbH",
  "license": "MIT",
  "description": "Meldet Staus als addon/{id}/jam-detected Events.",
  "requires_online": true,
  "service": { "runtime": "node20", "entry": "service/main.js", "max_rss_mb": 128 },
  "permissions": ["pos.read", "events.publish", "storage.own", "net.fetch:api.example.com"]
}
```

### 2.3 `service/main.js`

```js
import { connectAddon } from '@yapaja/addon-sdk';

// Läuft als Core-Kindprozess: YAPAJA_API_URL / YAPAJA_TOKEN / YAPAJA_ADDON_ID /
// YAPAJA_DATA_DIR stehen bereits in process.env -- connectAddon() erkennt daran
// automatisch den "service"-Transport, kein Konfigurationsaufwand nötig.
const addon = await connectAddon();

addon.position.subscribe(
  async (pos) => {
    const res = await addon.fetch(`https://api.example.com/traffic?lat=${pos.lat}&lon=${pos.lon}`);
    const data = await res.json();
    if (data.jam) {
      await addon.events.publish('jam-detected', { at: pos, severity: data.severity });
    }
  },
  (err) => console.error('pos.subscribe abgelehnt:', err.message),
);

// Am Leben halten -- der Core beendet den Prozess bei disable/uninstall selbst.
setInterval(() => {}, 60_000);
```

`addon.fetch()` geht über den Core-Egress-Proxy (`GET /api/v1/addons/proxy?url=`)
und funktioniert **nur** für Hosts, die als `net.fetch:<host>` im Manifest stehen
– alles andere liefert `403` (`ScopeDeniedError`, siehe §7).

### 2.4 Paketieren + Installieren

Identisch zu §1.4/§1.5 (Tarball mit `yapaja-addon.json` + `service/`). Nach
`enable` startet der Core den Prozess automatisch (`apps/core/src/addons/service-host.ts`);
`stdout`/`stderr` landen in den Core-Logs mit Präfix `[addon <id>] …`.

## 3. Manifest-Referenz (`yapaja-addon.json`)

Struktureller Typ: `AddonManifest` in `packages/shared/src/types.ts`, geprüft von
`addonManifestSchema` in `packages/shared/src/schemas/addon-manifest.ts`.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | `string` | ✅ | Reverse-DNS-artige ID (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$`). Wird 1:1 zum Verzeichnisnamen `data/addons/{id}/` – keine `/`, `\`, `..`. |
| `name` | `string` | ✅ | Anzeigename. |
| `version` | `string` | ✅ | Exakte Semver-Version des Add-ons, z. B. `"1.2.0"`. |
| `core_api` | `string` | ✅ | Semver-**Range**, die die kompatible Core-Version beschreibt, z. B. `"^0.1"`. Geprüft bei Install (W-11) *und* zusätzlich vom SDK beim Verbinden (Major-Gleichheit, §7). |
| `author` | `string` | ✅ | Autor/Herausgeber. |
| `license` | `string` | ✅ | Lizenz-Kennung (z. B. `"MIT"`). |
| `description` | `string` | ✅ | Kurzbeschreibung. |
| `requires_online` | `boolean` | – | Informativ: braucht das Add-on Internet (z. B. für `net.fetch`)? |
| `ui` | `object` | – | Siehe unten. Weglassen ⇒ kein UI-Anteil (reines Service-Add-on). |
| `ui.entry` | `string` | ✅ (wenn `ui` gesetzt) | Pfad zur HTML-Entry-Datei relativ zum Paket, üblich `"ui/index.html"`. Ausgeliefert unter `/addons/{id}/ui/…`. |
| `ui.widgets[]` | `{id, name, slots[]}[]` | – | Vom Add-on angebotene Widgets (registriert zur Laufzeit via `addon.widgets.register()`). |
| `ui.map_layers[]` | `{id, name, source}[]` | – | Deklarative Ankündigung von Kartenlayern (informativ für UI-Customizing/Store). |
| `ui.settings_page` | `boolean` | – | Bietet das Add-on eine eigene Einstellungsseite an? |
| `service` | `object` | – | Siehe unten. Weglassen ⇒ kein Service-Anteil (reines UI-Add-on). |
| `service.runtime` | `"node18" \| "node20" \| "external"` | ✅ (wenn `service` gesetzt) | `node18`/`node20`: vom Core als Kindprozess gestartet. `external`: eigener Container, verbindet sich selbst mit einem vom Core ausgestellten Token. |
| `service.entry` | `string` | ✅ (wenn `service` gesetzt) | Einstiegsdatei relativ zum Paket, z. B. `"service/main.js"`. Ignoriert bei `runtime: external`. |
| `service.max_rss_mb` | `number` (16–4096) | – | RSS-Obergrenze für den vom Core gestarteten Prozess; Default 256 MB (`DEFAULT_RSS_LIMIT_BYTES`), vom Watchdog überwacht (`apps/core/src/addons/watchdog.ts`). |
| `permissions` | `string[]` | ✅ | Liste der angeforderten Scopes (siehe §4) plus optional `net.fetch:<host>`-Einträge. Wird bei Installation angezeigt und vom Nutzer bestätigt. |

## 4. Scope-Referenz

Ein Scope ist genau dann wirksam, wenn er (a) im Manifest unter `permissions`
steht **und** (b) vom Nutzer bei der Installation bestätigt wurde. Die Spalte
„Transport" zeigt, über welchen Kanal der Scope tatsächlich etwas freischaltet –
serverseitige Quelle der Wahrheit: `protocol.ts#METHOD_SCOPES` (UI) und
`apps/core/src/addons/scopeMatrix.ts` (Service).

| Scope | Schaltet frei | Transport |
|---|---|---|
| `pos.read` | `position.get()` (Service), `position.subscribe()` (beide) | UI + Service |
| `nav.read` | `nav.state()` (beide), `nav.subscribe()` (nur Service) | UI + Service |
| `nav.control` | `nav.control.start/stop/pause/resume/destination()` | **nur Service** – kein UI-Bridge-Äquivalent |
| `route.read` | `route.read()` (Routen berechnen), `route.get()` (Route lesen) | **nur Service** |
| `route.propose` | `route.propose()` – schlägt eine Route vor, **aktiviert nie** etwas ohne Nutzerbestätigung (Wargame W-10) | **nur UI** |
| `map.layer.write` | `map.addLayer/addMarkers/removeLayer()` | **nur UI** – es gibt keine Karte in einem Headless-Prozess |
| `widget.register` | `widgets.register/update()` | **nur UI** |
| `events.publish` | `events.publish()` unter dem eigenen `addon/{id}/*`-Namensraum -- zusätzlich als `yapaja/addon/{id}/*` via MQTT (Rate-Limit 5 msg/s pro Add-on, Payload ≤ 16 KB, pro Add-on über die Store-Detailseite abschaltbar; E09-T8) | UI + Service |
| `storage.own` | `storage.get/set()` (beide), `storage.delete()` (**nur Service** – die UI-Bridge kennt kein Delete) | UI + Service |
| `net.fetch:<host>` | `fetch(url)` gegen genau diesen Host über den Core-Egress-Proxy | **nur Service** |
| `ha.notify` | `notify.send(message, title?)` – Benachrichtigung über den HA-Kanal | **nur Service** |
| `camera.view` | Kamera-Streams einbetten (nur UI-seitig, URLs aus Nutzer-Config) – **hat aktuell keine SDK-Methode**, das Add-on bindet die vom Nutzer konfigurierte Stream-URL direkt in sein eigenes UI-Markup ein | UI (kein SDK-Aufruf nötig) |

Ein Aufruf, den der aktuelle Transport nicht kennt, wirft sofort
`UnsupportedOnTransportError` (typisiert, mit `.method`/`.transport`) – das SDK
täuscht nie vor, dass ein Service-Add-on eine Karte hätte oder ein UI-Add-on
Navigation steuern könnte.

## 5. Transport-Erkennung

`connectAddon()` erkennt den Transport ohne jede Konfiguration
(`packages/addon-sdk/src/detect.ts`):

1. Ist `process.env.YAPAJA_TOKEN` gesetzt (nicht leer) → **Service**-Transport
   (REST + WS). Das ist der vom Core gesetzte Prozess-Vertrag.
2. Sonst, wenn `window`/`window.parent` existiert → **postMessage**-Transport
   (UI-Add-on im Sandbox-Iframe).
3. Keins von beidem → wirft `AddonTransportError`; dann explizit angeben:
   `connectAddon({ transport: 'postMessage' | 'service' })`.

Das Env-Signal gewinnt bewusst, falls (unüblich) beide gleichzeitig vorliegen –
`YAPAJA_TOKEN` ist ein bewusst vom Core ausgestelltes Credential, ein bloßes
`window`-Objekt ist ein schwächeres Signal.

## 6. SDK-Oberfläche im Überblick

Alle Methoden sind in `packages/addon-sdk/src/types.ts` (`YapajaAddon`) vollständig
typisiert und dort pro Methode mit „UI TRANSPORT ONLY"/„SERVICE TRANSPORT ONLY"
dokumentiert. Kurzfassung:

```ts
const addon = await connectAddon();

addon.transport;           // 'postMessage' | 'service'
addon.addonId;
addon.hasScope('pos.read'); // informativ, NIE autoritativ

addon.position.get();                    // Promise<Position|null> -- Service
addon.position.subscribe(cb, onError?);  // beide

addon.nav.state();                       // Promise<NavState> -- beide
addon.nav.subscribe(cb, onError?);       // Service
addon.nav.control.start/stop/pause/resume/destination(...); // Service

addon.route.read(request);   // Promise<Route[]> -- Service
addon.route.get(routeId);    // Promise<Route> -- Service
addon.route.propose(params); // UI

addon.map.addLayer/addMarkers/removeLayer(params); // UI
addon.widgets.register(params); addon.widgets.update(id, data); // UI

addon.events.publish(topic, payload); // beide, addon/{id}/* Namensraum

addon.storage.get(key); addon.storage.set(key, value); // beide
addon.storage.delete(key); // Service

addon.notify.send(message, title?); // Service
addon.fetch(url, { method?: 'GET', signal? }); // Service, GET-only

addon.dispose(); // beide
```

Re-exportierte Domain-Typen (`Position`, `NavState`, `Route`, `RouteRequest`,
`AddonManifest`, …) kommen aus `@yapaja/shared` – **ein** Import-Surface für
Add-on-Autoren, statt zwei parallele Typdefinitionen pflegen zu müssen.

## 7. Fehlerklassen

Alle exportiert aus `@yapaja/addon-sdk`, alle mit `.code`:

| Klasse | `.code` | Bedeutung |
|---|---|---|
| `ScopeDeniedError` | `SCOPE_DENIED` | Aufruf abgelehnt, weil ein Scope fehlt. Trägt **`.scope`** (der fehlende Scope, z. B. `"pos.read"` oder `"net.fetch:api.example.com"`) und **`.method`** (die aufgerufene SDK-Methode) – direkt nutzbar, ohne eine Fehlermeldung zu parsen. |
| `IncompatibleCoreError` | `INCOMPATIBLE_CORE` | Die verbundene Core-Version (`GET /api/v1/health`) hat eine andere **Major**-Version als dieses SDK-Build (`ADDON_SDK_VERSION`). Trägt `.sdkVersion`/`.coreVersion`. Regel: **SDK-Major muss gleich Core-Major sein** – Minor/Patch-Drift auf beiden Seiten ist unproblematisch. Umgehbar via `connectAddon({ service: { skipCoreCompatibilityCheck: true } })`. |
| `AddonTransportError` | `TRANSPORT_ERROR` (o. spezifischer) | Verbindung/Handshake/Netzwerk selbst ist fehlgeschlagen (kein Antwortinhalt vorhanden). |
| `AddonTimeoutError` | `TIMEOUT` | Der postMessage-Handshake hat innerhalb von `timeoutMs` (Default 5000) keine Antwort vom Host bekommen. |
| `UnsupportedOnTransportError` | `UNSUPPORTED_ON_TRANSPORT` | Die aufgerufene Methode existiert auf diesem Transport nicht (siehe §4-Tabelle). Trägt `.method`/`.transport`. |
| `RemoteCallError` | (Wire-Code, z. B. `INVALID_PARAMS`) | Jeder andere Fehler, den Host/Core zurückmelden – roh durchgereicht. |

Diese Klassen sind **Komfort**, keine Durchsetzung: Der Host/Core prüft jeden
Aufruf unabhängig noch einmal (§0).

## 8. Testrezept: gegen einen lokalen Core testen

1. **Core lokal starten** (aus dem Repo-Root):
   ```sh
   pnpm --filter @yapaja/core dev
   ```
   Startet auf `http://localhost:8080` (`PORT`-Env überschreibbar). Solange kein
   `API_AUTH_TOKEN` gesetzt ist, läuft der Core im offenen Modus (kein Bearer-Token
   für die `curl`-Aufrufe unten nötig).

   > ⚠️ **`core_api`-Range gegen einen LOKAL gebauten Core** (entdeckt bei
   > E09-T5): `GET /api/v1/health` meldet gegen einen aus dem Quellcode
   > gebauten Core (`node apps/core/dist/index.js` direkt aus dem Repo-Checkout,
   > nicht aus dem Docker-Image) `"version": "0.0.0"` statt der echten
   > `apps/core/package.json`-Version – `readPackageVersion()`
   > (`apps/core/src/version.ts`) löst `../../package.json` relativ zu
   > `apps/core/dist` auf, was lokal `apps/package.json` wäre (existiert
   > nicht → Fallback `"0.0.0"`). Im Docker-Image stimmt der Pfad (`WORKDIR
   > /app` kopiert das ROOT-`package.json` nach `/app/package.json`), dort ist
   > die gemeldete Version korrekt. Ein Manifest mit einer engen Range wie
   > `"core_api": "^0.1"` scheitert deshalb beim lokalen Testen mit
   > `INCOMPATIBLE_CORE_API`, obwohl es gegen einen echten/produktiven Core
   > passen würde. Zum lokalen Testen entweder `"core_api": "*"` verwenden
   > (siehe `addons-examples/*/yapaja-addon.json`) oder die tatsächlich lokal
   > gemeldete Version (`curl localhost:8080/api/v1/health`) explizit in der
   > Range berücksichtigen.

2. **Tarball bauen** (siehe §1.4/§2.4):
   ```sh
   tar czf my-addon.tar.gz yapaja-addon.json ui/ service/  # je nach Add-on-Typ
   ```

3. **Zwei-Schritt-Installation** (`apps/core/src/addons/routes.ts`):
   ```sh
   BASE64=$(base64 -w0 my-addon.tar.gz)

   # Schritt 1: validiert Manifest + core_api + zeigt Scopes/Warnungen -- installiert NICHTS
   curl -s -X POST http://localhost:8080/api/v1/addons/install \
     -H 'content-type: application/json' \
     -d "{\"source\":\"upload\",\"data\":\"$BASE64\"}" | tee /tmp/pending.json | jq

   PENDING=$(jq -r '.data.pending_id' /tmp/pending.json)

   # Schritt 2: entpackt tatsächlich + schreibt den DB-Eintrag (disabled per Default)
   curl -s -X POST "http://localhost:8080/api/v1/addons/install/$PENDING/confirm" | jq
   ```

4. **Aktivieren** (startet bei Service-Add-ons automatisch den Kindprozess):
   ```sh
   curl -s -X POST http://localhost:8080/api/v1/addons/com.example.my-addon/enable | jq
   ```

5. **Logs beobachten**: `pnpm --filter @yapaja/core dev` läuft im Vordergrund;
   Service-Add-on-Ausgabe erscheint mit Präfix `[addon <id>] …`
   (`stdout` → `info`, `stderr` → `warn`, siehe `apps/core/src/addons/service-host.ts`).
   Für UI-Add-ons: Web-Frontend separat starten (`pnpm --filter @yapaja/web dev`)
   und die Browser-DevTools der Haupt-App öffnen – Konsolenausgaben aus dem
   Add-on-Iframe erscheinen dort mit Iframe-Kontext.

6. **Status/Debug**:
   ```sh
   curl -s http://localhost:8080/api/v1/addons | jq                                  # alle installierten Add-ons
   curl -s http://localhost:8080/api/v1/addons/com.example.my-addon/service | jq      # Prozess-/Watchdog-Status
   ```

7. **Deaktivieren/Deinstallieren** zum Aufräumen:
   ```sh
   curl -s -X POST http://localhost:8080/api/v1/addons/com.example.my-addon/disable
   curl -s -X DELETE http://localhost:8080/api/v1/addons/com.example.my-addon
   ```

8. **Unit-Tests der eigenen Add-on-Logik**: `@yapaja/addon-sdk` selbst ist gegen
   einen Mock-Host getestet (`packages/addon-sdk/src/postMessageTransport.test.ts`,
   `serviceTransport.test.ts`) – dasselbe Muster (Fake-`window`/Fake-`fetch`+
   `WebSocket`) eignet sich, um die eigene Add-on-Logik ohne echten Core zu testen:
   `connectAddon({ transport: 'service', service: { fetchImpl, webSocketImpl, ... } })`
   nimmt injizierbare Implementierungen entgegen.

## 9. Bekannte Lücken (ehrlich dokumentiert)

- `storage.delete()` existiert nur auf dem Service-Transport – die E09-T2-Host-Bridge
  bietet aktuell nur `storage.get`/`storage.set`.
- `nav.subscribe()` (Live-Push von `NavState`) existiert nur auf dem
  Service-Transport (WS-Topic `nav/state`) – die Host-Bridge hat keinen
  entsprechenden Event-Kanal; ein UI-Add-on muss `nav.state()` pollen.
- `camera.view` hat keine eigene SDK-Methode; das Einbetten des Kamera-Streams ist
  reines UI-Markup im Add-on selbst (die vom Nutzer konfigurierte Stream-URL wird
  ihm über die Core-Settings zugänglich gemacht, nicht über dieses SDK).
- `fetch()` unterstützt ausschließlich `GET` – der Core-Egress-Proxy
  (`apps/core/src/addons/proxy.ts`) leitet grundsätzlich nur GET-Requests weiter.
- **`ui.settings_page` hat KEINE eigene Route/Mechanik.** Das Manifest-Feld
  ist rein informativ (Store-Anzeige "hat Einstellungen"); es gibt keinen
  `/addons/:id/ui/settings.html`-Sondermechanismus oder Ähnliches, den der
  Host bereitstellt. Eine Add-on-eigene Einstellungsseite ist schlicht Teil
  des normalen `ui.entry`-Iframes (z. B. ein umschaltbares Panel innerhalb
  derselben `index.html`) – siehe `addons-examples/poi-campsites/src/main.ts`s
  Kategorie-Filter-Panel als Beispiel.
- **Kein Klick-Callback für Karten-Marker** (entdeckt bei E09-T5, dem
  POI-Overlay-Referenz-Add-on): §3s SDK-Illustration oben deutet
  `addon.map.addMarkers('campsites', markers); // inkl. Klick-Callbacks` an,
  aber der tatsächliche Host-Code (`apps/web/src/addons/mapLayers.ts`) rendert
  `addMarkers()`/`addLayer()`-Output als reine, NICHT-interaktive
  MapLibre-Circle-Layer – es gibt keinen Event-Kanal, der einen Klick auf
  einen echten Karten-Marker zurück ins Add-on-Iframe meldet. Ein Add-on, das
  auf POI-Klicks reagieren soll, braucht aktuell eine EIGENE, klickbare
  Repräsentation innerhalb seines eigenen Iframes (siehe
  `addons-examples/poi-campsites/src/main.ts`, das den echten Karten-Layer
  weiter per SDK pusht, aber die Klick-Interaktion über eine zusätzliche Liste
  im eigenen Iframe löst).
- **`position.subscribe()`-Payload-Form unterscheidet sich je Transport**
  (entdeckt bei E09-T5, dem Track-Recorder-Referenz-Add-on): Auf dem
  SERVICE-Transport ist das an den Callback übergebene Objekt tatsächlich die
  VOLLE `Position`-Form aus `@yapaja/shared` (`lat`, **`lon`** – nicht
  `lng` –, `alt`, `speed`, `heading`, `accuracy`, `source`, `fix`, `ts`), weil
  `serviceTransport.ts` den rohen `pos/update`-Bus-Payload unverändert
  durchreicht (`apps/core/src/position/service.ts#pushFix` publiziert die
  ganze `Position`). Auf dem UI/postMessage-Transport konvertiert die Host-Bridge
  (`apps/web/src/addons/hostDeps.ts#toPositionUpdate`) das dagegen explizit auf
  die schmalere `{lat, lng, speed, heading}`-Form – ohne `ts`. Der SDK-Typ
  `PositionUpdate` deklariert nur die schmale Form (mit einer
  Index-Signatur, die `.lon`/`.ts`-Zugriff nicht verhindert, aber auch nicht
  typisiert) – ein Service-Add-on, das die reale Position braucht, sollte
  `.lon` (nicht `.lng`) lesen und `.ts` für den echten Fix-Zeitstempel nutzen,
  siehe `addons-examples/track-recorder/src/service.ts`s
  `ServiceTransportPositionFix`-Typ für ein dokumentiertes Beispiel.
