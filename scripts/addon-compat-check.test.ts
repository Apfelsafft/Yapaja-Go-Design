/**
 * Tests fuer den Add-on-Kompatibilitaets-Check (E10-T5, docs/07 §6
 * "Add-on-Kompatibilitätstest"). Der entscheidende Fall ist wieder der
 * ROTE: ein Referenz-Add-on, dessen `core_api` die aktuelle Core-Version
 * NICHT erfüllt, muss durchfallen -- nicht nur der heutige (grüne) Stand.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readCoreVersion,
  findReferenceAddonManifests,
  checkManifestCompat,
  ADDONS_EXAMPLES_DIR,
  CORE_PACKAGE_JSON_PATH,
  EXCLUDED_DIRS,
} from './addon-compat-check.js';

describe('readCoreVersion', () => {
  it('liest das "version"-Feld', () => {
    expect(readCoreVersion('{"version":"1.2.3"}')).toBe('1.2.3');
  });

  it('wirft bei fehlendem "version"-Feld', () => {
    expect(() => readCoreVersion('{}')).toThrow();
  });
});

describe('findReferenceAddonManifests', () => {
  it('findet unter dem echten addons-examples/ genau die zwei dokumentierten Referenz-Add-ons', () => {
    const paths = findReferenceAddonManifests(ADDONS_EXAMPLES_DIR);
    const names = paths.map((p) => p.split('/').slice(-2, -1)[0]).sort();
    expect(names).toEqual(['poi-campsites', 'track-recorder']);
  });

  it('schließt evil-fixture aus (Sandbox-Escape-Fixture, kein Referenz-Add-on)', () => {
    expect(EXCLUDED_DIRS.has('evil-fixture')).toBe(true);
    const paths = findReferenceAddonManifests(ADDONS_EXAMPLES_DIR);
    expect(paths.some((p) => p.includes('evil-fixture'))).toBe(false);
  });

  it('gibt eine leere Liste für ein nicht existierendes Verzeichnis zurück, statt zu werfen', () => {
    expect(findReferenceAddonManifests('/pfad/der/nicht/existiert')).toEqual([]);
  });
});

describe('checkManifestCompat', () => {
  it('GRÜN: core_api "*" ist mit jeder Core-Version kompatibel', () => {
    const result = checkManifestCompat('{"id":"test.addon","core_api":"*"}', '3.7.2');
    expect(result).toEqual({ id: 'test.addon', coreApiRange: '*', compatible: true });
  });

  it('GRÜN: enge Range, die die Core-Version tatsächlich erfüllt', () => {
    const result = checkManifestCompat('{"id":"test.addon","core_api":"^1.2.0"}', '1.5.0');
    expect(result.compatible).toBe(true);
  });

  it('ROT: Range, die die aktuelle Core-Version NICHT erfüllt (der Wargame-W-11-Fall)', () => {
    const result = checkManifestCompat('{"id":"test.addon","core_api":"^1.0.0"}', '2.0.0');
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('2.0.0');
  });

  it('ROT: ungültiger core_api-Range wird als inkompatibel gewertet, nicht stillschweigend übersprungen', () => {
    const result = checkManifestCompat('{"id":"test.addon","core_api":"not-a-range"}', '1.0.0');
    expect(result.compatible).toBe(false);
  });
});

describe('Realer Repo-Stand (der eigentliche Beweis für die Release-Pipeline)', () => {
  it('beide echten Referenz-Add-ons sind mit der aktuellen apps/core-Version kompatibel', () => {
    const coreVersion = readCoreVersion(readFileSync(CORE_PACKAGE_JSON_PATH, 'utf-8'));
    const manifestPaths = findReferenceAddonManifests(ADDONS_EXAMPLES_DIR);
    expect(manifestPaths.length).toBeGreaterThan(0);

    for (const path of manifestPaths) {
      const result = checkManifestCompat(readFileSync(path, 'utf-8'), coreVersion);
      expect(result.compatible, `${path}: ${result.reason ?? ''}`).toBe(true);
    }
  });
});
