/**
 * Ein Test gegen genau die Sorte Fehler, die `placeName.test.ts` nicht sehen
 * kann.
 *
 * Dort gibt jeder Test die Source-ID selbst herein, und die gefälschte Karte
 * antwortet auf jeden Namen. Alle 14 Tests waren grün, während
 * `resolvePlaceName` im Betrieb ausnahmslos `null` lieferte: die Konstante
 * stand auf `'region'`, die Quelle heißt `'yapaja-region'`. Ein Test, der
 * seinen eigenen Parameter setzt, prüft die Verdrahtung nicht.
 *
 * Diese Datei liest deshalb die WIRKLICHE Konstante aus dem Core und hält den
 * Wert der Weboberfläche dagegen. Die beiden liegen in getrennten Paketen
 * (kein Import über die Grenze), also über die Datei — dieselbe Technik, mit
 * der `yapaja_go/config.test.ts` die Add-on-Konfiguration gegen den Quelltext
 * hält.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGION_SOURCE_ID } from './placeName';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_CONSTANTS = join(__dirname, '../../../core/src/map/styles/constants.ts');

describe('REGION_SOURCE_ID stimmt mit dem Core überein', () => {
  it('nennt dieselbe Vektorquelle, die der Core im Stil anlegt', () => {
    const source = readFileSync(CORE_CONSTANTS, 'utf-8');
    const match = /export const REGION_SOURCE_ID = '([^']+)'/.exec(source);

    expect(
      match,
      `In ${CORE_CONSTANTS} ist kein REGION_SOURCE_ID mehr zu finden — wurde die ` +
        'Konstante umbenannt? Dann muss dieser Test ihr folgen, nicht verschwinden.',
    ).not.toBeNull();

    const coreValue = (match as RegExpExecArray)[1];
    expect(
      REGION_SOURCE_ID,
      `Die Weboberfläche fragt die Vektorquelle "${REGION_SOURCE_ID}" ab, der Core legt ` +
        `aber "${coreValue}" an. querySownerFeatures wirft dann bei jedem Aufruf, der ` +
        'Fehler wird geschluckt, und angetippte Ziele bleiben für immer ohne Namen — ' +
        'ohne dass irgendetwas darauf hinweist.',
    ).toBe(coreValue);
  });

  // Der Kern des ursprünglichen Fehlers: eine unbekannte Quelle war von
  // „keine Namen in der Nähe" nicht zu unterscheiden. Jetzt schon.
  it('liefert null und warnt genau einmal, wenn es die Quelle nicht gibt', async () => {
    const { resolvePlaceName } = await import('./placeName');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: unknown) => {
      warnings.push(String(msg));
    };

    try {
      const map = {
        getSource: () => undefined,
        querySourceFeatures: () => {
          throw new Error('darf gar nicht erst gefragt werden');
        },
      } as never;

      expect(resolvePlaceName({ map, point: { lat: 49.2, lon: 8.2 }, sourceId: 'gibt-es-nicht' })).toBeNull();
      expect(resolvePlaceName({ map, point: { lat: 49.2, lon: 8.2 }, sourceId: 'gibt-es-nicht' })).toBeNull();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('gibt-es-nicht');
  });
});
