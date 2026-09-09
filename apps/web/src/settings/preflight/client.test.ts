/**
 * Unit-Tests für den Preflight-Client.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchPreflight, fetchTrackers, waehleTracker, type PreflightReport } from './client';

const REPORT: PreflightReport = {
  status: 'warn',
  summary: 'Navigieren ist möglich. 1 Punkt ist eingeschränkt: Ortssuche.',
  checks: [
    {
      id: 'search',
      label: 'Ortssuche',
      status: 'warn',
      severity: 'recommended',
      detail: 'Weder Photon noch ein Lite-Index sind verfügbar.',
      remedy: 'Lite-Index bauen.',
    },
  ],
  checkedAt: '2026-09-01T10:00:00.000Z',
};

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('fetchPreflight', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // W-15: unter einem Ingress-Unterpfad (`/hassio_ingress/<token>/`) ist ein
  // fest verdrahteter `/api/...`-Pfad falsch — er landet auf der
  // Home-Assistant-Wurzel statt beim Add-on. Deshalb wird die URL aus
  // `BASE_URL` zusammengesetzt. Hier im Test ist `BASE_URL` `/`, der Pfad
  // sieht also absolut aus; die Aussage ist, dass das Präfix WIRKLICH aus
  // `BASE_URL` stammt und nicht danebensteht. Dass es unter einem echten
  // Unterpfad auch trägt, weist `apps/web/e2e/subpath.spec.ts` nach.
  it('ruft einen aus BASE_URL zusammengesetzten Pfad auf', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: REPORT }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchPreflight();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(`${import.meta.env.BASE_URL}api/v1/system/preflight`);
    expect(url.endsWith('api/v1/system/preflight')).toBe(true);
  });

  it('gibt den Bericht unverändert zurück', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: REPORT })) as unknown as typeof fetch;
    await expect(fetchPreflight()).resolves.toEqual(REPORT);
  });

  it('wirft bei einem Fehlerstatus mit dem Status im Text', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, false, 502)) as unknown as typeof fetch;
    await expect(fetchPreflight()).rejects.toThrow(/502/);
  });

  // Eine Antwort in falscher Form muss als Fehler ankommen und nicht als
  // leerer, scheinbar gesunder Bericht -- sonst zeigt die Oberfläche eine
  // leere Liste und behauptet damit implizit, es sei alles in Ordnung.
  it('wirft bei einer Antwort in unerwarteter Form, statt sie als leer durchzureichen', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { status: 'ok' } })) as unknown as typeof fetch;
    await expect(fetchPreflight()).rejects.toThrow(/erwartete Form/);
  });

  it('reicht einen Netzfehler durch', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Failed to fetch')) as unknown as typeof fetch;
    await expect(fetchPreflight()).rejects.toThrow(/Failed to fetch/);
  });
});

describe('die Auswahl der Positionsquelle', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('holt die Liste unter einem aus BASE_URL gebauten Pfad', async () => {
    // W-15, dieselbe Falle wie oben: ein fest verdrahteter `/api/...`-Pfad
    // landet unter Ingress auf der Home-Assistant-Wurzel.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { trackers: [], selected: '' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await fetchTrackers();

    expect(fetchMock.mock.calls[0][0]).toBe(
      `${import.meta.env.BASE_URL}api/v1/system/ha/trackers`,
    );
  });

  it('gibt Liste und Auswahl unveraendert zurueck', async () => {
    const auswahl = {
      trackers: [{ entity_id: 'device_tracker.iphone', friendly_name: 'iPhone' }],
      selected: 'device_tracker.iphone',
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: auswahl })) as unknown as typeof fetch;
    await expect(fetchTrackers()).resolves.toEqual(auswahl);
  });

  it('wirft, wenn die Antwort nicht die erwartete Form hat', async () => {
    // Eine Antwort ohne `trackers` als leere Liste durchzureichen hiesse:
    // „Home Assistant kennt keinen Tracker" -- eine falsche Aussage, die
    // aussieht wie ein Ergebnis.
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { selected: 'x' } })) as unknown as typeof fetch;
    await expect(fetchTrackers()).rejects.toThrow('erwartete Form');
  });

  it('schickt die Wahl als JSON und meldet zurueck, was gilt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { selected: 'device_tracker.iphone' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(waehleTracker('device_tracker.iphone')).resolves.toBe('device_tracker.iphone');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ entity_id: 'device_tracker.iphone' });
  });

  it('meldet die leere Wahl als Abwahl, nicht als Fehler', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { selected: '' } })) as unknown as typeof fetch;
    await expect(waehleTracker('')).resolves.toBe('');
  });

  it('wirft bei einem Fehlerstatus mit dem Status im Text', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, false, 503)) as unknown as typeof fetch;
    await expect(waehleTracker('device_tracker.iphone')).rejects.toThrow('503');
  });
});
