/**
 * Die zweite Zeile eines Suchvorschlags.
 *
 * Gemeldet: „Wenn ich Rewe eintippe und er mehrere Rewe in meinem Umkreis
 * findet, dann gib bitte die Adresse und ungefähre Entfernung mit an. Wenn ich
 * Beethoven eintippe, gib bitte den Ort mit an."
 *
 * Bis 0.3.8 stand dort `label`, und der Lite-Index setzte `label` auf den
 * NAMEN -- jeder Vorschlag zeigte denselben Text zweimal untereinander.
 */

import { describe, it, expect } from 'vitest';
import type { SearchResult } from '@yapaja/shared';
import { secondaryLine } from './secondaryLine';

function result(partial: Partial<SearchResult>): SearchResult {
  return {
    name: 'REWE',
    label: 'REWE',
    latlng: { lat: 49.6, lon: 8.1 },
    type: 'supermarket',
    source: 'lite',
    ...partial,
  };
}

describe('secondaryLine', () => {
  it('zeigt Adresse und Ort, wenn beide da sind', () => {
    expect(secondaryLine(result({ address: 'Kaiserstraße 7', locality: 'Worms' }))).toBe(
      'Kaiserstraße 7, Worms',
    );
  });

  it('zeigt den Ort allein, wenn es keine Adresse gibt', () => {
    expect(secondaryLine(result({ locality: 'Mannheim' }))).toBe('Mannheim');
  });

  /** Der Fall aus der Meldung: mehrere Treffer gleichen Namens muessen sich
   *  in dieser Zeile unterscheiden, sonst ist die Liste wertlos. */
  it('unterscheidet zwei gleichnamige Treffer', () => {
    const a = secondaryLine(result({ address: 'Kaiserstraße 7', locality: 'Worms' }));
    const b = secondaryLine(result({ locality: 'Mannheim' }));
    expect(a).not.toBe(b);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  /**
   * ─── KEINE ZEILE IST BESSER ALS EINE LEERE ────────────────────────────────
   * Ein wiederholter Name sieht aus wie ein Fehler, eine leere Zeile wie ein
   * fehlender Wert. Genau das war der Zustand vorher.
   */
  it('laesst die Zeile weg, wenn label nur den Namen wiederholt', () => {
    expect(secondaryLine(result({ name: 'Vaduz', label: 'Vaduz' }))).toBeNull();
  });

  it('laesst die Zeile weg, wenn es gar nichts zu sagen gibt', () => {
    expect(secondaryLine(result({ name: 'Vaduz', label: '' }))).toBeNull();
  });

  /** Photon und Nominatim liefern eine fertige Bezeichnung -- die bleibt. */
  it('reicht die Bezeichnung anderer Backends unveraendert durch', () => {
    expect(
      secondaryLine(
        result({ name: 'Vaduz', label: 'Vaduz, Liechtenstein', source: 'photon' }),
      ),
    ).toBe('Vaduz, Liechtenstein');
  });

  it('ignoriert leere und nur aus Leerzeichen bestehende Angaben', () => {
    expect(secondaryLine(result({ address: '   ', locality: '', label: 'REWE' }))).toBeNull();
  });
});
