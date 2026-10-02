/**
 * „Ziolkowskistraße 8 in Magdeburg" -- gegen einen echten Index.
 *
 * ─── DIE MELDUNG ────────────────────────────────────────────────────────────
 * „Ich möchte die Ziolkowskistrasse 8 in Magdeburg ansteuern. Er erkennt die
 * (falsche) Schreibweise mit ss anstatt ß nicht. Es wird sehr oft eine
 * Ziolkowski in Ilmenau vorgeschlagen. Wenn ich Magdeburg dazufüge
 * verschwinden die Straßen und es kommen nur POIs."
 *
 * Drei Ursachen, je ein Abschnitt unten:
 *  1. ss ≠ ß für den Trigramm-Tokenizer.
 *  2. Jeder Strassenabschnitt war ein eigener Treffer (achtmal Ilmenau).
 *  3. Strassen tragen den NÄCHSTEN Ort (in Magdeburg ein Stadtteil), die
 *     UND-Suche mit „Magdeburg" liess sie deshalb fallen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLiteIndexFile } from './buildIndex.js';
import { LiteIndexReader, splitQueryTerms, termVarianten } from './reader.js';
import { LiteBackend } from './liteBackend.js';
import { fillLocalities } from './cli.js';
import { PlaceLocator, type PlacePoint } from './placeLocator.js';
import {
  normalizePlaceFeature,
  normalizePoiFeature,
  normalizeStreetFeature,
  type NormalizedRecord,
  type OsmFeature,
} from './extract.js';

let dir: string;
afterEach(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

const punkt = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
const ort = (place: string, name: string, lon: number, lat: number): OsmFeature =>
  ({ geometry: punkt(lon, lat), properties: { place, name } }) as OsmFeature;
const strasse = (name: string, lon: number, lat: number): OsmFeature =>
  ({ geometry: punkt(lon, lat), properties: { highway: 'residential', name } }) as OsmFeature;
const laden = (name: string, lon: number, lat: number, tags: Record<string, string>): OsmFeature =>
  ({ geometry: punkt(lon, lat), properties: { shop: 'supermarket', name, ...tags } }) as OsmFeature;

function backend(): LiteBackend {
  const orte = [
    ort('city', 'Magdeburg', 11.629, 52.131),
    ort('suburb', 'Neue Neustadt', 11.632, 52.158),
    ort('town', 'Ilmenau', 10.914, 50.684),
  ];
  const strassen = [
    strasse('Ziolkowskistraße', 11.631, 52.162),
    // Ilmenau: dieselbe Strasse in vier Abschnitten.
    strasse('Ziolkowskistraße', 10.931, 50.677),
    strasse('Ziolkowskistraße', 10.932, 50.678),
    strasse('Ziolkowskistraße', 10.933, 50.679),
    strasse('Ziolkowskistraße', 10.934, 50.680),
  ];
  const laeden = [
    laden('Netto Marken-Discount', 11.6305, 52.1615, {
      'addr:street': 'Ziolkowskistraße',
      'addr:housenumber': '9',
      'addr:city': 'Magdeburg',
    }),
  ];
  const placeRecords = orte.map((f) => normalizePlaceFeature(f)).filter((r): r is NormalizedRecord => r !== null);
  const streetRecords = strassen.map((f) => normalizeStreetFeature(f)).filter((r): r is NormalizedRecord => r !== null);
  const poiRecords = laeden.map((f) => normalizePoiFeature(f)).filter((r): r is NormalizedRecord => r !== null);
  expect(placeRecords).toHaveLength(3);
  expect(streetRecords).toHaveLength(5);
  expect(poiRecords).toHaveLength(1);
  fillLocalities(streetRecords, new PlaceLocator(placeRecords as readonly PlacePoint[]));
  // Wie im echten Bau: die Magdeburger Strasse bekommt den Stadtteil.
  expect(streetRecords[0]?.locality).toBe('Neue Neustadt');

  dir = mkdtempSync(join(tmpdir(), 'strasse-im-ort-'));
  const dbPath = join(dir, 'lite_search.db');
  buildLiteIndexFile([...placeRecords, ...streetRecords, ...poiRecords], dbPath, { region: 'test' });
  return new LiteBackend({ dbDir: dir, reader: new LiteIndexReader(dbPath) });
}

// Standort in der Pfalz, wie auf dem Bildschirmfoto: Ilmenau ist näher.
const PFALZ = { lat: 49.2, lon: 8.3 };

describe('1. ss und ß', () => {
  it('„strasse" findet die „straße"', async () => {
    const r = await backend().search({ q: 'ziolkowskistrasse', limit: 10, ...PFALZ });
    expect(r.map((x) => x.name)).toContain('Ziolkowskistraße');
  });

  it('die Varianten decken ss, ß und Umlaute ab', () => {
    expect(termVarianten('ziolkowskistrasse')).toContain('ziolkowskistraße');
    expect(termVarianten('Muenchen')).toContain('München');
    expect(termVarianten('Straße')).toContain('Strasse');
  });

  it('Hausnummer und Abkürzungspunkt stören nicht, eine PLZ bleibt', () => {
    expect(splitQueryTerms('Ziolkowskistr. 8 Magdeburg')).toEqual(['Ziolkowskistr', 'Magdeburg']);
    expect(splitQueryTerms('Hauptstraße 128a')).toEqual(['Hauptstraße']);
    expect(splitQueryTerms('39126 Ziolkowskistraße')).toEqual(['39126', 'Ziolkowskistraße']);
  });
});

describe('2. Abschnitte einer Strasse', () => {
  it('vier Abschnitte in Ilmenau sind EIN Treffer, Magdeburg steht trotzdem in der Liste', async () => {
    const r = await backend().search({ q: 'Ziolkowskistraße', limit: 5, ...PFALZ });
    const strassen = r.filter((x) => x.name === 'Ziolkowskistraße');
    expect(strassen).toHaveLength(2);
  });
});

describe('3. Strasse und Ort', () => {
  it('„Ziolkowskistraße Magdeburg" liefert die Strasse in Magdeburg zuerst', async () => {
    const r = await backend().search({ q: 'Ziolkowskistraße Magdeburg', limit: 5, ...PFALZ });
    expect(r[0]?.name).toBe('Ziolkowskistraße');
    expect(r[0]?.latlng.lat).toBeCloseTo(52.162, 3);
    expect(r[0]?.label).toContain('Magdeburg');
    // Ilmenau gehört hier nicht hinein.
    expect(r.some((x) => Math.abs(x.latlng.lat - 50.68) < 0.1)).toBe(false);
  });

  it('genau die gemeldete Eingabe: „ziolkowskistrasse 8 magdeburg"', async () => {
    const r = await backend().search({ q: 'ziolkowskistrasse 8 magdeburg', limit: 5, ...PFALZ });
    expect(r[0]?.name).toBe('Ziolkowskistraße');
    expect(r[0]?.latlng.lat).toBeCloseTo(52.162, 3);
  });

  it('der Laden in derselben Strasse bleibt auffindbar', async () => {
    const r = await backend().search({ q: 'Ziolkowskistraße Magdeburg', limit: 5, ...PFALZ });
    expect(r.map((x) => x.name)).toContain('Netto Marken-Discount');
  });
});

describe('4. Strasse mit Hausnummer, ohne Ort (Rueckmeldung zu 0.26)', () => {
  it('„Ziolkowskistraße 8" zeigt die Strassen vor den Laeden darin', async () => {
    const r = await backend().search({ q: 'Ziolkowskistraße 8', limit: 3, ...PFALZ });
    expect(r.slice(0, 2).map((x) => x.name)).toEqual(['Ziolkowskistraße', 'Ziolkowskistraße']);
  });

  it('auch mit ss geschrieben', async () => {
    const r = await backend().search({ q: 'ziolkowskistrasse 8', limit: 3, ...PFALZ });
    expect(r[0]?.name).toBe('Ziolkowskistraße');
  });
});
