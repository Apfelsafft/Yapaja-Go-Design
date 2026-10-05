/**
 * „Rewe", „Caratec", „Hauptstraße 80" -- gegen einen echten Index (0.39.0).
 *
 * Gemeldet: „Wenn ich jetzt wieder nach Firmennamen wie Rewe oder Caratec
 * suche findet er sie nicht. Kann die Suche alle Parameter wie Name Straße
 * Hausnummer Ort plz usw prüfen?"
 *
 * Drei Ursachen, drei Abschnitte:
 *  1. Der nahe REWE fiel aus den landesweit geholten Zeilen heraus -- bm25
 *     bevorzugt kurze Namen, und davon hat jedes Land Hunderte mit „rewe"
 *     darin.
 *  2. Firmen (`office=company`) standen gar nicht im Index.
 *  3. Hausnummern gab es nicht; „Hauptstraße 80" führte auf die Straßenmitte.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAddresses, buildLiteIndexFile, LITE_INDEX_FORMAT } from './buildIndex.js';
import { LiteIndexReader, readLiteIndexMeta } from './reader.js';
import { LiteBackend, hausnummerAus } from './liteBackend.js';
import {
  normalizeAddressFeature,
  normalizeNamedFeature,
  normalizePoiFeature,
  normalizeStreetFeature,
  type AddressRecord,
  type NormalizedRecord,
  type OsmFeature,
} from './extract.js';

let dir: string;
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const HIER = { lat: 49.25, lon: 8.33 };

function punkt(lon: number, lat: number, properties: Record<string, string>): OsmFeature {
  return { geometry: { type: 'Point', coordinates: [lon, lat] }, properties } as OsmFeature;
}

async function* liste(items: AddressRecord[]): AsyncGenerator<AddressRecord> {
  for (const i of items) yield i;
}

async function baue(records: NormalizedRecord[], adressen: AddressRecord[] = []): Promise<LiteBackend> {
  dir = mkdtempSync(join(tmpdir(), 'firmen-'));
  const path = join(dir, 'lite_search-test.db');
  buildLiteIndexFile(records, path, { region: 'test' });
  await appendAddresses(path, liste(adressen));
  return new LiteBackend({ dbDir: dir, reader: new LiteIndexReader(path) });
}

describe('„Rewe": der nahe Markt gegen hunderte ferne Straßen', () => {
  it('liefert den REWE um die Ecke, auch wenn landesweit viele kurze Namen „rewe" enthalten', async () => {
    const records: NormalizedRecord[] = [];
    // 400 kurze Straßennamen weit weg (Norddeutschland), alle mit „rewe".
    for (let i = 0; i < 400; i += 1) {
      const s = normalizeStreetFeature(
        punkt(9 + i * 0.001, 53 + i * 0.001, { highway: 'residential', name: `Krewe${i}` }),
      );
      if (s) records.push(s);
    }
    const rewe = normalizePoiFeature(
      punkt(HIER.lon + 0.01, HIER.lat, { shop: 'supermarket', name: 'REWE Familie Appel' }),
    );
    expect(rewe).not.toBeNull();
    records.push(rewe as NormalizedRecord);

    const backend = await baue(records);
    const treffer = await backend.search({ q: 'Rewe', limit: 10, ...HIER });
    expect(treffer.map((t) => t.name)).toContain('REWE Familie Appel');
    expect(treffer[0]?.name).toBe('REWE Familie Appel');
  });

  it('zieht den nahen Markt dem fernen vor, auch wenn der ferne kürzer heißt', async () => {
    const nah = normalizePoiFeature(punkt(HIER.lon, HIER.lat + 0.02, { shop: 'supermarket', name: 'REWE Familie Appel' }));
    const fern = normalizePoiFeature(punkt(13.4, 52.5, { shop: 'supermarket', name: 'REWE' }));
    const backend = await baue([nah, fern] as NormalizedRecord[]);
    const treffer = await backend.search({ q: 'rewe', limit: 10, ...HIER });
    expect(treffer.map((t) => t.name)).toEqual(['REWE Familie Appel', 'REWE']);
  });
});

describe('0.39.1: der nächste zuerst, auch bei vielen nahen Treffern', () => {
  it('„Rewe": REWE Familie Appel in 2 km vor zwölf kürzer benannten Märkten in 13–25 km', async () => {
    const records: NormalizedRecord[] = [];
    for (let i = 0; i < 12; i += 1) {
      records.push(
        normalizePoiFeature(
          punkt(HIER.lon + 0.2 + i * 0.01, HIER.lat + 0.05, { shop: 'convenience', name: 'Rewe To Go' }),
        ) as NormalizedRecord,
      );
    }
    records.push(
      normalizePoiFeature(
        punkt(HIER.lon + 0.02, HIER.lat + 0.01, { shop: 'supermarket', name: 'REWE Familie Appel' }),
      ) as NormalizedRecord,
    );
    const backend = await baue(records);
    const treffer = await backend.search({ q: 'Rewe', limit: 10, ...HIER });
    expect(treffer[0]?.name).toBe('REWE Familie Appel');
  });

  it('„Ziolkowski 8": mit Hausnummer stehen Straßen vor einem gleich beginnenden Lokal', async () => {
    const records: NormalizedRecord[] = [];
    for (let i = 0; i < 12; i += 1) {
      records.push(
        normalizeStreetFeature(
          punkt(11 + i * 0.3, 51, { highway: 'residential', name: 'Ziolkowskistraße', 'addr:city': `Ort${i}` }),
        ) as NormalizedRecord,
      );
    }
    records.push(
      normalizePoiFeature(punkt(HIER.lon, HIER.lat, { amenity: 'restaurant', name: 'ZiolkowskiZEHN' })) as NormalizedRecord,
    );
    const backend = await baue(records);
    const mitNummer = await backend.search({ q: 'Ziolkowski 8', limit: 10, ...HIER });
    expect(mitNummer.map((t) => t.name)).not.toContain('ZiolkowskiZEHN');
    // Ohne Nummer darf das Lokal weiter vorn stehen -- dann ist es ein Name.
    const ohne = await backend.search({ q: 'Ziolkowski', limit: 10, ...HIER });
    expect(ohne[0]?.name).toBe('ZiolkowskiZEHN');
  });
});

describe('Firmen, die in keiner Kategorie stehen', () => {
  it('nimmt eine benannte Firma (office=company) auf und findet sie', async () => {
    const caratec = normalizeNamedFeature(
      punkt(8.14, 49.2, { office: 'company', name: 'Caratec', 'addr:city': 'Landau' }),
    );
    expect(caratec).toMatchObject({ kind: 'poi', name: 'Caratec', category: 'company' });
    const backend = await baue([caratec as NormalizedRecord]);
    const treffer = await backend.search({ q: 'Caratec', limit: 10, ...HIER });
    expect(treffer[0]).toMatchObject({ name: 'Caratec', type: 'company', locality: 'Landau' });
  });

  it('ein nur als Gebäude benanntes Objekt zählt als „Gebäude"', () => {
    expect(normalizeNamedFeature(punkt(8, 49, { building: 'yes', name: 'Halle 7' }))).toMatchObject({
      category: 'building',
    });
  });

  it('übergeht, was schon über die Kategorien hereinkommt -- sonst stünde es doppelt', () => {
    expect(normalizeNamedFeature(punkt(8, 49, { shop: 'supermarket', name: 'REWE' }))).toBeNull();
  });

  it('übergeht Unbenanntes und Bänke', () => {
    expect(normalizeNamedFeature(punkt(8, 49, { office: 'company' }))).toBeNull();
    expect(normalizeNamedFeature(punkt(8, 49, { amenity: 'bench', name: 'Ruhebank' }))).toBeNull();
  });
});

describe('Hausnummern', () => {
  const strasse = normalizeStreetFeature(
    punkt(HIER.lon, HIER.lat, { highway: 'residential', name: 'Hauptstraße' }),
  ) as NormalizedRecord;
  const nr80 = normalizeAddressFeature(
    punkt(HIER.lon + 0.004, HIER.lat + 0.001, {
      'addr:street': 'Hauptstraße',
      'addr:housenumber': '80',
      'addr:postcode': '76829',
      'addr:city': 'Landau',
    }),
  ) as AddressRecord;
  // Gleichnamige Straße, gleiche Nummer -- in einem anderen Ort.
  const anderswo = normalizeAddressFeature(
    punkt(11, 50, { 'addr:street': 'Hauptstraße', 'addr:housenumber': '80' }),
  ) as AddressRecord;

  it('erkennt die Nummer in der Eingabe, nicht aber eine Postleitzahl', () => {
    expect(hausnummerAus('Hauptstraße 80')).toBe('80');
    expect(hausnummerAus('Weg 12 a')).toBe('12a');
    expect(hausnummerAus('Weg 12b Landau')).toBe('12b');
    expect(hausnummerAus('76829 Landau')).toBeNull();
    expect(hausnummerAus('Caratec')).toBeNull();
  });

  it('führt „Hauptstraße 80" auf das Haus, nicht auf die Straßenmitte', async () => {
    const backend = await baue([strasse], [nr80, anderswo]);
    const treffer = await backend.search({ q: 'Hauptstrasse 80', limit: 10, ...HIER });
    expect(treffer[0]).toMatchObject({
      name: 'Hauptstraße 80',
      type: 'housenumber',
      locality: '76829 Landau',
      latlng: { lat: nr80.lat, lon: nr80.lon },
    });
    // Die Straße selbst bleibt als weiterer Treffer stehen.
    expect(treffer.some((t) => t.name === 'Hauptstraße')).toBe(true);
  });

  it('„12 a" und „12A" sind dieselbe Nummer', async () => {
    const a = normalizeAddressFeature(
      punkt(HIER.lon, HIER.lat, { 'addr:street': 'Hauptstraße', 'addr:housenumber': '12A' }),
    ) as AddressRecord;
    const backend = await baue([strasse], [a]);
    const treffer = await backend.search({ q: 'Hauptstraße 12 a', limit: 10, ...HIER });
    expect(treffer[0]?.name).toBe('Hauptstraße 12A');
  });

  it('ohne passende Nummer bleibt es bei der Straße', async () => {
    const backend = await baue([strasse], [nr80]);
    const treffer = await backend.search({ q: 'Hauptstraße 999', limit: 10, ...HIER });
    expect(treffer[0]?.name).toBe('Hauptstraße');
  });

  it('der Index trägt sein Format', async () => {
    await baue([strasse], [nr80]);
    expect(readLiteIndexMeta(join(dir, 'lite_search-test.db')).format).toBe(LITE_INDEX_FORMAT);
  });
});
