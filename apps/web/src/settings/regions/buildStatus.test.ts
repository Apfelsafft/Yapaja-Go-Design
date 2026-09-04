/**
 * Die Zeitangabe der Übersicht.
 *
 * „vor 3 Stunden" beantwortet die Frage, die man nach einem Bau hat („habe
 * ich das eben gemacht oder letzte Woche?"), besser als ein Datum. Weiter weg
 * ist es umgekehrt.
 */
import { describe, it, expect } from 'vitest';
import { formatBuiltAt } from './buildStatus';

const NOW = new Date('2026-09-04T12:00:00Z');
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatBuiltAt', () => {
  it('sagt nichts, wenn es keinen Zeitpunkt gibt', () => {
    expect(formatBuiltAt(undefined, NOW)).toBeNull();
  });

  it('sagt nichts bei einem unbrauchbaren Zeitpunkt', () => {
    expect(formatBuiltAt('gestern irgendwann', NOW)).toBeNull();
  });

  it('nennt Minuten, Stunden und Tage', () => {
    expect(formatBuiltAt(ago(30_000), NOW)).toBe('gerade eben');
    expect(formatBuiltAt(ago(1 * MIN), NOW)).toBe('vor 1 Minute');
    expect(formatBuiltAt(ago(42 * MIN), NOW)).toBe('vor 42 Minuten');
    expect(formatBuiltAt(ago(1 * HOUR), NOW)).toBe('vor 1 Stunde');
    expect(formatBuiltAt(ago(5 * HOUR), NOW)).toBe('vor 5 Stunden');
    expect(formatBuiltAt(ago(1 * DAY), NOW)).toBe('gestern');
    expect(formatBuiltAt(ago(3 * DAY), NOW)).toBe('vor 3 Tagen');
  });

  it('nennt weiter zurueck das Datum', () => {
    const out = formatBuiltAt(ago(30 * DAY), NOW);
    expect(out).toMatch(/^am /);
  });

  /**
   * Ein Zeitpunkt in der Zukunft (Zeitzone, NTP-Sprung) ist verdaechtig. Dann
   * ist das DATUM die ehrlichere Auskunft als eine relative Angabe.
   *
   * Frueher stand hier nur „enthaelt kein Minus". Das bestand auch ohne die
   * Pruefung: ohne sie faellt der Wert auf „gerade eben" durch, und darin
   * kommt ebenfalls kein Minus vor. Ein Test, der jeden Ausgang durchlaesst,
   * prueft nichts.
   */
  it('zeigt bei einem Zeitpunkt in der Zukunft das Datum statt einer relativen Angabe', () => {
    const out = formatBuiltAt(new Date(NOW.getTime() + 5 * HOUR).toISOString(), NOW);
    expect(out).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/);
    expect(out).not.toContain('gerade eben');
    expect(out).not.toContain('-');
  });
});
