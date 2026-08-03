# Registry-Guide (E09-T7)

Dieser Guide beschreibt das Repo-Layout der öffentlichen Add-on-Registry
(`yapaja-addons-registry`), das `index.json`-Schema, wie der Core es lädt und
cached, sowie die Review-Checkliste für Einreichungs-PRs. Siehe auch
docs/05-addon-system.md §5 (Marketplace/Store) und Wargame W-11/W-13
(docs/08-wargame.md).

## 1. Registry-Repo-Struktur

Ein separates, öffentliches Git-Repo (nicht Teil dieses Monorepos):

```
yapaja-addons-registry/
├── index.json              # DIE Katalog-Datei, siehe §2
├── addons/
│   ├── com.example.poi-campsites/
│   │   ├── releases/
│   │   │   └── 1.2.0.tar.gz
│   │   ├── icon.png
│   │   └── screenshots/
│   │       ├── shot1.png
│   │       └── shot2.png
│   └── com.example.track-recorder/
│       └── ...
└── README.md                # Einreichungs-PR-Checkliste (siehe §4) für Autor:innen
```

`index.json` liegt im Repo-Root, damit die raw-URL stabil und kurz bleibt
(z. B. `https://raw.githubusercontent.com/<org>/yapaja-addons-registry/main/index.json`).
Tarballs/Icons/Screenshots können irgendwo im selben Repo (oder via GitHub
Releases) liegen — `index.json` referenziert sie per absoluter `http(s)`-URL,
der Core lädt sie unabhängig vom Rest des Repo-Layouts.

Das Repo ist **statisch hostbar** (GitHub Pages, raw.githubusercontent.com,
oder ein beliebiger Static-File-Host) — kein Server-Code nötig, funktioniert
mit sporadischem Internet (W-13: der Core cached den Katalog lokal und bleibt
auch bei unerreichbarer Registry benutzbar, siehe §5 unten).

## 2. `index.json`-Schema

Ein JSON-**Array** von Einträgen (kein umschließendes Objekt). Jeder Eintrag:

```json
{
  "id": "com.example.poi-campsites",
  "name": "Stellplätze",
  "version": "1.2.0",
  "description": "POI-Overlay für Stellplätze mit Kategorie-Filter",
  "icon": "https://raw.githubusercontent.com/.../icon.png",
  "download_url": "https://github.com/.../releases/download/v1.2.0/poi-campsites-1.2.0.tar.gz",
  "sha256": "3f2504e04f8964...",
  "scopes": ["pos.read", "map.layer.write", "route.propose", "storage.own"],
  "core_api": "^1.0",
  "screenshots": [
    "https://raw.githubusercontent.com/.../shot1.png",
    "https://raw.githubusercontent.com/.../shot2.png"
  ],
  "signature": null
}
```

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `id` | ja | reverse-DNS-artige ID, identisch zum Manifest (`yapaja-addon.json`); muss `ADDON_ID_PATTERN` erfüllen |
| `name` | ja | Anzeigename |
| `version` | ja | exakte Semver-Version des veröffentlichten Tarballs |
| `description` | ja | Kurzbeschreibung, im Katalog + Detailansicht angezeigt |
| `icon` | nein | `http(s)`- oder `data:`-URL |
| `download_url` | ja | `http(s)`-URL auf den Release-Tarball |
| `sha256` | ja | **64 Hex-Zeichen**, sha256 des exakten Tarballs unter `download_url` |
| `scopes` | ja | Array der im Manifest deklarierten Permission-Scopes (docs/05 §2) — die "Scope-Vorschau" im Store |
| `core_api` | ja | Semver-Range, identisch zum Manifest-Feld |
| `screenshots` | nein | Array von `http(s)`-URLs |
| `signature` | nein | **reserviert, siehe §3** |

### Validierung durch den Core (`apps/core/src/addons/registry.ts`)

Der Core behandelt `index.json` als **vollständig nicht vertrauenswürdige
Eingabe** (exakt wie einen Add-on-Tarball) und validiert strikt:

- alle Pflichtfelder vorhanden und korrekt typisiert,
- `id` erfüllt das Manifest-ID-Pattern,
- `version` ist ein gültiges exaktes Semver,
- `core_api` ist eine gültige Semver-Range,
- `sha256` ist **genau 64 Hex-Zeichen** — ein fehlendes oder falsch
  geformtes `sha256` verwirft den Eintrag SOFORT (nicht erst beim Install),
- `download_url`/`icon`/`screenshots` sind `http(s)`- (bzw. bei `icon` auch
  `data:`-)URLs,
- `scopes` enthält nur bekannte Permission-Scopes oder `net.fetch:<host>`,
- Größen-/Längen-Limits gegen "implausible" Werte (z. B. ein 1-MB-`name`).

**Ein einzelner fehlerhafter Eintrag verwirft nicht den ganzen Katalog** —
er wird übersprungen (Fehler wird protokolliert und im Sync-Ergebnis
zurückgegeben), der Rest des Katalogs bleibt nutzbar. Genau dieselbe Regel
gilt schon für den lokalen Regionen-Katalog
(`apps/core/src/map/regions/catalog.ts`) und wird hier bewusst konsistent
fortgeführt. Eine **doppelte `id`** wird ebenfalls verworfen (der erste
Eintrag gewinnt) und protokolliert — ein zweiter Eintrag kann einen früheren
nie "überschreiben".

Der `sha256`-Wert aus `index.json` wird **unverändert an die bestehende
Install-Pipeline durchgereicht** (`POST /api/v1/addons/install
{source:'url', url, sha256}`) — die eigentliche Prüfung (Tarball
herunterladen, sha256 bilden, vergleichen) passiert ausschließlich dort
(`installService.ts`), nie ein zweites Mal in der Registry-Schicht. Ein
Registry-Eintrag kann diese Prüfung **nicht umgehen**: `sha256` ist für
einen URL-Install serverseitig ohnehin Pflicht.

## 3. Das `signature`-Feld (reserviert, NICHT verifiziert)

`signature` ist ab jetzt im Schema reserviert (docs/05 §5: "Signierung
(minisign) ist ab v1.1 vorgesehen"). **Klarstellung, damit hier keine
Fehlannahme entsteht:**

> Ein `signature`-Feld — egal welchen Inhalts, auch offensichtlicher Unsinn —
> wird vom Core **weder geprüft noch in irgendeiner Form als
> Vertrauens-Signal behandelt**. Es wird nur auf FORM geprüft (String, unter
> einer Längengrenze) und unverändert durchgereicht. Ein Add-on mit
> `signature` ist heute **nicht** vertrauenswürdiger als eines ohne.

Die tatsächliche minisign-Verifikation ist ein separates, zukünftiges Task.
Bis dahin ist Kuratierung ausschließlich Menschen-Review (§4).

## 4. Einreichungs-PR-Checkliste

Jede neue/aktualisierte `index.json`-Zeile geht über einen PR ins
Registry-Repo. Review-Punkte (aus docs/05 §5 sowie den allgemeinen
Sicherheits-Leitplanken des Add-on-Systems):

- [ ] **Scopes minimal**: jeder angeforderte Permission-Scope ist im README
  des Add-ons begründet; kein Scope "auf Vorrat".
- [ ] **Gefährliche Kombinationen geprüft**: `nav.control` + `net.fetch:*`
  gemeinsam wird besonders kritisch geprüft (der Store zeigt hierfür schon
  eine Warnung beim Install, docs/05 §2 — das ersetzt keine Review).
- [ ] **Lizenz** vorhanden und im Manifest (`license`) sowie im Repo (z. B.
  `LICENSE`-Datei) konsistent.
- [ ] **Kein obfuskierter Code**: Quelltext ist lesbar, kein minifiziertes/
  bewusst verschleiertes JS ohne zugehörige Quelle.
- [ ] **`sha256` im Eintrag stimmt** mit dem tatsächlich unter `download_url`
  liegenden Tarball überein (Reviewer lädt herunter, prüft `sha256sum`) —
  der Core verifiziert das zwar beim Install ohnehin hart, ein falscher Wert
  im Index sollte trotzdem nie gemerged werden (macht den Katalog-Eintrag
  für jede Installation nutzlos).
- [ ] **`core_api`-Range plausibel**: passt zur tatsächlich getesteten
  Core-Version, keine übermäßig weite Range "damit es nie bricht".
- [ ] **`id` matcht** exakt die `id` im Add-on-Manifest (`yapaja-addon.json`)
  — sonst installiert der Store technisch korrekt, aber Updates würden nie
  gefunden.
- [ ] **Icon/Screenshots** laden ohne Tracking/Drittanbieter-Cookies (reine
  statische Bilder).
- [ ] Für ein **Update** (gleiche `id`, neue `version`): Versionssprung ist
  nachvollziehbar (kein Rückschritt, kein Versions-Overwrite einer bereits
  veröffentlichten Version).

Ein PR, der nur diese Checkliste abhakt aber keinen der Punkte tatsächlich
verifiziert hat, wird nicht gemerged — die Checkliste ist eine
Review-Gedächtnisstütze, kein Selbstzertifizierungsformular.

## 5. Core-Konfiguration & Caching (W-13)

- **Registry-URL**: `ADDONS_REGISTRY_URL` (Env, höchste Priorität) →
  Settings-Key `addons.registry.url` → eingebauter Default (offizielles
  Registry-Repo). Für lokale Entwicklung/Tests: `ADDONS_REGISTRY_URL` auf
  eine lokale Fixture-`index.json` zeigen lassen (z. B. `http://127.0.0.1:<port>/index.json`,
  siehe `apps/core/src/addons/registryRoutes.test.ts` und
  `apps/web/e2e/store.spec.ts` für lauffähige Beispiele).
- **`GET /api/v1/addons/registry`**: liefert **ausschließlich den lokalen
  Cache** + dessen Alter (`age_ms`) und Zeitstempel (`fetched_at`) — macht
  **nie** eine Netzwerkanfrage. Das ist die Grundlage dafür, dass der Store
  auch bei unerreichbarer Registry benutzbar bleibt.
- **`POST /api/v1/addons/registry/sync`**: lädt `index.json` frisch, validiert
  (§2), persistiert den Katalog. **Ein fehlgeschlagener Sync lässt den
  bisherigen Cache vollständig unangetastet** — die Store-UI fällt in diesem
  Fall auf den letzten guten Cache-Stand zurück und hebt den
  **Datei-Upload-Install** deutlich hervor (der ist von der Registry völlig
  unabhängig und funktioniert immer).
- **`core_api`-Kompatibilität** wird bei jedem `GET`/`POST /sync` pro Eintrag
  **live gegen die aktuell laufende Core-Version** berechnet (nicht mit
  gecacht) — ein Core-Update ändert die Kompatibilitätsanzeige also sofort,
  auch ohne erneuten Registry-Sync. Ein inkompatibler Eintrag zeigt in der
  Store-UI einen Sperr-Hinweis **statt** eines Install-/Update-Buttons.

## 6. Lokale Fixture-Registry für Tests/Entwicklung

Ein minimaler lokaler HTTP-Server, der eine statische `index.json` ausliefert,
reicht als Fixture-Registry — kein Git-Repo nötig:

```js
import { createServer } from 'http';
const index = [{ id: 'com.example.demo', name: 'Demo', version: '1.0.0', /* ... */ }];
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(index));
}).listen(4400);
```

Core mit `ADDONS_REGISTRY_URL=http://127.0.0.1:4400/index.json` starten,
danach `POST /api/v1/addons/registry/sync` aufrufen. Siehe
`apps/core/src/addons/registryRoutes.test.ts` (Unit/Integration) und
`apps/web/e2e/store.spec.ts` (Playwright, online + offline) für vollständige,
lauffähige Beispiele dieses Patterns.
