/**
 * Tests fuer das Copyleft-Gate (E10-T4 Akzeptanzkriterium 3,
 * `scripts/generate-licenses.mjs`).
 *
 * Der entscheidende Fall ist der ROTE: „GPL-Dependency im ausgelieferten Bundle
 * -> Fail". Ein Gate, das nur beweist, dass es beim heutigen (sauberen) Stand
 * gruen ist, beweist nichts — deshalb wird hier ein GPL-Paket synthetisch
 * eingeschleust und geprueft, dass es das Gate umlegt.
 *
 * Die zweite Haelfte betrifft die Feinheiten von SPDX-Ausdruecken: `(MIT OR
 * GPL-2.0)` ist KEIN Konflikt (wir duerfen MIT waehlen), `GPL-3.0-or-later`
 * schon (nur anders geschrieben). Beides falsch zu klassifizieren waere ein
 * teurer Fehler in genau die eine oder andere Richtung.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyLicense,
  splitSpdx,
  baseLicenseId,
  flattenPnpmLicenses,
  findCopyleftViolations,
  groupByLicense,
} from './generate-licenses.mjs';

describe('classifyLicense', () => {
  it('stuft die tatsaechlich verwendeten Lizenzen als permissiv ein', () => {
    for (const id of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'BlueOak-1.0.0', '0BSD']) {
      expect(classifyLicense(id)).toBe('permissive');
    }
  });

  it('erkennt starkes Copyleft', () => {
    for (const id of ['GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'EUPL-1.2', 'CPAL-1.0']) {
      expect(classifyLicense(id)).toBe('strong-copyleft');
    }
  });

  it('erkennt schwaches Copyleft', () => {
    for (const id of ['LGPL-3.0', 'MPL-2.0', 'EPL-2.0', 'CDDL-1.0']) {
      expect(classifyLicense(id)).toBe('weak-copyleft');
    }
  });

  it('erkennt die Suffix-Varianten desselben Bezeichners', () => {
    // Diese Schreibweisen kommen in echten package.json-Dateien vor; wuerden
    // sie durchrutschen, waere das Gate blind fuer die haeufigste GPL-Form.
    expect(classifyLicense('GPL-3.0-or-later')).toBe('strong-copyleft');
    expect(classifyLicense('GPL-2.0-only')).toBe('strong-copyleft');
    expect(classifyLicense('GPL-2.0+')).toBe('strong-copyleft');
    expect(baseLicenseId('AGPL-3.0-or-later')).toBe('AGPL-3.0');
  });

  it('behandelt eine ODER-Doppellizenz mit permissiver Alternative als permissiv', () => {
    // Bei `(MIT OR GPL-2.0)` duerfen wir MIT waehlen -- das ist kein Konflikt,
    // und es faelschlich rot zu melden wuerde das Gate unbrauchbar machen.
    expect(classifyLicense('(MIT OR GPL-2.0)')).toBe('permissive');
    expect(classifyLicense('(MIT OR WTFPL)')).toBe('permissive');
    expect(classifyLicense('(BSD-2-Clause OR MIT OR Apache-2.0)')).toBe('permissive');
  });

  it('bleibt rot, wenn ALLE Alternativen Copyleft sind', () => {
    expect(classifyLicense('(GPL-2.0 OR AGPL-3.0)')).toBe('strong-copyleft');
  });

  it('behandelt UND-Verknuepfungen kumulativ', () => {
    // `AND` heisst: beide Lizenzen gelten. Ein Copyleft-Teil bindet also.
    expect(classifyLicense('MIT AND GPL-2.0')).toBe('strong-copyleft');
  });

  it('meldet fehlende Angaben als unbekannt statt als permissiv', () => {
    expect(classifyLicense('')).toBe('unknown');
    expect(classifyLicense(undefined)).toBe('unknown');
    expect(classifyLicense('UNKNOWN')).toBe('unknown');
    expect(classifyLicense('UNLICENSED')).toBe('unknown');
  });

  it('zerlegt SPDX-Ausdruecke', () => {
    expect(splitSpdx('(MIT OR Apache-2.0)')).toEqual(['MIT', 'Apache-2.0']);
    expect(splitSpdx('MIT')).toEqual(['MIT']);
  });
});

describe('flattenPnpmLicenses', () => {
  const report = {
    MIT: [{ name: 'fastify', versions: ['5.11.2'], license: 'MIT', homepage: 'https://fastify.dev' }],
    'Apache-2.0': [{ name: 'irgendwas', versions: ['1.0.0', '2.0.0'], license: 'Apache-2.0' }],
  };

  it('flacht die Lizenz-Gruppierung zu einer Paketliste ab (eine Zeile je Version)', () => {
    const packages = flattenPnpmLicenses(report);
    expect(packages).toHaveLength(3);
    expect(packages[0]).toMatchObject({ name: 'fastify', version: '5.11.2', license: 'MIT' });
  });

  it('liefert eine stabile Sortierung (sonst waere der --check-Lauf nie gruen)', () => {
    const namen = flattenPnpmLicenses(report).map((p) => `${p.name}@${p.version}`);
    expect(namen).toEqual([...namen].sort());
  });
});

describe('findCopyleftViolations', () => {
  const sauber = [
    { name: 'fastify', version: '5.11.2', license: 'MIT' },
    { name: 'ajv', version: '8.20.0', license: 'MIT' },
    { name: 'wrappy', version: '1.0.2', license: 'ISC' },
  ];

  it('meldet den sauberen Satz als konfliktfrei', () => {
    const v = findCopyleftViolations(sauber);
    expect(v.strong).toHaveLength(0);
    expect(v.unreviewedWeak).toHaveLength(0);
    expect(v.unknown).toHaveLength(0);
  });

  it('FAELLT UM, sobald ein GPL-Paket im ausgelieferten Satz auftaucht', () => {
    // Das ist Akzeptanzkriterium 3 in einem Test.
    const v = findCopyleftViolations([
      ...sauber,
      { name: 'boeses-paket', version: '1.0.0', license: 'GPL-3.0-or-later' },
    ]);
    expect(v.strong).toHaveLength(1);
    expect(v.strong[0].name).toBe('boeses-paket');
  });

  it('meldet ungeprueftes schwaches Copyleft gesondert', () => {
    const v = findCopyleftViolations([
      ...sauber,
      { name: 'mpl-paket', version: '1.0.0', license: 'MPL-2.0' },
    ]);
    expect(v.strong).toHaveLength(0);
    expect(v.unreviewedWeak.map((p) => p.name)).toEqual(['mpl-paket']);
  });

  it('sammelt Pakete ohne Lizenzangabe, ohne sie stillschweigend zu erlauben', () => {
    const v = findCopyleftViolations([...sauber, { name: 'namenlos', version: '1.0.0', license: '' }]);
    expect(v.unknown.map((p) => p.name)).toEqual(['namenlos']);
  });
});

describe('groupByLicense', () => {
  it('sortiert nach Haeufigkeit, dann alphabetisch (deterministisch)', () => {
    const groups = groupByLicense([
      { name: 'a', version: '1', license: 'ISC' },
      { name: 'b', version: '1', license: 'MIT' },
      { name: 'c', version: '1', license: 'MIT' },
    ]);
    expect(groups.map(([license, pkgs]) => [license, pkgs.length])).toEqual([
      ['MIT', 2],
      ['ISC', 1],
    ]);
  });
});
