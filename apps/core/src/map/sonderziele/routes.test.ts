/**
 * `GET /api/v1/map/sonderziele` — der Weg vom Suchindex auf die Karte.
 *
 * ─── WARUM DAS ÜBER DEN ECHTEN SERVER GEHT ──────────────────────────────────
 * `ausIndex.test.ts` prüft die Auskunft selbst, gegen eine echte SQLite-Datei.
 * Was es NICHT prüft, ist der Weg dorthin: ob die Route überhaupt registriert
 * ist, ob sie das Verzeichnis findet, das `LITE_SEARCH_DB_PATH` angibt, und ob
 * das Ergebnis die Verpackung unverändert übersteht.
 *
 * Genau an solchen Nahtstellen ist in diesem Projekt schon mehrfach etwas
 * lautlos verschwunden — zuletzt bei den Verkehrsmeldungen, wo die Zuordnung
 * Symbol-zu-Meldung in einem Paket lag, das der Browser gar nicht auflösen
 * kann. Die Tests waren grün, die Karte leer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../index.js';
import { closeDb } from '../../db/index.js';
import { buildLiteIndexFile } from '../../search/lite/buildIndex.js';
import { liteSearchDbPathForRegion } from '../../search/lite/paths.js';
import type { SonderzieleGeoJson } from './ausIndex.js';

describe('GET /api/v1/map/sonderziele', () => {
  let app: FastifyInstance;
  let dir: string;
  const alteUmgebung = process.env.LITE_SEARCH_DB_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yapaia-sz-route-'));
    // `LITE_SEARCH_DB_PATH` zeigt historisch auf eine DATEI; genommen wird
    // ihr Verzeichnis. Genau so setzt das Add-on sie auch.
    process.env.LITE_SEARCH_DB_PATH = join(dir, 'lite_search.db');
  });

  afterEach(async () => {
    if (app) await app.close();
    closeDb();
    rmSync(dir, { recursive: true, force: true });
    if (alteUmgebung === undefined) delete process.env.LITE_SEARCH_DB_PATH;
    else process.env.LITE_SEARCH_DB_PATH = alteUmgebung;
  });

  async function hole(): Promise<SonderzieleGeoJson> {
    app = await buildServer();
    const antwort = await app.inject({ method: 'GET', url: '/api/v1/map/sonderziele' });
    expect(antwort.statusCode).toBe(200);
    return antwort.json() as SonderzieleGeoJson;
  }

  it('liefert die Entsorgungsstation aus dem gebauten Index', async () => {
    buildLiteIndexFile(
      [
        {
          kind: 'poi',
          name: 'Wohnmobilhafen Germersheim',
          lat: 49.22,
          lon: 8.36,
          category: 'sanitary_dump_station',
        },
      ],
      liteSearchDbPathForRegion(dir, 'rheinland-pfalz'),
      { region: 'rheinland-pfalz' },
    );

    const geo = await hole();

    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features).toHaveLength(1);
    expect(geo.features[0]?.properties.symbol).toBe('poi-entsorgung');
    expect(geo.features[0]?.geometry.coordinates).toEqual([8.36, 49.22]);
  });

  it('sagt bei fehlendem Index `ohne_index` statt einfach nichts', async () => {
    // Ohne dieses Feld wäre „für diese Region gibt es keine Entsorgung"
    // nicht von „der Suchindex wurde nie gebaut" zu unterscheiden. Für
    // jemanden mit vollem Abwassertank sind das zwei sehr verschiedene
    // Auskünfte, und nur eine davon kann er beheben.
    const geo = await hole();

    expect(geo.features).toEqual([]);
    expect(geo.befund.ohne_index).toBe(true);
  });

  it('nennt die betroffenen Kategorien samt Grund in der Antwort', async () => {
    const geo = await hole();

    const namen = geo.befund.kategorien.map((k) => k.kategorie);
    expect(namen).toContain('sanitary_dump_station');
    for (const k of geo.befund.kategorien) {
      expect(k.grund).toMatch(/OpenMapTiles/);
    }
  });
});
