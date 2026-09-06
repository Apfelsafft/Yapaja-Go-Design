/**
 * Tests fuer das erzwungene Breaking-Change-Feld (E10-T5 Plausibilitaet).
 * Der entscheidende Fall ist wieder der ROTE: ein major-Bump auf eine
 * Add-on-API ohne Breaking-Change-Abschnitt MUSS durchfallen -- ein Gate,
 * das nur den heutigen (leeren) Zustand grün zeigt, beweist nichts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseChangesetFile,
  requiresBreakingSection,
  hasBreakingSection,
  checkChangesetContent,
  ADDON_API_PACKAGES,
} from './changeset-breaking-check.mjs';

const withBreakingSection = `---
"@yapaia/core": major
---

Core-API: \`/api/v1/navigation/destination\` verlangt jetzt zwingend \`profile_id\`.

## Breaking Change

Add-ons, die \`profile_id\` bisher weggelassen haben (implizites Default-Profil),
müssen es ab dieser Version explizit mitschicken. Betrifft \`core_api\` < 2.0.
`;

const withoutBreakingSection = `---
"@yapaia/core": major
---

Core-API: \`/api/v1/navigation/destination\` verlangt jetzt zwingend \`profile_id\`.
`;

const minorBumpOnly = `---
"@yapaia/core": minor
---

Neuer optionaler Parameter, rückwärtskompatibel.
`;

const majorOnUnrelatedPackage = `---
"@yapaia/web": major
---

Internes UI-Refactoring, keine Add-on-API betroffen.
`;

describe('parseChangesetFile', () => {
  it('liest Paket -> Bump-Zuordnungen aus dem Frontmatter', () => {
    const parsed = parseChangesetFile(withBreakingSection);
    expect(parsed?.bumps).toEqual({ '@yapaia/core': 'major' });
    expect(parsed?.body).toContain('## Breaking Change');
  });

  it('gibt null für Dateien ohne Changeset-Frontmatter zurück (z. B. README.md)', () => {
    expect(parseChangesetFile('# Changesets\n\nSiehe https://github.com/changesets/changesets\n')).toBeNull();
  });

  it('liest mehrere Pakete aus einem Changeset', () => {
    const raw = '---\n"@yapaia/core": major\n"@yapaia/addon-sdk": major\n---\n\nText.\n';
    expect(parseChangesetFile(raw)?.bumps).toEqual({ '@yapaia/core': 'major', '@yapaia/addon-sdk': 'major' });
  });
});

describe('requiresBreakingSection', () => {
  it('verlangt den Abschnitt bei major auf @yapaia/core', () => {
    expect(requiresBreakingSection({ '@yapaia/core': 'major' })).toBe(true);
  });

  it('verlangt den Abschnitt bei major auf @yapaia/addon-sdk', () => {
    expect(requiresBreakingSection({ '@yapaia/addon-sdk': 'major' })).toBe(true);
  });

  it('verlangt ihn NICHT bei minor/patch', () => {
    expect(requiresBreakingSection({ '@yapaia/core': 'minor' })).toBe(false);
    expect(requiresBreakingSection({ '@yapaia/core': 'patch' })).toBe(false);
  });

  it('verlangt ihn NICHT bei major auf einem Nicht-Add-on-API-Paket', () => {
    expect(requiresBreakingSection({ '@yapaia/web': 'major' })).toBe(false);
    expect(requiresBreakingSection({ '@yapaia/shared': 'major' })).toBe(false);
  });

  it('deckt genau die zwei dokumentierten Add-on-API-Pakete ab', () => {
    expect(ADDON_API_PACKAGES).toEqual(['@yapaia/core', '@yapaia/addon-sdk']);
  });
});

describe('hasBreakingSection', () => {
  it('erkennt die Pflicht-Überschrift', () => {
    expect(hasBreakingSection('Text.\n\n## Breaking Change\n\nDetails.\n')).toBe(true);
  });

  it('erkennt sie NICHT, wenn "breaking" nur im Fließtext vorkommt (keine echte Überschrift)', () => {
    expect(hasBreakingSection('Dies ist eine breaking Änderung, aber ohne Überschrift.\n')).toBe(false);
  });
});

describe('checkChangesetContent (der eigentliche Gate-Check)', () => {
  it('GRÜN: major auf @yapaia/core MIT Breaking-Change-Abschnitt', () => {
    expect(checkChangesetContent(withBreakingSection)).toEqual({ ok: true, skipped: false });
  });

  it('ROT: major auf @yapaia/core OHNE Breaking-Change-Abschnitt', () => {
    const result = checkChangesetContent(withoutBreakingSection);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('GRÜN: minor-Bump braucht keinen Abschnitt', () => {
    expect(checkChangesetContent(minorBumpOnly)).toEqual({ ok: true, skipped: false });
  });

  it('GRÜN: major auf einem Nicht-Add-on-API-Paket braucht keinen Abschnitt', () => {
    expect(checkChangesetContent(majorOnUnrelatedPackage)).toEqual({ ok: true, skipped: false });
  });

  it('übersprungen (kein Fehler) bei Nicht-Changeset-Dateien', () => {
    expect(checkChangesetContent('# Changesets\n')).toEqual({ ok: true, skipped: true });
  });
});
