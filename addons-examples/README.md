# Referenz-Add-ons (E09-T5, docs/05-addon-system.md §6)

Zwei lebende Beispiele, die zusammen die komplette `@yapaja/addon-sdk`-Oberfläche
abdecken (docs/05 §6) und als Vorlage für Dritt-Add-ons dienen:

- **[`poi-campsites/`](./poi-campsites)** -- Typ A (reines UI-Add-on): POI-Overlay
  "Stellplätze".
- **[`track-recorder/`](./track-recorder)** -- Typ B + Mini-UI (Service-Add-on):
  zeichnet die Fahrt als GPX auf.

Jedes Verzeichnis hat sein eigenes `README.md` mit Manifest/Scope-Begründung,
Build- und Testanleitung.

## Kein Beispiel: `evil-fixture/` (E09-T6)

Das Verzeichnis `evil-fixture/` ist **kein** Referenz-Add-on, sondern das
Angriffs-Fixture der Sandbox-Escape-Suite (E09-T6, Wargame W-10). Es versucht
systematisch jede verbotene Aktion und darf deshalb **niemals in die Registry
oder in den Store** — nicht als Beispiel, nicht als Vorlage, nicht auf ein
echtes Gerät. Der Guard-Test `evil-fixture/not-in-store.test.ts` bricht die CI,
sobald seine Add-on-Id in einem Registry-/Store-Index oder im
Produktions-Quellcode auftaucht.

Details: `evil-fixture/README.md`, Nachweistabelle in
`../e2e/security/README.md`.

## Warum diese Verzeichnisse KEIN pnpm-Workspace-Package sind

`pnpm-workspace.yaml` listet nur `apps/*`, `packages/*`, `services/*` --
absichtlich, **nicht** `addons-examples/*`. Diese beiden Pakete sind
Beispiel-/Referenzprojekte, keine Teile des shipped Monorepo-Graphen: sie
werden nicht von `apps/core` oder `apps/web` importiert, haben keine
Laufzeit-Abhängigkeit zueinander, und ihr einziger "Konsument" ist der
Add-on-Installationsmechanismus (ein gebauter `.tgz`-Tarball), nicht `pnpm`
selbst. Das hält `pnpm -r lint`/`pnpm -r typecheck`/`pnpm -r build` (und die
Abhängigkeits-Reihenfolge, die `pnpm -r` daraus ableitet) exakt so, wie sie
vor E09-T5 waren -- keine neuen Workspace-Mitglieder, kein Risiko, dass ein
zukünftiger `pnpm -r`-Lauf versehentlich anfängt, ein Beispielprojekt zu
bauen/zu veröffentlichen.

Was das konkret bedeutet:

- **`@yapaja/addon-sdk` wird per esbuild `alias` direkt aus dessen
  TypeScript-QUELLTEXT** (`packages/addon-sdk/src/index.ts`, ebenso
  `@yapaja/shared`) **gebündelt** (siehe `*/build.mjs`), nicht über eine
  `workspace:*`-Abhängigkeit aufgelöst -- es gibt keine node_modules-Verlinkung
  zu diesen Paketen. Das ist ohnehin nötig: die add-on Iframe/Prozess-Umgebung
  kennt gar kein `node_modules` (siehe unten), der fertige Bundle muss
  selbstständig sein.
- **Jedes Paket typechecked trotzdem** (`npm run typecheck` -> `tsc -p
  tsconfig.json`, `noEmit`), gegen dieselbe `../../tsconfig.base.json` wie der
  Rest des Repos -- nur eben manuell aufgerufen, nicht über
  `pnpm -r typecheck`.
- **Die Unit-Tests LAUFEN trotzdem in der einen `npx vitest run`-Suite**: die
  Root-`vitest.config.ts` hat `addons-examples/**/*.test.ts` explizit im
  `include`-Glob (unabhängig vom pnpm-Workspace -- Vitest kennt nur Vite-Aliase,
  keine pnpm-Workspace-Mitgliedschaft).
- **`esbuild` ist eine Root-`devDependency`** (bereits transitiv über `vite`
  im Lockfile vorhanden, `pnpm install` lädt dadurch nichts Neues herunter) --
  beide `build.mjs`-Skripte importieren es über normale Node-Modulauflösung
  (die bei `addons-examples/<pkg>/build.mjs` bis zum Root-`node_modules`
  hochläuft, unabhängig vom pnpm-Workspace).
- **Lint**: `pnpm -r lint` rührt diese Pakete nicht an (sie sind kein
  Workspace-Mitglied). Sie lassen sich trotzdem mit der GLEICHEN geteilten
  Root-ESLint-Konfiguration prüfen: `npx eslint addons-examples/<pkg>/src
  --ext .ts` (das Root-`eslint.config.js` hat dafür einen eigenen
  `no-undef: off`-Block für Browser/DOM-Code, siehe dessen Kommentar).

Kurz: **außerhalb des Workspace, aber nicht außerhalb der Tool-Kette** --
lint/typecheck/test laufen alle, nur nicht unter dem `-r`-Rekursions-Dach.

## Bauen

```sh
cd addons-examples/poi-campsites && node build.mjs   # -> dist/poi-campsites.tgz
cd addons-examples/track-recorder && node build.mjs  # -> dist/track-recorder.tgz
```

## Testen

```sh
npx vitest run addons-examples          # Unit-Tests beider Add-ons
cd apps/web && npx playwright test e2e/addon-examples-poi.spec.ts e2e/addon-examples-recorder.spec.ts
```
