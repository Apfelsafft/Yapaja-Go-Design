# Stellplätze-Overlay (`com.yapaja.poi-campsites`)

Referenz-UI-Add-on (Typ A, E09-T5, [docs/05 §6.1](../../docs/05-addon-system.md#6-referenz-add-ons-teil-von-e09-dienen-als-lebende-doku)).
Zeigt ~200 gebündelte Stellplatz-POIs als Kartenlayer; Klick auf einen
Stellplatz zeigt Details + "Route hierhin" (löst nur die Host-Bestätigung
aus, W-10); Einstellungspanel mit Kategorie-Filter.

Folgt [docs/addon-dev-guide.md](../../docs/addon-dev-guide.md) §1 (UI-Add-on
in 10 Minuten) -- bei Fragen zum allgemeinen Ablauf (Manifest, Paketieren,
Installieren, Testrezept) siehe dort. Dieses README beschreibt nur das
Add-on-spezifische.

## Scopes (minimal -- Begründung pro Eintrag)

| Scope | Warum genau dieser (und kein anderer) |
|---|---|
| `map.layer.write` | Pusht die gefilterten POIs als GeoJSON-Marker-Layer (`addon.map.addLayer`) sowie einen separaten Highlight-Layer für die aktuelle Auswahl. |
| `widget.register` | Registriert/aktualisiert das `poi-detail`-Side-Panel-Widget mit dem Namen des ausgewählten Stellplatzes. |
| `route.propose` | Der "Route hierhin"-Button in der Detail-Ansicht. **Aktiviert nie** selbst eine Route -- der Host zeigt nur die Bestätigungs-Banner (W-10); erst ein Klick des Nutzers dort löst `POST /navigation/destination` aus. |

**Bewusst NICHT angefordert:**
- `pos.read` -- dieses Add-on sortiert/filtert nicht nach der aktuellen
  Position (kein "nächstgelegene zuerst"-Feature). Der Track-Recorder deckt
  `position.subscribe` bereits als SDK-Referenz ab (docs/05 §6: "decken
  zusammen alle SDK-Oberflächen ab" bezieht sich auf BEIDE Add-ons zusammen,
  nicht auf jedes einzeln).
- `storage.own` -- der Kategorie-Filter lebt nur im Iframe-Zustand (setzt
  sich beim Neuladen zurück); es gibt nichts, das dauerhaft gespeichert
  werden muss.

## Daten

`data/campsites.geojson` -- 200 generierte (nicht reale) Stellplätze rund um
den Bodensee/Allgäu-Raum (dieselbe Region wie die übrigen Karten-Fixtures des
Repos, siehe `apps/web/e2e/support/constants.ts#FIXTURE_REGION`). Erzeugt von
`scripts/generate-data.mjs` (deterministisch, seeded PRNG) -- nur zum
Regenerieren von Hand ausführen, kein Teil des Builds.

Die GeoJSON-Datei wird beim Build von esbuild **direkt in den JS-Bundle
eingebettet** (kein Laufzeit-`fetch` nötig -- der Iframe könnte das ohnehin
nicht: die add-on-CSP setzt `connect-src 'none'`, siehe
`apps/core/src/addons/ui-host.ts`).

## Bekannte Plattform-Lücke: kein Marker-Klick-Callback

`docs/05 §3`s SDK-Illustration deutet an: `addon.map.addMarkers('campsites',
markers); // inkl. Klick-Callbacks`. Der tatsächliche Host-Code
(`apps/web/src/addons/mapLayers.ts`) rendert `addMarkers()`/`addLayer()`
aktuell als reine, NICHT-interaktive MapLibre-Circle-Layer -- es gibt (Stand
E09-T2/T4) keinen Event-Kanal, der einen Klick auf einen echten Karten-Marker
zurück ins Add-on-Iframe meldet.

Diese Beispiel-Implementierung arbeitet das aus, OHNE den Host anzufassen
(bewusste Entscheidung, siehe Task-Vorgabe "adjust the example, not the
sandbox"): der echte Karten-Layer wird weiterhin per SDK gepusht (das Overlay
ist also auf der echten Karte sichtbar), aber die eigentliche
"Klick -> Detail"-Interaktion läuft über eine zusätzliche, eigene, klickbare
Liste **innerhalb** des Add-on-Iframes selbst. Das ist mit der heutigen
SDK-Oberfläche vollständig demonstrierbar und ehrlich dokumentiert -- siehe
auch `docs/addon-dev-guide.md` §9 ("Bekannte Lücken"), die um genau diesen
Punkt ergänzt wurde.

## Hinweis: `core_api` als `"*"`

`docs/addon-dev-guide.md`s Beispiel-Manifest verwendet `"core_api": "^0.1"`.
Dieses Add-on setzt bewusst `"*"` (statt einer engeren Range): in einem lokal
aus dem Quellcode gebauten Core (`node apps/core/dist/index.js` direkt aus dem
Repo, statt aus dem Docker-Image) löst `readPackageVersion()`
(`apps/core/src/version.ts`) den Pfad `../../package.json` relativ zu
`apps/core/dist` auf -- das ist `apps/package.json`, das es lokal gar nicht
gibt, sodass `GET /api/v1/health` `"0.0.0"` statt der echten
`apps/core/package.json`-Version meldet (im Docker-Image, wo `WORKDIR /app`
das ROOT-`package.json` nach `/app/package.json` kopiert, stimmt der Pfad und
liefert die echte Version). `^0.1` würde gegen die lokale `0.0.0` fehlschlagen
(`INCOMPATIBLE_CORE_API`) -- entdeckt beim Schreiben der E2E-Tests dieses
Tasks. `"*"` ist für ein Referenz-Add-on ohnehin die richtige Wahl (maximale
Kompatibilität) und umgeht diese Lokal-Dev-Falle sauber, statt sie zu
verschleiern.

## Bauen

```sh
node build.mjs   # -> dist/poi-campsites.tgz
```

## Installieren (lokal gegen einen laufenden Core, siehe Dev-Guide §8)

```sh
BASE64=$(base64 -w0 dist/poi-campsites.tgz)
PENDING=$(curl -s -X POST http://localhost:8080/api/v1/addons/install \
  -H 'content-type: application/json' \
  -d "{\"source\":\"upload\",\"data\":\"$BASE64\"}" | jq -r '.data.pending_id')
curl -s -X POST "http://localhost:8080/api/v1/addons/install/$PENDING/confirm"
curl -s -X POST http://localhost:8080/api/v1/addons/com.yapaja.poi-campsites/enable
```

## Testen

```sh
npx vitest run addons-examples/poi-campsites   # Unit: Kategorie-Filter
cd ../../apps/web && npx playwright test e2e/addon-examples-poi.spec.ts
```
