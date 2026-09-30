/**
 * Bordhinweise: Anzeigetext und wann ein Hinweis „derselbe" ist.
 */

import { describe, it, expect } from 'vitest';
import { hinweisSchluessel, stationsZeile } from './bordStore.js';

const station = (voraus_m: number | null, abseits_m: number) => ({
  name: 'Entsorgung Musterhof',
  lat: 47.1234,
  lon: 9.5678,
  voraus_m,
  abseits_m,
});

describe('stationsZeile', () => {
  it('direkt an der Strecke: nur der Weg dorthin', () => {
    expect(stationsZeile(station(12_400, 80))).toBe('Entsorgung Musterhof — in 12 km an der Strecke');
  });

  it('etwas abseits: beides', () => {
    expect(stationsZeile(station(3_450, 420))).toBe('Entsorgung Musterhof — in 3,5 km, 420 m neben der Strecke');
  });

  it('ohne Route: die Luftlinie', () => {
    expect(stationsZeile(station(null, 8_000))).toBe('Entsorgung Musterhof — 8,0 km entfernt');
  });
});

describe('hinweisSchluessel', () => {
  it('hängt nicht am Füllstand -- 81 % und 83 % sind derselbe Hinweis', () => {
    // Der Wert steht gar nicht im Schlüssel: wer „Später" getippt hat, soll
    // ihn nicht bei jedem Prozentpunkt neu sehen.
    expect(hinweisSchluessel({ art: 'grauwasser', station: station(1000, 0) })).toBe(
      hinweisSchluessel({ art: 'grauwasser', station: station(900, 0) }),
    );
  });

  it('eine andere Station ist ein neuer Hinweis', () => {
    expect(hinweisSchluessel({ art: 'grauwasser', station: station(1000, 0) })).not.toBe(
      hinweisSchluessel({ art: 'grauwasser', station: { ...station(1000, 0), lat: 48 } }),
    );
  });
});
