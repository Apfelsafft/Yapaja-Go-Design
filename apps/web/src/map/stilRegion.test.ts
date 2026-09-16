/**
 * Welche Region in die Stil-Anfrage geht.
 *
 * ─── WARUM ES DIESE PRÜFUNGEN GIBT ──────────────────────────────────────────
 * Die Mehrregionen-Karte aus 0.9.1 war vollständig wirkungslos, weil EINE
 * Zeile in `MapView` die Region der aktuellen Position einsetzte. Gemeldet
 * wurde „Sehe aber nur Deutschland".
 *
 * Eine Mutation hat das danach überlebt: `fetchStyle` war geprüft, die
 * Entscheidung darüber nicht — sie stand in einem React-Baustein, den kein
 * Test berührt. Deshalb hat sie jetzt einen Namen und diese Zusicherungen.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stilRegion } from './stilRegion';

describe('stilRegion', () => {
  // ─── DIE ZUSICHERUNG, DIE GEFEHLT HAT ─────────────────────────────────────
  it('nennt KEINE Region, wenn keine fest gewählt ist', () => {
    // `undefined` heißt für den Kern: alle installierten zeichnen.
    expect(stilRegion({ manuell: null })).toBeUndefined();
  });

  it('ignoriert die Region der aktuellen Position', () => {
    // Genau das war der Fehler. `aktiv` ist für „wo bin ich" richtig und für
    // „was wird gezeichnet" falsch — hier darf sie nichts bewirken.
    expect(stilRegion({ manuell: null, aktiv: 'germany' })).toBeUndefined();
  });

  it('nimmt die feste Wahl, wenn es eine gibt', () => {
    // Die Gegenrichtung: sonst liesse sich die Regel oben dadurch
    // „erfüllen", dass gar keine Region mehr ankommt und die feste Wahl
    // wirkungslos wird.
    expect(stilRegion({ manuell: 'switzerland' })).toBe('switzerland');
  });

  it('lässt die feste Wahl auch dann gelten, wenn man woanders steht', () => {
    // „Nur diese" ist für die Planung gedacht — eine Gegend aufschlagen, in
    // der man gerade nicht ist.
    expect(stilRegion({ manuell: 'switzerland', aktiv: 'germany' })).toBe('switzerland');
  });

  it('behandelt eine leere Wahl wie „keine"', () => {
    // Sonst entstünde ein `?region=`, zu dem der Kern nichts findet — eine
    // leere Karte ohne Fehlermeldung.
    expect(stilRegion({ manuell: '' })).toBeUndefined();
    expect(stilRegion({ manuell: '   ' })).toBeUndefined();
  });
});

/**
 * ─── EINE WACHE, KEINE VERHALTENSPRÜFUNG ────────────────────────────────────
 * `stilRegion` zu prüfen genügt nicht: `MapView` könnte sie schlicht umgehen
 * und wieder `activeRegionName` einsetzen. Genau das war der Fehler, und eine
 * Mutation davon hat alle bisherigen Zusicherungen überlebt — der Baustein
 * ist ein React-Bauteil, das kein Test anfasst.
 *
 * Diese Prüfung liest deshalb den Quelltext. Das ist normalerweise ein
 * schlechtes Zeichen, und sie kann auch nur DIESEN einen Fehler fangen,
 * nicht „die Karte zeigt zu wenig" im Allgemeinen. Sie steht hier, weil der
 * Fehler lautlos ist, zweimal aufgetreten wäre und sich in einer Zeile
 * beschreiben lässt.
 */
describe('MapView umgeht die Entscheidung nicht', () => {
  it('reicht `activeRegionName` NICHT in die Stil-Anfrage', () => {
    const quelle = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'MapView.tsx'),
      'utf8',
    );
    const aufrufe = quelle.match(/fetchStyle\([^)]*\)/g) ?? [];
    expect(aufrufe.length, 'kein fetchStyle gefunden — Prüfung wäre wirkungslos').toBeGreaterThan(
      0,
    );
    for (const aufruf of aufrufe) {
      expect(
        aufruf,
        'Die Stil-Anfrage bekommt die Region der aktuellen Position. Dann zeichnet ' +
          'der Kern genau EINE Region statt aller — lautlos. Siehe stilRegion.ts.',
      ).not.toContain('activeRegionName');
    }
  });

  it('benutzt `stilRegion` überhaupt', () => {
    const quelle = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'MapView.tsx'),
      'utf8',
    );
    expect(quelle).toContain('stilRegion(');
  });
});
