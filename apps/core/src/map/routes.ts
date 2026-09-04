/**
 * Fastify routes for PMTiles delivery, map region metadata, and the
 * core-served style system (E01-T4).
 *
 * - GET /tiles/:region.pmtiles       range-request tile archive delivery
 * - GET /api/v1/map/regions          installed region metadata
 * - GET /api/v1/map/styles           available styles (id, name, preview?)
 * - GET /api/v1/map/styles/:id       style JSON (source URL(s) rewritten to
 *                                    the active region's real tile URL;
 *                                    ?lang=/?labelScale=/?poi= transform it)
 *
 * Region manager (E01-T5, see ./regions/routes.ts, registered below):
 * - GET    /api/v1/map/regions/catalog   downloadable regions + installed flag
 * - POST   /api/v1/map/regions           starts a resumable download job
 * - DELETE /api/v1/map/regions/:id       removes an installed region
 * - GET    /api/v1/jobs/:id              job status
 * - DELETE /api/v1/jobs/:id              cancels a job
 *
 * Note: the tiles route intentionally lives outside the /api/v1 prefix,
 * per docs/03-api-spec.md §2 ("Karten & Tiles").
 */

import { createReadStream } from 'fs';
import { stat as fsStat } from 'fs/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { parseRegionParam, resolveGraphDir, resolveRegionFilePath, resolveTilesDir } from './paths.js';
import { parseRange } from './range.js';
import { listRegions, type MapRegionInfo } from './regions.js';
import { collectBuildStatus } from './buildStatus.js';
import { readLiteIndexMeta } from '../search/lite/reader.js';
import { resolveLiteSearchDbPath } from '../search/lite/paths.js';
import { regionsPlugin } from './regions/routes.js';
import {
  applyStyleOptions,
  getStyleDocument,
  listStyleSummaries,
  parseStyleOptions,
  rewriteSourceUrls,
  type MapStyleDocument,
  type RawStyleQuery,
  type StyleSummary,
} from './styles/index.js';

interface TileRouteParams {
  regionParam: string;
}

interface RegionsReply {
  data: MapRegionInfo[];
}

interface StylesListReply {
  data: StyleSummary[];
}

interface StyleDetailParams {
  id: string;
}

interface StyleDetailQuery extends RawStyleQuery {
  /** Explicit region override; defaults to the first installed region. */
  region?: string;
}

function createErrorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function buildEtag(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function ifNoneMatchSatisfied(headerValue: string, etag: string): boolean {
  return headerValue
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === '*' || v === etag);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const mapPlugin: FastifyPluginAsync = async (fastify) => {
  const tilesDir = resolveTilesDir();

  // Region manager (E01-T5): catalog listing, resumable download jobs,
  // delete, and the generic job-status endpoint. Fully additive -- see
  // ./regions/routes.ts. GET /api/v1/map/regions (below) predates it (E01-T1).
  await fastify.register(regionsPlugin);

  // GET /tiles/:region.pmtiles -- HTTP range-request tile archive delivery.
  // The route param captures the full "<region>.pmtiles" segment; we parse
  // and validate it ourselves rather than relying on router path syntax, so
  // that any decoded slashes / traversal sequences are caught explicitly.
  // Reply generic intentionally omitted: this handler sends either an
  // ApiError JSON body (400/404/416) or a raw file stream (200/206), which
  // don't share a common shape.
  fastify.get<{ Params: TileRouteParams }>(
    '/tiles/:regionParam',
    async (request: FastifyRequest<{ Params: TileRouteParams }>, reply) => {
      const region = parseRegionParam(request.params.regionParam);
      if (!region) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'Region name is invalid'));
      }

      const filePath = resolveRegionFilePath(tilesDir, region);
      if (!filePath) {
        return reply
          .code(400)
          .send(createErrorResponse('INVALID_REGION', 'Region name is invalid'));
      }

      let fileStat;
      try {
        fileStat = await fsStat(filePath);
      } catch {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Region '${region}' not found`));
      }
      if (!fileStat.isFile()) {
        return reply
          .code(404)
          .send(createErrorResponse('NOT_FOUND', `Region '${region}' not found`));
      }

      const etag = buildEtag(fileStat.size, fileStat.mtimeMs);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      reply.header('ETag', etag);

      const ifNoneMatch = firstHeaderValue(request.headers['if-none-match']);
      if (ifNoneMatch && ifNoneMatchSatisfied(ifNoneMatch, etag)) {
        return reply.code(304).send();
      }

      const rangeHeader = firstHeaderValue(request.headers.range);
      const rangeResult = parseRange(rangeHeader, fileStat.size);

      if (rangeResult.kind === 'unsatisfiable') {
        reply.header('Content-Range', `bytes */${fileStat.size}`);
        return reply.code(416).send();
      }

      reply.header('Content-Type', 'application/octet-stream');

      if (rangeResult.kind === 'satisfiable') {
        const { start, end } = rangeResult;
        const length = end - start + 1;
        reply.header('Content-Range', `bytes ${start}-${end}/${fileStat.size}`);
        reply.header('Content-Length', length);
        const stream = createReadStream(filePath, { start, end });
        // Belt-and-suspenders: ensure the fd closes if the client aborts
        // mid-stream, even though Fastify already destroys unfinished
        // stream payloads when the underlying response closes.
        reply.raw.once('close', () => {
          if (!stream.destroyed) {
            stream.destroy();
          }
        });
        return reply.code(206).send(stream);
      }

      // rangeResult.kind === 'none' | 'full' -> serve the entire file.
      reply.header('Content-Length', fileStat.size);
      const stream = createReadStream(filePath);
      reply.raw.once('close', () => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      });
      return reply.code(200).send(stream);
    },
  );

  // GET /api/v1/map/regions -- installed region metadata.
  fastify.get<{ Reply: RegionsReply }>('/api/v1/map/regions', async (_request, reply) => {
    const regions = await listRegions(tilesDir, fastify.log);
    return reply.code(200).send({ data: regions });
  });

  // GET /api/v1/map/build-status -- was ist gebaut, und wann?
  //
  // Gemeldet: „Nach der (erfolgreichen) Erstellung sehe ich nicht, dass
  // bereits etwas erstellt wurde und wann." Bei einem Bau, der fuer
  // Deutschland Stunden laeuft, ist das die wichtigste Auskunft ueberhaupt.
  fastify.get('/api/v1/map/build-status', async (_request, reply) => {
    const status = await collectBuildStatus(
      {
        tilesDir,
        graphDir: resolveGraphDir(),
        liteSearchDbPath: resolveLiteSearchDbPath(),
      },
      readLiteIndexMeta,
    );
    return reply.code(200).send({ data: status });
  });

  // GET /api/v1/map/styles -- available styles (id, name, preview?).
  fastify.get<{ Reply: StylesListReply }>('/api/v1/map/styles', async (_request, reply) => {
    return reply.code(200).send({ data: listStyleSummaries() });
  });

  // GET /api/v1/map/styles/:id -- MapLibre style JSON. Source URL(s) are
  // rewritten to the active region's real (relative) tile URL, and
  // ?lang=/?labelScale=/?poi= (if present) transform the served JSON.
  fastify.get<{ Params: StyleDetailParams; Querystring: StyleDetailQuery; Reply: MapStyleDocument | ApiError }>(
    '/api/v1/map/styles/:id',
    async (request, reply) => {
      const { id } = request.params;
      const baseStyle = getStyleDocument(id);
      if (!baseStyle) {
        return reply.code(404).send(createErrorResponse('NOT_FOUND', `Style '${id}' not found`));
      }

      const regions = await listRegions(tilesDir, fastify.log);
      const requestedRegion = request.query.region;
      const activeRegion =
        requestedRegion && regions.some((r) => r.region === requestedRegion)
          ? requestedRegion
          : regions[0]?.region;

      const style = activeRegion ? rewriteSourceUrls(baseStyle, activeRegion) : baseStyle;
      const options = parseStyleOptions(request.query);
      return reply.code(200).send(applyStyleOptions(style, options));
    },
  );
};
