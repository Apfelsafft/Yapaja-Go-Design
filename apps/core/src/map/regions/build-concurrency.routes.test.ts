/**
 * Zwei gleichzeitige Kachelbauten zerstoeren einander -- Regressionstest.
 *
 * ─── WAS IM BETRIEB PASSIERT IST ────────────────────────────────────────────
 * Der Knopf „Kacheln bauen" wurde ein zweites Mal gedrueckt, waehrend der
 * erste Lauf noch bei 66 % des Wasserflaechen-Downloads stand. Beide
 * planetiler-Prozesse benutzen DASSELBE Verzeichnis fuer die gemeinsamen
 * Basisdaten. Der zweite Lauf las die Datei, die der erste noch schrieb, und
 * starb an:
 *
 *   java.util.zip.ZipException: zip END header not found
 *
 * Im Add-on-Protokoll standen daraufhin zwei Laufzeituhren nebeneinander
 * (0:03:17 und 0:01:52) -- der einzige sichtbare Hinweis darauf, dass es
 * ueberhaupt zwei Prozesse waren. Die Meldung selbst sah nach einem kaputten
 * Download aus und fuehrte damit in die falsche Richtung.
 *
 * Die Sperre gilt bewusst UEBER ALLE REGIONEN, nicht je Region: geteilt ist
 * das Quellenverzeichnis, nicht die Region. Genau das pruefen die beiden
 * Faelle unten.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { regionsPlugin } from './routes.js';
import type { SpawnedBuild } from './build.js';

/** Ein Kindprozess, der NIE endet -- damit bleibt der Job „running" und die
 *  zweite Anfrage trifft auf genau den Zustand, um den es geht. */
function neverEndingChild(): SpawnedBuild {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on: () => undefined,
    kill: () => true,
  };
}

describe('POST /api/v1/map/regions/:id/build -- nur ein Bau gleichzeitig', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setUp(): Promise<void> {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-buildlock-tiles-'));
    const catalogDir = mkdtempSync(join(tmpdir(), 'yapaja-buildlock-catalog-'));
    tempDirs.push(tilesDir, catalogDir);

    const catalogPath = join(catalogDir, 'catalog.json');
    writeFileSync(
      catalogPath,
      JSON.stringify([
        {
          id: 'liechtenstein',
          name: 'Liechtenstein',
          pbfUrl: 'http://127.0.0.1:1/li.osm.pbf',
          sizeBytes: 1000,
          bounds: [9.4, 47.0, 9.7, 47.3],
        },
        {
          id: 'rheinlandpfalz',
          name: 'Rheinland-Pfalz',
          pbfUrl: 'http://127.0.0.1:1/rp.osm.pbf',
          sizeBytes: 1000,
          bounds: [6.1, 48.9, 8.6, 51.0],
        },
      ]),
    );

    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = catalogPath;

    app = Fastify({ logger: false });
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
      buildDeps: {
        spawnFn: () => neverEndingChild(),
        freeMemFn: () => 8 * 1024 ** 3,
        logger: () => undefined,
      },
    });
  }

  it('lehnt einen zweiten Bau DERSELBEN Region mit 409 BUILD_IN_PROGRESS ab', async () => {
    await setUp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BUILD_IN_PROGRESS');
    // Die Meldung muss den Grund nennen, nicht nur das Verbot -- sonst wirkt
    // sie wie eine Schikane statt wie ein Schutz.
    expect(body.error.message).toContain('Basisdaten');
  });

  it('lehnt auch den Bau einer ANDEREN Region ab, solange einer laeuft', async () => {
    // Der Fall, der leicht durchrutscht: „andere Region, also unabhaengig".
    // Ist er nicht -- geteilt ist das Quellenverzeichnis.
    await setUp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    expect(first.statusCode).toBe(202);

    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/rheinlandpfalz/build',
    });
    expect(other.statusCode).toBe(409);
    expect((other.json() as { error: { code: string } }).error.code).toBe('BUILD_IN_PROGRESS');
  });

  it('nennt die Job-Kennung des laufenden Baus, damit die Oberfläche ihn anzeigen kann', async () => {
    await setUp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    const firstJobId = (first.json() as { job_id: string }).job_id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    const details = (second.json() as { error: { details?: { jobId?: string } } }).error.details;
    expect(details?.jobId).toBe(firstJobId);
  });

  it('erlaubt einen neuen Bau, sobald der laufende abgebrochen wurde', async () => {
    // Ohne diesen Fall waere die Sperre eine Falle: ein Bau, der einmal
    // haengt, wuerde jeden weiteren bis zum Neustart des Add-ons blockieren.
    await setUp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    const jobId = (first.json() as { job_id: string }).job_id;

    const cancelled = await app.inject({ method: 'DELETE', url: `/api/v1/jobs/${jobId}` });
    expect(cancelled.statusCode).toBeLessThan(300);

    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/liechtenstein/build',
    });
    expect(again.statusCode).toBe(202);
  });
});
