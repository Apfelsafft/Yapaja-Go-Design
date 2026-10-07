/**
 * Tankerkönig (0.42.0): Preise nur mit Schalter UND Schlüssel, sparsam
 * abgefragt, und bei jedem Fehler einfach keine Preise.
 *
 * Wie in `routes.test.ts` zählt nicht die Antwort, sondern ob `fetch`
 * überhaupt gerufen wurde.
 */
import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { onlinePlugin, onlineStatus } from './routes';
import { Tankerkoenig, gerundet, station, TANKEN_TTL_MS } from './tanken';

const ANTWORT = {
  ok: true,
  status: 'ok',
  stations: [
    {
      id: 'a1',
      name: ' Aral Tankstelle ',
      brand: 'ARAL',
      lat: 49.2,
      lng: 8.1,
      dist: 1.2,
      diesel: 1.659,
      e5: 1.799,
      e10: 1.739,
      isOpen: true,
    },
    { id: 'b2', name: 'Freie', brand: '', lat: 49.21, lng: 8.11, diesel: false, e5: null, e10: 0, isOpen: false },
    { kaputt: true },
  ],
};

function falscherFetch(antwort: unknown = ANTWORT): { fetchFn: typeof fetch; rufe: string[] } {
  const rufe: string[] = [];
  const fetchFn = (async (url: unknown) => {
    rufe.push(String(url));
    return { ok: true, status: 200, json: async () => antwort } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, rufe };
}

async function server(env: Record<string, string>, fetchFn: typeof fetch): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(onlinePlugin, { env: env as NodeJS.ProcessEnv, tankenDeps: { fetchFn } });
  await app.ready();
  return app;
}

describe('station()', () => {
  it('liest Preise, Marke und offen/geschlossen', () => {
    expect(station(ANTWORT.stations[0])).toEqual({
      id: 'a1',
      name: 'Aral Tankstelle',
      marke: 'ARAL',
      lat: 49.2,
      lon: 8.1,
      diesel: 1.659,
      e5: 1.799,
      e10: 1.739,
      offen: true,
    });
  });

  it('„false", null und 0 sind kein Preis; leere Marke ist keine Marke', () => {
    expect(station(ANTWORT.stations[1])).toMatchObject({ marke: null, diesel: null, e5: null, e10: null, offen: false });
  });

  it('übergeht Zeilen ohne Kennung oder Ort', () => {
    expect(station(ANTWORT.stations[2])).toBeNull();
    expect(station(null)).toBeNull();
  });
});

describe('Tankerkoenig.umkreis', () => {
  it('schickt nur den gerundeten Ort und hält das Ergebnis fünf Minuten', async () => {
    let jetzt = 1_000_000;
    const { fetchFn, rufe } = falscherFetch();
    const tk = new Tankerkoenig('geheim', { fetchFn, jetzt: () => jetzt });
    const erste = await tk.umkreis(49.23456, 8.12345, 10);
    expect(rufe).toHaveLength(1);
    expect(rufe[0]).toContain('lat=49.25&lng=8.1&rad=10');
    expect(rufe[0]).not.toContain('49.23456');
    expect(erste.stationen).toHaveLength(2);
    expect(erste.abgerufen).toBe(new Date(1_000_000).toISOString());

    // Gleiche Gegend, kurz darauf: kein zweiter Ruf.
    jetzt += 60_000;
    await tk.umkreis(49.24, 8.11, 10);
    expect(rufe).toHaveLength(1);

    jetzt += TANKEN_TTL_MS;
    await tk.umkreis(49.24, 8.11, 10);
    expect(rufe).toHaveLength(2);
  });

  it('begrenzt den Radius auf 1–25 km', async () => {
    const { fetchFn, rufe } = falscherFetch();
    const tk = new Tankerkoenig('k', { fetchFn });
    await tk.umkreis(49, 8, 100);
    await tk.umkreis(50, 8, 0);
    expect(rufe[0]).toContain('rad=25');
    expect(rufe[1]).toContain('rad=1');
  });

  it('meldet einen falschen Schlüssel als solchen', async () => {
    const { fetchFn } = falscherFetch({ ok: false, status: 'error', message: 'apikey nicht angegeben, falsch, oder im falschen Format' });
    await expect(new Tankerkoenig('x', { fetchFn }).umkreis(49, 8, 5)).rejects.toMatchObject({ code: 'SCHLUESSEL' });
  });

  it('meldet fehlendes Netz', async () => {
    const fetchFn = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    await expect(new Tankerkoenig('x', { fetchFn }).umkreis(49, 8, 5)).rejects.toMatchObject({ code: 'NETZ' });
  });

  it('rundet auf 0,05°', () => {
    expect(gerundet(49.23456)).toBe(49.25);
    expect(gerundet(8.12345)).toBe(8.1);
  });
});

describe('GET /api/v1/tanken/preise', () => {
  const AN = { ONLINE_ENABLED: 'true', TANKERKOENIG_API_KEY: 'geheim' };

  it('ohne Online-Schalter: 409, und es geht NICHTS hinaus', async () => {
    const { fetchFn, rufe } = falscherFetch();
    const app = await server({ ONLINE_ENABLED: 'false', TANKERKOENIG_API_KEY: 'geheim' }, fetchFn);
    const res = await app.inject({ method: 'GET', url: '/api/v1/tanken/preise?lat=49.2&lon=8.1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TANKERKOENIG_AUS');
    expect(rufe).toHaveLength(0);
  });

  it('ohne Schlüssel: 409, und es geht NICHTS hinaus', async () => {
    const { fetchFn, rufe } = falscherFetch();
    const app = await server({ ONLINE_ENABLED: 'true', TANKERKOENIG_API_KEY: '  ' }, fetchFn);
    const res = await app.inject({ method: 'GET', url: '/api/v1/tanken/preise?lat=49.2&lon=8.1' });
    expect(res.statusCode).toBe(409);
    expect(rufe).toHaveLength(0);
  });

  it('prüft lat/lon', async () => {
    const { fetchFn, rufe } = falscherFetch();
    const app = await server(AN, fetchFn);
    for (const q of ['', 'lat=abc&lon=8', 'lat=95&lon=8', 'lat=49']) {
      const res = await app.inject({ method: 'GET', url: `/api/v1/tanken/preise?${q}` });
      expect(res.statusCode).toBe(400);
    }
    expect(rufe).toHaveLength(0);
  });

  it('liefert die Stationen mit Abrufzeit', async () => {
    const { fetchFn } = falscherFetch();
    const app = await server(AN, fetchFn);
    const res = await app.inject({ method: 'GET', url: '/api/v1/tanken/preise?lat=49.2&lon=8.1&rad=5' });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.stationen[0]).toMatchObject({ id: 'a1', diesel: 1.659 });
    expect(typeof data.abgerufen).toBe('string');
  });

  it('Tankerkönig-Fehler: 502, nie den Schlüssel in der Antwort', async () => {
    const { fetchFn } = falscherFetch({ ok: false, message: 'apikey nicht angegeben, falsch, oder im falschen Format' });
    const app = await server(AN, fetchFn);
    const res = await app.inject({ method: 'GET', url: '/api/v1/tanken/preise?lat=49.2&lon=8.1' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('TANKERKOENIG_SCHLUESSEL');
    expect(res.body).not.toContain('geheim');
  });
});

describe('Status', () => {
  it('nennt Tankerkönig als Dienst mit Schlüssel', () => {
    expect(onlineStatus(true).dienste.find((d) => d.name === 'Tankerkönig')).toMatchObject({ schluessel_noetig: true });
  });
});
