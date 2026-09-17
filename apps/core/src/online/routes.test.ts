/* eslint-disable no-undef -- `fetch`/`Response`/`AbortController`/`setTimeout`/
 * `clearTimeout` sind Standard-Globale in Node 22 (typisiert ueber
 * @types/node); dieselbe Begruendung wie in `ha/client.ts`. */

/**
 * Die Schnittstelle zu den Online-Diensten.
 *
 * ─── DIE WICHTIGSTE ZUSICHERUNG DIESER DATEI ────────────────────────────────
 * Dass ohne Schalter WIRKLICH NICHTS hinausgeht. Yapaia ist eine
 * Offline-Navigation; dass sie nach draußen telefoniert, muss eine
 * Entscheidung sein und darf nicht passieren, weil jemand eine Seite geöffnet
 * hat.
 *
 * Geprüft wird das nicht an der Antwort, sondern daran, ob `fetch` überhaupt
 * gerufen wurde. Eine Antwort „nichts gefunden" sähe sonst genauso aus wie
 * „gar nicht gefragt" — und das ist genau die Verwechslung, die dieses Projekt
 * schon mehrfach Zeit gekostet hat.
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { onlinePlugin, onlineEingeschaltet, onlineStatus } from './routes';

/** Zählt mit, ob und wie oft nach draußen gerufen wurde. */
function zaehlenderFetch(): { fetchFn: typeof fetch; rufe: string[] } {
  const rufe: string[] = [];
  const fetchFn = (async (eingabe: unknown) => {
    rufe.push(String(eingabe));
    return {
      ok: true,
      status: 200,
      json: async () => ({ roadworks: [] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchFn, rufe };
}

async function server(
  an: boolean,
  fetchFn?: typeof fetch,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(onlinePlugin, {
    env: { ONLINE_ENABLED: an ? 'true' : 'false' } as NodeJS.ProcessEnv,
    diagnoseDeps: fetchFn ? { fetchFn } : undefined,
    verkehrDeps: fetchFn ? { fetchFn } : undefined,
  });
  await app.ready();
  return app;
}

describe('onlineEingeschaltet', () => {
  it('ist nur bei genau „true" an', () => {
    expect(onlineEingeschaltet({ ONLINE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(onlineEingeschaltet({ ONLINE_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toBe(true);
    expect(onlineEingeschaltet({ ONLINE_ENABLED: ' true ' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('ist bei allem anderen AUS — auch bei Unsinn', () => {
    // Die Richtung ist Absicht: was nicht eindeutig „ja" heißt, ist „nein".
    // Eine Konfiguration von vor 0.10.0 kennt den Schlüssel gar nicht, und
    // ein Update darf eine Installation nicht stillschweigend ins Netz
    // schicken.
    for (const wert of ['false', '', '1', 'yes', 'ja', undefined]) {
      expect(
        onlineEingeschaltet({ ONLINE_ENABLED: wert } as NodeJS.ProcessEnv),
        JSON.stringify(wert),
      ).toBe(false);
    }
    expect(onlineEingeschaltet({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('GET /api/v1/online/status', () => {
  it('antwortet AUCH, wenn die Dienste aus sind', async () => {
    // Sonst könnte die Oberfläche nicht sagen „ausgeschaltet, hier ist der
    // Schalter" -- sie zeigte einfach nichts, und das sieht aus wie ein
    // Fehler.
    const app = await server(false);
    const r = await app.inject({ method: 'GET', url: '/api/v1/online/status' });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.aktiv).toBe(false);
    await app.close();
  });

  it('nennt im ausgeschalteten Zustand, WO der Schalter sitzt', async () => {
    const app = await server(false);
    const hinweis = (await app.inject({ method: 'GET', url: '/api/v1/online/status' })).json().data
      .hinweis;
    expect(hinweis).toContain('Add-on-Konfiguration');
    expect(hinweis).toContain('enabled');
    await app.close();
  });

  it('ruft dabei NICHT nach draußen', async () => {
    // Ein Status, der selbst Anfragen auslöst, wäre eine Hintertür: jede
    // Oberfläche, die ihn regelmäßig abfragt, telefonierte dann mit.
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await app.inject({ method: 'GET', url: '/api/v1/online/status' });
    expect(rufe).toEqual([]);
    await app.close();
  });

  it('listet die Dienste auch dann auf, wenn sie aus sind', async () => {
    const app = await server(false);
    const data = (await app.inject({ method: 'GET', url: '/api/v1/online/status' })).json().data;
    expect(data.dienste.length).toBeGreaterThan(0);
    expect(data.dienste[0].name).toContain('Autobahn');
    await app.close();
  });
});

describe('POST /api/v1/online/diagnose', () => {
  // ─── DIE ZUSICHERUNG, UM DIE ES GEHT ──────────────────────────────────────
  it('ruft OHNE Schalter kein einziges Mal nach draußen', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(false, fetchFn);
    const r = await app.inject({ method: 'POST', url: '/api/v1/online/diagnose', payload: {} });
    expect(r.statusCode).toBe(409);
    expect(rufe, 'es ging trotz ausgeschalteter Dienste etwas hinaus').toEqual([]);
    await app.close();
  });

  it('sagt beim Ablehnen, wo der Schalter sitzt', async () => {
    const app = await server(false);
    const r = await app.inject({ method: 'POST', url: '/api/v1/online/diagnose', payload: {} });
    expect(r.json().error.code).toBe('ONLINE_DISABLED');
    expect(r.json().error.message).toContain('enabled');
    await app.close();
  });

  it('ruft MIT Schalter und berichtet', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    const r = await app.inject({ method: 'POST', url: '/api/v1/online/diagnose', payload: {} });
    expect(r.statusCode).toBe(200);
    expect(rufe.length).toBe(6);
    expect(r.json().data.zeilen).toHaveLength(6);
    expect(typeof r.json().data.urteil).toBe('string');
    await app.close();
  });

  it('nimmt die Vorgabe A61, wenn keine Straße genannt ist', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await app.inject({ method: 'POST', url: '/api/v1/online/diagnose', payload: {} });
    expect(rufe.some((u) => u.includes('/A61/'))).toBe(true);
    await app.close();
  });

  it('nimmt eine genannte Straße', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await app.inject({
      method: 'POST',
      url: '/api/v1/online/diagnose',
      payload: { strasse: 'a3' },
    });
    expect(rufe.some((u) => u.includes('/A3/'))).toBe(true);
    await app.close();
  });

  // ─── WAS IN EINE URL GEHT, WIRD GEPRÜFT ───────────────────────────────────
  it('lehnt alles ab, was keine Autobahnkennung ist — ohne zu rufen', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    for (const unsinn of ['../../etc/passwd', 'A61/services', 'https://fremd.example', '', 'AAAAA1']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/online/diagnose',
        payload: { strasse: unsinn },
      });
      expect(r.statusCode, unsinn).toBe(400);
    }
    expect(rufe, 'eine abgelehnte Kennung hat trotzdem einen Aufruf ausgelöst').toEqual([]);
    await app.close();
  });

  it('nennt in der Ablehnung ein Beispiel, statt nur „ungültig" zu sagen', async () => {
    const app = await server(true);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/online/diagnose',
      payload: { strasse: 'Autobahn' },
    });
    expect(r.json().error.message).toContain('A61');
    await app.close();
  });
});

describe('onlineStatus', () => {
  it('sagt im eingeschalteten Zustand, dass die Navigation offline bleibt', () => {
    // Wer den Schalter umlegt, soll wissen, dass er nichts aufgibt.
    expect(onlineStatus(true).hinweis).toContain('offline');
  });

  it('sagt im ausgeschalteten Zustand, dass nichts hinausgeht', () => {
    expect(onlineStatus(false).hinweis).toContain('nie das Haus');
  });
});

/**
 * ─── POST /api/v1/online/verkehr ────────────────────────────────────────────
 *
 * Baustellen und Sperrungen für die Autobahnen, die die App nennt.
 *
 * Die wichtigste Zusicherung ist dieselbe wie oben: ohne Schalter geht NICHTS
 * hinaus — und geprüft wird das daran, ob `fetch` gerufen wurde, nicht an der
 * Antwort. Eine leere Liste sähe sonst genauso aus, ob nun nichts gemeldet
 * war oder gar nicht gefragt wurde.
 */
describe('POST /api/v1/online/verkehr', () => {
  async function frage(app: FastifyInstance, strassen: unknown): Promise<{
    status: number;
    body: { data?: { meldungen: unknown[]; strassen: unknown[]; urteil: string }; error?: { code: string } };
  }> {
    const antwort = await app.inject({
      method: 'POST',
      url: '/api/v1/online/verkehr',
      payload: { strassen },
    });
    return { status: antwort.statusCode, body: antwort.json() };
  }

  it('AUSGESCHALTET: 409 und KEIN einziger Aufruf nach draußen', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(false, fetchFn);
    const { status, body } = await frage(app, ['A61']);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('ONLINE_DISABLED');
    expect(rufe).toEqual([]);
    await app.close();
  });

  it('EINGESCHALTET: fragt die genannte Autobahn ab', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    const { status, body } = await frage(app, ['A61']);
    expect(status).toBe(200);
    expect(rufe.every((u) => u.includes('/A61/services/'))).toBe(true);
    expect(body.data?.urteil).toContain('nichts gemeldet');
    await app.close();
  });

  it('fragt NUR die genannten Straßen ab und sucht sich keine dazu', async () => {
    // Der Kern weiß nicht, wo das Fahrzeug hinfährt. Sich hier etwas
    // auszudenken hiesse, entweder zu viel nach draußen zu rufen oder eine
    // Lücke zu erzeugen, die wie Ruhe aussieht.
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await frage(app, ['A3']);
    expect(rufe.some((u) => u.includes('/A61/'))).toBe(false);
    await app.close();
  });

  it('ohne Straßen wird gar nicht gerufen — und das steht auch da', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    const { status, body } = await frage(app, []);
    expect(status).toBe(200);
    expect(rufe).toEqual([]);
    // „nichts gemeldet" wäre hier eine Entwarnung, die niemand geprüft hat.
    expect(body.data?.urteil).toContain('nichts abgefragt');
    await app.close();
  });

  it('verträgt einen unsinnigen Rumpf, statt zu stürzen', async () => {
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    for (const unsinn of [null, 'A61', 42, { a: 1 }]) {
      const { status } = await frage(app, unsinn);
      expect(status, JSON.stringify(unsinn)).toBe(200);
    }
    expect(rufe).toEqual([]);
    await app.close();
  });

  it('wirft Einträge weg, die keine Autobahnkennung sind', async () => {
    // Sie landen in einer Adresse. Kodiert werden sie ohnehin, aber freier
    // Text an dieser Stelle wäre trotzdem eine Einladung.
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await frage(app, ['../../etc/passwd', 'A61']);
    expect(rufe.every((u) => u.includes('/A61/services/'))).toBe(true);
    await app.close();
  });

  it('der Zwischenspeicher überlebt zwischen zwei Anfragen', async () => {
    // Läge er in der Anfrage, wäre er bei jedem Aufruf leer — und damit
    // genau so wirkungslos wie gar keiner. Auf einem Mobilfunkanschluss im
    // Wohnmobil ist das keine Kleinigkeit.
    const { fetchFn, rufe } = zaehlenderFetch();
    const app = await server(true, fetchFn);
    await frage(app, ['A61']);
    const nachErstem = rufe.length;
    expect(nachErstem).toBeGreaterThan(0);
    await frage(app, ['A61']);
    expect(rufe.length).toBe(nachErstem);
    await app.close();
  });
});
