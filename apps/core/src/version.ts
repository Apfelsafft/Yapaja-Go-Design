/**
 * ZWEI Versionen, die bisher eine waren.
 *
 * ─── WAS SCHIEFLIEF ─────────────────────────────────────────────────────────
 * `/api/v1/health` meldete `"version":"0.0.0"`. Nicht manchmal -- IMMER, auch
 * im ausgelieferten Image. Der Pfad ging eine Ebene zu hoch:
 *
 *   apps/core/src/version.ts  -> ../../package.json = apps/package.json
 *   apps/core/dist/index.js   -> ../../package.json = apps/package.json
 *   /app/apps/core/dist       -> ../../package.json = /app/apps/package.json
 *
 * Keine dieser Dateien existiert. Das `catch` fing das ab und lieferte
 * `'0.0.0'` -- ein gueltig aussehender Wert, der nie stimmte. Ein Test
 * schrieb das sogar fest, aber mit falscher Begruendung („faellt unter vitest
 * auf 0.0.0 zurueck"): es lag nicht an vitest, es lag am Pfad.
 *
 * Der Schaden ist der uebliche: wer meldet „bei mir geht X nicht", kann nicht
 * sagen, welchen Stand er laeuft, und ich kann es ihm nicht ansehen.
 *
 * ─── WARUM ES JETZT ZWEI FUNKTIONEN SIND ────────────────────────────────────
 * An dem einen Wert hingen zwei verschiedene Fragen:
 *
 *   1. „Welchen Stand laeuft dieses Geraet?"  -> `/api/v1/health` und die
 *      HA-Discovery (`sw_version`). Gemeint ist die ADD-ON-Version aus
 *      `config.yaml` -- die, die Home Assistant anzeigt und die jemand in
 *      einer Meldung nennen wuerde. `0.0.1` aus `apps/core/package.json`
 *      waere hier genauso nutzlos wie `0.0.0`.
 *
 *   2. „Welchen Core-API-Vertrag bekommen Fremd-Add-ons?" -> der
 *      `core_api`-Semver-Bereich in `addons/installService.ts` und
 *      `addons/registryRoutes.ts` (Wargame W-11). Das ist die Version des
 *      CORES, nicht die des Add-ons, und sie darf sich nicht jedes Mal
 *      mitbewegen, wenn eine Kartenfunktion eine neue Add-on-Version bekommt.
 *
 * Die OpenAPI-Beschreibung (`openapi/generate.ts`) nimmt bewusst ebenfalls
 * die CORE-Version: sie beschreibt den API-Vertrag, und sie muss in CI
 * reproduzierbar sein -- das Add-on-Env ist dort nicht gesetzt.
 *
 * Beide auf denselben Wert zu legen war der eigentliche Fehler; dass er
 * `0.0.0` lautete, hat ihn nur unsichtbar gemacht.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Wenn gar nichts lesbar ist. Bewusst kein Fantasiewert. */
export const UNKNOWN_VERSION = '0.0.0';

/**
 * Das Env, das das Add-on-Image setzt (`ENV YAPAJA_ADDON_VERSION=${BUILD_VERSION}`).
 * `BUILD_VERSION` reicht der HA-Supervisor bei jedem Bau aus `config.yaml`
 * herein -- dieselbe Zahl, die er in der Oberflaeche anzeigt.
 */
export const ADDON_VERSION_ENV = 'YAPAJA_ADDON_VERSION';

/**
 * Die Version des CORES -- der Vertrag fuer `core_api` von Fremd-Add-ons.
 *
 * `../package.json` ist in allen drei Layouts richtig: aus `src/` und aus
 * `dist/` liegt `apps/core/package.json` genau eine Ebene hoeher, und im
 * Image ebenso (`/app/apps/core/dist` neben `/app/apps/core/package.json`,
 * siehe die COPY-Zeilen im Dockerfile).
 */
export async function readPackageVersion(): Promise<string> {
  try {
    const packagePath = join(__dirname, '../package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version || UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}

/**
 * Die Version, die der Betreiber sieht und in einer Meldung nennt.
 *
 * Ausserhalb des Add-ons (Entwicklung, Tests, blosses `apps/core`) gibt es
 * kein Add-on -- dann ist die Core-Version die ehrlichste verfuegbare
 * Auskunft. Erfunden wird nichts.
 */
export async function readAddonVersion(): Promise<string> {
  const fromEnv = process.env[ADDON_VERSION_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return readPackageVersion();
}
