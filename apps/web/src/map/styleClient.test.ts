/**
 * Unit tests for the style-fetching client (E01-T4).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  fetchStyle,
  fetchStyleSummaries,
  buildFallbackStyle,
  applyDegradationCaps,
  NO_STYLE_QUALITY_CAPS,
  DEFAULT_STYLE_ID,
  type StyleOptions,
} from './styleClient';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('fetchStyleSummaries', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetches from a BASE_URL-relative path and returns the data array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: 'yapaja-light', name: 'Yapaia Light' }] }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const summaries = await fetchStyleSummaries();

    expect(summaries).toEqual([{ id: 'yapaja-light', name: 'Yapaia Light' }]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('api/v1/map/styles'));
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/^https?:\/\//); // relative, no foreign host
  });

  it('returns [] on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as unknown as typeof fetch;
    expect(await fetchStyleSummaries()).toEqual([]);
  });

  it('returns [] on a network error (never throws)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchStyleSummaries()).toEqual([]);
  });

  it('returns [] when the response body has no data array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ nope: true })) as unknown as typeof fetch;
    expect(await fetchStyleSummaries()).toEqual([]);
  });
});

describe('fetchStyle', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const options = { lang: 'name', labelScale: '1.0', poi: 'full' } as const;

  it('requests the style id with lang/labelScale/poi as query params', async () => {
    const styleDoc = { version: 8, sources: {}, layers: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(styleDoc));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStyle('yapaja-dark', { lang: 'name_de', labelScale: '1.2', poi: 'reduced' });

    expect(result).toEqual(styleDoc);
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('api/v1/map/styles/yapaja-dark');
    expect(requestedUrl).toContain('lang=name_de');
    expect(requestedUrl).toContain('labelScale=1.2');
    expect(requestedUrl).toContain('poi=reduced');
    expect(requestedUrl).not.toMatch(/^https?:\/\//);
  });

  describe('die abgeschalteten Kategorien in der Anfrage', () => {
    async function urlFuer(opts: Parameters<typeof fetchStyle>[1]): Promise<string> {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ version: 8, sources: {}, layers: [] }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      await fetchStyle('yapaja-light', opts);
      return fetchMock.mock.calls[0][0] as string;
    }

    it('nennt `poiAus`, wenn etwas abgeschaltet ist', async () => {
      const url = await urlFuer({ ...options, poiAus: ['poi-tanken', 'poi-dusche'] });
      // `decodeURIComponent`, weil das Komma in einer Anfrage als `%2C`
      // steht -- die Zusicherung soll die Kategorien pruefen und nicht die
      // Schreibweise von URLSearchParams.
      expect(decodeURIComponent(url)).toContain('poiAus=poi-tanken,poi-dusche');
    });

    it('lässt `poiAus` ganz weg, wenn nichts abgeschaltet ist', async () => {
      // Ein leeres `poiAus=` waere eine zweite Adresse fuer dieselbe Karte:
      // zwei Abrufe und zwei Eintraege im Zwischenspeicher fuer denselben
      // Zustand.
      expect(await urlFuer({ ...options, poiAus: [] })).not.toContain('poiAus');
    });

    it('lässt unbekannte Schlüssel weg, statt sie mitzuschicken', async () => {
      const url = await urlFuer({ ...options, poiAus: ['gibtsnicht'] });
      expect(url).not.toContain('poiAus');
    });

    it('holt die Karte auch dann, wenn `poiAus` ganz fehlt', async () => {
      // ─── WARUM DAS EINE ZUSICHERUNG WERT IST ─────────────────────────
      // Die Typangabe sagt, dass das Feld da ist. Fehlt es trotzdem -- ein
      // aelterer gespeicherter Zustand, ein von Hand gebauter Aufruf --,
      // darf das hoechstens einen fehlenden Parameter kosten und nicht die
      // ganze Karte. Genau diesen Absturz hat der Test darueber gefunden,
      // bevor er jemandem im Fahrerhaus passieren konnte.
      const ohne = { lang: 'name', labelScale: '1.0', poi: 'full' } as never;
      await expect(urlFuer(ohne)).resolves.toContain('api/v1/map/styles/yapaja-light');
    });
  });

  it('falls back to DEFAULT_STYLE_ID if the requested id 404s', async () => {
    const fallbackDoc = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false)) // requested id -> 404
      .mockResolvedValueOnce(jsonResponse(fallbackDoc)); // default id -> 200
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStyle('unknown-style', options);

    expect(result).toEqual(fallbackDoc);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][0] as string)).toContain(`api/v1/map/styles/${DEFAULT_STYLE_ID}`);
  });

  it('returns null if even the default style id fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, false)) as unknown as typeof fetch;
    expect(await fetchStyle(DEFAULT_STYLE_ID, options)).toBeNull();
  });

  it('returns null on a network error (never throws)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    expect(await fetchStyle('yapaja-light', options)).toBeNull();
  });
});

describe('buildFallbackStyle', () => {
  it('is a minimal, valid, offline style with a background layer only', () => {
    const style = buildFallbackStyle();
    expect(style.version).toBe(8);
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0].type).toBe('background');
    expect(Object.keys(style.sources ?? {})).toHaveLength(0);
  });
});

describe('applyDegradationCaps', () => {
  const user: StyleOptions = { lang: 'name_en', labelScale: '1.2', poi: 'full' };

  it('is a no-op when there are no caps (user choice passes through)', () => {
    expect(applyDegradationCaps(user, NO_STYLE_QUALITY_CAPS)).toEqual(user);
  });

  it('clamps poi DOWN to the cap when the cap is stricter', () => {
    expect(applyDegradationCaps(user, { poi: 'reduced', labelScale: null }).poi).toBe('reduced');
    expect(applyDegradationCaps(user, { poi: 'off', labelScale: null }).poi).toBe('off');
  });

  it('never raises poi above the user choice (the core bug it replaced)', () => {
    // A user who chose poi:'off' must never be forced back up to 'full'/'reduced'
    // by a degradation cap.
    const offUser: StyleOptions = { ...user, poi: 'off' };
    expect(applyDegradationCaps(offUser, { poi: 'full', labelScale: null }).poi).toBe('off');
    expect(applyDegradationCaps(offUser, { poi: 'reduced', labelScale: null }).poi).toBe('off');
  });

  it('clamps labelScale down but never up, and always preserves lang', () => {
    expect(applyDegradationCaps(user, { poi: null, labelScale: '1.0' }).labelScale).toBe('1.0');
    const smallUser: StyleOptions = { ...user, labelScale: '1.0' };
    expect(applyDegradationCaps(smallUser, { poi: null, labelScale: '1.0' }).labelScale).toBe('1.0');
    expect(applyDegradationCaps(user, { poi: 'off', labelScale: '1.0' }).lang).toBe('name_en');
  });
});

/**
 * ─── OHNE FESTE WAHL KEIN `region` ──────────────────────────────────────────
 * Der Kern zeichnet seit 0.9.1 ALLE installierten Regionen, wenn die Anfrage
 * keine nennt. `?region=` heißt dagegen „NUR diese".
 *
 * Bis 0.10.0 schickte die Oberfläche immer eine — auch im Modus „Automatisch",
 * wo sie die Region der aktuellen Position einsetzte. Damit lief die
 * Mehrregionen-Karte vollständig ins Leere, und zwar lautlos: gemeldet wurde
 * „Ich habe Deutschland, Liechtenstein und Schweiz Kacheln gebaut. Sehe aber
 * nur Deutschland."
 *
 * Diese Zusicherungen halten die eine Zeile fest, an der das hängt.
 */
describe('die Regionswahl in der Stil-Anfrage', () => {
  function abgefragteUrl(region?: string): string {
    let url = '';
    const original = globalThis.fetch;
    globalThis.fetch = (async (eingabe: unknown) => {
      url = String(eingabe);
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: 8, name: 'x', sources: {}, layers: [] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      void fetchStyle('yapaja-light', {}, region);
    } finally {
      globalThis.fetch = original;
    }
    return url;
  }

  it('lässt `region` WEG, wenn keine gewählt ist', () => {
    // Das ist die ganze Aussage: keine Nennung = alle Regionen.
    expect(abgefragteUrl(undefined)).not.toContain('region=');
  });

  it('nennt `region`, wenn eine fest gewählt ist', () => {
    // Die Gegenrichtung -- sonst liesse sich die Regel oben dadurch
    // „erfuellen", dass die feste Wahl auch nicht mehr ankommt.
    expect(abgefragteUrl('switzerland')).toContain('region=switzerland');
  });

  it('behandelt die leere Zeichenkette wie „keine Wahl"', () => {
    // Ein leerer Wert waere sonst ein `?region=`, und der Kern faende keine
    // Region dieses Namens -- eine leere Karte ohne Fehlermeldung.
    expect(abgefragteUrl('')).not.toContain('region=');
  });
});
