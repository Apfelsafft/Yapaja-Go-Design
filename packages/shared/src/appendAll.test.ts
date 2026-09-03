/**
 * Der Fehler, den diese Datei festhält, hat den Betreiber getroffen und nicht
 * uns — und zwar aus einem Grund, der sich wiederholen wird, wenn man ihn
 * nicht ausdrücklich adressiert: **er hängt an der Datenmenge**.
 *
 * `allRecords.push(...records)` lief für Liechtenstein (3 189 Datensätze)
 * jahrelang durch, in jeder CI und auf jedem Gerät. Rheinland-Pfalz brachte
 * es zum Absturz:
 *
 *     build-lite-index CLI fehlgeschlagen: Maximum call stack size exceeded
 *
 * Ein Test mit einer kleinen Beispielregion hätte das nie gesehen. Deshalb
 * arbeitet dieser hier ausdrücklich OBERHALB der Grenze — das ist der ganze
 * Zweck der Datei, und sie darf nicht auf eine bequemere Größe verkleinert
 * werden.
 */

import { describe, it, expect } from 'vitest';
import { appendAll } from './appendAll';

/**
 * Über V8s Argumentgrenze. Die liegt je nach Build und Stapeltiefe grob bei
 * 65 000 bis 125 000; 200 000 ist sicher darüber und kostet als reine
 * Zahlenliste kaum Zeit.
 */
const ABOVE_ARGUMENT_LIMIT = 200_000;

describe('appendAll', () => {
  it('hängt eine kurze Liste an', () => {
    const target = [1, 2];
    expect(appendAll(target, [3, 4])).toBe(target);
    expect(target).toEqual([1, 2, 3, 4]);
  });

  it('kommt mit einer leeren Quelle und einem leeren Ziel zurecht', () => {
    expect(appendAll([1], [])).toEqual([1]);
    expect(appendAll([], [1])).toEqual([1]);
    expect(appendAll([], [])).toEqual([]);
  });

  // ─── DER EIGENTLICHE PUNKT ────────────────────────────────────────────────
  it(`hängt ${ABOVE_ARGUMENT_LIMIT} Elemente an, ohne den Aufrufstapel zu sprengen`, () => {
    const source = Array.from({ length: ABOVE_ARGUMENT_LIMIT }, (_, i) => i);
    const target: number[] = [];

    expect(() => appendAll(target, source)).not.toThrow();
    expect(target.length).toBe(ABOVE_ARGUMENT_LIMIT);
    expect(target[0]).toBe(0);
    expect(target[ABOVE_ARGUMENT_LIMIT - 1]).toBe(ABOVE_ARGUMENT_LIMIT - 1);
  });

  /**
   * Und der Gegenbeweis — selbstkalibrierend statt mit fester Zahl.
   *
   * Erster Versuch hier war `expect(() => target.push(...200k)).toThrow()`.
   * Der fiel durch: unter Vitest überstand `push` dieselbe Menge, die das
   * echte Programm zum Absturz gebracht hat. Das ist kein Widerspruch,
   * sondern die Eigenschaft des Fehlers — die Grenze hängt am RESTLICHEN
   * Aufrufstapel, und der ist tief in einer Anwendung kleiner als in einem
   * Test. Eine feste Zahl prüft hier also nur die Laufzeit des Testlaufs.
   *
   * Deshalb sucht dieser Test die Grenze der aktuellen Umgebung selbst und
   * hält `appendAll` genau dagegen. Damit beweist er, was zählt — `appendAll`
   * trägt mehr als `push` — und zwar auf jeder Laufzeit, ohne gepflegte
   * Schwellenwerte.
   */
  it('trägt mindestens so viel wie push, und mehr als dessen Grenze', () => {
    let limit: number | null = null;
    for (let n = 1 << 14; n <= 1 << 22; n *= 2) {
      const probe = Array.from({ length: n }, (_, i) => i);
      try {
        ([] as number[]).push(...probe);
      } catch {
        limit = n;
        break;
      }
    }

    if (limit === null) {
      // Keine Grenze gefunden — dann gibt es auf DIESER Laufzeit nichts
      // gegenzubeweisen. Der Test oben prüft `appendAll` trotzdem weiter.
      // Bewusst kein Fehlschlag: das wäre eine Beschwerde über die Laufzeit,
      // nicht über unseren Code.
      expect(appendAll([], Array.from({ length: 1 << 20 }, (_, i) => i)).length).toBe(1 << 20);
      return;
    }

    // Bei genau der Menge, an der `push` zerbricht, muss `appendAll` tragen.
    const source = Array.from({ length: limit }, (_, i) => i);
    const target: number[] = [];
    expect(() => appendAll(target, source)).not.toThrow();
    expect(target.length).toBe(limit);
  });
});
