/**
 * „Finde den nächsten Aldi" -- die Umkreissuche gegen einen echten Index.
 *
 * Die gewöhnliche Suche rankt nach Namensgüte und holt bundesweit nur die
 * besten Treffer; der Laden um die Ecke wäre darunter Zufall. Mit
 * `umkreisKm` zählen nur Sonderziele im Umkreis, die nächsten zuerst.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteIndexReader } from './reader.js';
import { LiteBackend } from './liteBackend.js';
import { normalizePoiFeature, normalizeStreetFeature, type NormalizedRecord, type OsmFeature } from './extract.js';

let dir: string;
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const punkt = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const laden = (name: string, lon: number, lat: number): OsmFeature =>
  ({ geometry: punkt(lon, lat), properties: { shop: 'supermarket', name } }) as OsmFeature;

function backend(): LiteBackend {
  const pois = [
    laden('ALDI Süd', 8.40, 49.30), // ~11 km
    laden('ALDI Süd', 8.31, 49.21), // ~1,3 km
    laden('Aldi', 10.0, 51.0), // weit weg
    laden('Lidl', 8.301, 49.201),
  ]
    .map((f) => normalizePoiFeature(f))
    .filter((r): r is NormalizedRecord => r !== null);
  const strassen = [
    ({ geometry: punkt(8.302, 49.202), properties: { highway: 'residential', name: 'Aldinger Straße' } }) as OsmFeature,
  ]
    .map((f) => normalizeStreetFeature(f))
    .filter((r): r is NormalizedRecord => r !== null);
  dir = mkdtempSync(join(tmpdir(), 'naechster-name-'));
  const dbPath = join(dir, 'lite_search.db');
  buildLiteIndexFile([...pois, ...strassen], dbPath, { region: 'test' });
  return new LiteBackend({ dbDir: dir, reader: new LiteIndexReader(dbPath) });
}

const HIER = { lat: 49.2, lon: 8.3 };

describe('Umkreissuche', () => {
  it('nur Sonderziele im Umkreis, die nächsten zuerst', async () => {
    const r = await backend().search({ q: 'aldi', limit: 10, ...HIER, umkreisKm: 25 });
    expect(r.map((x) => x.latlng.lat)).toEqual([49.21, 49.3]);
    expect(r.every((x) => x.name === 'ALDI Süd')).toBe(true);
  });

  it('außerhalb des Umkreises: nichts', async () => {
    const r = await backend().search({ q: 'aldi', limit: 10, lat: 40, lon: 0, umkreisKm: 25 });
    expect(r).toEqual([]);
  });
});
