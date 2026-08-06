/**
 * Tests fuer das W-ID-Abgleich-Skript (E10-T5 Pflicht-Test).
 *
 * Zwei Dinge muessen belegt sein: (1) die Ableitung der Pflichtliste aus
 * docs/08-wargame.md funktioniert korrekt und ist NICHT hartkodiert --
 * getestet mit einem synthetischen Wargame-Dokument, nicht nur gegen den
 * heutigen Datei-Stand; (2) der ECHTE Repo-Stand ist heute vollstaendig
 * abgedeckt (der Beweis, den Akzeptanzkriterium 3 der Aufgabe verlangt).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  extractWargameEntries,
  requiredWIds,
  extractDocumentedWIds,
  findMissing,
  findExtra,
  WARGAME_PATH,
  TROUBLESHOOTING_PATH,
} from './wargame-coverage.mjs';

const SYNTHETIC_WARGAME = `
# Wargame

### W-01 🟠 Erster Fall
Text.

### W-02 🔴 Zweiter Fall
Text.

### W-03 🟡 Dritter Fall (nur Komfort)
Text.

### W-10 🟠 Zehnter Fall
Text.
`;

describe('extractWargameEntries', () => {
  it('findet jede Wargame-Ueberschrift mit ID, Schweregrad und Titel', () => {
    const entries = extractWargameEntries(SYNTHETIC_WARGAME);
    expect(entries).toEqual([
      { id: 'W-01', severity: '🟠', title: 'Erster Fall' },
      { id: 'W-02', severity: '🔴', title: 'Zweiter Fall' },
      { id: 'W-03', severity: '🟡', title: 'Dritter Fall (nur Komfort)' },
      { id: 'W-10', severity: '🟠', title: 'Zehnter Fall' },
    ]);
  });
});

describe('requiredWIds', () => {
  it('nimmt nur 🔴 und 🟠 auf, sortiert numerisch nach ID (nicht alphabetisch)', () => {
    // W-02 vor W-10 waere bei alphabetischer Sortierung falsch ("W-10" < "W-02" als String).
    expect(requiredWIds(SYNTHETIC_WARGAME)).toEqual(['W-01', 'W-02', 'W-10']);
  });

  it('lässt 🟡-Faelle konsequent aussen vor', () => {
    expect(requiredWIds(SYNTHETIC_WARGAME)).not.toContain('W-03');
  });

  it('reagiert auf eine geaenderte Einstufung ohne Code-Aenderung (kein Hardcoding)', () => {
    const upgraded = SYNTHETIC_WARGAME.replace('### W-03 🟡 Dritter Fall', '### W-03 🟠 Dritter Fall');
    expect(requiredWIds(upgraded)).toContain('W-03');
  });

  it('reagiert auf einen neu hinzugefuegten Fall ohne Code-Aenderung', () => {
    const withNewCase = SYNTHETIC_WARGAME + '\n### W-42 🔴 Neuer Fall\nText.\n';
    expect(requiredWIds(withNewCase)).toContain('W-42');
  });
});

describe('extractDocumentedWIds', () => {
  it('erkennt "## W-nn — ..."-Ueberschriften im Troubleshooting-Doc', () => {
    const md = '## W-01 — Titel eins\n\nText.\n\n## W-14 — Titel zwei\n\nText.\n';
    expect(extractDocumentedWIds(md)).toEqual(new Set(['W-01', 'W-14']));
  });

  it('zaehlt eine blosse Erwaehnung im Fliesstext NICHT als Abdeckung', () => {
    const md = '## W-01 — Titel\n\nSiehe auch W-14 fuer einen aehnlichen Fall.\n';
    const documented = extractDocumentedWIds(md);
    expect(documented.has('W-01')).toBe(true);
    expect(documented.has('W-14')).toBe(false);
  });
});

describe('findMissing / findExtra', () => {
  it('findMissing liefert genau die Pflichtfaelle ohne Dokumentation', () => {
    expect(findMissing(['W-01', 'W-02', 'W-10'], new Set(['W-01', 'W-10']))).toEqual(['W-02']);
  });

  it('findExtra meldet dokumentierte, aber nicht pflichtige Faelle (informativ)', () => {
    expect(findExtra(['W-01'], new Set(['W-01', 'W-99']))).toEqual(['W-99']);
  });
});

describe('Realer Repo-Stand (der eigentliche Beweis fuer Akzeptanzkriterium 3)', () => {
  it('jeder 🔴/🟠-Fall aus docs/08-wargame.md hat einen Abschnitt in docs/troubleshooting.md', () => {
    const wargameMd = readFileSync(WARGAME_PATH, 'utf-8');
    const troubleshootingMd = readFileSync(TROUBLESHOOTING_PATH, 'utf-8');

    const required = requiredWIds(wargameMd);
    const documented = extractDocumentedWIds(troubleshootingMd);
    const missing = findMissing(required, documented);

    expect(missing).toEqual([]);
  });

  it('die geforderte Liste ist NICHT leer (kein Grün durch eine kaputte Extraktion)', () => {
    const wargameMd = readFileSync(WARGAME_PATH, 'utf-8');
    expect(requiredWIds(wargameMd).length).toBeGreaterThan(0);
  });

  it('die geforderte Liste entspricht genau der vom Orchestrator vorgegebenen W-ID-Menge', () => {
    const wargameMd = readFileSync(WARGAME_PATH, 'utf-8');
    const expected = [
      'W-01', 'W-02', 'W-03', 'W-05', 'W-06', 'W-08', 'W-09', 'W-10',
      'W-11', 'W-12', 'W-14', 'W-15', 'W-16', 'W-18', 'W-19', 'W-22',
    ];
    expect(requiredWIds(wargameMd)).toEqual(expected);
  });
});
