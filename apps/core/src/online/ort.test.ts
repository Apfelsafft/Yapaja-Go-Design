/* eslint-disable no-undef -- `fetch`/`Response`/`URL`/`Buffer` sind Node-22-Globale (wie in ort.ts). */
import { describe, it, expect } from 'vitest';
import { holeOrtInfo, osmAusTags, overpassText, titelPasst, bildErlaubt } from './ort.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** Eine Attrappe für `fetch`, die je Adresse antwortet. */
function attrappe(antworten: Array<[RegExp, () => Response]>): { fetchFn: typeof fetch; gerufen: string[] } {
  const gerufen: string[] = [];
  const fetchFn = (async (url: string | URL) => {
    const u = String(url);
    gerufen.push(u);
    const treffer = antworten.find(([m]) => m.test(u));
    return treffer ? treffer[1]() : new Response('nichts', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, gerufen };
}

const json = (x: unknown) => () => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });

describe('osmAusTags', () => {
  it('macht aus OSM-Schlüsseln Klartext für Camper', () => {
    const o = osmAusTags({
      website: 'https://stellplatz.example',
      'contact:phone': '+49 123',
      opening_hours: 'Mo-Su 08:00-20:00',
      fee: 'yes',
      motorhome: 'yes',
      power_supply: 'yes',
      capacity: '12',
    });
    expect(o.website).toBe('https://stellplatz.example');
    expect(o.telefon).toBe('+49 123');
    expect(o.gebuehr).toBe('kostenpflichtig');
    expect(o.merkmale).toEqual(['Wohnmobile erlaubt', '12 Stellplätze', 'Strom']);
  });
});

describe('titelPasst', () => {
  it('nimmt nur einen Artikel, der wirklich den Ort meint', () => {
    expect(titelPasst('Burg Gutenberg (Balzers)', 'Burg Gutenberg')).toBe(true);
    // Der Ort, in dem die Tankstelle steht, ist KEIN Artikel über sie.
    expect(titelPasst('Balzers', 'Aral Tankstelle Balzers')).toBe(false);
  });
});

describe('overpassText', () => {
  it('maskiert Anführungszeichen und Zeilenumbrüche im Namen', () => {
    expect(overpassText('Zum "Hirsch"\nx')).toBe('Zum \\"Hirsch\\" x');
  });
});

describe('bildErlaubt', () => {
  it('lädt nur Bilder von upload.wikimedia.org über https', () => {
    expect(bildErlaubt('https://upload.wikimedia.org/a.jpg')).toBe(true);
    expect(bildErlaubt('http://upload.wikimedia.org/a.jpg')).toBe(false);
    expect(bildErlaubt('https://evil.example/a.jpg')).toBe(false);
  });
});

describe('holeOrtInfo', () => {
  it('fügt OSM, Wikipedia und Bilder zusammen -- Bilder als data:-Adressen', async () => {
    const { fetchFn } = attrappe([
      [/overpass/, json({ elements: [{ tags: { name: 'Burg Gutenberg', wikipedia: 'de:Burg Gutenberg (Balzers)', website: 'https://burg.example' } }] })],
      [/rest_v1\/page\/summary/, json({ title: 'Burg Gutenberg (Balzers)', extract: 'Eine Burg.', content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Burg_Gutenberg' } }, thumbnail: { source: 'https://upload.wikimedia.org/burg.png' } })],
      [/commons\.wikimedia\.org/, json({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://upload.wikimedia.org/c1.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:c1.png' }] } } } })],
      [/upload\.wikimedia\.org/, () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })],
    ]);
    const info = await holeOrtInfo({ lat: 47.06, lon: 9.5, name: 'Burg Gutenberg' }, { fetchFn });
    expect(info.osm?.website).toBe('https://burg.example');
    expect(info.wikipedia?.auszug).toBe('Eine Burg.');
    expect(info.bilder.map((b) => b.art)).toEqual(['artikel', 'umgebung']);
    expect(info.bilder[0]!.daten.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('ohne passenden Artikel in der Nähe: kein Wikipedia-Text statt eines falschen', async () => {
    const { fetchFn } = attrappe([
      [/overpass/, json({ elements: [] })],
      [/list=geosearch/, json({ query: { geosearch: [{ title: 'Balzers' }] } })],
      [/commons/, json({})],
    ]);
    const info = await holeOrtInfo({ lat: 47.06, lon: 9.5, name: 'Aral Tankstelle' }, { fetchFn });
    expect(info.wikipedia).toBeNull();
    expect(info.osm).toBeNull();
  });

  it('fallen alle Dienste aus, kommt eine leere Antwort und kein Fehler', async () => {
    const fetchFn = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await holeOrtInfo({ lat: 1, lon: 1, name: 'x' }, { fetchFn })).toEqual({ osm: null, wikipedia: null, bilder: [] });
  });

  it('übernimmt keine Bilder fremder Hosts und keine Nicht-Bilder', async () => {
    const { fetchFn, gerufen } = attrappe([
      [/overpass/, json({ elements: [] })],
      [/commons/, json({ query: { pages: { 1: { imageinfo: [{ thumburl: 'https://evil.example/x.png', descriptionurl: 'x' }] } } } })],
    ]);
    const info = await holeOrtInfo({ lat: 1, lon: 1 }, { fetchFn });
    expect(info.bilder).toEqual([]);
    expect(gerufen.some((u) => u.includes('evil.example'))).toBe(false);
  });
});
