/**
 * E10-T5 Pflicht-Test: "OpenAPI-Aktualitäts-Check". Zwei Dinge müssen belegt
 * sein: (1) das committete `docs/openapi.json` stimmt JETZT mit dem, was der
 * Generator aus dem laufenden Code erzeugt, exakt überein; (2) die Prüfung
 * ist kein Papiertiger -- ein echtes Auseinanderlaufen wird tatsächlich als
 * Unterschied erkannt (der rote Fall, nicht nur der grüne).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { closeDb } from '../db/index.js';
import {
  generateOpenApiDocument,
  serializeDocument,
  specsMatch,
  toOpenApiPath,
  operationFor,
  OPENAPI_OUTPUT_PATH,
} from './generate.js';

describe('generateOpenApiDocument', () => {
  afterEach(() => {
    closeDb();
  });

  it('produces the SAME document as the committed docs/openapi.json right now', async () => {
    const fresh = await generateOpenApiDocument();
    const freshSerialized = serializeDocument(fresh);
    const committed = readFileSync(OPENAPI_OUTPUT_PATH, 'utf-8');

    // Bewusst als voller String-Vergleich statt deep-equal: das ist exakt
    // dasselbe, was `tsx src/openapi/generate.ts --check` in CI prüft --
    // ein Test, der eine andere Vergleichslogik verwendet als das echte
    // Gate, könnte grün sein, während CI rot wird (oder umgekehrt).
    expect(freshSerialized).toBe(committed);
  }, 20_000);

  it('lists a plausible number of real REST routes (guards against a silently empty introspection)', async () => {
    const doc = await generateOpenApiDocument();
    const paths = doc.paths as Record<string, unknown>;
    // Stand bei Einführung: 57 Pfade. Eine leere/kaputte Introspektion
    // (z. B. Hook nicht mehr im ersten Statement von buildServer()) würde
    // hier 0 liefern und diesen Test rot machen, statt still ein leeres
    // "docs/openapi.json" durchzuwinken.
    expect(Object.keys(paths).length).toBeGreaterThan(40);
  }, 20_000);

  it('excludes the WebSocket route, the SPA fallback, and auto-added HEAD methods', async () => {
    const doc = await generateOpenApiDocument();
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    expect(paths['/ws/v1']).toBeUndefined();
    expect(paths['/*']).toBeUndefined();
    for (const methods of Object.values(paths)) {
      expect(Object.keys(methods)).not.toContain('head');
    }
  }, 20_000);

  it('references only component schemas that actually exist in the document', async () => {
    const doc = await generateOpenApiDocument();
    const componentNames = new Set(Object.keys((doc.components as { schemas: Record<string, unknown> }).schemas));
    const serialized = serializeDocument(doc);
    const refs = Array.from(serialized.matchAll(/#\/components\/schemas\/([A-Za-z]+)/g)).map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(componentNames.has(ref)).toBe(true);
    }
  }, 20_000);
});

describe('specsMatch (the comparison the --check CLI mode uses)', () => {
  it('is true for two structurally identical documents', () => {
    const a = { openapi: '3.1.0', paths: { '/x': { get: {} } } };
    const b = { openapi: '3.1.0', paths: { '/x': { get: {} } } };
    expect(specsMatch(a, b)).toBe(true);
  });

  it('is FALSE the moment a route is added -- the drift case the CI gate exists for', () => {
    const before = { openapi: '3.1.0', paths: { '/x': { get: {} } } };
    const afterAddingRoute = { openapi: '3.1.0', paths: { '/x': { get: {} }, '/y': { post: {} } } };
    expect(specsMatch(before, afterAddingRoute)).toBe(false);
  });

  it('is FALSE when a response schema silently changes', () => {
    const before = { paths: { '/x': { get: { responses: { '200': { $ref: '#/components/schemas/Route' } } } } } };
    const afterSchemaChange = {
      paths: { '/x': { get: { responses: { '200': { $ref: '#/components/schemas/NavState' } } } } },
    };
    expect(specsMatch(before, afterSchemaChange)).toBe(false);
  });
});

describe('toOpenApiPath', () => {
  it("converts Fastify's ':param' syntax to OpenAPI's '{param}' syntax", () => {
    expect(toOpenApiPath('/api/v1/profiles/:id')).toBe('/api/v1/profiles/{id}');
    expect(toOpenApiPath('/api/v1/addons/:id/storage/:key')).toBe('/api/v1/addons/{id}/storage/{key}');
    expect(toOpenApiPath('/api/v1/health')).toBe('/api/v1/health');
  });
});

describe('operationFor', () => {
  it('emits a path parameter for every Fastify :param segment', () => {
    const op = operationFor('GET', '/api/v1/profiles/:id');
    expect(op.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
  });

  it('falls back to a generic (but present, not missing) operation for an undocumented route', () => {
    const op = operationFor('GET', '/api/v1/totally-made-up-route');
    expect(op.summary).toContain('GET /api/v1/totally-made-up-route');
    expect(op.responses).toBeDefined();
  });
});
