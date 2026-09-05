/**
 * Tests fuer die zwei Versionen (`version.ts`).
 *
 * ─── WARUM ES DIESE DATEI VORHER NICHT GAB ──────────────────────────────────
 * `/api/v1/health` meldete `"version":"0.0.0"` -- immer, auch im
 * ausgelieferten Image, weil `../../package.json` eine Ebene zu hoch zielte
 * und das `catch` den Fehlschlag in einen gueltig aussehenden Wert verwandelte.
 *
 * Aufgefallen ist es NICHT, weil zwei Tests danebengriffen:
 *
 *   * `health.test.ts` baute sich einen eigenen Fastify mit fest
 *     eingetragener Version -- der echte Server kam darin nicht vor.
 *   * `addons/routes.test.ts` hielt `0.0.0` fuer eine Eigenart von vitest
 *     („readPackageVersion() falls back to 0.0.0 under vitest") und richtete
 *     sich danach ein, statt nachzusehen.
 *
 * Deshalb wird hier die WIRKLICHE Datei gelesen und mit dem verglichen, was
 * in `apps/core/package.json` steht -- nicht mit einer Zahl im Test. Ein
 * Versions-Bump darf diesen Test nicht rot machen; ein kaputter Pfad muss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDON_VERSION_ENV, UNKNOWN_VERSION, readAddonVersion, readPackageVersion } from './version.js';

const here = dirname(fileURLToPath(import.meta.url));
const realCoreVersion = JSON.parse(
  readFileSync(join(here, '../package.json'), 'utf-8'),
).version as string;

describe('Core-Version (der core_api-Vertrag)', () => {
  it('liest die echte apps/core/package.json', async () => {
    // Die Gegenprobe zum Fehler: mit `../../package.json` landete das auf
    // `apps/package.json`, das es nicht gibt -> catch -> '0.0.0'.
    expect(await readPackageVersion()).toBe(realCoreVersion);
  });

  it('ist nicht der Rueckfallwert', async () => {
    // Das ist der eigentliche Punkt. Waere der Pfad wieder falsch, kaeme
    // `0.0.0` zurueck -- ein Wert, der wie eine Auskunft aussieht und keine
    // ist. Der Test oben allein wuerde das nicht zeigen, falls jemand
    // `package.json` versehentlich auf 0.0.0 setzt.
    expect(await readPackageVersion()).not.toBe(UNKNOWN_VERSION);
    expect(realCoreVersion).not.toBe(UNKNOWN_VERSION);
  });
});

describe('Add-on-Version (was der Betreiber laeuft)', () => {
  const saved = process.env[ADDON_VERSION_ENV];

  beforeEach(() => {
    delete process.env[ADDON_VERSION_ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ADDON_VERSION_ENV];
    else process.env[ADDON_VERSION_ENV] = saved;
  });

  it('nimmt, was das Image gesetzt hat', async () => {
    process.env[ADDON_VERSION_ENV] = '0.5.2';
    expect(await readAddonVersion()).toBe('0.5.2');
  });

  it('faellt ausserhalb des Add-ons auf die Core-Version zurueck, nicht auf 0.0.0', async () => {
    // In Entwicklung und Tests gibt es kein Add-on. Dann ist die Core-Version
    // die ehrlichste verfuegbare Auskunft -- erfunden wird nichts.
    expect(await readAddonVersion()).toBe(realCoreVersion);
  });

  it('ignoriert ein leeres oder nur aus Leerzeichen bestehendes Env', async () => {
    // Ein `ENV YAPAJA_ADDON_VERSION=` ohne Wert (oder ein BUILD_VERSION, das
    // der Supervisor nicht gesetzt hat) darf nicht als Version durchgehen --
    // sonst meldete health eine leere Zeichenkette.
    process.env[ADDON_VERSION_ENV] = '   ';
    expect(await readAddonVersion()).toBe(realCoreVersion);

    process.env[ADDON_VERSION_ENV] = '';
    expect(await readAddonVersion()).toBe(realCoreVersion);
  });

  it('ist NICHT dieselbe Funktion wie die Core-Version', async () => {
    // Beide auf einen Wert zu legen war der urspruengliche Fehler: an ihm
    // hingen zwei verschiedene Fragen (welcher Stand laeuft hier / welchen
    // API-Vertrag bekommen Fremd-Add-ons).
    process.env[ADDON_VERSION_ENV] = '9.9.9';
    expect(await readAddonVersion()).toBe('9.9.9');
    expect(await readPackageVersion()).toBe(realCoreVersion);
    expect(await readPackageVersion()).not.toBe('9.9.9');
  });
});
