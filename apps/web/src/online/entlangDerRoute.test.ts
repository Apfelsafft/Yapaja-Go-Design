import { describe, expect, it } from 'vitest';
import { lageAufRoute, meldungenEntlang, naechsteMeldungen, routenLinie } from './entlangDerRoute.js';
import type { KartenMeldung } from './verkehrGeoJson.js';

// Eine gerade Route nach Norden, 10 km lang, bei 49° Breite.
const LINIE = routenLinie(Array.from({ length: 11 }, (_, i) => [8.5, 49 + i * 0.009] as const));

const meldung = (id: string, lat: number, lon: number): KartenMeldung => ({
  id,
  art: 'baustelle',
  strasse: 'A 5',
  titel: id,
  beschreibung: '',
  lat,
  lon,
  symbol: 'verkehr-baustelle',
});

describe('entlangDerRoute', () => {
  it('misst Abstand daneben und Strecke entlang', () => {
    const l = lageAufRoute(LINIE, 49.045, 8.5 + 0.0041)!; // ~300 m östlich, ~5 km weit
    expect(l.daneben_m).toBeGreaterThan(250);
    expect(l.daneben_m).toBeLessThan(350);
    expect(l.entlang_m).toBeGreaterThan(4900);
    expect(l.entlang_m).toBeLessThan(5100);
  });

  it('lässt Meldungen weit neben der Route weg', () => {
    const r = meldungenEntlang(
      [meldung('dran', 49.02, 8.5), meldung('weg', 49.02, 8.6), meldung('ohne', NaN, NaN)],
      LINIE,
    );
    expect(r.map((x) => x.meldung.id)).toEqual(['dran']);
  });

  it('die nächsten fünf voraus, nach Abstand, Vergangenes fällt weg', () => {
    const alle = meldungenEntlang(
      Array.from({ length: 9 }, (_, i) => meldung(`m${i}`, 49 + i * 0.01, 8.5)),
      LINIE,
    );
    const r = naechsteMeldungen(alle, 2500);
    expect(r).toHaveLength(5);
    // m2 liegt bei ~2,2 km, also ~270 m hinter uns: vorbei.
    expect(r[0]!.meldung.id).toBe('m3');
    expect(r.map((x) => x.voraus_m)).toEqual([...r.map((x) => x.voraus_m)].sort((a, b) => a - b));
    expect(r.some((x) => ['m0', 'm1', 'm2'].includes(x.meldung.id))).toBe(false);
  });
});
