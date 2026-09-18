/**
 * `POST /api/v1/map/gesamtbau` — der eine Knopf.
 *
 * ─── DIE LEITFRAGE ──────────────────────────────────────────────────────────
 * Kann dieser Knopf etwas anrichten, was die drei Einzelknöpfe nicht konnten?
 *
 * Er startet mehrere schwere Bauten hintereinander, auf einem Gerät, auf dem
 * auch Home Assistant läuft. Die Sperren, die für die Einzelbauten gelten,
 * müssen hier genauso greifen — und zwar in BEIDE Richtungen.
 */

import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { regionsPlugin } from './routes.js';
import type { SpawnedBuild } from './build.js';
import { buildPMTilesFixtureBuffer } from '../__fixtures__/pmtiles-fixture.js';

/** Ein Kindprozess, der nie endet — der Job bleibt damit „running". */
function endlos(): SpawnedBuild {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    on: () => undefined,
    kill: () => true,
  };
}

const KATALOG = [
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
];

describe('POST /api/v1/map/gesamtbau', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];
  let kommandos: string[] = [];

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    delete process.env.VALHALLA_TILES_DIR;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Baut die Anwendung mit den genannten INSTALLIERTEN Karten auf. */
  async function setUp(installiert: string[], freierRam = 8 * 1024 ** 3): Promise<void> {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamt-tiles-'));
    const catalogDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamt-catalog-'));
    const graphDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamt-graph-'));
    tempDirs.push(tilesDir, catalogDir, graphDir);

    for (const region of installiert) {
      writeFileSync(join(tilesDir, `${region}.pmtiles`), buildPMTilesFixtureBuffer({}));
    }

    const catalogPath = join(catalogDir, 'catalog.json');
    writeFileSync(catalogPath, JSON.stringify(KATALOG));

    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = catalogPath;
    process.env.VALHALLA_TILES_DIR = join(graphDir, 'tiles');

    kommandos = [];
    app = Fastify({ logger: false });
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
      buildDeps: {
        spawnFn: (command) => {
          kommandos.push(command);
          return endlos();
        },
        freeMemFn: () => freierRam,
        logger: () => undefined,
      },
    });
  }

  it('startet einen Job und nennt die Zahl der Schritte', async () => {
    // Die Zahl gehoert in die ANTWORT: die Oberflaeche zeigt „Schritt 1 von
    // N", und N darf sie nicht selbst raten.
    await setUp(['liechtenstein', 'rheinlandpfalz']);
    const antwort = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(antwort.statusCode).toBe(202);
    const body = antwort.json() as { job_id: string; schritte: number };
    expect(body.job_id).toBeTruthy();
    // Einmal Routing plus je Karte die Suche.
    expect(body.schritte).toBe(3);
  });

  it('beginnt mit dem Routinggraphen', async () => {
    await setUp(['liechtenstein']);
    await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(kommandos).toEqual(['/usr/bin/yapaja-build-graph']);
  });

  it('ohne installierte Karte: 409 statt eines leeren Laufs', async () => {
    // Ein Lauf, der nach zwei Sekunden „fertig" meldet und nichts getan hat,
    // ist schlimmer als eine Absage.
    await setUp([]);
    const antwort = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(antwort.statusCode).toBe(409);
    expect((antwort.json() as { error: { code: string } }).error.code).toBe('NO_REGIONS');
    expect(kommandos).toEqual([]);
  });

  it('der Job trägt seine Bauart, damit die Oberfläche wieder andocken kann', async () => {
    // Gemeldet und in 0.10.4 geloest: nach einem Seitenwechsel wusste die
    // Anzeige nicht mehr, welcher Job zu was gehoert. Fuer den Gesamtbau
    // gilt dasselbe.
    await setUp(['liechtenstein']);
    await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    const laufend = await app.inject({ method: 'GET', url: '/api/v1/map/regions/laufender-bau' });
    const job = (laufend.json() as { data: { bauart?: string } | null }).data;
    expect(job?.bauart).toBe('gesamt');
  });

  it('der Stand nennt Schritt, Gesamtzahl und den Schritt in Worten', async () => {
    await setUp(['liechtenstein', 'rheinlandpfalz']);
    const gestartet = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    const jobId = (gestartet.json() as { job_id: string }).job_id;

    const stand = await app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}` });
    const gesamt = (
      stand.json() as {
        data: { gesamt?: { schritt: number; schritte: number; schrittText: string } };
      }
    ).data.gesamt;
    expect(gesamt?.schritt).toBe(1);
    expect(gesamt?.schritte).toBe(3);
    expect(gesamt?.schrittText).toBe('Routing bauen (2 Karten)');
  });

  it('beim ERSTEN Lauf gibt es keine Restzeit — und keine erfundene', () => {
    // Steht als eigener Fall da, weil die bequeme Loesung waere, hier
    // irgendeine Zahl hinzuschreiben.
    return (async (): Promise<void> => {
      await setUp(['liechtenstein']);
      const gestartet = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
      const jobId = (gestartet.json() as { job_id: string }).job_id;
      const stand = await app.inject({ method: 'GET', url: `/api/v1/jobs/${jobId}` });
      const gesamt = (
        stand.json() as {
          data: { gesamt?: { restSekunden: number | null; restGrund: string; restText: string | null } };
        }
      ).data.gesamt;
      expect(gesamt?.restSekunden).toBeNull();
      expect(gesamt?.restGrund).toBe('unbekannt');
      expect(gesamt?.restText).toBeNull();
    })();
  });
});

describe('POST /api/v1/map/gesamtbau — die Sperre gilt in beide Richtungen', () => {
  let app: FastifyInstance;
  const tempDirs: string[] = [];

  afterEach(async () => {
    await app?.close();
    delete process.env.TILES_DIR;
    delete process.env.MAP_REGIONS_CATALOG_FILE;
    delete process.env.VALHALLA_TILES_DIR;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function setUp(freierRam = 8 * 1024 ** 3): Promise<void> {
    const tilesDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamtlock-tiles-'));
    const catalogDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamtlock-catalog-'));
    const graphDir = mkdtempSync(join(tmpdir(), 'yapaja-gesamtlock-graph-'));
    tempDirs.push(tilesDir, catalogDir, graphDir);
    writeFileSync(join(tilesDir, 'liechtenstein.pmtiles'), buildPMTilesFixtureBuffer({}));
    const catalogPath = join(catalogDir, 'catalog.json');
    writeFileSync(catalogPath, JSON.stringify(KATALOG));
    process.env.TILES_DIR = tilesDir;
    process.env.MAP_REGIONS_CATALOG_FILE = catalogPath;
    process.env.VALHALLA_TILES_DIR = join(graphDir, 'tiles');

    app = Fastify({ logger: false });
    await app.register(regionsPlugin, {
      statfsImpl: async () => ({ bavail: 10_000_000, bsize: 4096 }),
      buildDeps: {
        spawnFn: () => endlos(),
        freeMemFn: () => freierRam,
        logger: () => undefined,
      },
    });
  }

  // Gebaut wird `rheinlandpfalz` und NICHT `liechtenstein`: letzteres ist in
  // diesem Aufbau installiert, und der Kachelbau lehnt eine installierte
  // Region schon vor der Sperrprüfung mit `ALREADY_INSTALLED` ab. Ein Test,
  // der darauf hereinfällt, prüft eine andere Absage als die gemeinte — und
  // sähe trotzdem grün aus, solange er nur auf 409 schaut.
  const NICHT_INSTALLIERT = 'rheinlandpfalz';

  it('ein laufender Einzelbau verhindert den Gesamtbau', async () => {
    await setUp();
    const einzeln = await app.inject({
      method: 'POST',
      url: `/api/v1/map/regions/${NICHT_INSTALLIERT}/build`,
    });
    expect(einzeln.statusCode).toBe(202);

    const gesamt = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(gesamt.statusCode).toBe(409);
    expect((gesamt.json() as { error: { code: string } }).error.code).toBe('BUILD_IN_PROGRESS');
  });

  it('ein laufender Gesamtbau verhindert den Einzelbau', async () => {
    // Die Gegenrichtung. Ohne sie startete jemand waehrend des Gesamtbaus
    // einen Kachelbau -- und beide planetiler-Prozesse traefen sich im selben
    // Quellenverzeichnis.
    await setUp();
    const gesamt = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(gesamt.statusCode).toBe(202);

    const einzeln = await app.inject({
      method: 'POST',
      url: `/api/v1/map/regions/${NICHT_INSTALLIERT}/build`,
    });
    expect(einzeln.statusCode).toBe(409);
    expect((einzeln.json() as { error: { code: string } }).error.code).toBe('BUILD_IN_PROGRESS');
  });

  it('ein zweiter Gesamtbau wird ebenfalls abgelehnt', async () => {
    await setUp();
    expect((await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' })).statusCode).toBe(
      202,
    );
    expect((await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' })).statusCode).toBe(
      409,
    );
  });

  it('zu wenig Arbeitsspeicher: 409 mit dem Ausweg, nicht nur mit der Zahl', async () => {
    // Auf einer 8-GB-VM ist Photon abzuschalten die empfohlene Einstellung.
    // Eine Ablehnung, die nur die Zahl nennt, schickt den Betreiber auf die
    // Suche.
    await setUp(100 * 1024 ** 2);
    const antwort = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(antwort.statusCode).toBe(409);
    const body = antwort.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INSUFFICIENT_MEMORY');
    expect(body.error.message).toContain('photon_enabled');
  });

  it('nach einem Abbruch geht es wieder', async () => {
    // Ohne diesen Fall waere die Sperre eine Falle.
    await setUp();
    const gesamt = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    const jobId = (gesamt.json() as { job_id: string }).job_id;
    await app.inject({ method: 'DELETE', url: `/api/v1/jobs/${jobId}` });
    const wieder = await app.inject({ method: 'POST', url: '/api/v1/map/gesamtbau' });
    expect(wieder.statusCode).toBe(202);
  });
});
