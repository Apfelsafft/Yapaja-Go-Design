/**
 * Tests fuer das Dependency-Audit-Gate (E10-T4, `scripts/dependency-audit.mjs`).
 *
 * Ein Gate, das nur im Gruen-Fall getestet ist, ist kein Gate. Der Kern dieser
 * Datei sind darum die ROT-Faelle: ein High-Advisory in einer Produktions-
 * Abhaengigkeit blockiert, eine abgelaufene Ausnahme blockiert, eine Ausnahme
 * mit zu fernem Ablaufdatum blockiert (das ist die E10-T4-Plausibilitaetsregel,
 * hier maschinell erzwungen statt nur aufgeschrieben).
 *
 * Der Parser fuer osv-scanner wird gegen Fixtures geprueft, weil osv-scanner in
 * dieser Umgebung nicht installierbar ist (GitHub-Releases liefern 403 ueber
 * den Proxy) und ausschliesslich in CI laeuft — siehe docs/licenses.md §5.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePnpmAudit,
  parseOsvReport,
  collectProdPackages,
  isProdFinding,
  validateExceptions,
  applyExceptions,
  severityFromCvssScore,
  isBlockingSeverity,
  MAX_EXCEPTION_DAYS,
} from './dependency-audit.mjs';

const NOW = new Date('2026-08-05T12:00:00Z');

/** `expires`-Wert, der `days` Tage in der Zukunft liegt. */
function inDays(days: number): string {
  const d = new Date(NOW.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function exception(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'GHSA-aaaa-bbbb-cccc',
    package: 'beispiel',
    reason: 'Trifft nur den Dev-Server, der nie auf das Geraet ausgeliefert wird.',
    expires: inDays(30),
    owner: 'core-team',
    ...overrides,
  };
}

describe('parsePnpmAudit', () => {
  const report = {
    advisories: {
      '1': {
        id: 1,
        github_advisory_id: 'GHSA-1111-1111-1111',
        module_name: 'fastify',
        severity: 'high',
        title: 'Body validation bypass',
        patched_versions: '>=5.7.2',
        findings: [{ version: '4.29.1', paths: ['apps__core>fastify'] }],
      },
    },
  };

  it('normalisiert ein Advisory zu einem Finding', () => {
    const [finding] = parsePnpmAudit(report);
    expect(finding).toMatchObject({
      id: 'GHSA-1111-1111-1111',
      package: 'fastify',
      version: '4.29.1',
      severity: 'high',
      patched: '>=5.7.2',
      scanner: 'pnpm-audit',
    });
  });

  it('vertraegt einen leeren Report (der Sollzustand)', () => {
    expect(parsePnpmAudit({ advisories: {} })).toEqual([]);
    expect(parsePnpmAudit({})).toEqual([]);
  });
});

describe('parseOsvReport', () => {
  // Aufbau wie `osv-scanner --format json`.
  const report = {
    results: [
      {
        source: { path: 'pnpm-lock.yaml', type: 'lockfile' },
        packages: [
          {
            package: { name: 'linkes-paket', version: '1.0.0', ecosystem: 'npm' },
            vulnerabilities: [
              {
                id: 'GHSA-2222-2222-2222',
                aliases: ['CVE-2026-0001'],
                summary: 'Etwas Schlimmes',
                database_specific: { severity: 'HIGH' },
              },
            ],
            groups: [{ ids: ['GHSA-2222-2222-2222'], max_severity: '8.1' }],
          },
          {
            package: { name: 'rechtes-paket', version: '2.0.0', ecosystem: 'npm' },
            vulnerabilities: [{ id: 'OSV-2026-1', aliases: [], summary: 'Ohne GHSA-Severity' }],
            groups: [{ ids: ['OSV-2026-1'], max_severity: '9.4' }],
          },
        ],
      },
    ],
  };

  it('liest Schweregrad bevorzugt aus database_specific', () => {
    const findings = parseOsvReport(report);
    expect(findings[0]).toMatchObject({
      id: 'GHSA-2222-2222-2222',
      package: 'linkes-paket',
      severity: 'high',
      scanner: 'osv-scanner',
    });
  });

  it('faellt auf den CVSS-Score der Gruppe zurueck, wenn kein Schweregrad dabei ist', () => {
    const findings = parseOsvReport(report);
    expect(findings[1]).toMatchObject({ id: 'OSV-2026-1', severity: 'critical' });
  });

  it('vertraegt einen Report ohne Funde', () => {
    expect(parseOsvReport({ results: [] })).toEqual([]);
    expect(parseOsvReport({})).toEqual([]);
  });
});

describe('severityFromCvssScore', () => {
  it('bildet die qualitative CVSS-v3.1-Skala ab', () => {
    expect(severityFromCvssScore('9.8')).toBe('critical');
    expect(severityFromCvssScore('7.0')).toBe('high');
    expect(severityFromCvssScore('4.0')).toBe('moderate');
    expect(severityFromCvssScore('1.2')).toBe('low');
    expect(severityFromCvssScore('keine-zahl')).toBe('unknown');
  });

  it('behandelt einen unbekannten Schweregrad nicht als blockierend', () => {
    // Sonst wuerde ein Formatwechsel bei osv-scanner die Pipeline flaechig rot
    // faerben; stattdessen taucht der Fund in der Ausgabe auf.
    expect(isBlockingSeverity('unknown')).toBe(false);
    expect(isBlockingSeverity('high')).toBe(true);
    expect(isBlockingSeverity('critical')).toBe(true);
    expect(isBlockingSeverity('moderate')).toBe(false);
  });
});

describe('Prod-/Dev-Trennung', () => {
  const listJson = [
    {
      name: '@yapaja/core',
      dependencies: {
        fastify: { version: '5.11.2', dependencies: { 'find-my-way': { version: '9.7.0' } } },
      },
    },
  ];

  it('flacht den Prod-Baum rekursiv ab', () => {
    const set = collectProdPackages(listJson);
    expect(set.has('fastify@5.11.2')).toBe(true);
    expect(set.has('find-my-way@9.7.0')).toBe(true);
    expect(set.has('vitest@1.6.1')).toBe(false);
  });

  it('erkennt einen Fund in einer transitiven Produktions-Abhaengigkeit', () => {
    const set = collectProdPackages(listJson);
    expect(isProdFinding({ package: 'find-my-way', version: '9.7.0' }, set)).toBe(true);
    expect(isProdFinding({ package: 'vitest', version: '1.6.1' }, set)).toBe(false);
  });
});

describe('validateExceptions', () => {
  it('akzeptiert eine leere Liste (Sollzustand)', () => {
    expect(validateExceptions([], NOW)).toEqual([]);
  });

  it('akzeptiert einen vollstaendigen Eintrag innerhalb der Frist', () => {
    expect(validateExceptions([exception()], NOW)).toEqual([]);
  });

  it('lehnt eine Ausnahme ohne Ablaufdatum ab', () => {
    const errors = validateExceptions([exception({ expires: undefined })], NOW);
    expect(errors.join('\n')).toContain('"expires"');
  });

  it('lehnt eine ABGELAUFENE Ausnahme ab', () => {
    const errors = validateExceptions([exception({ expires: inDays(-1) })], NOW);
    expect(errors.join('\n')).toContain('ABGELAUFEN');
  });

  it(`lehnt ein Ablaufdatum jenseits von ${MAX_EXCEPTION_DAYS} Tagen ab`, () => {
    // Das ist die Plausibilitaetsregel der Aufgabe, maschinell erzwungen.
    expect(validateExceptions([exception({ expires: inDays(MAX_EXCEPTION_DAYS + 1) })], NOW))
      .toHaveLength(1);
    expect(validateExceptions([exception({ expires: inDays(MAX_EXCEPTION_DAYS - 1) })], NOW))
      .toHaveLength(0);
  });

  it('lehnt eine Alibi-Begruendung ab', () => {
    const errors = validateExceptions([exception({ reason: 'spaeter' })], NOW);
    expect(errors.join('\n')).toContain('zu duenn');
  });

  it('lehnt doppelte Eintraege fuer dasselbe Advisory ab', () => {
    const errors = validateExceptions([exception(), exception()], NOW);
    expect(errors.join('\n')).toContain('doppelter Eintrag');
  });
});

describe('applyExceptions', () => {
  const high = {
    id: 'GHSA-aaaa-bbbb-cccc',
    package: 'beispiel',
    version: '1.0.0',
    severity: 'high',
    title: 't',
  };

  it('BLOCKIERT einen High-Fund ohne Ausnahme', () => {
    const { blocking, excepted } = applyExceptions([high], []);
    expect(blocking).toHaveLength(1);
    expect(excepted).toHaveLength(0);
  });

  it('laesst einen Fund mit passender Ausnahme durch', () => {
    const { blocking, excepted } = applyExceptions([high], [exception()]);
    expect(blocking).toHaveLength(0);
    expect(excepted).toHaveLength(1);
  });

  it('greift NICHT paketweit — die Advisory-ID muss passen', () => {
    const other = applyExceptions([{ ...high, id: 'GHSA-zzzz-zzzz-zzzz' }], [exception()]);
    expect(other.blocking).toHaveLength(1);
  });

  it('greift NICHT paketuebergreifend — der Paketname muss passen', () => {
    const other = applyExceptions([{ ...high, package: 'anderes' }], [exception()]);
    expect(other.blocking).toHaveLength(1);
  });

  it('deckt einen OSV-Fund ueber seinen CVE-Alias ab', () => {
    const osv = { ...high, id: 'OSV-2026-9', aliases: ['GHSA-aaaa-bbbb-cccc'] };
    expect(applyExceptions([osv], [exception()]).excepted).toHaveLength(1);
  });

  it('blockiert nicht bei moderate/low (Schwelle ist high/critical)', () => {
    expect(applyExceptions([{ ...high, severity: 'moderate' }], []).blocking).toHaveLength(0);
    expect(applyExceptions([{ ...high, severity: 'critical' }], []).blocking).toHaveLength(1);
  });
});
