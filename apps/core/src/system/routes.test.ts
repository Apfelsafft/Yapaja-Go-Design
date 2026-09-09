/**
 * Integration test for GET /api/v1/system/resources (E08-T5) -- registers
 * `systemPlugin` directly on a standalone Fastify instance (not the full
 * `buildServer()`, mirroring `map/regions/disk-check.routes.test.ts`) so an
 * injected statfs/os can prove the endpoint reports REAL measured values
 * (the plausibility requirement) rather than a hardcoded number.
 */

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { systemPlugin } from './routes.js';

describe('GET /api/v1/system/resources (E08-T5, W-12/W-18)', () => {
  it('returns the injected statfs/os values verbatim, correctly converted to bytes', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 250_000, blocks: 1_000_000, bsize: 4096 }),
      freeMemFn: () => 2_147_483_648, // 2 GiB
      totalMemFn: () => 8_589_934_592, // 8 GiB
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/resources' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Record<string, number> };
    expect(body.data).toEqual({
      disk_free_bytes: 250_000 * 4096,
      disk_total_bytes: 1_000_000 * 4096,
      mem_free_bytes: 2_147_483_648,
      mem_total_bytes: 8_589_934_592,
    });

    await app.close();
  });

  it('two different injected snapshots produce two different responses (not a hardcoded constant)', async () => {
    const appLow: FastifyInstance = Fastify({ logger: false });
    await appLow.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 10, blocks: 100, bsize: 1024 }),
      freeMemFn: () => 100,
      totalMemFn: () => 200,
    });
    const appHigh: FastifyInstance = Fastify({ logger: false });
    await appHigh.register(systemPlugin, {
      dataDir: '/fake/data/dir',
      statfsFn: async () => ({ bavail: 999_999, blocks: 9_999_999, bsize: 1024 }),
      freeMemFn: () => 999_999,
      totalMemFn: () => 1_999_999,
    });

    const low = (await appLow.inject({ method: 'GET', url: '/api/v1/system/resources' })).json() as {
      data: Record<string, number>;
    };
    const high = (await appHigh.inject({ method: 'GET', url: '/api/v1/system/resources' })).json() as {
      data: Record<string, number>;
    };

    expect(low.data).not.toEqual(high.data);

    await appLow.close();
    await appHigh.close();
  });

  it('defaults dataDir to resolveTilesDir() and calls the real fs.statfs/os when no deps are injected', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    const prevTilesDir = process.env.TILES_DIR;
    process.env.TILES_DIR = process.cwd(); // guaranteed to exist
    try {
      await app.register(systemPlugin, {});
      const response = await app.inject({ method: 'GET', url: '/api/v1/system/resources' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: Record<string, number> };
      expect(body.data.disk_free_bytes).toBeGreaterThan(0);
      expect(body.data.mem_total_bytes).toBeGreaterThan(0);
    } finally {
      if (prevTilesDir === undefined) delete process.env.TILES_DIR;
      else process.env.TILES_DIR = prevTilesDir;
      await app.close();
    }
  });
});

describe('GET /api/v1/system/preflight (feat/gui-install-path)', () => {
  const GB = 1024 ** 3;

  async function appWith(deps: Parameters<typeof systemPlugin>[1]['preflightDeps']) {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, { dataDir: '/fake/data/dir', preflightDeps: deps });
    return app;
  }

  it('reicht den Bericht durch, so wie die Prüfung ihn erzeugt hat', async () => {
    const app = await appWith({
      env: {
        TILES_DIR: '/data/tiles',
        MQTT_BROKER_URL: 'mqtt://x:1883',
        GPSD_ENABLED: 'true',
      },
      listDir: async () => ['liechtenstein.pmtiles'],
      fileSize: async () => 1024,
      tcpProbe: async () => true,
      httpProbe: async () => true,
      totalMem: () => 16 * GB,
      diskFree: async () => 40 * GB,
      now: () => new Date('2026-09-01T10:00:00.000Z'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { status: string; checks: unknown[]; checkedAt: string } };
    expect(body.data.status).toBe('ok');
    expect(body.data.checks).toHaveLength(7);
    expect(body.data.checkedAt).toBe('2026-09-01T10:00:00.000Z');

    await app.close();
  });

  // Der wichtigste Test dieser Datei. Eine unvollständige Installation ist
  // GENAU der Fall, für den diese Seite existiert -- wenn sie dann einen
  // Fehlerstatus liefert, verschluckt generische Fehlerbehandlung im Client
  // (oder ein Reverse Proxy) die Erklärung, die der Betreiber gerade
  // braucht. Der Zustand gehört in den Rumpf, nicht in den HTTP-Status.
  it('antwortet auch bei kaputter Installation mit 200 -- der Zustand steht im Rumpf', async () => {
    const app = await appWith({
      env: {},
      listDir: async () => {
        throw new Error('ENOENT');
      },
      fileSize: async () => null,
      tcpProbe: async () => false,
      httpProbe: async () => false,
      totalMem: () => 8 * GB,
      diskFree: async () => 1 * GB,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: { status: string; checks: Array<{ id: string; status: string; remedy?: string }> };
    };
    expect(body.data.status).toBe('fail');
    const tiles = body.data.checks.find((c) => c.id === 'tiles');
    expect(tiles?.status).toBe('fail');
    expect(tiles?.remedy).toBeTruthy();

    await app.close();
  });

  it('läuft ohne injizierte Sonden gegen die echte Umgebung, ohne zu werfen', async () => {
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin, {});
    const response = await app.inject({ method: 'GET', url: '/api/v1/system/preflight' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { checks: Array<{ id: string }> } };
    expect(body.data.checks.map((c) => c.id)).toContain('tiles');
    await app.close();
  });
});

/**
 * ─── DIE POSITIONSQUELLE AUSWAEHLEN (B-05, Companion App) ──────────────────
 * Bis 0.7.0 musste hier eine Entity-ID von Hand in die Add-on-Konfiguration
 * getippt werden -- eine Angabe, die man nicht weiss, sondern in Home
 * Assistant nachschlagen muss. Diese Route liefert die Auswahl, die es
 * wirklich gibt, und nimmt die Wahl entgegen.
 */
describe('GET/POST /api/v1/system/ha/trackers', () => {
  function appBauen(vorhanden: string[] = ['device_tracker.telefon']) {
    let gewaehlt = '';
    const app: FastifyInstance = Fastify({ logger: false });
    const registriert = app.register(systemPlugin, {
      trackerDeps: {
        listeTracker: async () =>
          vorhanden.map((id) => ({ entity_id: id, friendly_name: `Name ${id}` })),
        gewaehlt: () => gewaehlt,
        waehle: (id: string) => {
          gewaehlt = id;
        },
      },
    });
    return { app, registriert, gewaehltJetzt: () => gewaehlt };
  }

  it('liefert die vorhandenen Tracker und die aktuelle Wahl', async () => {
    const a = appBauen(['device_tracker.telefon', 'device_tracker.ipad']);
    await a.registriert;
    const antwort = await a.app.inject({ method: 'GET', url: '/api/v1/system/ha/trackers' });
    expect(antwort.statusCode).toBe(200);
    const body = antwort.json() as {
      data: { trackers: Array<{ entity_id: string; friendly_name: string }>; selected: string };
    };
    expect(body.data.trackers.map((t) => t.entity_id)).toEqual([
      'device_tracker.telefon',
      'device_tracker.ipad',
    ]);
    expect(body.data.selected).toBe('');
  });

  it('nimmt eine Wahl entgegen und gibt sie danach zurueck', async () => {
    const a = appBauen();
    await a.registriert;
    const gesetzt = await a.app.inject({
      method: 'POST',
      url: '/api/v1/system/ha/trackers',
      payload: { entity_id: 'device_tracker.telefon' },
    });
    expect(gesetzt.statusCode).toBe(200);
    expect(a.gewaehltJetzt()).toBe('device_tracker.telefon');

    const gelesen = await a.app.inject({ method: 'GET', url: '/api/v1/system/ha/trackers' });
    expect((gelesen.json() as { data: { selected: string } }).data.selected).toBe(
      'device_tracker.telefon',
    );
  });

  it('laesst das Abwaehlen zu', async () => {
    // „Doch keinen" muss genauso gehen wie „diesen" -- sonst bleibt eine
    // einmal gewaehlte Quelle fuer immer haengen.
    const a = appBauen();
    await a.registriert;
    await a.app.inject({
      method: 'POST',
      url: '/api/v1/system/ha/trackers',
      payload: { entity_id: 'device_tracker.telefon' },
    });
    await a.app.inject({ method: 'POST', url: '/api/v1/system/ha/trackers', payload: {} });
    expect(a.gewaehltJetzt()).toBe('');
  });

  it('weist alles zurueck, was keine device_tracker-Entitaet ist', async () => {
    // Eine falsche ID hier waere eine Positionsquelle, die still nie etwas
    // liefert -- der teuerste Fehler in diesem Programm.
    const a = appBauen();
    await a.registriert;
    for (const wert of ['sensor.irgendwas', 'telefon', 42]) {
      const antwort = await a.app.inject({
        method: 'POST',
        url: '/api/v1/system/ha/trackers',
        payload: { entity_id: wert },
      });
      expect(antwort.statusCode, String(wert)).toBe(400);
    }
    expect(a.gewaehltJetzt()).toBe('');
  });

  it('antwortet auch ohne Home-Assistant-Anbindung, statt zu scheitern', async () => {
    // Eine Einrichtungshilfe, die selbst ausfaellt, versagt genau dann, wenn
    // man sie braucht.
    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(systemPlugin);
    const antwort = await app.inject({ method: 'GET', url: '/api/v1/system/ha/trackers' });
    expect(antwort.statusCode).toBe(200);
    expect((antwort.json() as { data: { trackers: unknown[] } }).data.trackers).toEqual([]);
  });
});
