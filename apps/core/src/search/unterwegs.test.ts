/**
 * „Unterwegs finden": Kategorien, Lesen aus dem echten Suchindex, Bezug.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedRecord } from './lite/extract.js';
import { buildLiteIndexFile } from './lite/buildIndex.js';
import { liteSearchDbPathForRegion } from './lite/paths.js';
import { findPoiCategory } from './lite/poiCategories.js';
import { buildRouteGeometryFromPoints } from '../navigation/mapMatching.js';
import {
  leseKandidaten,
  sucheUnterwegs,
  unterwegsKategorie,
  UNTERWEGS_KATEGORIEN,
} from './unterwegs.js';

const verzeichnisse: string[] = [];
afterEach(() => {
  while (verzeichnisse.length > 0) rmSync(verzeichnisse.pop() as string, { recursive: true, force: true });
});

function index(records: NormalizedRecord[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'yapaia-unterwegs-'));
  verzeichnisse.push(dir);
  const pfad = liteSearchDbPathForRegion(dir, 'test');
  buildLiteIndexFile(records, pfad, { region: 'test' });
  return pfad;
}

const poi = (name: string, category: string, lat: number, lon: number): NormalizedRecord => ({
  kind: 'poi',
  name,
  lat,
  lon,
  category,
});

describe('UNTERWEGS_KATEGORIEN', () => {
  it('jede Kategorie steht auch wirklich im Suchindex', () => {
    // Eine Kategorie, die der Index nicht baut, wäre ein Knopf, der immer
    // „nichts gefunden" sagt -- und niemand merkte, warum.
    for (const k of UNTERWEGS_KATEGORIEN) {
      const irgendwo = ['amenity', 'shop', 'tourism', 'leisure'].some((key) => findPoiCategory(key, k.id));
      expect(irgendwo, k.id).toBe(true);
    }
  });

  it('kennt unbekannte Kategorien nicht', () => {
    expect(unterwegsKategorie('fuel')?.name).toBe('Tankstelle');
    expect(unterwegsKategorie('bogus')).toBeUndefined();
  });
});

describe('leseKandidaten', () => {
  it('liest genau die Kategorie aus dem echten Index', () => {
    const pfad = index([
      poi('Aral', 'fuel', 47.1, 9.1),
      poi('REWE', 'supermarket', 47.2, 9.2),
    ]);
    const tanken = leseKandidaten(unterwegsKategorie('fuel')!, [pfad]);
    expect(tanken).toEqual([{ name: 'Aral', lat: 47.1, lon: 9.1 }]);
  });

  it('ein kaputter Index nimmt die anderen nicht mit', () => {
    const gut = index([poi('Aral', 'fuel', 47.1, 9.1)]);
    const kaputt = join(verzeichnisse[0]!, 'lite_search-kaputt.db');
    expect(leseKandidaten(unterwegsKategorie('fuel')!, [kaputt, gut])).toHaveLength(1);
  });
});

describe('sucheUnterwegs', () => {
  const geom = buildRouteGeometryFromPoints(Array.from({ length: 11 }, (_, i) => ({ lat: 47 + i * 0.009, lon: 9 })));
  const tanke = { name: 'Aral', lat: 47.05, lon: 9.0005 };
  const fuel = unterwegsKategorie('fuel')!;

  it('bezieht sich auf die Route, wenn eine läuft', () => {
    const r = sucheUnterwegs(fuel, [tanke], { route: { geom, progressM: 0 }, position: null });
    expect(r.bezug).toBe('route');
    expect(r.treffer[0]!.voraus_m).toBeGreaterThan(5_000);
  });

  it('sonst auf die Position', () => {
    const r = sucheUnterwegs(fuel, [tanke], { route: null, position: { lat: 47, lon: 9 } });
    expect(r.bezug).toBe('position');
    expect(r.treffer).toHaveLength(1);
  });

  it('ohne beides: sagt es, statt zu raten', () => {
    const r = sucheUnterwegs(fuel, [tanke], { route: null, position: null });
    expect(r).toMatchObject({ bezug: 'keiner', treffer: [] });
  });
});
