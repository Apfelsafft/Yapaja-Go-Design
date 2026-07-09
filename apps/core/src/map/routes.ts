/**
 * Fastify routes for PMTiles delivery and map region metadata.
 *
 * - GET /tiles/:region.pmtiles       range-request tile archive delivery
 * - GET /api/v1/map/regions          installed region metadata
 *
 * Note: the tiles route intentionally lives outside the /api/v1 prefix,
 * per docs/03-api-spec.md §2 ("Karten & Tiles").
 */

import { createReadStream } from 'fs';
import { stat as fsStat } from 'fs/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ApiError } from '@yapaja/shared';
import { parseRegionParam, resolveRegionFilePath, resolveTilesDir } from './paths.js';
import { parseRange } from './range.js';
import { listRegions, type MapRegionInfo } from './regions.js';

interface TileRouteParams {
  regionParam: string;
}

interface RegionsReply {
  data: MapRegionInfo[];
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
};
