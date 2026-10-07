import { describe, it, expect } from 'vitest';
import {
  AELTER_MS,
  FRISCH_MS,
  MAX_TREFFER,
  frische,
  holePreise,
  preiseFuer,
  preiseZuPunkten,
  preisText,
  zuordnen,
  type Preisabfrage,
  type Tankstelle,
} from './preise';

const ARAL: Tankstelle = {
  id: 'a',
  name: 'Aral',
  marke: 'ARAL',
  lat: 49.2,
  lon: 8.1,
  diesel: 1.659,
  e5: 1.799,
  e10: 1.739,
  offen: true,
};
// ~1 km östlich
const SHELL: Tankstelle = { ...ARAL, id: 's', name: 'Shell', lon: 8.114, diesel: 1.689 };

describe('zuordnen', () => {
  it('nimmt die nächste Station in 250 m', () => {
    expect(zuordnen({ lat: 49.2005, lon: 8.1005 }, [SHELL, ARAL])?.id).toBe('a');
  });
  it('nichts, wenn keine Station nah genug ist', () => {
    expect(zuordnen({ lat: 49.2, lon: 8.107 }, [SHELL, ARAL])).toBeNull();
  });
});

describe('preiseFuer — nach Spritsorte des Profils', () => {
  it('Diesel', () => {
    expect(preiseFuer(ARAL, 'diesel')).toEqual([{ sorte: 'Diesel', euro: 1.659 }]);
  });
  it('Benzin zeigt E5 und E10', () => {
    expect(preiseFuer(ARAL, 'benzin').map((p) => p.sorte)).toEqual(['E5', 'E10']);
  });
  it('Gas, Strom oder keine Angabe: kein Preis', () => {
    for (const s of ['lpg', 'cng', 'elektro', null, undefined] as const) expect(preiseFuer(ARAL, s)).toEqual([]);
  });
  it('fehlender Dieselpreis: nichts', () => {
    expect(preiseFuer({ ...ARAL, diesel: null }, 'diesel')).toEqual([]);
  });
});

describe('preisText', () => {
  it('schreibt wie die Preistafel', () => {
    expect(preisText(1.659)).toBe('1,65⁹');
    expect(preisText(1.7)).toBe('1,70⁰');
    expect(preisText(2.009)).toBe('2,00⁹');
  });
});

describe('frische — die Farbe nach Alter der Abfrage', () => {
  const t0 = Date.parse('2026-10-07T10:00:00Z');
  const iso = new Date(t0).toISOString();
  it('frisch, älter, alt', () => {
    expect(frische(iso, true, t0 + 60_000)).toBe('frisch');
    expect(frische(iso, true, t0 + FRISCH_MS + 1)).toBe('aelter');
    expect(frische(iso, true, t0 + AELTER_MS + 1)).toBe('alt');
  });
  it('geschlossen schlägt alles', () => {
    expect(frische(iso, false, t0)).toBe('zu');
  });
  it('unlesbare Zeit gilt als alt', () => {
    expect(frische('kaputt', true, t0)).toBe('alt');
  });
});

describe('holePreise — jeder Fehler heißt „kein Preis"', () => {
  it('409 (Online aus / kein Schlüssel) → null', async () => {
    const f = (async () => ({ ok: false, status: 409, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await holePreise({ lat: 49, lon: 8 }, f)).toBeNull();
  });
  it('kein Netz → null', async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await holePreise({ lat: 49, lon: 8 }, f)).toBeNull();
  });
  it('fragt den Kern, nicht Tankerkönig', async () => {
    const urls: string[] = [];
    const f = (async (u: string) => {
      urls.push(u);
      return { ok: true, json: async () => ({ data: { abgerufen: 'x', stationen: [] } }) };
    }) as unknown as typeof fetch;
    expect(await holePreise({ lat: 49.2, lon: 8.1 }, f)).toEqual({ abgerufen: 'x', stationen: [] });
    expect(urls[0]).toMatch(/api\/v1\/tanken\/preise\?lat=49\.2&lon=8\.1&rad=\d+$/);
  });
});

describe('preiseZuPunkten', () => {
  it('eine Abfrage je Gegend, Zuordnung je Punkt', async () => {
    let rufe = 0;
    const holen = async (): Promise<Preisabfrage> => {
      rufe += 1;
      return { abgerufen: 'jetzt', stationen: [ARAL, SHELL] };
    };
    const z = await preiseZuPunkten(
      [
        { lat: 49.2001, lon: 8.1001 },
        { lat: 49.2, lon: 8.1141 },
        { lat: 49.21, lon: 8.12 },
      ],
      holen,
    );
    expect(rufe).toBe(1);
    expect(z.map((x) => x?.station.id ?? null)).toEqual(['a', 's', null]);
  });

  it('Fehler → überall kein Preis', async () => {
    const z = await preiseZuPunkten([{ lat: 49.2, lon: 8.1 }], async () => null);
    expect(z).toEqual([null]);
  });

  it(`höchstens ${MAX_TREFFER} Treffer`, async () => {
    const punkte = Array.from({ length: MAX_TREFFER + 3 }, (_, i) => ({ lat: 40 + i, lon: 8 }));
    let rufe = 0;
    const z = await preiseZuPunkten(punkte, async () => {
      rufe += 1;
      return { abgerufen: 'x', stationen: [] };
    });
    expect(rufe).toBe(MAX_TREFFER);
    expect(z).toHaveLength(punkte.length);
  });
});
