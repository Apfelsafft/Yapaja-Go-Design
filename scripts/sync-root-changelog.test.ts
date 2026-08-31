/**
 * Tests fuer den Changelog-Sync (E10-T5). Kein echtes Changeset wurde in
 * diesem Repo je versioniert (siehe apps/core/CHANGELOG.md existiert nicht),
 * daher arbeiten diese Tests mit synthetischen Fixtures im selben Format,
 * das @changesets/cli's Default-Changelog-Generator tatsaechlich erzeugt --
 * derselbe reduzierte, aber echte Beweis-Ansatz wie
 * scripts/runbook-smoke.sh (siehe dessen Kopfkommentar).
 */

import { describe, it, expect } from 'vitest';
import { extractLatestSection, mergeIntoRootChangelog, extractRootSection } from './sync-root-changelog.mjs';

// Realistische Form dessen, was `@changesets/cli/changelog` tatsaechlich
// erzeugt: neueste Version zuerst, "### Major/Minor/Patch Changes"-
// Unterabschnitte mit Bullet-Punkten aus den Changeset-Zusammenfassungen.
const PACKAGE_CHANGELOG_FIXTURE = `# @yapaja/core

## 1.2.0

### Minor Changes

- abc1234: Neuer optionaler Parameter \`heading\` bei Reroute-Requests (W-05).

### Patch Changes

- def5678: Fix ETA-Rundung bei DST-Uebergang (W-22).

## 1.1.0

### Minor Changes

- 9990001: Erstes oeffentliches Changeset-Release.
`;

describe('extractLatestSection', () => {
  it('extrahiert nur den JÜNGSTEN Versionsabschnitt, nicht die älteren', () => {
    const result = extractLatestSection(PACKAGE_CHANGELOG_FIXTURE);
    expect(result?.version).toBe('1.2.0');
    expect(result?.body).toContain('heading');
    expect(result?.body).toContain('DST-Uebergang');
    expect(result?.body).not.toContain('Erstes oeffentliches Changeset-Release');
  });

  it('gibt null zurück, wenn keine Versionsüberschrift existiert (noch nie versioniert)', () => {
    expect(extractLatestSection('# @yapaja/core\n\nNoch keine Releases.\n')).toBeNull();
  });

  it('funktioniert auch, wenn es nur EINEN Versionsabschnitt gibt (Dateiende statt nächster Überschrift)', () => {
    const singleSection = '# pkg\n\n## 1.0.0\n\n### Patch Changes\n\n- abc: erster Eintrag\n';
    const result = extractLatestSection(singleSection);
    expect(result?.version).toBe('1.0.0');
    expect(result?.body).toContain('erster Eintrag');
  });
});

describe('mergeIntoRootChangelog', () => {
  const rootFixture = [
    '# Changelog',
    '',
    'Kopftext, der unangetastet bleiben muss.',
    '',
    '## [Unreleased]',
    '',
    'Noch keine veröffentlichte Version.',
    '',
  ].join('\n');

  it('fügt den neuen Abschnitt direkt nach "## [Unreleased]" ein', () => {
    const updated = mergeIntoRootChangelog(rootFixture, '1.2.0', '- Neuer Parameter heading.', { date: '2026-08-06' });
    expect(updated).toContain('Kopftext, der unangetastet bleiben muss.');
    expect(updated).toContain('## [Unreleased]');
    expect(updated).toContain('## [1.2.0] - 2026-08-06');
    expect(updated).toContain('- Neuer Parameter heading.');
    // Reihenfolge: [Unreleased] -> [1.2.0] (neuestes Release direkt danach).
    expect(updated.indexOf('## [Unreleased]')).toBeLessThan(updated.indexOf('## [1.2.0]'));
  });

  it('ist idempotent: ein bereits vorhandener Abschnitt für dieselbe Version wird NICHT verdoppelt', () => {
    const onceMerged = mergeIntoRootChangelog(rootFixture, '1.2.0', '- Erster Merge.', { date: '2026-08-06' });
    const twiceMerged = mergeIntoRootChangelog(onceMerged, '1.2.0', '- Erster Merge.', { date: '2026-08-06' });
    expect(twiceMerged).toBe(onceMerged);
    expect(twiceMerged.match(/## \[1\.2\.0\]/g)?.length).toBe(1);
  });

  it('haengt an das Dateiende an, wenn keine "## [Unreleased]"-Überschrift existiert', () => {
    const withoutUnreleased = '# Changelog\n\nKein Unreleased-Abschnitt hier.\n';
    const updated = mergeIntoRootChangelog(withoutUnreleased, '2.0.0', '- Text.', { date: '2026-08-06' });
    expect(updated).toContain('## [2.0.0] - 2026-08-06');
  });
});

describe('extractRootSection (das, was release.yml als GitHub-Release-Body nimmt)', () => {
  it('extrahiert genau den Textkörper der angefragten Version', () => {
    const merged = mergeIntoRootChangelog(
      '# Changelog\n\n## [Unreleased]\n\nText.\n',
      '1.2.0',
      '- Neuer Parameter heading.',
      { date: '2026-08-06' },
    );
    expect(extractRootSection(merged, '1.2.0')).toBe('- Neuer Parameter heading.');
  });

  it('gibt null für eine Version ohne Abschnitt zurück', () => {
    expect(extractRootSection('# Changelog\n\n## [Unreleased]\n', '9.9.9')).toBeNull();
  });
});

describe('End-to-End (synthetisch): Paket-Changelog -> Root-Changelog', () => {
  it('übernimmt den neuesten Paket-Abschnitt vollständig in den Root-Changelog', () => {
    const rootFixture = '# Changelog\n\n## [Unreleased]\n\nNoch nichts.\n';
    const latest = extractLatestSection(PACKAGE_CHANGELOG_FIXTURE);
    expect(latest).not.toBeNull();
    const updated = mergeIntoRootChangelog(rootFixture, latest!.version, latest!.body, { date: '2026-08-06' });
    expect(updated).toContain('## [1.2.0] - 2026-08-06');
    expect(updated).toContain('Fix ETA-Rundung bei DST-Uebergang');
  });
});
