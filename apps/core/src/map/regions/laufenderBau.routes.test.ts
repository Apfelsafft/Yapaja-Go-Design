/**
 * Ein laufender Bau muss wiederfindbar sein.
 *
 * ─── DER GEMELDETE FALL ─────────────────────────────────────────────────────
 * „Wenn man von Yapaia woandershin wechselt und dann wieder aufruft sind die
 * aktuellen Fortschrittsinformationen vom Bau nicht mehr sichtbar."
 *
 * Und beim nächsten Druck auf „bauen": „Es läuft bereits ein Bau."
 *
 * Beides stimmte gleichzeitig, und das ist der ganze Punkt. Der Bau lief im
 * Kern ungestört weiter — die Oberfläche merkte sich nur im Speicher des
 * Browsers, WELCHER Job zu welcher Region gehört, und der ist beim Verlassen
 * der Seite weg. Danach wusste der Kern alles und zeigte nichts: ein Bau, der
 * offenbar läuft, ohne jede Auskunft darüber, wie weit er ist oder ob er noch
 * lebt. Bei einem Vorgang, der Stunden dauert, ist das die Frage, auf die es
 * ankommt.
 *
 * Wieder dieselbe Fehlerklasse wie so oft in diesem Projekt: die Antwort ist
 * da, sie ist von dort, wo der Betreiber hinsieht, nur nicht erreichbar.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { regionsPlugin } from './routes.js';
import type { JobSnapshot } from './jobs.js';
import type { SpawnedBuild } from './build.js';

/** Ein Kindprozess, der nie endet — damit bleibt der Job „running". */
function laufenderProzess(): SpawnedBuild {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on: () => undefined,
    kill: () => true,
  };
}

describe('GET /api/v1/map/regions/laufender-bau', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function setUp(): Promise<void> {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-laufend-tiles-'));
    const katalogDir = mkdtempSync(join(tmpdir(), 'yapaja-laufend-katalog-'));
    tempDirs.push(tilesDir, katalogDir);

    const katalogPfad = join(katalogDir, 'catalog.json');
    writeFileSync(
      katalogPfad,
      JSON.stringify([
        {
          id: 'germany',
          name: 'Deutschland',
          pbfUrl: 'http://127.0.0.1:1/germany-latest.osm.pbf',
          sizeBytes: 1000,
          bounds: [5.8, 47.2, 15.1, 55.1],
        },
      ]),
    );
    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = katalogPfad;

    app = Fastify({ logger: false });
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
      buildDeps: {
        spawnFn: () => laufenderProzess(),
        freeMemFn: () => 8 * 1024 ** 3,
        logger: () => undefined,
      },
    });
  }

  function laufend(): Promise<JobSnapshot | null> {
    return app
      .inject({ method: 'GET', url: '/api/v1/map/regions/laufender-bau' })
      .then((a) => (a.json() as { data: JobSnapshot | null }).data);
  }

  it('meldet `null`, wenn nichts läuft', async () => {
    await setUp();
    expect(await laufend()).toBeNull();
  });

  it('nennt den laufenden Bau MIT seiner Region', async () => {
    // Die Region ist der springende Punkt. Ohne sie wüsste die Oberfläche
    // zwar, dass etwas läuft, aber nicht, unter welchem Eintrag sie den
    // Fortschritt zeigen soll — und an der falschen Stelle wäre er schlimmer
    // als gar nicht.
    await setUp();
    const gestartet = await app.inject({
      method: 'POST',
      url: '/api/v1/map/regions/germany/build-graph',
    });
    expect(gestartet.statusCode).toBe(202);

    const job = await laufend();
    expect(job?.region).toBe('germany');
    expect(job?.id).toBe((gestartet.json() as { job_id: string }).job_id);
  });

  it('sagt auch, WELCHE Art Bau es ist', async () => {
    // „Es läuft ein Bau" allein lässt offen, ob gerade Kacheln, Routing oder
    // Suche gebaut werden. Bei Laufzeiten von Stunden ist das ein Unterschied.
    await setUp();
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    expect((await laufend())?.bauart).toBe('routing');
  });

  it('unterscheidet die drei Bauarten', async () => {
    await setUp();
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-search-index' });
    expect((await laufend())?.bauart).toBe('suche');
  });

  it('der Kachelbau trägt seine Region genauso', async () => {
    await setUp();
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build' });
    const job = await laufend();
    expect(job?.region).toBe('germany');
    expect(job?.bauart).toBe('kacheln');
  });

  it('liefert denselben Job, den auch /api/v1/jobs/:id kennt', async () => {
    // Sonst wären es zwei Auskünfte über denselben Vorgang, die auseinander
    // laufen können — und die Anzeige würde nach dem Wiederanhängen auf eine
    // andere Quelle umschalten als die, aus der sie gerade gelesen hat.
    await setUp();
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    const job = await laufend();
    const einzeln = await app.inject({ method: 'GET', url: `/api/v1/jobs/${job?.id}` });
    expect((einzeln.json() as { data: JobSnapshot }).data.id).toBe(job?.id);
  });

  it('meldet nach dem Abbruch wieder `null`', async () => {
    // Ein beendeter Bau darf nicht ewig als „läuft" gemeldet werden — sonst
    // klebte die Anzeige an einem Fortschritt, den es nicht mehr gibt.
    await setUp();
    await app.inject({ method: 'POST', url: '/api/v1/map/regions/germany/build-graph' });
    const job = await laufend();
    await app.inject({ method: 'DELETE', url: `/api/v1/jobs/${job?.id}` });
    expect(await laufend()).toBeNull();
  });

  it('die Route verwechselt sich nicht mit einer Region namens „laufender-bau"', async () => {
    // `/api/v1/map/regions/:id` gibt es als DELETE. Eine Region darf diesen
    // Namen nicht kapern — geprüft wird deshalb, dass GET wirklich den Job
    // liefert und nicht in die Regionsbehandlung läuft.
    await setUp();
    const antwort = await app.inject({
      method: 'GET',
      url: '/api/v1/map/regions/laufender-bau',
    });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toEqual({ data: null });
  });
});
