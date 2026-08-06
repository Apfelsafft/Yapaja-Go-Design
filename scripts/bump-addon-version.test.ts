import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeVersion, bumpVersionLine, ADDON_CONFIG_PATH } from './bump-addon-version.mjs';

describe('normalizeVersion', () => {
  it('lässt ein nacktes X.Y.Z unverändert', () => {
    expect(normalizeVersion('1.2.3')).toBe('1.2.3');
  });

  it('streift ein führendes "v" (Tag-Format vX.Y.Z)', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
  });

  it('akzeptiert Prerelease-Suffixe', () => {
    expect(normalizeVersion('v1.2.3-rc.1')).toBe('1.2.3-rc.1');
  });

  it('lehnt ungültige Versionen ab', () => {
    expect(() => normalizeVersion('nicht-semver')).toThrow();
    expect(() => normalizeVersion('1.2')).toThrow();
  });
});

describe('bumpVersionLine', () => {
  const fixture = 'name: "Yapaja Go"\nversion: "0.1.0"\nslug: yapaja_go\n';

  it('ersetzt nur die version-Zeile, lässt den Rest unangetastet', () => {
    const result = bumpVersionLine(fixture, '1.0.0');
    expect(result).toBe('name: "Yapaja Go"\nversion: "1.0.0"\nslug: yapaja_go\n');
  });

  it('wirft, wenn keine version-Zeile gefunden wird', () => {
    expect(() => bumpVersionLine('name: "x"\n', '1.0.0')).toThrow();
  });
});

describe('Realer Repo-Stand', () => {
  it('ha-addon/yapaja_go/config.yaml hat aktuell eine gültige version-Zeile', () => {
    const raw = readFileSync(ADDON_CONFIG_PATH, 'utf-8');
    expect(() => bumpVersionLine(raw, '99.99.99')).not.toThrow();
  });
});
