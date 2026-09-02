# Lizenz-Inventar & Attribution

> **Generiert.** Diese Datei wird von `scripts/generate-licenses.mjs` erzeugt.
> Nicht von Hand bearbeiten — Aenderungen gehen beim naechsten Lauf verloren.
> Neu erzeugen: `pnpm licenses:generate`. CI prueft mit `pnpm licenses:check`,
> dass diese Datei zum aktuellen Abhaengigkeitsstand passt (Job `dependency-audit`).

Erfuellt E10-T4 (Lizenz-Inventar) und den Release-Gate-Punkt
„Lizenz-/Attributions-Pruefung (OSM, Fonts, Icons, Dependencies)" aus docs/07 §7.

---

## 1. Kartendaten — OpenStreetMap / ODbL

Yapaja Go erhebt keine eigenen Kartendaten; alle Geometrien, Restriktionen und
POIs stammen aus OpenStreetMap (docs/00 „Rechtliches"). OSM-Daten stehen unter der
**Open Database License (ODbL) 1.0**, die eine sichtbare Namensnennung verlangt.

**Umsetzung:** die Attribution `© OpenStreetMap contributors` liegt dauerhaft und
sichtbar auf der Karte (`apps/web/src/map/MapView.tsx`, `customAttribution`), zusaetzlich
im Erstnutzungs-Dialog (`apps/web/src/onboarding/steps/DisclaimerStep.tsx`).

**Automatisch verifiziert** — die Attribution ist nicht nur vorhanden, ihr Fehlen
laesst die Pipeline fehlschlagen. Die bestehenden E2E-Assertions:

| Assertion | Datei | Kontext |
|---|---|---|
| `getByText('OpenStreetMap contributors')` sichtbar | [`apps/web/e2e/map-render.spec.ts`](../apps/web/e2e/map-render.spec.ts) | Karten-Grundlast (ADR-003 / ODbL-Pflicht) |
| dito, im Offline-Kaltstart | [`apps/web/e2e/flow-01-cold-start-offline.spec.ts`](../apps/web/e2e/flow-01-cold-start-offline.spec.ts) | Pflicht-Flow 1 — Attribution auch ohne Netz |
| dito, unter HA-Ingress-Subpfad | [`apps/web/e2e/subpath.spec.ts`](../apps/web/e2e/subpath.spec.ts) | Pflicht-Flow 9 — Attribution ueberlebt den Reverse-Proxy |
| Disclaimer nennt OpenStreetMap | [`apps/web/e2e/profiles.spec.ts`](../apps/web/e2e/profiles.spec.ts) | Pflicht-Hinweis beim Profilrouting |

Die Routing- und Suchdaten (Valhalla-Graph, Photon-/Lite-Index) werden aus denselben
OSM-Extrakten abgeleitet und sind damit ebenfalls ODbL-abgeleitete Datenbanken;
der Prozess dafuer steht in [`docs/data-update-runbook.md`](data-update-runbook.md).

## 2. Schriften & Icons

| Gegenstand | Herkunft | Lizenz | Beleg |
|---|---|---|---|
| Schriftarten | **keine mitgeliefert** | — | Kein `@font-face`, keine `.woff/.ttf/.otf` im Repo; das gebaute CSS nutzt ausschliesslich `font-family: sans-serif` (Systemschrift). Damit entsteht keine Font-Lizenzpflicht. |
| App-/PWA-Icons (`apps/web/public/icons/*.png`) | Projekteigen, erstellt in E07-T5 | Projektlizenz (s. §6) | Keine Icon-Bibliothek als Abhaengigkeit; die PNGs tragen keine fremden Metadaten. |
| Manoever-Pfeile | Projekteigen, Inline-SVG | Projektlizenz (s. §6) | `apps/web/src/drive/arrows.tsx` — im Quelltext gezeichnet, kein Icon-Set. |
| Karten-Symbole/Labels | Aus dem Kartenstil, OSM-abgeleitet | ODbL (s. §1) | `apps/core/src/map/styles/` — kein externer Sprite-/Glyph-Server (offline-Betrieb). |

Gegenprobe fuer kuenftige Aenderungen: `find apps packages -name "*.woff*" -o -name "*.ttf"`
muss leer bleiben, und es darf kein Icon-Paket (lucide, heroicons, font-awesome …) in einer
`package.json` auftauchen.

## 3. Mitgelieferte Dienste (eigene Container)

Diese Dienste laufen als eigene Container neben dem Core; sie werden nicht in unser
Bundle gelinkt, sondern unveraendert als Image bezogen (`docker-compose.yml`).

| Dienst | Image | Lizenz des Projekts |
|---|---|---|
| Valhalla (Routing) | `ghcr.io/gis-ops/docker-valhalla/valhalla` | MIT |
| Photon (Geocoding) | `rtuszik/photon-docker` | Apache-2.0 |
| gpsd (GPS-Daemon) | Distributionspaket im Add-on-Image | BSD-2-Clause |
| Mosquitto (nur Test/HA-seitig) | `eclipse-mosquitto` | EPL-2.0 / EDL-1.0 |

Mosquitto ist der einzige Copyleft-Beruehrungspunkt (EPL-2.0, schwaches Copyleft) und
**gehoert nicht zum ausgelieferten Bundle**: der Broker wird von Home Assistant bzw. vom
Betreiber gestellt, wir sprechen ihn nur ueber MQTT an (Netzwerkprotokoll, kein Linken).

## 4. NPM-Abhaengigkeiten im ausgelieferten Produkt

Erfasst: **203** Pakete (Produktionsabhaengigkeiten von
`apps/core` — via `pnpm install --prod` im Image — und `apps/web` — in das JS-Bundle
kompiliert), inklusive aller transitiven Abhaengigkeiten.

| Lizenz | Pakete | Einstufung |
|---|---|---|
| `MIT` | 152 | permissiv |
| `ISC` | 19 | permissiv |
| `Apache-2.0` | 10 | permissiv |
| `BSD-3-Clause` | 10 | permissiv |
| `BlueOak-1.0.0` | 5 | permissiv |
| `BSD-2-Clause` | 3 | permissiv |
| `(BSD-2-Clause OR MIT OR Apache-2.0)` | 1 | permissiv |
| `(MIT OR Apache-2.0)` | 1 | permissiv |
| `(MIT OR WTFPL)` | 1 | permissiv |
| `0BSD` | 1 | permissiv |

<details><summary>Vollstaendige Paketliste</summary>

| Paket | Version | Lizenz |
|---|---|---|
| `@babel/runtime` | 7.29.7 | `MIT` |
| `@dnd-kit/accessibility` | 3.1.1 | `MIT` |
| `@dnd-kit/core` | 6.3.1 | `MIT` |
| `@dnd-kit/utilities` | 3.2.2 | `MIT` |
| `@fastify/accept-negotiator` | 2.0.1 | `MIT` |
| `@fastify/ajv-compiler` | 4.0.5 | `MIT` |
| `@fastify/error` | 4.2.0 | `MIT` |
| `@fastify/fast-json-stringify-compiler` | 5.1.0 | `MIT` |
| `@fastify/forwarded` | 3.0.2 | `MIT` |
| `@fastify/merge-json-schemas` | 0.2.1 | `MIT` |
| `@fastify/proxy-addr` | 5.1.0 | `MIT` |
| `@fastify/send` | 4.1.0 | `MIT` |
| `@fastify/static` | 10.1.2 | `MIT` |
| `@fastify/websocket` | 11.3.0 | `MIT` |
| `@lukeed/ms` | 2.0.2 | `MIT` |
| `@mapbox/jsonlint-lines-primitives` | 2.0.3 | `MIT` |
| `@mapbox/point-geometry` | 1.1.0 | `ISC` |
| `@mapbox/tiny-sdf` | 2.2.0 | `BSD-2-Clause` |
| `@mapbox/unitbezier` | 0.0.1 | `BSD-2-Clause` |
| `@mapbox/unitbezier` | 1.0.0 | `BSD-2-Clause` |
| `@mapbox/vector-tile` | 2.0.5 | `BSD-3-Clause` |
| `@mapbox/whoots-js` | 3.1.0 | `ISC` |
| `@maplibre/geojson-vt` | 6.1.1 | `ISC` |
| `@maplibre/maplibre-gl-style-spec` | 24.10.0 | `ISC` |
| `@maplibre/mlt` | 1.1.12 | `(MIT OR Apache-2.0)` |
| `@maplibre/vt-pbf` | 4.3.2 | `MIT` |
| `@pinojs/redact` | 0.4.0 | `MIT` |
| `@types/geojson` | 7946.0.16 | `MIT` |
| `@types/node` | 20.19.43 | `MIT` |
| `@types/prop-types` | 15.7.15 | `MIT` |
| `@types/react` | 18.3.31 | `MIT` |
| `@types/readable-stream` | 4.0.24 | `MIT` |
| `@types/ws` | 8.18.1 | `MIT` |
| `abort-controller` | 3.0.0 | `MIT` |
| `abstract-logging` | 2.0.1 | `MIT` |
| `ajv` | 8.20.0 | `MIT` |
| `ajv-formats` | 3.0.1 | `MIT` |
| `atomic-sleep` | 1.0.0 | `MIT` |
| `avvio` | 9.3.0 | `MIT` |
| `b4a` | 1.8.1 | `Apache-2.0` |
| `balanced-match` | 4.0.4 | `MIT` |
| `bare-events` | 2.9.1 | `Apache-2.0` |
| `bare-fs` | 4.7.4 | `Apache-2.0` |
| `bare-path` | 3.1.1 | `Apache-2.0` |
| `bare-stream` | 2.13.3 | `Apache-2.0` |
| `bare-url` | 2.4.5 | `Apache-2.0` |
| `base64-js` | 1.5.1 | `MIT` |
| `better-sqlite3` | 12.11.1 | `MIT` |
| `bindings` | 1.5.0 | `MIT` |
| `bl` | 4.1.0 | `MIT` |
| `bl` | 6.1.6 | `MIT` |
| `brace-expansion` | 5.0.9 | `MIT` |
| `broker-factory` | 3.1.15 | `MIT` |
| `buffer` | 5.7.1 | `MIT` |
| `buffer` | 6.0.3 | `MIT` |
| `buffer-from` | 1.1.2 | `MIT` |
| `chownr` | 1.1.4 | `ISC` |
| `commist` | 3.2.0 | `MIT` |
| `concat-stream` | 2.0.0 | `MIT` |
| `content-disposition` | 2.0.1 | `MIT` |
| `cookie` | 1.1.1 | `MIT` |
| `csstype` | 3.2.3 | `MIT` |
| `debug` | 4.4.3 | `MIT` |
| `decompress-response` | 6.0.0 | `MIT` |
| `deep-extend` | 0.6.0 | `MIT` |
| `depd` | 2.0.0 | `MIT` |
| `dequal` | 2.0.3 | `MIT` |
| `detect-libc` | 2.1.2 | `Apache-2.0` |
| `duplexify` | 4.1.3 | `MIT` |
| `earcut` | 3.2.3 | `ISC` |
| `end-of-stream` | 1.4.5 | `MIT` |
| `escape-html` | 1.0.3 | `MIT` |
| `event-target-shim` | 5.0.1 | `MIT` |
| `events` | 3.3.0 | `MIT` |
| `events-universal` | 1.0.1 | `Apache-2.0` |
| `expand-template` | 2.0.3 | `(MIT OR WTFPL)` |
| `fast-decode-uri-component` | 1.0.1 | `MIT` |
| `fast-deep-equal` | 3.1.3 | `MIT` |
| `fast-fifo` | 1.3.2 | `MIT` |
| `fast-json-stringify` | 7.0.1 | `MIT` |
| `fast-querystring` | 1.1.2 | `MIT` |
| `fast-redact` | 3.5.0 | `MIT` |
| `fast-unique-numbers` | 9.0.27 | `MIT` |
| `fast-uri` | 3.1.7 | `BSD-3-Clause` |
| `fast-uri` | 4.1.4 | `BSD-3-Clause` |
| `fastify` | 5.11.2 | `MIT` |
| `fastify-plugin` | 6.0.0 | `MIT` |
| `fastq` | 1.20.1 | `ISC` |
| `fflate` | 0.8.3 | `MIT` |
| `file-uri-to-path` | 1.0.0 | `MIT` |
| `find-my-way` | 9.7.0 | `MIT` |
| `fs-constants` | 1.0.0 | `MIT` |
| `github-from-package` | 0.0.0 | `MIT` |
| `gl-matrix` | 3.4.4 | `MIT` |
| `glob` | 13.0.6 | `BlueOak-1.0.0` |
| `help-me` | 5.0.0 | `MIT` |
| `http-errors` | 2.0.0 | `MIT` |
| `ieee754` | 1.2.1 | `BSD-3-Clause` |
| `inherits` | 2.0.4 | `ISC` |
| `ini` | 1.3.8 | `ISC` |
| `ip-address` | 10.4.0 | `MIT` |
| `ipaddr.js` | 2.5.0 | `MIT` |
| `js-sdsl` | 4.3.0 | `MIT` |
| `js-tokens` | 4.0.0 | `MIT` |
| `json-schema-ref-resolver` | 3.0.0 | `MIT` |
| `json-schema-traverse` | 1.0.0 | `MIT` |
| `json-stringify-pretty-compact` | 4.0.0 | `MIT` |
| `kdbush` | 4.1.0 | `ISC` |
| `light-my-request` | 6.6.0 | `BSD-3-Clause` |
| `loose-envify` | 1.4.0 | `MIT` |
| `lru-cache` | 10.4.3 | `ISC` |
| `lru-cache` | 11.5.2 | `BlueOak-1.0.0` |
| `maplibre-gl` | 5.24.0 | `BSD-3-Clause` |
| `mime` | 3.0.0 | `MIT` |
| `mimic-response` | 3.1.0 | `MIT` |
| `minimatch` | 10.2.5 | `BlueOak-1.0.0` |
| `minimist` | 1.2.8 | `MIT` |
| `minipass` | 7.1.3 | `BlueOak-1.0.0` |
| `mkdirp-classic` | 0.5.3 | `MIT` |
| `mqtt` | 5.15.2 | `MIT` |
| `mqtt-packet` | 9.0.2 | `MIT` |
| `ms` | 2.1.3 | `MIT` |
| `murmurhash-js` | 1.0.0 | `MIT` |
| `napi-build-utils` | 2.0.0 | `MIT` |
| `node-abi` | 3.94.0 | `MIT` |
| `number-allocator` | 1.0.14 | `MIT` |
| `on-exit-leak-free` | 2.1.2 | `MIT` |
| `once` | 1.4.0 | `ISC` |
| `path-scurry` | 2.0.2 | `BlueOak-1.0.0` |
| `pbf` | 4.0.2 | `BSD-3-Clause` |
| `pbf` | 5.1.2 | `BSD-3-Clause` |
| `pino` | 8.21.0 | `MIT` |
| `pino` | 9.14.0 | `MIT` |
| `pino-abstract-transport` | 1.2.0 | `MIT` |
| `pino-abstract-transport` | 2.0.0 | `MIT` |
| `pino-std-serializers` | 6.2.2 | `MIT` |
| `pino-std-serializers` | 7.1.0 | `MIT` |
| `pmtiles` | 4.4.1 | `BSD-3-Clause` |
| `potpack` | 2.1.0 | `ISC` |
| `prebuild-install` | 7.1.3 | `MIT` |
| `process` | 0.11.10 | `MIT` |
| `process-nextick-args` | 2.0.1 | `MIT` |
| `process-warning` | 3.0.0 | `MIT` |
| `process-warning` | 4.0.1 | `MIT` |
| `process-warning` | 5.0.0 | `MIT` |
| `protocol-buffers-schema` | 3.6.1 | `MIT` |
| `pump` | 3.0.4 | `MIT` |
| `quick-format-unescaped` | 4.0.4 | `MIT` |
| `quickselect` | 3.0.0 | `ISC` |
| `rc` | 1.2.8 | `(BSD-2-Clause OR MIT OR Apache-2.0)` |
| `react` | 18.3.1 | `MIT` |
| `react-dom` | 18.3.1 | `MIT` |
| `readable-stream` | 3.6.2 | `MIT` |
| `readable-stream` | 4.7.0 | `MIT` |
| `real-require` | 0.2.0 | `MIT` |
| `require-from-string` | 2.0.2 | `MIT` |
| `resolve-protobuf-schema` | 2.1.0 | `MIT` |
| `ret` | 0.5.0 | `MIT` |
| `reusify` | 1.1.0 | `MIT` |
| `rfdc` | 1.4.1 | `MIT` |
| `safe-buffer` | 5.2.1 | `MIT` |
| `safe-regex2` | 5.1.1 | `MIT` |
| `safe-stable-stringify` | 2.5.0 | `MIT` |
| `scheduler` | 0.23.2 | `MIT` |
| `secure-json-parse` | 4.1.0 | `BSD-3-Clause` |
| `semver` | 7.8.5 | `ISC` |
| `set-cookie-parser` | 2.7.2 | `MIT` |
| `setprototypeof` | 1.2.0 | `ISC` |
| `simple-concat` | 1.0.1 | `MIT` |
| `simple-get` | 4.0.1 | `MIT` |
| `smart-buffer` | 4.2.0 | `MIT` |
| `socks` | 2.8.9 | `MIT` |
| `sonic-boom` | 3.8.1 | `MIT` |
| `sonic-boom` | 4.2.1 | `MIT` |
| `split2` | 4.2.0 | `ISC` |
| `statuses` | 2.0.1 | `MIT` |
| `stream-shift` | 1.0.3 | `MIT` |
| `streamx` | 2.28.0 | `MIT` |
| `string_decoder` | 1.3.0 | `MIT` |
| `strip-json-comments` | 2.0.1 | `MIT` |
| `tar-fs` | 2.1.5 | `MIT` |
| `tar-stream` | 2.2.0 | `MIT` |
| `tar-stream` | 3.2.0 | `MIT` |
| `teex` | 1.0.1 | `MIT` |
| `text-decoder` | 1.2.7 | `Apache-2.0` |
| `thread-stream` | 2.7.0 | `MIT` |
| `thread-stream` | 3.2.0 | `MIT` |
| `tinyqueue` | 3.0.0 | `ISC` |
| `toad-cache` | 3.7.4 | `MIT` |
| `toidentifier` | 1.0.1 | `MIT` |
| `tslib` | 2.8.1 | `0BSD` |
| `tunnel-agent` | 0.6.0 | `Apache-2.0` |
| `typedarray` | 0.0.6 | `MIT` |
| `undici-types` | 6.21.0 | `MIT` |
| `use-sync-external-store` | 1.6.0 | `MIT` |
| `util-deprecate` | 1.0.2 | `MIT` |
| `worker-factory` | 7.0.50 | `MIT` |
| `worker-timers` | 8.0.33 | `MIT` |
| `worker-timers-broker` | 8.0.18 | `MIT` |
| `worker-timers-worker` | 9.0.15 | `MIT` |
| `wrappy` | 1.0.2 | `ISC` |
| `ws` | 8.21.0 | `MIT` |
| `zustand` | 4.5.7 | `MIT` |

</details>

## 5. Copyleft-Pruefung (Akzeptanzkriterium 3)

**Ergebnis: keine Copyleft-Konflikte.**

Kein einziges Paket im ausgelieferten Satz steht unter GPL, AGPL, LGPL, SSPL, MPL,
EPL, CDDL, OSL, EUPL oder CPAL. Alle Lizenzen sind permissiv (MIT, ISC, BSD, Apache-2.0,
BlueOak-1.0.0, 0BSD) oder permissiv waehlbare Doppel-Lizenzen.

Erzwungen wird das von `scripts/generate-licenses.mjs --check` im CI-Job
`dependency-audit`: eine GPL-Abhaengigkeit im ausgelieferten Bundle laesst die
Pipeline fehlschlagen, nicht bloss diese Datei anders aussehen.

**Dev-Abhaengigkeiten** (620 Pakete: vitest, vite, eslint, playwright, tsup …)
sind hier bewusst nicht bewertet. Sie werden nie ausgeliefert — das Docker-Image
installiert mit `--prod` —, koennen das Produkt also nicht lizenzrechtlich binden.
Fuer Sicherheits-Advisories gilt dieselbe Trennung, dort aber mit sichtbarer Meldung:
siehe `scripts/dependency-audit.mjs` und `security/audit-exceptions.json`.

## 6. Offener Punkt: Lizenz des Projekts selbst

Das Repository hat derzeit **keine** `LICENSE`-Datei und in keiner `package.json` ein
`license`-Feld. Fuer die Abhaengigkeits- und Attributionspflichten oben ist das ohne
Belang, fuer die Veroeffentlichung von v1.0 aber eine menschliche Entscheidung, die vor
dem Release zu treffen ist (E10-T6, Release-Gate). Dieses Skript trifft sie nicht und
blockiert deswegen auch nicht.

