/* eslint-disable no-console -- Reines CLI-Skript (`pnpm addon-compat:check`); der Bericht gehoert auf stdout. */
/**
 * addon-compat-check.ts — "Add-on-Kompatibilitätstest (Referenz-Add-ons
 * gegen neue Core-API)" aus docs/07-testing-qa.md §6 ("Release: Nightly-
 * Suite + Add-on-Kompatibilitätstest + Changelog + signierte Images").
 *
 * Prüft für jedes Referenz-Add-on unter `addons-examples/`
 * (`addons-examples/README.md`: aktuell `poi-campsites` und
 * `track-recorder` -- ausdrücklich NICHT `evil-fixture`, das ist das
 * Sandbox-Escape-Angriffs-Fixture aus E09-T6, kein Referenz-Add-on), ob sein
 * deklarierter `core_api`-Semver-Range mit der Version erfüllt ist, die
 * `apps/core/package.json` gerade trägt -- mit derselben `satisfies()`-
 * Funktion aus `@yapaja/shared`, die auch der echte Installationspfad
 * benutzt (`apps/core/src/addons/installService.ts`, Wargame W-11), nicht
 * einer zweiten, separat driftenden Implementierung.
 *
 * Das ist die Release-Pipeline-Sicht der Wargame-W-11-Frage "bricht dieser
 * Core-Release ein Referenz-Add-on". Was per-PR bereits als Unit-Test läuft
 * (`apps/core/src/addons/installService.test.ts`) ist die INSTALLATIONS-
 * LOGIK selbst; dieses Skript prüft stattdessen die KONKRETEN, im Repo
 * lebenden Referenz-Add-ons gegen den KONKRETEN, aktuellen Core-
 * Versionsstand -- der Fall, den ein Release tatsächlich ausrollt.
 *
 * Warum `.ts` + `tsx` statt `.mjs` + `node` (wie die übrigen `scripts/*.mjs`):
 * `@yapaja/shared` wird im gesamten Monorepo über `tsconfig.base.json`s
 * `paths`-Alias direkt auf dessen TS-Quellcode aufgelöst (TypeScript/tsup/
 * tsx/Vitest verstehen das) -- NICHT über die paketbasierte `exports`-
 * Auflösung auf ein gebautes `dist/`. Ein simples `node <script>.mjs` kennt
 * diesen Alias nicht und bräuchte stattdessen `@yapaja/shared`s gebautes
 * `dist/index.js` -- das ist real, aber (unabhängig von dieser Aufgabe)
 * kaputt: `packages/shared`s `tsc`-Output referenziert relative Importe ohne
 * `.js`-Endung, was Node im ESM-Modus ablehnt (`ERR_MODULE_NOT_FOUND`) --
 * nie aufgefallen, weil bisher ausschließlich Bundler/tsx/Vitest (alle
 * extensionslos-tolerant) diesen Pfad konsumiert haben. Dieses Skript
 * arbeitet also bewusst über denselben `tsx`-Weg wie
 * `apps/core/src/openapi/generate.ts`, statt diesen vorbestehenden,
 * eigenständigen Packaging-Bug "nebenbei" zu reparieren.
 *
 * Verwendung (siehe root `package.json`s `addon-compat:check`):
 *   pnpm --filter @yapaja/core exec tsx ../../scripts/addon-compat-check.ts            # Bericht
 *   pnpm --filter @yapaja/core exec tsx ../../scripts/addon-compat-check.ts --check    # zusätzlich Exit 1 bei Inkompatibilität
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfies, isValidRange } from '@yapaja/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const ADDONS_EXAMPLES_DIR = join(REPO_ROOT, 'addons-examples');
export const CORE_PACKAGE_JSON_PATH = join(REPO_ROOT, 'apps', 'core', 'package.json');

/** `addons-examples/README.md`: das einzige NICHT-Referenz-Add-on-Verzeichnis dort. */
export const EXCLUDED_DIRS = new Set(['evil-fixture']);

export interface CompatResult {
  id: string;
  coreApiRange: string;
  compatible: boolean;
  reason?: string;
}

export function readCoreVersion(packageJsonRaw: string): string {
  const parsed: unknown = JSON.parse(packageJsonRaw);
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { version?: unknown }).version !== 'string') {
    throw new Error('apps/core/package.json hat kein "version"-Feld');
  }
  return (parsed as { version: string }).version;
}

/**
 * Findet jedes `addons-examples/<name>/yapaja-addon.json`, außer den
 * explizit ausgeschlossenen Verzeichnissen.
 */
export function findReferenceAddonManifests(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
    .map((e) => join(dir, e.name, 'yapaja-addon.json'))
    .filter((path) => existsSync(path));
}

/** Prüft ein Manifest gegen eine Core-Version. */
export function checkManifestCompat(manifestRaw: string, coreVersion: string): CompatResult {
  const manifest: unknown = JSON.parse(manifestRaw);
  const id = String((manifest as { id?: unknown }).id ?? '(ohne id)');
  const coreApiRange = (manifest as { core_api?: unknown }).core_api;
  if (typeof coreApiRange !== 'string' || !isValidRange(coreApiRange)) {
    return { id, coreApiRange: String(coreApiRange), compatible: false, reason: `ungültiger core_api-Range: ${String(coreApiRange)}` };
  }
  const compatible = satisfies(coreVersion, coreApiRange);
  return {
    id,
    coreApiRange,
    compatible,
    ...(compatible ? {} : { reason: `${coreVersion} erfüllt ${coreApiRange} nicht` }),
  };
}

function main(): void {
  const check = process.argv.includes('--check');
  const coreVersion = readCoreVersion(readFileSync(CORE_PACKAGE_JSON_PATH, 'utf-8'));
  const manifestPaths = findReferenceAddonManifests(ADDONS_EXAMPLES_DIR);

  if (manifestPaths.length === 0) {
    console.error(`Keine Referenz-Add-on-Manifeste unter ${ADDONS_EXAMPLES_DIR} gefunden -- Pfad/Struktur geprüft?`);
    process.exitCode = 1;
    return;
  }

  console.log(`Core-Version: ${coreVersion}`);
  const results = manifestPaths.map((path) => {
    const result = checkManifestCompat(readFileSync(path, 'utf-8'), coreVersion);
    const relative = path.slice(REPO_ROOT.length + 1);
    console.log(
      `- ${relative}: ${result.id} (core_api: "${result.coreApiRange}") -> ${
        result.compatible ? '✅ kompatibel' : `❌ INKOMPATIBEL (${result.reason})`
      }`,
    );
    return result;
  });

  const incompatible = results.filter((r) => !r.compatible);
  if (check && incompatible.length > 0) {
    console.error(
      `\nFEHLER: ${incompatible.length} Referenz-Add-on(s) sind mit Core-Version ${coreVersion} inkompatibel ` +
        '(Wargame W-11) -- entweder der Core hat versehentlich core_api gebrochen, oder das Referenz-' +
        'Add-on-Manifest muss aktualisiert werden.',
    );
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
