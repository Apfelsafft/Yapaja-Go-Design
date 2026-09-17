/**
 * „Routing bauen" deckt ab jetzt ALLE installierten Karten ab — auf der Ebene
 * der Route geprüft, nicht nur in der Rechenfunktion.
 *
 * ─── WARUM GENAU HIER ───────────────────────────────────────────────────────
 * Der gemeldete Fehler war keiner in einer Formel. Er saß in der Nahtstelle:
 * das Bau-Skript sieht nur das Zwischenlager, der Kern kennt Katalog und
 * installierte Karten — und bis 0.10.1 hat keiner der beiden die Lücke
 * bemerkt. Eine reine Funktionsprüfung hätte das nie gefunden, weil beide
 * Seiten für sich genommen richtig rechneten.
 *
 * Diese Datei prüft deshalb, was tatsächlich beim Skript ANKOMMT.
 *
 * Gemeldet wurde:
 *   „Rheinland Pfalz ist gelöscht. Routing und Suche gebaut. … Das routing
 *    funktioniert nicht mehr. Es erscheint eine Fehlermeldung ‚no edges found
 *    near location'. Liegt das daran dass nur das routing für Liechtenstein
 *    angezeigt wird?"
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Buffer } from 'node:buffer';
import { regionsPlugin } from './routes.js';
import { GRAPH_PLAN_ENV } from './graphPlan.js';
import type { SpawnedBuild } from './build.js';
import { buildPMTilesFixtureBuffer } from '../__fixtures__/pmtiles-fixture.js';

function stillerProzess(): SpawnedBuild {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on: () => undefined,
    kill: () => true,
  };
}

/** Der Katalog, den alle Fälle hier benutzen. */
const KATALOG = [
  {
    id: 'germany',
    name: 'Deutschland',
    pbfUrl: 'http://127.0.0.1:1/germany-latest.osm.pbf',
    sizeBytes: 1000,
    bounds: [5.8, 47.2, 15.1, 55.1],
  },
  {
    id: 'switzerland',
    name: 'Schweiz',
    pbfUrl: 'http://127.0.0.1:1/switzerland-latest.osm.pbf',
    sizeBytes: 1000,
    bounds: [5.9, 45.8, 10.5, 47.8],
  },
  {
    id: 'liechtenstein',
    name: 'Liechtenstein',
    pbfUrl: 'http://127.0.0.1:1/liechtenstein-latest.osm.pbf',
    sizeBytes: 1000,
    bounds: [9.4, 47.0, 9.7, 47.3],
  },
];

describe('POST /:id/build-graph — ein Graph über alle installierten Karten', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];
  /** Was `runBuildJob` an den Prozess weiterreicht. */
  let gesehenesEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    delete process.env.VALHALLA_TILES_DIR;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * @param installiert  Regionen, deren `.pmtiles` im Kartenverzeichnis liegt.
   * @param mitExtrakt   Regionen, deren `.osm.pbf` schon im Zwischenlager liegt.
   */
  async function setUp(installiert: string[], mitExtrakt: string[]): Promise<void> {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-abdeckung-tiles-'));
    const katalogDir = mkdtempSync(join(tmpdir(), 'yapaja-abdeckung-katalog-'));
    // Das Zwischenlager liegt zwei Ebenen über dem Graphverzeichnis — so
    // leitet `yapaja-build-graph` es ab, und genau so `pbfLagerPfad()`.
    const valhallaWurzel = mkdtempSync(join(tmpdir(), 'yapaja-abdeckung-valhalla-'));
    tempDirs.push(tilesDir, katalogDir, valhallaWurzel);

    for (const region of installiert) {
      writeFileSync(join(tilesDir, `${region}.pmtiles`), buildPMTilesFixtureBuffer());
    }

    const lager = join(valhallaWurzel, 'planetiler-sources');
    mkdirSync(lager, { recursive: true });
    for (const region of mitExtrakt) {
      writeFileSync(join(lager, `${region}.osm.pbf`), Buffer.alloc(64, 1));
    }

    const katalogPfad = join(katalogDir, 'catalog.json');
    writeFileSync(katalogPfad, JSON.stringify(KATALOG));

    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = katalogPfad;
    process.env.VALHALLA_TILES_DIR = join(valhallaWurzel, 'valhalla', 'tiles');

    gesehenesEnv = {};
    app = Fastify({ logger: false });
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
      buildDeps: {
        spawnFn: (_cmd, _args, env) => {
          gesehenesEnv = env;
          return stillerProzess();
        },
        freeMemFn: () => 8 * 1024 ** 3,
        logger: () => undefined,
      },
    });
  }

  /** Die Zeilen, die das Skript in $YAPAIA_GRAPH_EXTRAKTE bekommt. */
  function nachzuladen(): string[] {
    const roh = gesehenesEnv[GRAPH_PLAN_ENV] ?? '';
    return roh.length === 0 ? [] : roh.split('\n').map((zeile) => zeile.split(' ')[0]).sort();
  }

  it('DER GEMELDETE FALL: drei Karten, ein Extrakt — der Bau läuft trotzdem', async () => {
    // Bis 0.10.0 baute das stillschweigend einen Graphen mit nur einem Land.
    // 0.10.1 lehnte stattdessen mit 409 ab — richtiger, aber immer noch keine
    // Lösung: der Betreiber hatte keinen Weg zu dem, was er wollte.
    await setUp(['germany', 'switzerland', 'liechtenstein'], ['liechtenstein']);

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/germany/build-graph',
    });

    expect(antwort.statusCode).toBe(202);
    const body = antwort.json() as { abdeckung: { danach: string[]; ohneRouting: string[] } };
    expect(body.abdeckung.danach).toEqual(['germany', 'liechtenstein', 'switzerland']);
    expect(body.abdeckung.ohneRouting).toEqual([]);
  });

  it('nennt dem Skript genau die Regionen, deren Extrakt fehlt', async () => {
    // Das ist die Nahtstelle, an der der Fehler saß. Ein Test auf die
    // Antwort allein hätte sie nicht berührt: die Antwort könnte stimmen,
    // während beim Skript nichts ankommt.
    await setUp(['germany', 'switzerland', 'liechtenstein'], ['liechtenstein']);
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    expect(nachzuladen()).toEqual(['germany', 'switzerland']);
  });

  it('reicht zu jeder Region auch ihre Quelle durch', async () => {
    await setUp(['germany'], []);
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    expect(gesehenesEnv[GRAPH_PLAN_ENV]).toBe(
      'germany http://127.0.0.1:1/germany-latest.osm.pbf',
    );
  });

  it('lädt nichts nach, was schon da ist', async () => {
    // Deutschland ist ~4 GB. Ein überflüssiger Download kostet auf einem
    // Mobilfunkanschluss echtes Geld.
    await setUp(['germany', 'switzerland'], ['germany', 'switzerland']);
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    expect(nachzuladen()).toEqual([]);
  });

  it('eine leere Liste kommt als leere Zeichenkette an, nicht als Leerzeile', async () => {
    // Sonst läse das Skript eine Zeile mit leeren Feldern. Es fängt das ab,
    // aber sich darauf zu verlassen hieße, den Fehler nur zu verschieben.
    await setUp(['germany'], ['germany']);
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    expect(gesehenesEnv[GRAPH_PLAN_ENV]).toBe('');
  });

  it('eine Karte ohne Katalogeintrag wird BENANNT, nicht verschwiegen', async () => {
    // Eine von Hand nach /share gelegte `.pmtiles`. Für sie gibt es keinen
    // Extrakt und keine Quelle — sie kann nicht ins Routing. Das muss
    // dastehen: eine fehlende Region ist beim Routen sonst nicht von einem
    // Fehler zu unterscheiden.
    await setUp(['germany', 'mein-bundesland'], []);

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/germany/build-graph',
    });

    expect(antwort.statusCode).toBe(409);
    const body = antwort.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('COVERAGE_LOSS');
    expect(body.error.message).toContain('mein-bundesland');
  });

  it('und mit Bestätigung läuft dieser Bau dann doch', async () => {
    // Eine Warnung ohne Weg ist eine Sackgasse. Genau die war 0.10.1.
    await setUp(['germany', 'mein-bundesland'], []);

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/germany/build-graph',
      payload: { abdeckung_bestaetigt: true },
    });

    expect(antwort.statusCode).toBe(202);
    expect(nachzuladen()).toEqual(['germany']);
  });

  it('ein Extrakt ohne installierte Karte geht NICHT verloren', async () => {
    // Rheinland-Pfalz wurde gelöscht, sein Extrakt liegt noch. Das Skript
    // sammelt ihn per Glob ein — die Abdeckung muss dasselbe sagen, sonst
    // warnt sie vor einem Verlust, den es nicht gibt.
    await setUp(['germany'], ['germany', 'rheinlandpfalz']);

    const antwort = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/germany/build-graph',
    });

    expect(antwort.statusCode).toBe(202);
    const body = antwort.json() as { abdeckung: { danach: string[]; verliert: string[] } };
    expect(body.abdeckung.danach).toContain('rheinlandpfalz');
    expect(body.abdeckung.verliert).toEqual([]);
  });
});
