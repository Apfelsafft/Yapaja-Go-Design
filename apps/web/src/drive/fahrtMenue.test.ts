/**
 * Was das Fahrtmenü als Zwischenstopp anbietet.
 */

import { describe, it, expect } from 'vitest';
import { stoppAuswahl, VERLAUF_IM_MENUE } from './FahrtMenue.js';

const fav = (id: string, lat: number, name = `Fav ${id}`) => ({
  id,
  name,
  latlng: { lat, lon: 9 },
  category: 'poi' as const,
});
const hist = (id: string, lat: number | null, name: string | null = `Ziel ${id}`) => ({
  id,
  destination: lat === null ? null : { latlng: { lat, lon: 9 }, name },
});

describe('stoppAuswahl', () => {
  it('Favoriten zuerst, dann der Verlauf', () => {
    const raus = stoppAuswahl([fav('a', 47)], [hist('h1', 48)]);
    expect(raus.map((r) => r.schluessel)).toEqual(['fav-a', 'hist-h1']);
  });

  it('bietet dieselbe Stelle nicht zweimal an', () => {
    // Wer den Stellplatz als Favoriten hat und gestern dort war, soll ihn
    // einmal sehen, nicht zweimal untereinander.
    const raus = stoppAuswahl([fav('a', 47)], [hist('h1', 47)]);
    expect(raus).toHaveLength(1);
  });

  it('nimmt aus dem Verlauf nur Ziele, keine reinen Suchbegriffe', () => {
    expect(stoppAuswahl([], [hist('q', null)])).toEqual([]);
  });

  it('begrenzt den Verlauf', () => {
    const verlauf = Array.from({ length: VERLAUF_IM_MENUE + 3 }, (_, i) => hist(`h${i}`, 40 + i));
    expect(stoppAuswahl([], verlauf)).toHaveLength(VERLAUF_IM_MENUE);
  });

  it('gibt einem namenlosen Ziel die Koordinaten als Namen', () => {
    const [eins] = stoppAuswahl([], [hist('h', 47.5, null)]);
    expect(eins!.name).toBe('47.5000, 9.0000');
  });
});
