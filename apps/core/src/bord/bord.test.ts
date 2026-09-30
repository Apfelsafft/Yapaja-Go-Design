/**
 * Bordsensoren: Regeln, Hysterese, Stationssuche voraus, Dienst.
 */

import { describe, it, expect } from 'vitest';
import { bordBefunde, haZahl, HYSTERESE, STANDARD_SCHWELLEN, type BordArt } from './regeln.js';
import { naechsteStationen, KORRIDOR_M } from './entlangRoute.js';
import { BordDienst, bordKonfigurationAusUmgebung } from './dienst.js';
import { buildRouteGeometryFromPoints } from '../navigation/mapMatching.js';

const leer = { grauwasser_prozent: null, frischwasser_prozent: null, batterie_prozent: null, aussentemperatur_c: null };
const arten = (b: { art: BordArt }[]) => b.map((x) => x.art);

describe('bordBefunde', () => {
  it('meldet jede Art an ihrer Schwelle', () => {
    const b = bordBefunde(
      { grauwasser_prozent: 80, frischwasser_prozent: 20, batterie_prozent: 30, aussentemperatur_c: 1 },
      STANDARD_SCHWELLEN,
    );
    expect(arten(b)).toEqual(['grauwasser', 'frischwasser', 'batterie', 'frost']);
  });

  it('meldet nichts, solange alles im grünen Bereich ist', () => {
    const b = bordBefunde(
      { grauwasser_prozent: 79, frischwasser_prozent: 21, batterie_prozent: 31, aussentemperatur_c: 1.1 },
      STANDARD_SCHWELLEN,
    );
    expect(b).toEqual([]);
  });

  it('flackert nicht: ein aktiver Hinweis erlischt erst nach der Hysterese', () => {
    // Der Tank schwappt zwischen 79 und 81 -- ohne Hysterese käme der Hinweis
    // jede Minute neu.
    const an = new Set<BordArt>(['grauwasser']);
    expect(arten(bordBefunde({ ...leer, grauwasser_prozent: 79 }, STANDARD_SCHWELLEN, an))).toEqual(['grauwasser']);
    expect(
      arten(bordBefunde({ ...leer, grauwasser_prozent: 80 - HYSTERESE.prozent - 1 }, STANDARD_SCHWELLEN, an)),
    ).toEqual([]);
  });

  it('dasselbe nach unten (Frischwasser)', () => {
    const an = new Set<BordArt>(['frischwasser']);
    expect(arten(bordBefunde({ ...leer, frischwasser_prozent: 24 }, STANDARD_SCHWELLEN, an))).toEqual([
      'frischwasser',
    ]);
    expect(arten(bordBefunde({ ...leer, frischwasser_prozent: 26 }, STANDARD_SCHWELLEN, an))).toEqual([]);
  });

  it('ein unbekannter Wert löst nie etwas aus und lässt einen aktiven Hinweis erlöschen', () => {
    const an = new Set<BordArt>(['grauwasser']);
    expect(bordBefunde(leer, STANDARD_SCHWELLEN, an)).toEqual([]);
  });

  it('schreibt die Temperatur mit Komma', () => {
    const [f] = bordBefunde({ ...leer, aussentemperatur_c: -0.5 }, STANDARD_SCHWELLEN);
    expect(f!.text).toContain('-0,5 °C');
  });
});

describe('haZahl', () => {
  it('liest Zahlen, auch mit Komma', () => {
    expect(haZahl('83')).toBe(83);
    expect(haZahl('12,5')).toBe(12.5);
  });
  it('„unknown", „unavailable", leer und Unsinn sind null -- nicht 0', () => {
    for (const z of ['unknown', 'unavailable', '', 'voll', undefined, null]) expect(haZahl(z)).toBeNull();
  });
});

describe('naechsteStationen', () => {
  // Eine Strecke 20 km nach Norden.
  const geom = buildRouteGeometryFromPoints(
    Array.from({ length: 21 }, (_, i) => ({ lat: 47 + i * 0.009, lon: 9 })),
  );
  const ost = (lat: number, m: number) => ({ lat, lon: 9 + m / 75_800 });

  it('nimmt die nächste VORAUS, nicht die nächste insgesamt', () => {
    const hinten = { name: 'hinten', ...ost(47.02, 100) }; // ~2 km, schon vorbei
    const vorn = { name: 'vorn', ...ost(47.09, 100) }; // ~10 km
    const weiter = { name: 'weiter', ...ost(47.14, 100) };
    const [erste] = naechsteStationen([weiter, hinten, vorn], { route: { geom, progressM: 5_000 }, position: null });
    expect(erste!.name).toBe('vorn');
    expect(erste!.voraus_m).toBeGreaterThan(4_000);
    expect(erste!.voraus_m).toBeLessThan(6_000);
  });

  it('lässt weg, was zu weit abseits liegt', () => {
    const abseits = { name: 'abseits', ...ost(47.09, KORRIDOR_M + 1_000) };
    expect(naechsteStationen([abseits], { route: { geom, progressM: 0 }, position: null })).toEqual([]);
  });

  it('ohne Route: Luftlinie ab der Position', () => {
    const nah = { name: 'nah', lat: 47.01, lon: 9 };
    const fern = { name: 'fern', lat: 48, lon: 9 };
    const r = naechsteStationen([fern, nah], { route: null, position: { lat: 47, lon: 9 } });
    expect(r.map((x) => x.name)).toEqual(['nah']);
    expect(r[0]!.voraus_m).toBeNull();
  });

  it('ohne Route und ohne Position: nichts', () => {
    expect(naechsteStationen([{ name: 'x', lat: 47, lon: 9 }], { route: null, position: null })).toEqual([]);
  });
});

describe('bordKonfigurationAusUmgebung', () => {
  it('nimmt Entitäten und Schwellen, ignoriert Unsinn', () => {
    const k = bordKonfigurationAusUmgebung({
      YAPAIA_BORD_GRAUWASSER: 'sensor.grauwasser',
      YAPAIA_BORD_FRISCHWASSER: 'kein sensor',
      YAPAIA_BORD_GRAUWASSER_AB: '70',
      YAPAIA_BORD_FROST_BIS: 'abc',
    });
    expect(k.entitaeten).toEqual({ grauwasser: 'sensor.grauwasser' });
    expect(k.schwellen.grauwasser_ab_prozent).toBe(70);
    expect(k.schwellen.frost_bis_c).toBe(STANDARD_SCHWELLEN.frost_bis_c);
  });
});

describe('BordDienst', () => {
  const konfiguration = {
    entitaeten: { grauwasser: 'sensor.grau', frischwasser: 'sensor.frisch' },
    schwellen: STANDARD_SCHWELLEN,
  };

  it('verbindet Lesen, Regeln und die passende Station', async () => {
    const dienst = new BordDienst({
      konfiguration,
      leseZustaende: async () => new Map([['sensor.grau', '88'], ['sensor.frisch', '60']]),
      stationen: (k) => (k === 'sanitary_dump_station' ? [{ name: 'Station', lat: 47.01, lon: 9 }] : []),
      ort: () => ({ route: null, position: { lat: 47, lon: 9 } }),
      jetzt: () => new Date('2026-09-29T10:00:00Z'),
    });
    const z = await dienst.aktualisiere();
    expect(z.werte.grauwasser_prozent).toBe(88);
    expect(z.hinweise).toHaveLength(1);
    expect(z.hinweise[0]!.station?.name).toBe('Station');
    expect(z.stand).toBe('2026-09-29T10:00:00.000Z');
  });

  it('ohne eingerichtete Entität: nicht eingerichtet, kein Lesen', async () => {
    let gelesen = 0;
    const dienst = new BordDienst({
      konfiguration: { entitaeten: {}, schwellen: STANDARD_SCHWELLEN },
      leseZustaende: async () => {
        gelesen++;
        return new Map();
      },
      stationen: () => [],
      ort: () => ({ route: null, position: null }),
    });
    await dienst.aktualisiere();
    expect(gelesen).toBe(0);
    expect(dienst.zustand().eingerichtet).toBe(false);
  });

  it('ein Lesefehler wird zu „unbekannt", nicht zu einem Absturz', async () => {
    const dienst = new BordDienst({
      konfiguration,
      leseZustaende: async () => {
        throw new Error('HA weg');
      },
      stationen: () => [],
      ort: () => ({ route: null, position: null }),
    });
    const z = await dienst.aktualisiere();
    expect(z.hinweise).toEqual([]);
    expect(z.werte.grauwasser_prozent).toBeNull();
  });
});
