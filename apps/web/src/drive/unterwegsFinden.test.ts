/**
 * „Unterwegs finden": was gesagt wird, wenn nichts gefunden wurde.
 */

import { describe, it, expect } from 'vitest';
import { nichtsGefunden } from './UnterwegsFinden.js';

const kategorie = { id: 'fuel', name: 'Tankstelle', symbol: '⛽' };

describe('nichtsGefunden', () => {
  it('nennt den Grund -- „keine" ist nicht dasselbe wie „konnte nicht suchen"', () => {
    expect(nichtsGefunden({ kategorie, bezug: 'route', treffer: [] })).toBe(
      'Keine Tankstelle in den nächsten 80 km an der Strecke.',
    );
    expect(nichtsGefunden({ kategorie, bezug: 'position', treffer: [] })).toBe(
      'Keine Tankstelle im Umkreis von 25 km.',
    );
    expect(nichtsGefunden({ kategorie, bezug: 'keiner', treffer: [] })).toBe(
      'Ohne Position lässt sich keine Tankstelle in der Nähe suchen.',
    );
  });
});
