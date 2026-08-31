/* eslint-disable no-console -- Dieses Modul ist ein CLI (`pnpm openapi:generate` / `--check`); sein Ergebnis
 * gehoert auf stdout, nicht in einen Logger. */
/**
 * E10-T5 (docs/07 §7, docs/03 §1): generates `docs/openapi.json` from the
 * Core's ACTUAL Fastify route table (introspected via `buildServer`'s
 * `onRouteHook`, see `index.ts`) plus the real `@yapaja/shared` JSON
 * Schemas (`schemas.ts`) and a hand-curated per-route enrichment table
 * (`paths.ts`, which documents WHY it exists and what it deliberately does
 * not attempt).
 *
 * Usage (see root `package.json` -- `pnpm openapi:generate` /
 * `pnpm openapi:check` filter into this):
 *   tsx src/openapi/generate.ts            # write docs/openapi.json
 *   tsx src/openapi/generate.ts --check    # CI: fail if committed spec is stale
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../index.js';
import { readPackageVersion } from '../version.js';
import { COMPONENT_SCHEMAS } from './schemas.js';
import { ROUTE_DOCS, DEFAULT_TAG, type RouteDoc } from './paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/core/src/openapi -> apps/core/src -> apps/core -> apps -> repo root
export const REPO_ROOT = resolve(__dirname, '../../../..');
export const OPENAPI_OUTPUT_PATH = join(REPO_ROOT, 'docs', 'openapi.json');

export interface CollectedRoute {
  method: string | string[];
  url: string;
}

const EXCLUDED_METHODS = new Set(['HEAD']);
// '/*' (SPA-Fallback), '/' (statisches Shell-HTML), '/ws/v1' (WebSocket --
// OpenAPI modelliert das nicht sinnvoll, siehe docs/03 §3), und der
// Add-on-UI-iframe-Passthrough (liefert beliebige Add-on-Assets aus, keine
// JSON-API) sind bewusst kein Teil dieser REST-API-Doku.
const EXCLUDED_URLS = new Set(['/*', '/', '/ws/v1', '/addons/:id/ui/', '/addons/:id/ui/*']);

function methodsOf(route: CollectedRoute): string[] {
  const list = Array.isArray(route.method) ? route.method : [route.method];
  return list.filter((m) => !EXCLUDED_METHODS.has(m));
}

/**
 * Boots the real server (in-memory DB, gpsd/simulator/MQTT all in their
 * normal "not actually reachable, degrades gracefully" test posture --
 * exactly what every one of this package's existing `buildServer()`
 * integration tests already relies on) purely to observe its route table,
 * then tears it down again. No network port is opened (`buildServer` never
 * calls `.listen()` -- only `main()` in `index.ts` does).
 */
export async function collectRoutes(): Promise<CollectedRoute[]> {
  process.env.DB_PATH ??= ':memory:';
  process.env.GPSD_ENABLED ??= 'false';

  const collected: CollectedRoute[] = [];
  const server = await buildServer({ onRouteHook: (route) => collected.push(route) });
  await server.ready();
  await server.close();

  return collected.filter((route) => !EXCLUDED_URLS.has(route.url));
}

/** Fastify's `:id` param syntax -> OpenAPI's `{id}` syntax. */
export function toOpenApiPath(fastifyUrl: string): string {
  return fastifyUrl.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function pathParamNames(fastifyUrl: string): string[] {
  return Array.from(fastifyUrl.matchAll(/:([A-Za-z0-9_]+)/g)).map((m) => m[1]);
}

function dataResponseSchema(doc: RouteDoc): Record<string, unknown> | undefined {
  if (!doc.responseSchema) return undefined;
  const ref = { $ref: `#/components/schemas/${doc.responseSchema}` };
  const inner = doc.responseIsArray ? { type: 'array', items: ref } : ref;
  if (doc.responseNotWrapped) return inner;
  return { type: 'object', properties: { data: inner }, required: ['data'] };
}

export function operationFor(method: string, fastifyUrl: string): Record<string, unknown> {
  const doc = ROUTE_DOCS[`${method} ${fastifyUrl}`];
  const params = pathParamNames(fastifyUrl);

  const operation: Record<string, unknown> = {
    summary: doc?.summary ?? `${method} ${toOpenApiPath(fastifyUrl)}`,
    tags: doc?.tags ?? [DEFAULT_TAG],
  };

  if (params.length > 0) {
    operation.parameters = params.map((name) => ({
      name,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
  }

  if (doc?.requestSchema) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${doc.requestSchema}` } } },
    };
  }

  const success = doc && !doc.rawResponse ? dataResponseSchema(doc) : undefined;
  operation.responses = {
    '200': success
      ? { description: 'Erfolgreiche Antwort', content: { 'application/json': { schema: success } } }
      : doc?.rawResponse
        ? { description: 'Binärdaten (kein JSON-Schema veröffentlicht)' }
        : { description: 'Erfolgreiche Antwort (Schema noch nicht kuratiert -- siehe apps/core/src/openapi/paths.ts)' },
    default: {
      description: 'Fehler',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
    },
  };

  return operation;
}

export async function generateOpenApiDocument(): Promise<Record<string, unknown>> {
  const version = await readPackageVersion();
  const routes = await collectRoutes();

  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.url);
    const entry = (paths[openApiPath] ??= {});
    for (const method of methodsOf(route)) {
      entry[method.toLowerCase()] = operationFor(method, route.url);
    }
  }

  const tags = Array.from(new Set(Object.values(ROUTE_DOCS).flatMap((d) => d.tags))).sort();

  return {
    openapi: '3.1.0',
    info: {
      title: 'Yapaja Go Core API',
      version,
      description:
        'Automatisch generiert aus den tatsächlich registrierten Fastify-Routen ' +
        '(apps/core/src/index.ts, onRouteHook) und den @yapaja/shared-JSON-Schemas ' +
        '(packages/shared/src/schemas/). Quelle der Wahrheit ist der Code, nicht ' +
        'dieses Dokument -- bei Verdacht auf Abweichung: `pnpm openapi:check` (CI-Gate ' +
        '"Spec aktuell") bzw. docs/03-api-spec.md für den erzählenden Überblick. ' +
        'WebSocket (/ws/v1) und MQTT sind hier NICHT modelliert (OpenAPI eignet sich ' +
        'dafür nicht) -- siehe docs/03-api-spec.md §3/§4.',
    },
    servers: [{ url: '/api/v1', description: 'Core-API (relative Pfade -- funktioniert unverändert hinter HA-Ingress, W-15)' }],
    tags: tags.map((name) => ({ name })),
    paths,
    components: { schemas: COMPONENT_SCHEMAS },
  };
}

export function serializeDocument(doc: unknown): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

export function specsMatch(a: unknown, b: unknown): boolean {
  return serializeDocument(a) === serializeDocument(b);
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const doc = await generateOpenApiDocument();
  const serialized = serializeDocument(doc);

  if (check) {
    if (!existsSync(OPENAPI_OUTPUT_PATH)) {
      console.error(`Spec fehlt: ${OPENAPI_OUTPUT_PATH} -- einmal 'pnpm openapi:generate' laufen lassen und committen.`);
      process.exitCode = 1;
      return;
    }
    const committed = readFileSync(OPENAPI_OUTPUT_PATH, 'utf-8');
    if (committed !== serialized) {
      console.error(
        'docs/openapi.json ist veraltet (Fastify-Routen oder @yapaja/shared-Schemas haben ' +
          "sich geändert, das committete Dokument aber nicht). 'pnpm openapi:generate' laufen " +
          'lassen und den Diff committen.',
      );
      process.exitCode = 1;
      return;
    }
    console.log('OK: docs/openapi.json ist aktuell ("Spec aktuell").');
    return;
  }

  writeFileSync(OPENAPI_OUTPUT_PATH, serialized, 'utf-8');
  console.log(`Geschrieben: ${OPENAPI_OUTPUT_PATH}`);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
