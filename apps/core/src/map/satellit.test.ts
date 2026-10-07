/* eslint-disable no-undef -- `fetch`/`Response` sind Node-22-Globale (wie in online/ort.test.ts). */
/**
 * „Satellit (online)" (0.41.0): Stil und Kachel-Durchreiche.
 *
 * Gewünscht: „Und können wir auch Satellitenkarten einbinden?"
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { createFixtureTilesDir, type FixtureDirHandle } from './__fixtures__/pmtiles-fixture.js';
import { satellitUrl, setzeSatellitFetch } from './routes.js';
import { buildYapaiaSatellitStyle, SATELLIT_SOURCE_ID } from './styles/yapaja-satellit.js';
import { rewriteToRegions } from './styles/rewrite.js';
import { listStyleSummaries } from './styles/registry.js';

describe('Stil', () => {
  it('Bild unten, Straßen und Namen darüber, keine Flächen, die es verdecken', () => {
    const style = buildYapaiaSatellitStyle();
    expect(style.layers[1]).toMatchObject({ type: 'raster', source: SATELLIT_SOURCE_ID });
    expect(style.layers.filter((l) => l.type === 'fill')).toEqual([]);
    expect(style.layers.some((l) => l.type === 'line')).toBe(true);
    expect(style.layers.some((l) => l.type === 'symbol')).toBe(true);
    // Die Kacheln kommen vom eigenen Server, relativ zur Seite (Ingress).
    expect(JSON.stringify(style.sources)).toContain('./api/v1/map/satellit/');
    expect(JSON.stringify(style.sources)).not.toContain('eox.at');
  });

  it('mehrere Karten: das Bild gibt es einmal, nicht je Region', () => {
    const style = rewriteToRegions(buildYapaiaSatellitStyle(), ['germany', 'switzerland']);
    expect(style.layers.filter((l) => l.type === 'raster')).toHaveLength(1);
    expect(style.sources[SATELLIT_SOURCE_ID]).toBeDefined();
  });

  it('steht in der Stilliste', () => {
    expect(listStyleSummaries().map((s) => s.name)).toContain('Satellit (online)');
  });

  it('URL der Quelle: Sentinel-2 cloudless, y vor x (WMTS)', () => {
    expect(satellitUrl(10, 535, 357)).toBe(
      'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/10/357/535.jpg',
    );
  });
});

describe('Kachel-Durchreiche', () => {
  let fixture: FixtureDirHandle;
  let server: FastifyInstance;
  const geholt: string[] = [];

  beforeEach(async () => {
    fixture = createFixtureTilesDir({ germany: { totalSize: 4096 } });
    process.env.TILES_DIR = fixture.dir;
    process.env.DB_PATH = ':memory:';
    server = await buildServer();
    geholt.length = 0;
  });

  afterEach(async () => {
    setzeSatellitFetch((...args) => fetch(...args));
    await server.close();
    closeDb();
    fixture.cleanup();
    delete process.env.TILES_DIR;
    delete process.env.DB_PATH;
  });

  it('reicht die Kachel als JPEG durch', async () => {
    setzeSatellitFetch((async (url: string) => {
      geholt.push(String(url));
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 });
    }) as typeof fetch);
    const r = await server.inject({ method: 'GET', url: '/api/v1/map/satellit/10/535/357.jpg' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(geholt).toEqual([satellitUrl(10, 535, 357)]);
  });

  it('ohne Internet: 404, kein Absturz', async () => {
    setzeSatellitFetch((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    const r = await server.inject({ method: 'GET', url: '/api/v1/map/satellit/10/535/357.jpg' });
    expect(r.statusCode).toBe(404);
  });

  it('lehnt unsinnige Kacheln ab, ohne nach außen zu fragen', async () => {
    setzeSatellitFetch((async (url: string) => {
      geholt.push(String(url));
      return new Response('', { status: 200 });
    }) as typeof fetch);
    for (const u of ['/api/v1/map/satellit/99/0/0.jpg', '/api/v1/map/satellit/2/9/0.jpg', '/api/v1/map/satellit/a/b/c.jpg']) {
      expect((await server.inject({ method: 'GET', url: u })).statusCode).toBe(400);
    }
    expect(geholt).toEqual([]);
  });
});

describe('Stil-Optionen vertragen die Bildebene', () => {
  it('Sprache, Schriftgröße und ausgeblendete Sonderziele', async () => {
    const { applyStyleOptions, parseStyleOptions } = await import('./styles/index.js');
    const opts = parseStyleOptions({ lang: 'de', labelScale: '1.5', poiAus: 'parking' } as never);
    const style = applyStyleOptions(buildYapaiaSatellitStyle(), opts);
    expect(style.layers.some((l) => l.type === 'raster')).toBe(true);
  });
});
