import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../index.js';
import { closeDb } from '../db/index.js';
import { createFixtureTilesDir, type FixtureDirHandle } from './__fixtures__/pmtiles-fixture.js';

const FIXTURE_SIZE = 20000;

describe('Map / style routes integration', () => {
  let server: FastifyInstance;
  let fixture: FixtureDirHandle;

  beforeEach(async () => {
    fixture = createFixtureTilesDir({ germany: { totalSize: FIXTURE_SIZE } });
    process.env.TILES_DIR = fixture.dir;
    process.env.DB_PATH = ':memory:';
    closeDb();
    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    closeDb();
    fixture.cleanup();
    delete process.env.TILES_DIR;
  });

  describe('GET /api/v1/map/styles', () => {
    it('lists the three built-in styles', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/map/styles' });
      expect(response.statusCode).toBe(200);

      const body = response.json() as { data: Array<{ id: string; name: string }> };
      expect(body.data.map((s) => s.id).sort()).toEqual(['yapaja-contrast', 'yapaja-dark', 'yapaja-light']);
      for (const style of body.data) {
        expect(style.name).toBeTruthy();
      }
    });
  });

  describe('GET /api/v1/map/styles/:id', () => {
    it('returns a valid style JSON with the source URL rewritten to the installed region', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/map/styles/yapaja-light' });
      expect(response.statusCode).toBe(200);

      const style = response.json() as {
        version: number;
        sources: Record<string, { type: string; url: string }>;
        layers: Array<{ id: string; type: string }>;
      };
      expect(style.version).toBe(8);
      expect(style.layers.some((l) => l.type === 'background')).toBe(true);

      const sourceIds = Object.keys(style.sources);
      expect(sourceIds.length).toBeGreaterThan(0);
      for (const id of sourceIds) {
        const url = style.sources[id].url;
        // Relative, page-relative, same-origin URL — never an absolute host.
        expect(url).toBe('pmtiles://./tiles/germany.pmtiles');
        expect(url).not.toMatch(/^pmtiles:\/\/https?:/);
      }
    });

    it('returns 404 in the unified error format for an unknown style id', async () => {
      const response = await server.inject({ method: 'GET', url: '/api/v1/map/styles/does-not-exist' });
      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
    });

    it('serves all three known ids with 200', async () => {
      for (const id of ['yapaja-light', 'yapaja-dark', 'yapaja-contrast']) {
        const response = await server.inject({ method: 'GET', url: `/api/v1/map/styles/${id}` });
        expect(response.statusCode).toBe(200);
      }
    });

    it('yapaja-dark has a dark background, yapaja-light a light one (never accidentally swapped)', async () => {
      const dark = (
        await server.inject({ method: 'GET', url: '/api/v1/map/styles/yapaja-dark' })
      ).json() as { layers: Array<{ id: string; paint?: Record<string, string> }> };
      const light = (
        await server.inject({ method: 'GET', url: '/api/v1/map/styles/yapaja-light' })
      ).json() as { layers: Array<{ id: string; paint?: Record<string, string> }> };

      const darkBg = dark.layers.find((l) => l.id === 'background')?.paint?.['background-color'];
      const lightBg = light.layers.find((l) => l.id === 'background')?.paint?.['background-color'];
      expect(darkBg).toBeTruthy();
      expect(lightBg).toBeTruthy();
      expect(darkBg).not.toBe(lightBg);
      // Dark background: low channel values (e.g. "#111417"); light: high (e.g. "#F5F3EC").
      expect(parseInt((darkBg as string).slice(1, 3), 16)).toBeLessThan(0x40);
      expect(parseInt((lightBg as string).slice(1, 3), 16)).toBeGreaterThan(0xc0);
    });

    describe('style options', () => {
      it('?lang=name:de rewrites label text-field', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/map/styles/yapaja-light?lang=name:de',
        });
        const style = response.json() as { layers: Array<{ id: string; layout?: { 'text-field'?: unknown } }> };
        const placeLabels = style.layers.find((l) => l.id === 'place-labels');
        expect(placeLabels?.layout?.['text-field']).toEqual(['get', 'name:de']);
      });

      it('?labelScale=1.2 increases text-size', async () => {
        const base = (
          await server.inject({ method: 'GET', url: '/api/v1/map/styles/yapaja-light' })
        ).json() as { layers: Array<{ id: string; layout?: { 'text-size'?: number } }> };
        const scaled = (
          await server.inject({ method: 'GET', url: '/api/v1/map/styles/yapaja-light?labelScale=1.2' })
        ).json() as { layers: Array<{ id: string; layout?: { 'text-size'?: number } }> };

        const baseSize = base.layers.find((l) => l.id === 'place-labels')?.layout?.['text-size'];
        const scaledSize = scaled.layers.find((l) => l.id === 'place-labels')?.layout?.['text-size'];
        expect(baseSize).toBeTruthy();
        expect(scaledSize).toBeCloseTo((baseSize as number) * 1.2, 5);
      });

      it('?poi=off hides the poi-labels layer', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/map/styles/yapaja-light?poi=off',
        });
        const style = response.json() as { layers: Array<{ id: string; layout?: { visibility?: string } }> };
        const poiLabels = style.layers.find((l) => l.id === 'poi-labels');
        expect(poiLabels?.layout?.visibility).toBe('none');
      });

      it('invalid option values are ignored (200, default behavior), never 400/500', async () => {
        const response = await server.inject({
          method: 'GET',
          url: '/api/v1/map/styles/yapaja-light?lang=xx&labelScale=abc&poi=lots',
        });
        expect(response.statusCode).toBe(200);
      });
    });
  });
});
